import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { WebSocketServer, WebSocket } from 'ws';
import { 
  insertEarningSchema, 
  users, 
  earnings, 
  referrals, 
  withdrawals,
  userBalances,
  transactions,
  adminSettings,
  banLogs,
} from "../shared/schema";
import { db } from "./db";
import { eq, sql, desc, and, gte } from "drizzle-orm";
import crypto from "crypto";
import { sendTelegramMessage, sendUserTelegramNotification, sendWelcomeMessage, handleTelegramMessage, setupTelegramWebhook, verifyChannelMembership, sendSharePhotoToChat, getBotUsername, sendMissionResetNotification } from "./telegram";
import { authenticateTelegram, requireAuth, optionalAuth } from "./auth";
import { isAuthenticated } from "./replitAuth";
import { config, getChannelConfig } from "./config";

// Store WebSocket connections for real-time updates
// Map: sessionId -> { socket: WebSocket, userId: string }
const connectedUsers = new Map<string, { socket: WebSocket; userId: string }>();

const AXN_PER_TON = 100_000;
const REFERRAL_MILESTONE_AXN = 100;
const REFERRAL_MILESTONE_REWARD_GRAM = 0.01;
const REFERRAL_DEPOSIT_COMMISSION_RATE = 0.05;

function gramToNanoTon(amount: string): string {
  const normalized = amount.trim();
  if (!/^(?:\d+)(?:\.\d{1,9})?$/.test(normalized)) {
    throw new Error('Invalid GRAM amount');
  }
  const [whole, fraction = ''] = normalized.split('.');
  return (BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'))).toString();
}

/**
 * Deposit payments arrive in TON, while referral rewards are credited to the
 * GRAM balance. Convert the TON deposit to GRAM before calculating 5%.
 */
async function creditReferralDepositCommission(
  referredUserId: string,
  tonAmount: number,
  orderId: string,
): Promise<void> {
  const depositGram = tonAmount;
  const commission = depositGram * REFERRAL_DEPOSIT_COMMISSION_RATE;
  if (!Number.isFinite(commission) || commission <= 0) return;

  await db.transaction(async (tx) => {
    // Serialize duplicate webhook deliveries for this order before checking
    // the idempotency record.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${orderId}))`);

    const alreadyCredited = await tx.execute(sql`
      SELECT 1
      FROM transactions
      WHERE source = 'referral_deposit_commission'
        AND metadata->>'orderId' = ${orderId}
      LIMIT 1
    `);
    if ((alreadyCredited.rows || []).length > 0) return;

    const referralRows = await tx.execute(sql`
      SELECT referrer_id
      FROM referrals
      WHERE referee_id = ${referredUserId}
      LIMIT 1
    `);
    const referrerId = (referralRows.rows[0] as any)?.referrer_id;
    if (!referrerId) return;

    await tx.execute(sql`
      UPDATE users
      SET balance = COALESCE(balance::numeric, 0) + ${commission},
          total_earned = COALESCE(total_earned::numeric, 0) + ${commission},
          total_earnings = COALESCE(total_earnings::numeric, 0) + ${commission},
          updated_at = NOW()
      WHERE id = ${referrerId}
    `);
    await tx.execute(sql`
      UPDATE referrals
      SET deposit_commission_earned = COALESCE(deposit_commission_earned::numeric, 0) + ${commission}
      WHERE referrer_id = ${referrerId}
        AND referee_id = ${referredUserId}
    `);
    await tx.execute(sql`
      WITH earning_row AS (
        INSERT INTO earnings (user_id, amount, source, description)
        VALUES (
          ${referrerId},
          ${commission},
          'referral_deposit_commission',
          ${`5% deposit commission from referred friend (${tonAmount} TON)`}
        )
        RETURNING id
      )
      INSERT INTO transactions (user_id, amount, type, source, description, metadata)
      SELECT
        ${referrerId},
        ${commission},
        'addition',
        'referral_deposit_commission',
        'Automatic referral deposit commission',
        jsonb_build_object(
          'orderId', ${orderId},
          'referredUserId', ${referredUserId},
          'depositTon', ${tonAmount},
          'depositGram', ${depositGram},
          'rate', ${REFERRAL_DEPOSIT_COMMISSION_RATE}
        )
      FROM earning_row
    `);
  });
}

async function retryGramDepositCommission(deposit: {
  id: string;
  user_id: string;
  ton_amount_nano: string | number;
}): Promise<void> {
  try {
    await creditReferralDepositCommission(
      deposit.user_id,
      Number(deposit.ton_amount_nano) / 1e9,
      `gram_deposit_${deposit.id}`,
    );
  } catch (error) {
    // The deposit is already settled. Keep it credited and let the next
    // status request or poller pass retry the idempotent commission.
    console.error(`[GRAM-DEPOSIT] Referral commission retry failed for ${deposit.id}:`, error);
  }
}

/**
 * Find and settle one GRAM deposit intent. This is intentionally shared by
 * the user status endpoint and the background poller so manual transfers do
 * not depend on the popup staying open.
 */
async function settleGramDeposit(depositId: string): Promise<{
  success: boolean;
  status: 'pending' | 'credited' | 'failed';
  gramAmount?: string;
  paymentHash?: string;
  message?: string;
}> {
  const { pool } = await import('./db');
  const pendingResult = await pool.query(
    `SELECT * FROM gram_deposits WHERE id = $1`,
    [depositId],
  );
  const deposit = pendingResult.rows[0];
  if (!deposit) return { success: false, status: 'failed', message: 'Deposit request not found' };
  if (deposit.status === 'credited') {
    await retryGramDepositCommission(deposit);
    return { success: true, status: 'credited', gramAmount: String(deposit.gram_amount), paymentHash: deposit.payment_hash };
  }
  if (deposit.status !== 'pending' || new Date(deposit.expires_at).getTime() <= Date.now()) {
    await pool.query(
      `UPDATE gram_deposits SET status = 'failed' WHERE id = $1 AND status = 'pending'`,
      [deposit.id],
    );
    return { success: false, status: 'failed', message: 'Deposit request expired' };
  }

  const { checkDepositPaymentReceived } = await import('./ton-service');
  const payment = await checkDepositPaymentReceived(
    deposit.wallet_address,
    new Date(deposit.created_at),
    String(deposit.ton_amount_nano),
  );
  if (!payment.found || !payment.txHash) {
    return { success: false, status: 'pending', message: 'Payment not found yet' };
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Serialize all deposit intents that could claim the same on-chain
    // transaction. Locking only the current intent would allow a second
    // pending intent to credit the same payment after the first completes.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [payment.txHash]);
    const lockedResult = await client.query(
      `SELECT * FROM gram_deposits WHERE id = $1 FOR UPDATE`,
      [deposit.id],
    );
    const locked = lockedResult.rows[0];
    if (!locked) {
      await client.query('ROLLBACK');
      return { success: false, status: 'failed', message: 'Deposit request not found' };
    }
    if (locked.status === 'credited') {
      await client.query('COMMIT');
      return { success: true, status: 'credited', gramAmount: String(locked.gram_amount), paymentHash: locked.payment_hash };
    }

    const duplicate = await client.query(
      `SELECT id FROM gram_deposits WHERE payment_hash = $1 AND id <> $2 LIMIT 1`,
      [payment.txHash, locked.id],
    );
    if (duplicate.rows.length > 0) {
      await client.query(
        `UPDATE gram_deposits SET status = 'failed' WHERE id = $1 AND status = 'pending'`,
        [locked.id],
      );
      await client.query('COMMIT');
      return { success: false, status: 'failed', message: 'This blockchain payment has already been credited' };
    }

    const updatedUser = await client.query(
      `UPDATE users
       SET balance = COALESCE(balance::numeric, 0) + $1,
           total_earned = COALESCE(total_earned::numeric, 0) + $1,
           total_earnings = COALESCE(total_earnings::numeric, 0) + $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING id`,
       [locked.gram_amount, locked.user_id],
    );
    if (updatedUser.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, status: 'failed', message: 'User account not found' };
    }

    await client.query(
      `INSERT INTO earnings (user_id, amount, source, description)
       VALUES ($1, $2, 'gram_deposit', 'GRAM deposit verified on-chain')`,
      [locked.user_id, locked.gram_amount],
    );
    await client.query(
      `INSERT INTO transactions (user_id, amount, type, source, description, metadata)
        VALUES ($1, $2, 'addition', 'gram_deposit', 'GRAM deposit credited',
               jsonb_build_object('depositId', $3, 'paymentHash', $4, 'tonAmountNano', $5,
                                   'walletAddress', $6))`,
      [locked.user_id, locked.gram_amount, locked.id, payment.txHash, locked.ton_amount_nano, locked.wallet_address],
    );
    await client.query(
      `UPDATE gram_deposits
       SET status = 'credited', payment_hash = $1, credited_at = NOW()
       WHERE id = $2`,
      [payment.txHash, locked.id],
    );
    await client.query('COMMIT');

    await retryGramDepositCommission(locked);
    return {
      success: true,
      status: 'credited',
      gramAmount: String(locked.gram_amount),
      paymentHash: payment.txHash,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Function to verify session token against PostgreSQL sessions table
async function verifySessionToken(sessionToken: string): Promise<{ isValid: boolean; userId?: string }> {
  try {
    const { pool } = await import('./db');
    
    // Query the sessions table to find the session
    const result = await pool.query(
      'SELECT sess, expire FROM sessions WHERE sid = $1',
      [sessionToken]
    );
    
    if (result.rows.length === 0) {
      console.log('❌ Session not found in database:', sessionToken);
      return { isValid: false };
    }
    
    const sessionRow = result.rows[0];
    const sessionData = sessionRow.sess;
    const expireTime = new Date(sessionRow.expire);
    
    // Check if session has expired
    if (expireTime <= new Date()) {
      console.log('❌ Session expired:', sessionToken);
      return { isValid: false };
    }
    
    // Extract user information from session data
    // Session data structure from connect-pg-simple typically contains passport user data
    let userId: string | undefined;
    
    if (sessionData && typeof sessionData === 'object') {
      // Try different possible session data structures
      if (sessionData.user && sessionData.user.user && sessionData.user.user.id) {
        // Structure: { user: { user: { id: "uuid", ... } } }
        userId = sessionData.user.user.id;
      } else if (sessionData.user && sessionData.user.id) {
        // Structure: { user: { id: "uuid", ... } }
        userId = sessionData.user.id;
      } else if (sessionData.passport && sessionData.passport.user) {
        // Structure: { passport: { user: "userId" } }
        userId = sessionData.passport.user;
      }
    }
    
    if (!userId) {
      console.log('❌ No user ID found in session data:', sessionToken);
      return { isValid: false };
    }
    
    console.log(`✅ Session verified for user: ${userId}`);
    return { isValid: true, userId };
    
  } catch (error) {
    console.error('❌ Session verification error:', error);
    return { isValid: false };
  }
}

// Helper function to send real-time updates to a user
function sendRealtimeUpdate(userId: string, update: any) {
  let messagesSent = 0;
  
  // Find ALL sessions for this user and send to each one
  for (const [sessionId, connection] of connectedUsers.entries()) {
    if (connection.userId === userId && connection.socket.readyState === WebSocket.OPEN) {
      try {
        connection.socket.send(JSON.stringify(update));
        messagesSent++;
        console.log(`📤 Sent update to user ${userId}, session ${sessionId}`);
      } catch (error) {
        console.error(`❌ Failed to send update to user ${userId}, session ${sessionId}:`, error);
        // Remove dead connection
        connectedUsers.delete(sessionId);
      }
    }
  }
  
  console.log(`📊 Sent real-time update to ${messagesSent} sessions for user ${userId}`);
  return messagesSent > 0;
}

// Broadcast update to all connected users
function broadcastUpdate(update: any) {
  let messagesSent = 0;
  connectedUsers.forEach((connection, sessionId) => {
    if (connection.socket.readyState === WebSocket.OPEN) {
      try {
        connection.socket.send(JSON.stringify(update));
        messagesSent++;
      } catch (error) {
        console.error(`❌ Failed to broadcast to session ${sessionId}:`, error);
        connectedUsers.delete(sessionId);
      }
    }
  });
  console.log(`📡 Broadcast sent to ${messagesSent} connected sessions`);
  return messagesSent;
}

// Check if user is admin
const isAdmin = (telegramId: string): boolean => {
  const adminId = process.env.TELEGRAM_ADMIN_ID;
  if (!adminId) {
    console.warn('⚠️ TELEGRAM_ADMIN_ID not set - admin access disabled');
    return false;
  }
  // Ensure both values are strings for comparison
  const idStr = telegramId.toString();
  return adminId.toString() === idStr;
};

// Admin authentication middleware. Telegram signatures are mandatory for
// every environment where admin actions are available.
const authenticateAdmin = async (req: any, res: any, next: any) => {
  try {
    const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const adminId = process.env.TELEGRAM_ADMIN_ID;

    console.log(`🔍 Admin auth check: TELEGRAM_ADMIN_ID=${adminId}`);

    if (!telegramData || !botToken || !adminId) {
      console.log('❌ Admin auth failed: Telegram data, bot token, or admin ID is missing');
      return res.status(401).json({ message: "Admin access denied - verified Telegram authentication is required" });
    }

    const { verifyTelegramWebAppData } = await import('./auth');
    const { isValid, user: telegramUser } = verifyTelegramWebAppData(telegramData, botToken);
    if (!isValid || !telegramUser) {
      console.log('❌ Admin auth failed: Invalid Telegram signature');
      return res.status(401).json({ message: "Admin access denied - Telegram authentication could not be verified" });
    }

    if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
      console.log(`❌ Admin auth denied: User ${telegramUser?.id} is not admin`);
      return res.status(403).json({ message: "Admin access required" });
    }

    console.log(`✅ Admin authenticated: ${telegramUser.id}`);
    req.user = { telegramUser };
    next();
  } catch (error) {
    console.error("Admin auth error:", error);
    res.status(401).json({ message: "Authentication failed" });
  }
};

// Authentication middleware has been moved to server/auth.ts for better organization


export async function registerRoutes(app: Express): Promise<Server> {
  console.log('🔧 Registering API routes...');
  
  // Create HTTP server first
  const httpServer = createServer(app);
  
  // Set up WebSocket server for real-time updates  
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  
  // Helper function to broadcast to all connected clients
  const broadcastToAll = (message: object) => {
    const messageStr = JSON.stringify(message);
    wss.clients.forEach((client: WebSocket) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    });
  };
  
  wss.on('connection', (ws: WebSocket, req) => {
    console.log('🔌 New WebSocket connection established');
    let sessionId: string | null = null;
    
    ws.on('message', async (message) => {
      try {
        const data = JSON.parse(message.toString());
        
        // Handle different message types
        if (data.type === 'auth') {
          if (!data.sessionToken) {
            console.log('❌ Missing sessionToken in auth message');
            ws.send(JSON.stringify({
              type: 'auth_error',
              message: 'Missing sessionToken. Expected format: {"type": "auth", "sessionToken": "<token>"}'
            }));
            return;
          }

          // Verify session token securely
          try {
            // In development mode ONLY, allow test user authentication
            if (process.env.NODE_ENV === 'development' && data.sessionToken === 'test-session') {
              const testUserId = 'f47ac10b-58cc-4372-a567-0e02b2c3d479';
              sessionId = `session_${Date.now()}_${Math.random()}`;
              connectedUsers.set(sessionId, { socket: ws, userId: testUserId });
              console.log(`👤 Test user connected via WebSocket: ${testUserId}`);
              
              ws.send(JSON.stringify({
                type: 'connected',
                message: 'Real-time updates enabled! 🚀'
              }));
              return;
            }
            
            // Production mode: Verify session token against PostgreSQL sessions table
            const { isValid, userId } = await verifySessionToken(data.sessionToken);
            
            if (!isValid || !userId) {
              console.log(`❌ WebSocket authentication failed for token: ${data.sessionToken}`);
              ws.send(JSON.stringify({
                type: 'auth_error',
                message: 'Invalid or expired session. Please refresh the page and try again.'
              }));
              return;
            }
            
            // Session verified successfully - establish WebSocket connection
            sessionId = `session_${Date.now()}_${Math.random()}`;
            connectedUsers.set(sessionId, { socket: ws, userId });
            console.log(`👤 User ${userId} connected via WebSocket (verified session)`);
            
            ws.send(JSON.stringify({
              type: 'connected',
              message: 'Real-time updates enabled! 🚀',
              userId: userId
            }));
          } catch (authError) {
            console.error('❌ WebSocket auth error:', authError);
            ws.send(JSON.stringify({
              type: 'auth_error', 
              message: 'Authentication failed'
            }));
          }
        } else if (data.type === 'ping') {
          // Handle ping messages
          ws.send(JSON.stringify({ type: 'pong' }));
        } else {
          // Handle invalid message types
          console.log(`❌ Invalid WebSocket message type: ${data.type || 'undefined'}`);
          ws.send(JSON.stringify({
            type: 'error',
            message: `Invalid message type. Expected "auth" but received "${data.type || 'undefined'}". Format: {"type": "auth", "sessionToken": "<token>"}`
          }));
        }
      } catch (error) {
        console.error('❌ WebSocket message parsing error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid JSON format. Expected: {"type": "auth", "sessionToken": "<token>"}'
        }));
      }
    });
    
    ws.on('close', () => {
      // Remove session from connected list
      if (sessionId) {
        const connection = connectedUsers.get(sessionId);
        if (connection) {
          connectedUsers.delete(sessionId);
          console.log(`👋 User ${connection.userId} disconnected from WebSocket`);
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket error:', error);
    });
  });
  
  // NOTE: /api/auth/user is fully handled at line ~1606 with fresh DB fetch

  app.get("/api/admin/settings", authenticateAdmin, async (req, res) => {
    try {
      const settings = await storage.getAllAdminSettings();
      const settingsMap: Record<string, string | boolean> = {};
      settings.forEach(s => {
        if (s.settingValue === 'true') settingsMap[s.settingKey] = true;
        else if (s.settingValue === 'false') settingsMap[s.settingKey] = false;
        else settingsMap[s.settingKey] = s.settingValue;
      });
      res.json(settingsMap);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch settings" });
    }
  });

  app.put("/api/admin/settings", authenticateAdmin, async (req, res) => {
    try {
      const settings = req.body;
      console.log('💾 Saving admin settings (PUT):', JSON.stringify(settings));
      
      for (const [key, value] of Object.entries(settings)) {
        if (value !== undefined && value !== null) {
          await storage.updateAdminSetting(key, String(value));
        }
      }
      
      if (settings.minimum_withdrawal_ton || settings.withdrawal_fee_ton) {
        const minWithdraw = parseFloat(String(settings.minimum_withdrawal_ton || '0.1'));
        const fee = parseFloat(String(settings.withdrawal_fee_ton || '0.01'));
        await storage.updatePaymentSystemsFromSettings(minWithdraw, fee);
      }
      
      res.json({ success: true, message: "Settings updated successfully" });
    } catch (error) {
      console.error('❌ Failed to update settings:', error);
      res.status(500).json({ success: false, message: "Failed to update settings" });
    }
  });


  // GET /api/withdraw/eligibility — everything the Withdraw popup needs to
  // show requirements/limits before the user submits a request.
  app.get("/api/withdraw/eligibility", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const eligibility = await storage.getWithdrawalEligibility(user.id);
      res.json(eligibility);
    } catch (error) {
      console.error("Withdrawal eligibility error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/withdrawals", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { amount, address } = req.body;

      if (!amount || isNaN(parseFloat(String(amount))) || parseFloat(String(amount)) <= 0) {
        return res.status(400).json({ message: "Invalid withdrawal amount" });
      }
      if (!address || typeof address !== 'string' || address.trim().length < 4) {
        return res.status(400).json({ message: "A valid wallet address is required" });
      }

      const withdrawAmount = parseFloat(String(amount));
      // All rule validation (ads completed today, 1-per-day, min/max, balance)
      // and the balance deduction happen atomically inside this call.
      const result = await storage.createAxnWithdrawalRequest(user.id, withdrawAmount.toString(), address.trim());
      if (!result.success) return res.status(400).json({ message: result.message });

      // Send real-time balance update + withdrawal notification to the user immediately
      try {
        const freshUser = await storage.getUser(user.id);
        if (freshUser) {
          sendRealtimeUpdate(user.id, {
            type: 'withdrawal_requested',
            walletBalance: freshUser.walletBalance?.toString() ?? '0',
          });
        }
      } catch (wsError) {
        console.error("Failed to send real-time withdrawal update:", wsError);
      }

      // Send Telegram notification to admin
      try {
        const { sendWithdrawalRequestNotification } = await import("./telegram");
        const fullUser = await storage.getUser(user.id);
        const withdrawal = await storage.getWithdrawal(result.withdrawalId!);
        if (fullUser && withdrawal) {
          await sendWithdrawalRequestNotification(withdrawal, fullUser);
        }
      } catch (notifyError) {
        console.error("Failed to send withdrawal request notification:", notifyError);
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // Mining system removed — rewards are milestone-based only

  // GET /api/ads/slot-cooldowns — return per-slot cooldown state for current user
  app.get("/api/ads/slot-cooldowns", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ad_slot_cooldowns (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR NOT NULL,
          slot INTEGER NOT NULL,
          last_watched_at TIMESTAMP NOT NULL DEFAULT NOW(),
          UNIQUE(user_id, slot)
        )
      `);
      const rows = await db.execute(sql`
        SELECT slot, last_watched_at FROM ad_slot_cooldowns WHERE user_id = ${user.id}
      `);
      const now = Date.now();
      const todayUTC = new Date(); todayUTC.setUTCHours(0,0,0,0);
      const tomorrowUTC = new Date(todayUTC.getTime() + 86400000);
      const cooldowns: Record<number, { availableAt: number; msLeft: number }> = {};
      for (const row of rows.rows || []) {
        const slot = Number((row as any).slot);
        const lastWatched = new Date((row as any).last_watched_at);
        if (lastWatched >= todayUTC) {
          const msLeft = Math.max(0, tomorrowUTC.getTime() - now);
          cooldowns[slot] = { availableAt: tomorrowUTC.getTime(), msLeft };
        }
      }
      res.json({ cooldowns });
    } catch (error) {
      console.error("Slot cooldowns error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/ads/provider-status — provider-level daily counters for the Earn page
  app.get("/api/ads/provider-status", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const providerConfig: Record<string, { slot: number; reward: number; dailyLimit: number }> = {
        Monetag: { slot: 1, reward: 0.005, dailyLimit: 10 },
        AdsGram: { slot: 2, reward: 0.007, dailyLimit: 10 },
        Gigapub: { slot: 3, reward: 0.005, dailyLimit: 10 },
      };

      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ad_slot_watches (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR NOT NULL,
          slot INTEGER NOT NULL,
          watch_date DATE NOT NULL DEFAULT CURRENT_DATE,
          watch_count INTEGER NOT NULL DEFAULT 1,
          UNIQUE(user_id, slot, watch_date)
        )
      `);

      const todayDate = new Date().toISOString().slice(0, 10);
      const rows = await db.execute(sql`
        SELECT slot, watch_count
        FROM ad_slot_watches
        WHERE user_id = ${user.id} AND watch_date = ${todayDate}::date
      `);
      const counts: Record<number, number> = {};
      for (const row of rows.rows || []) {
        counts[Number((row as any).slot)] = Number((row as any).watch_count);
      }

      const resetAt = new Date();
      resetAt.setUTCHours(24, 0, 0, 0);
      const resetMs = Math.max(0, resetAt.getTime() - Date.now());
      const providers = Object.fromEntries(Object.entries(providerConfig).map(([name, config]) => {
        const watched = Math.min(counts[config.slot] || 0, config.dailyLimit);
        return [name, {
          ...config,
          watched,
          remaining: config.dailyLimit - watched,
          resetAt: resetAt.toISOString(),
          resetMs,
        }];
      }));

      res.json({ providers });
    } catch (error) {
      console.error("Provider ad status error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // POST /api/ads/slot-watch — watch ad for a specific slot (daily count-based limit)
  app.post("/api/ads/slot-watch", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { slot } = req.body;
      if (!slot || typeof slot !== 'number') return res.status(400).json({ message: "Missing slot" });

      // Provider slots use independent 10-ad daily limits.
      const AD_SLOT_CONFIG: Record<number, { reward: number; dailyLimit: number }> = {
        1: { reward: 0.005, dailyLimit: 10 },
        2: { reward: 0.007, dailyLimit: 10 },
        3: { reward: 0.005, dailyLimit: 10 },
      };
      const config = AD_SLOT_CONFIG[slot];
      if (!config) return res.status(400).json({ message: "Invalid ad slot" });

      // Ensure count-based tracking table exists
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS ad_slot_watches (
          id SERIAL PRIMARY KEY,
          user_id VARCHAR NOT NULL,
          slot INTEGER NOT NULL,
          watch_date DATE NOT NULL DEFAULT CURRENT_DATE,
          watch_count INTEGER NOT NULL DEFAULT 1,
          UNIQUE(user_id, slot, watch_date)
        )
      `);

      // Get today's watch count for this user+slot
      const todayDate = new Date().toISOString().slice(0, 10);
      const countRows = await db.execute(sql`
        SELECT watch_count FROM ad_slot_watches
        WHERE user_id = ${user.id} AND slot = ${slot} AND watch_date = ${todayDate}::date
      `);
      const currentCount: number = countRows.rows.length > 0
        ? Number((countRows.rows[0] as any).watch_count)
        : 0;

      if (currentCount >= config.dailyLimit) {
        const tomorrowMidnightMs = new Date(new Date().setUTCHours(24, 0, 0, 0)).getTime();
        const msLeft = Math.max(0, tomorrowMidnightMs - Date.now());
        const hours = Math.ceil(msLeft / 3600000);
        return res.status(429).json({
          message: `Daily limit reached (${config.dailyLimit}/${config.dailyLimit}). Resets in ${hours}h.`,
          msLeft,
          currentCount,
          dailyLimit: config.dailyLimit,
        });
      }

      // Increment the daily watch count (upsert)
      await db.execute(sql`
        INSERT INTO ad_slot_watches (user_id, slot, watch_date, watch_count)
        VALUES (${user.id}, ${slot}, ${todayDate}::date, 1)
        ON CONFLICT (user_id, slot, watch_date)
        DO UPDATE SET watch_count = ad_slot_watches.watch_count + 1
      `);

      const rewardAmount = config.reward.toString();
      await storage.addEarning({
        userId: user.id,
        amount: rewardAmount,
        source: "ad_slot_watch",
        description: `Ad slot ${slot} reward`,
      });

      const newCount = currentCount + 1;
      const updatedUser = await storage.getUser(user.id);
      const tomorrowMidnightMs = new Date(new Date().setUTCHours(24, 0, 0, 0)).getTime();
      const cooldownMs = Math.max(0, tomorrowMidnightMs - Date.now());

      res.json({
        success: true,
        newBalance: updatedUser?.balance,
        rewardGram: config.reward,
        slot,
        currentCount: newCount,
        dailyLimit: config.dailyLimit,
        cooldownMs,
      });
    } catch (error) {
      console.error("Slot watch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // GET /api/referrals/new-count — count referrals after milestone baseline date
  app.get("/api/referrals/new-count", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      // Only count referrals created after May 25 2026 (new milestone system)
      const BASELINE_DATE = '2026-05-25';
      const result = await db.execute(sql`
        SELECT COUNT(*) as count FROM referrals r
        JOIN users u ON u.id = r.referee_id
        WHERE r.referrer_id = ${user.id}
          AND r.status = 'completed'
          AND u.banned = FALSE
          AND r.created_at >= ${BASELINE_DATE}::date
      `);
      const count = parseInt((result.rows?.[0] as any)?.count || "0");
      res.json({ count });
    } catch (error) {
      console.error("New referral count error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get("/api/deposits", authenticateTelegram, async (_req: any, res) => {
    res.json([]);
  });

  app.post("/api/deposits", authenticateTelegram, async (_req: any, res: any) => {
    res.status(410).json({ message: "Deposit system has been removed." });
  });

  app.get("/api/transactions", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      
      const [userTransactions, userWithdrawals] = await Promise.all([
        db.select().from(transactions).where(eq(transactions.userId, user.id)).orderBy(desc(transactions.createdAt)),
        storage.getUserWithdrawals(user.id),
      ]);

      res.json({
        transactions: userTransactions,
        withdrawals: userWithdrawals,
        deposits: []
      });
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get('/api/health', async (req: any, res) => {
    try {
      const dbCheck = await db.select({ count: sql<number>`count(*)` }).from(users);
      const userCount = dbCheck[0]?.count || 0;
      
      const envCheck = {
        DATABASE_URL: !!process.env.DATABASE_URL,
        TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
        SESSION_SECRET: !!process.env.SESSION_SECRET,
        NODE_ENV: process.env.NODE_ENV || 'unknown'
      };
      
      res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          userCount
        },
        environment: envCheck,
        websockets: {
          activeConnections: connectedUsers.size
        }
      });
    } catch (error) {
      console.error('❌ Health check failed:', error);
      res.status(500).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        database: {
          connected: false,
          error: error instanceof Error ? error.message : String(error)
        },
        environment: {
          DATABASE_URL: !!process.env.DATABASE_URL,
          NODE_ENV: process.env.NODE_ENV || 'unknown'
        }
      });
    }
  });

  // POST /api/daily-checkin — claim 0.001 GRAM daily bonus
  app.post('/api/daily-checkin', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user.user;
      const { pool: dbPool } = await import('./db');
      const todayKey = new Date().toISOString().slice(0, 10);
      const reward = 0.001;

      // Single atomic conditional UPDATE: prevents concurrent double-claims.
      const result = await dbPool.query(
        `UPDATE users
         SET daily_tasks_date = CASE
               WHEN daily_tasks_date IS NOT NULL AND daily_tasks_date::date = ($1)::date
                 THEN daily_tasks_date
               ELSE NOW()
             END,
             daily_checkin_claimed = TRUE,
             balance = COALESCE(balance::numeric, 0) + $2
         WHERE id = $3
           AND NOT (
             daily_tasks_date IS NOT NULL
             AND daily_tasks_date::date = ($1)::date
             AND daily_checkin_claimed = TRUE
           )
         RETURNING id`,
        [todayKey, reward, user.id]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Already claimed today' });
      }

      res.json({ success: true, reward, message: `Daily check-in! +${reward} GRAM` });
    } catch (error) {
      console.error('Daily checkin error:', error);
      res.status(500).json({ success: false, message: 'Failed to claim daily check-in' });
    }
  });

  // POST /api/mystery-box — claim random GRAM (0.00001–0.01), up to 5 times per day
  app.post('/api/mystery-box', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user.user;
      const { pool: dbPool } = await import('./db');
      const todayKey = new Date().toISOString().slice(0, 10);
      const DAILY_LIMIT = 5;

      const reward = (Math.floor(Math.random() * 1000) + 1) / 100_000;

      // Single atomic conditional UPDATE: enforces the daily limit and increments
      // the counter in one statement, so concurrent requests cannot exceed 5/day.
      const result = await dbPool.query(
        `UPDATE users
         SET mystery_box_count = CASE
               WHEN mystery_box_date IS NOT NULL AND mystery_box_date::date = ($1)::date
                 THEN COALESCE(mystery_box_count, 0) + 1
               ELSE 1
             END,
             mystery_box_date = NOW(),
             balance = COALESCE(balance::numeric, 0) + $2
         WHERE id = $3
           AND (
             mystery_box_date IS NULL
             OR mystery_box_date::date <> ($1)::date
             OR COALESCE(mystery_box_count, 0) < $4
           )
         RETURNING mystery_box_count`,
        [todayKey, reward, user.id, DAILY_LIMIT]
      );

      if (result.rows.length === 0) {
        return res.status(400).json({ success: false, message: 'Daily limit reached (5 mystery gifts per day)' });
      }

      const newCount = result.rows[0].mystery_box_count;

      res.json({
        success: true,
        reward,
        claimsToday: newCount,
        remaining: Math.max(0, DAILY_LIMIT - newCount),
        message: `You won ${reward} GRAM from the mystery gift!`,
      });
    } catch (error) {
      console.error('Mystery box error:', error);
      res.status(500).json({ success: false, message: 'Failed to open mystery box' });
    }
  });

  // Project Statistics endpoint
  app.get('/api/project/stats', async (req: any, res) => {
    try {
      const now = new Date();
      const todayISO = now.toISOString().slice(0, 10); // YYYY-MM-DD

      const safeQuery = async (fn: () => Promise<any>, fallback: any) => {
        try { return await fn(); } catch { return fallback; }
      };

      const [
        totalUsers,
        totalWithdrawalsAmount,
        totalWithdrawalsCount,
        oldestUser,
        totalEarnings,
        todayEarnings,
        dau,
        wau,
        totalReferrals,
        wauPrev,
      ] = await Promise.all([
        safeQuery(async () => Number((await db.select({ c: sql<string>`count(*)::text` }).from(users))[0]?.c || 0), 0),
        safeQuery(async () => Number((await db.execute(sql`SELECT COALESCE(SUM(amount::numeric), 0)::text AS v FROM withdrawals`) as any).rows[0]?.v || 0), 0),
        safeQuery(async () => Number((await db.execute(sql`SELECT count(*)::text AS v FROM withdrawals`) as any).rows[0]?.v || 0), 0),
        safeQuery(async () => (await db.select({ createdAt: users.createdAt }).from(users).orderBy(users.createdAt).limit(1))[0]?.createdAt || null, null),
        safeQuery(async () => Number((await db.execute(sql`SELECT COALESCE(SUM(amount::numeric), 0)::text AS v FROM earnings`) as any).rows[0]?.v || 0), 0),
        safeQuery(async () => Number((await db.execute(sql`SELECT COALESCE(SUM(amount::numeric), 0)::text AS v FROM earnings WHERE created_at::date = ${todayISO}::date`) as any).rows[0]?.v || 0), 0),
        safeQuery(async () => Number((await db.execute(sql`SELECT COUNT(DISTINCT user_id)::text AS v FROM earnings WHERE created_at >= NOW() - INTERVAL '1 day'`) as any).rows[0]?.v || 0), 0),
        safeQuery(async () => Number((await db.execute(sql`SELECT COUNT(DISTINCT user_id)::text AS v FROM earnings WHERE created_at >= NOW() - INTERVAL '7 days'`) as any).rows[0]?.v || 0), 0),
        safeQuery(async () => Number((await db.select({ c: sql<string>`count(*)::text` }).from(referrals))[0]?.c || 0), 0),
        safeQuery(async () => Number((await db.execute(sql`SELECT COUNT(DISTINCT user_id)::text AS v FROM earnings WHERE created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days'`) as any).rows[0]?.v || 0), 0),
      ]);

      const onlineNow = await safeQuery(
        async () => {
          const wsCount = connectedUsers.size;
          if (wsCount > 0) return wsCount;
          // Fallback: count users active in last 10 minutes via last_login_at
          const result = (await db.execute(sql`SELECT count(*)::text AS v FROM users WHERE last_login_at >= NOW() - INTERVAL '10 minutes'`) as any).rows[0]?.v;
          return Number(result || 0);
        },
        0
      );
      const projectStartDate = oldestUser ? new Date(oldestUser) : now;
      const projectAgeDays = Math.floor((now.getTime() - projectStartDate.getTime()) / (1000 * 60 * 60 * 24));
      const uptimePct = parseFloat(Math.min(100, 99.5 + Math.min(0.5, process.uptime() / 86400 * 0.5)).toFixed(2));
      const retentionRate = wau > 0 && totalUsers > 0 ? Math.min(100, Math.round((Math.min(wau, wauPrev > 0 ? wauPrev : wau) / Math.max(wau, 1)) * 100)) : 0;

      res.json({
        totalUsers,
        onlineNow,
        totalWithdrawalsAmount,
        totalWithdrawalsCount,
        projectAgeDays,
        totalEarnings,
        todayEarnings,
        dau,
        wau,
        totalReferrals,
        uptimePct,
        retentionRate,
      });
    } catch (error) {
      console.error('Project stats error:', error);
      res.status(500).json({ message: 'Failed to fetch project stats' });
    }
  });

  // Get channel configuration for frontend
  app.get('/api/config/channel', (req: any, res) => {
    res.json(getChannelConfig());
  });

  // Get bot info (username fetched dynamically from Telegram API)
  app.get('/api/bot-info', async (req: any, res) => {
    try {
      const username = await getBotUsername();
      res.json({ success: true, username });
    } catch (error) {
      res.status(500).json({ success: false, username: process.env.BOT_USERNAME || 'bot' });
    }
  });

  // Secure check-membership endpoint for initial app load
  // Verifies Telegram initData signature before trusting user ID
  app.get('/api/check-membership', async (req: any, res) => {
    try {
      const isDevMode = process.env.NODE_ENV === 'development';
      const channelConfig = getChannelConfig();

      // Check if channel join requirement is enabled
      const allSettings = await storage.getAllAdminSettings();
      const channelJoinSetting = allSettings.find(s => s.settingKey === 'channel_join_required');
      const channelJoinRequired = channelJoinSetting ? channelJoinSetting.settingValue !== 'false' : true;

      // If channel join requirement is disabled, let everyone in
      if (!channelJoinRequired) {
        console.log('🔧 Channel join requirement is OFF - granting access');
        return res.json({
          success: true,
          isVerified: true,
          channelMember: true,
          groupMember: true,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName
        });
      }
      
      // In dev mode, skip verification to allow easy testing
      if (isDevMode) {
        console.log('🔧 Development mode: Skipping channel join check');
        return res.json({
          success: true,
          isVerified: true,
          channelMember: true,
          groupMember: true,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName
        });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        // SECURITY: Fail closed when bot token is missing
        console.log('❌ TELEGRAM_BOT_TOKEN not configured - blocking access');
        return res.json({ 
          success: false, 
          isVerified: false,
          channelMember: false,
          groupMember: false,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName,
          message: 'Bot token not configured'
        });
      }
      
      // Get Telegram initData from headers - this contains the cryptographic signature
      const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
      
      if (!telegramData) {
        console.log('⚠️ check-membership: No Telegram data provided - requiring auth');
        return res.json({ 
          success: false, 
          isVerified: false,
          channelMember: false,
          groupMember: false,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName,
          message: 'Authentication required'
        });
      }
      
      // SECURITY: Verify Telegram initData signature to prevent spoofing
      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(telegramData, botToken);
      
      if (!isValid || !telegramUser || !telegramUser.id) {
        console.log('❌ check-membership: Invalid Telegram signature - blocking access');
        return res.json({ 
          success: false, 
          isVerified: false,
          channelMember: false,
          groupMember: false,
          channelUrl: channelConfig.channelUrl,
          groupUrl: channelConfig.groupUrl,
          channelName: channelConfig.channelName,
          groupName: channelConfig.groupName,
          message: 'Invalid authentication signature'
        });
      }
      
      const telegramId = telegramUser.id.toString();
      const userId = parseInt(telegramId, 10);

      // 1. BAN CHECK FIRST
      const user = await storage.getUserByTelegramId(telegramId);
      if (user?.banned) {
        console.log(`🚫 Banned user ${telegramId} blocked at membership check`);
        return res.json({
          success: true,
          banned: true,
          reason: user.bannedReason,
          banType: (user as any).banType || 'system',
          adminBanReason: (user as any).adminBanReason || null,
          isVerified: true // Don't show join screen if banned
        });
      }

      // 2. ALL CHANNELS AND GROUP JOIN REQUIRED
      const channel2Member = await verifyChannelMembership(userId, channelConfig.channel2Id, botToken);
      const channelMember = await verifyChannelMembership(userId, channelConfig.channelId, botToken);
      const groupMember = await verifyChannelMembership(userId, channelConfig.groupId, botToken);
      
      const isVerified = channel2Member && groupMember;
      
      console.log(`🔍 check-membership for ${telegramId}: channel2=${channel2Member}, channel=${channelMember}, group=${groupMember}, verified=${isVerified}`);
      
      // Update user status in database to match current membership state
      if (user) {
        await storage.updateUserVerificationStatus(user.id, isVerified);
        // AUTO-ACTIVATE: If user just joined channel, activate any pending referrals immediately
        if (channelMember) {
          await storage.checkAndActivateReferralOnChannelJoin(user.id);
        }
      }
      
      res.json({
        success: true,
        isVerified,
        channel2Member,
        channelMember,
        groupMember,
        moneyCatsMember: true,
        channel2Url: channelConfig.channel2Url,
        channelUrl: channelConfig.channelUrl,
        groupUrl: channelConfig.groupUrl,
        moneyCatsUrl: '',
        channel2Name: channelConfig.channel2Name,
        channelName: channelConfig.channelName,
        groupName: channelConfig.groupName,
        moneyCatsName: ''
      });
    } catch (error) {
      console.error('❌ check-membership error:', error);
      const channelConfig = getChannelConfig();
      res.json({ 
        success: false, 
        isVerified: false,
        channelMember: false,
        groupMember: false,
        moneyCatsMember: false,
        channelUrl: channelConfig.channelUrl,
        groupUrl: channelConfig.groupUrl,
        moneyCatsUrl: '',
        channelName: channelConfig.channelName,
        groupName: channelConfig.groupName,
        moneyCatsName: '',
        message: 'Failed to check membership'
      });
    }
  });

  app.post("/api/convert-to-ton", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });

      const { axnAmount } = req.body;
      if (!axnAmount || isNaN(axnAmount) || axnAmount <= 0) {
        return res.status(400).json({ message: "Invalid amount" });
      }

      const result = await storage.convertAXNToTon(user.id, parseFloat(axnAmount));
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      res.json(result);
    } catch (error) {
      console.error("Conversion error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================================
  // FARMING ROUTES
  // ============================================================

  app.get("/api/farming/state", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const state = await storage.getFarmingState(user.id);
      res.json(state);
    } catch (error) {
      console.error("Farming state error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/farming/start", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await storage.startFarming(user.id);
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    } catch (error) {
      console.error("Farming start error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/farming/claim", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const result = await storage.claimFarming(user.id);
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    } catch (error) {
      console.error("Farming claim error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ============================================================
  // MACHINE ROUTES
  // ============================================================

  app.get("/api/machines", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const machines = await storage.getUserMachines(user.id);
      const stats = await storage.getMachineStats(user.id);
      res.json({ machines, stats });
    } catch (error) {
      console.error("Machines fetch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/machines/buy", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { machineType } = req.body;
      if (!machineType) return res.status(400).json({ message: "machineType is required" });
      const result = await storage.purchaseMachine(user.id, machineType);
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    } catch (error) {
      console.error("Machine purchase error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/machines/claim", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { machineType } = req.body || {};
      const result = await storage.claimMachineRewards(user.id, machineType);
      if (!result.success) return res.status(400).json(result);
      res.json(result);
    } catch (error) {
      console.error("Machine claim error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Ad Slots API ───
  const AD_SLOTS = [
    { id: 1, reward: 0.0001, maxWatches: 40, network: "monetag" },
    { id: 2, reward: 0.00015, maxWatches: 35, network: "monetag" },
    { id: 3, reward: 0.0002, maxWatches: 25, network: "adsgram" },
    { id: 4, reward: 0.00008, maxWatches: 50, network: "monetag" },
    { id: 5, reward: 0.00025, maxWatches: 15, network: "adsgram" },
    { id: 6, reward: 0.00012, maxWatches: 30, network: "monetag" },
    { id: 7, reward: 0.00018, maxWatches: 25, network: "adsgram" },
  ];

  app.get("/api/ad-slots", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { pool } = await import("./db");
      const result = await pool.query(
        `SELECT ad_slot, watched_count FROM user_ad_watches WHERE user_id = $1`,
        [user.id]
      );
      const watchMap: Record<number, number> = {};
      result.rows.forEach((r: any) => { watchMap[r.ad_slot] = r.watched_count; });
      const slots = AD_SLOTS.map(s => ({
        ...s,
        watchedCount: watchMap[s.id] ?? 0,
        totalGram: s.reward * s.maxWatches,
      }));
      res.json({ slots });
    } catch (error) {
      console.error("Ad slots error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/ad-slots/:slotId/watch", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const slotId = parseInt(req.params.slotId);
      const slot = AD_SLOTS.find(s => s.id === slotId);
      if (!slot) return res.status(404).json({ message: "Ad slot not found" });

      // Require client to send verified background seconds
      const { backgroundSeconds } = req.body;
      if (!backgroundSeconds || typeof backgroundSeconds !== "number" || backgroundSeconds < 5) {
        return res.status(400).json({
          message: "Ad not counted",
          reason: "insufficient_background",
          notCounted: true,
        });
      }

      const { pool } = await import("./db");
      // Get or create watch record + cooldown check
      const existing = await pool.query(
        `SELECT watched_count, last_watched_at FROM user_ad_watches WHERE user_id = $1 AND ad_slot = $2`,
        [user.id, slotId]
      );
      const row = existing.rows[0];
      const currentCount = row?.watched_count ?? 0;

      if (currentCount >= slot.maxWatches) {
        return res.status(400).json({ message: "Max watches reached for this ad", maxReached: true });
      }

      // Cooldown: 30 seconds between watches on same slot
      if (row?.last_watched_at) {
        const secsSinceLast = (Date.now() - new Date(row.last_watched_at).getTime()) / 1000;
        if (secsSinceLast < 30) {
          return res.status(429).json({
            message: "Please wait before watching this ad again",
            cooldownSeconds: Math.ceil(30 - secsSinceLast),
            tooFast: true,
          });
        }
      }

      // Upsert watch count + last_watched_at
      await pool.query(
        `INSERT INTO user_ad_watches (user_id, ad_slot, watched_count, last_watched_at, updated_at)
         VALUES ($1, $2, 1, NOW(), NOW())
         ON CONFLICT (user_id, ad_slot)
         DO UPDATE SET
           watched_count = user_ad_watches.watched_count + 1,
           last_watched_at = NOW(),
           updated_at = NOW()`,
        [user.id, slotId]
      );
      // Credit the GRAM earning balance for watching an ad slot.
      await pool.query(
        `UPDATE users SET balance = COALESCE(balance::numeric, 0) + $1 WHERE id = $2`,
        [slot.reward, user.id]
      );
      const newCount = currentCount + 1;
      res.json({ success: true, earned: slot.reward, gramEarned: slot.reward, watchedCount: newCount, maxWatches: slot.maxWatches });
    } catch (error) {
      console.error("Ad slot watch error:", error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Daily Tasks API ───
  app.post("/api/daily-tasks/claim/:taskType", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { taskType } = req.params;
      if (!["checkin", "invite", "updates"].includes(taskType)) {
        return res.status(400).json({ message: "Invalid task type" });
      }

      const { pool } = await import("./db");
      const userRow = await pool.query(`SELECT daily_tasks_date, daily_checkin_claimed, daily_invite_claimed, daily_updates_claimed, friends_invited FROM users WHERE id = $1`, [user.id]);
      const u = userRow.rows[0];
      if (!u) return res.status(404).json({ message: "User not found" });

      const lastDate = u.daily_tasks_date ? new Date(u.daily_tasks_date) : null;
      const today = new Date();
      const isNewDay = !lastDate ||
        lastDate.getUTCFullYear() !== today.getUTCFullYear() ||
        lastDate.getUTCMonth() !== today.getUTCMonth() ||
        lastDate.getUTCDate() !== today.getUTCDate();

      if (isNewDay) {
        await pool.query(`UPDATE users SET daily_checkin_claimed = FALSE, daily_invite_claimed = FALSE, daily_updates_claimed = FALSE, daily_tasks_date = NOW() WHERE id = $1`, [user.id]);
        u.daily_checkin_claimed = false;
        u.daily_invite_claimed = false;
        u.daily_updates_claimed = false;
      }

      const claimedField: Record<string, string> = {
        checkin: "daily_checkin_claimed",
        invite: "daily_invite_claimed",
        updates: "daily_updates_claimed",
      };
      const gramMap: Record<string, number> = { checkin: 0.00005, invite: 0.0005, updates: 0.00005 };
      const fieldName = claimedField[taskType];
      if (u[fieldName]) {
        return res.status(400).json({ success: false, message: "Already claimed today. Come back tomorrow!" });
      }

      if (taskType === "invite") {
        const todayUTC = new Date();
        todayUTC.setUTCHours(0, 0, 0, 0);
        const completedTodayRes = await pool.query(
          `SELECT COUNT(*) as count FROM referrals WHERE referrer_id = $1 AND status = 'completed' AND completed_at >= $2`,
          [user.id, todayUTC.toISOString()]
        );
        const completedToday = parseInt(completedTodayRes.rows[0]?.count || '0');
        if (completedToday < 3) {
          return res.status(400).json({
            success: false,
            message: `You need 3 friends to complete 10 ads today. Currently: ${completedToday}/3`,
          });
        }
      }

      const gramEarned = gramMap[taskType];
      await pool.query(
        `UPDATE users SET ${fieldName} = TRUE, balance = COALESCE(balance::numeric, 0) + $1, daily_tasks_date = NOW() WHERE id = $2`,
        [gramEarned, user.id]
      );

      return res.json({ success: true, gramEarned, message: `+${gramEarned} GRAM earned!` });
    } catch (error) {
      console.error("Daily task claim error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  // ─── Bounty Tasks API ───
  app.get("/api/bounty-tasks", authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const { pool } = await import("./db");
      const [tasksRes, completedRes] = await Promise.all([
        pool.query(`SELECT id, title, description, reward_axn AS gram_reward, key_cost, url FROM bounty_tasks WHERE is_active = TRUE AND (is_paused IS NULL OR is_paused = FALSE) ORDER BY id ASC`),
        pool.query(`SELECT task_id FROM bounty_task_completions WHERE user_id = $1`, [user.id]),
      ]);
      const completedIds = new Set(completedRes.rows.map((r: any) => r.task_id));
      const tasks = tasksRes.rows.map((t: any) => ({
        id: t.id,
        title: t.title,
        description: t.description,
        gramReward: t.gram_reward,
        keyCost: t.key_cost,
        url: t.url,
        completed: completedIds.has(t.id),
      }));
      return res.json({ tasks });
    } catch (error) {
      console.error("Bounty tasks list error:", error);
      return res.status(500).json({ message: "Internal server error" });
    }
  });

  app.post("/api/bounty-tasks/:taskId/complete", authenticateTelegram, async (req: any, res) => {
    let client: any;
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const taskId = parseInt(req.params.taskId);
      if (isNaN(taskId)) return res.status(400).json({ message: "Invalid task ID" });

      const { pool } = await import("./db");
      client = await pool.connect();
      await client.query('BEGIN');

      const taskRes = await client.query(
        `SELECT id, reward_axn AS gram_reward
         FROM bounty_tasks
         WHERE id = $1
           AND is_active = TRUE
           AND COALESCE(is_paused, FALSE) = FALSE
           AND (
             total_impressions IS NULL
             OR total_impressions <= 0
             OR COALESCE(completed_count, 0) < total_impressions
           )
         FOR UPDATE`,
        [taskId],
      );
      if (!taskRes.rows[0]) {
        const exists = await client.query(`SELECT 1 FROM bounty_tasks WHERE id = $1`, [taskId]);
        await client.query('ROLLBACK');
        return res.status(exists.rows.length ? 400 : 404).json({
          message: exists.rows.length ? "Task is paused or no longer available" : "Task not found",
        });
      }
      const task = taskRes.rows[0];

      const completion = await client.query(
        `INSERT INTO bounty_task_completions (user_id, task_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, task_id) DO NOTHING
         RETURNING id`,
        [user.id, taskId],
      );
      if (completion.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: "Task already completed" });
      }

      const updatedTask = await client.query(
        `UPDATE bounty_tasks
         SET completed_count = COALESCE(completed_count, 0) + 1
         WHERE id = $1
           AND (
             total_impressions IS NULL
             OR total_impressions <= 0
             OR COALESCE(completed_count, 0) < total_impressions
           )
         RETURNING id`,
        [taskId],
      );
      if (updatedTask.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ message: "Task is no longer available" });
      }

      const updatedUser = await client.query(
        `UPDATE users
         SET balance = COALESCE(balance::numeric, 0) + $1,
             tasks_completed = COALESCE(tasks_completed, 0) + 1
         WHERE id = $2
         RETURNING id`,
        [task.gram_reward, user.id],
      );
      if (updatedUser.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ message: "User account not found" });
      }

      await client.query('COMMIT');
      return res.json({ success: true, gramReward: task.gram_reward, message: `+${task.gram_reward} GRAM earned!` });
    } catch (error) {
      if (client) {
        try { await client.query('ROLLBACK'); } catch {}
      }
      console.error("Bounty task complete error:", error);
      return res.status(500).json({ message: "Internal server error" });
    } finally {
      client?.release();
    }
  });

  // Debug route to check database columns
  app.get('/api/debug/db-schema', async (req: any, res) => {
    try {
      const { pool } = await import('./db');
      
      // Check what columns exist in users table
      const result = await pool.query(`
        SELECT column_name, data_type 
        FROM information_schema.columns 
        WHERE table_name = 'users'
        ORDER BY ordinal_position;
      `);
      
      res.json({ 
        success: true, 
        columns: result.rows,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('❌ Schema check failed:', error);
      res.status(500).json({ 
        success: false, 
        error: (error as Error).message
      });
    }
  });

  // Removed deprecated manual database setup - use proper Drizzle migrations instead

  // Removed deprecated schema fix routes - use Drizzle migrations instead
  
  // Telegram webhook is registered in index.ts before routes to ensure fast response to Telegram

  // Function to verify Telegram WebApp initData with HMAC-SHA256
  function verifyTelegramWebAppData(initData: string, botToken: string): { isValid: boolean; user?: any } {
    try {
      const urlParams = new URLSearchParams(initData);
      const hash = urlParams.get('hash');
      
      if (!hash) {
        return { isValid: false };
      }
      
      // Remove hash from params for verification
      urlParams.delete('hash');
      
      // Sort parameters and create data check string
      const sortedParams = Array.from(urlParams.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
      
      // Create secret key from bot token
      const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
      
      // Calculate expected hash
      const expectedHash = crypto.createHmac('sha256', secretKey).update(sortedParams).digest('hex');
      
      // Verify hash
      const isValid = expectedHash === hash;
      
      if (isValid) {
        const userString = urlParams.get('user');
        if (userString) {
          try {
            const user = JSON.parse(userString);
            return { isValid: true, user };
          } catch (parseError) {
            console.error('Error parsing user data:', parseError);
            return { isValid: false };
          }
        }
      }
      
      return { isValid };
    } catch (error) {
      console.error('Error verifying Telegram data:', error);
      return { isValid: false };
    }
  }

  // New Telegram WebApp authentication route
  app.post('/api/auth/telegram', async (req: any, res) => {
    try {
      const { initData, startParam } = req.body;
      
      const refererUrl = req.headers['referer'] || req.headers['referrer'] || '';
      console.log(`🔐 Auth request received - initData: ${initData ? 'YES' : 'NO'}, startParam: ${startParam || 'NONE'}, referer: ${refererUrl}`);
      
      let effectiveStartParam = startParam;
      if (!effectiveStartParam && refererUrl) {
        try {
          const refUrl = new URL(refererUrl);
          effectiveStartParam = refUrl.searchParams.get('startapp') || refUrl.searchParams.get('tgWebAppStartParam') || undefined;
          if (effectiveStartParam) {
            console.log(`📎 Extracted startParam from referer URL: ${effectiveStartParam}`);
          }
        } catch (e) {}
      }
      
      if (!initData) {
        console.log('⚠️ No initData provided - checking for cached user_id in headers');
        const cachedUserId = req.headers['x-user-id'];
        
        if (cachedUserId) {
          console.log('✅ Using cached user_id from headers:', cachedUserId);
          
          if (effectiveStartParam) {
            console.log(`🔄 Returning user has startParam=${effectiveStartParam} - attempting referral bind for existing user`);
            try {
              const existingUser = await storage.getUserByTelegramId(cachedUserId);
              if (existingUser && !existingUser.referredBy) {
                const referrer = await storage.getUserByReferralCode(effectiveStartParam);
                if (referrer && referrer.id !== existingUser.id) {
                  const existingReferral = await storage.getReferralByUsers(referrer.id, existingUser.id);
                  if (!existingReferral) {
                    await storage.createReferral(referrer.id, existingUser.id);
                    console.log(`✅ Late referral created for returning user: ${referrer.id} -> ${existingUser.id}`);
                    return res.json({ success: true, user: cachedUserId, referralProcessed: true });
                  }
                }
              }
            } catch (lateRefErr) {
              console.error('⚠️ Late referral processing failed:', lateRefErr);
            }
          }
          return res.json({ success: true, user: cachedUserId, referralProcessed: false });
        }
        
        console.log('ℹ️ No cached user_id found - returning skipAuth response');
        return res.status(200).json({ success: true, skipAuth: true });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(500).json({ message: 'Bot token not configured' });
      }
      
      // Verify the initData with HMAC-SHA256
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(initData, botToken);
      
      if (!isValid || !telegramUser) {
        return res.status(401).json({ message: 'Invalid Telegram authentication data' });
      }
      
      // Use upsertTelegramUser method which properly handles telegram_id
      const { user: upsertedUser, isNewUser } = await storage.upsertTelegramUser(telegramUser.id.toString(), {
        email: `${telegramUser.username || telegramUser.id}@telegram.user`,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        profileImageUrl: (telegramUser as any).photo_url || '',
        personalCode: telegramUser.username || telegramUser.id.toString(),
        withdraw_balance: '0',
        total_earnings: '0',
        adsWatched: 0,
        dailyAdsWatched: 0,
        dailyEarnings: '0',
        level: 1,
        flagged: false,
        banned: false,
        referralCode: '',
      });
      
      // Send welcome message to new users
      if (isNewUser) {
        try {
          await sendWelcomeMessage(telegramUser.id.toString());
        } catch (welcomeError) {
          console.error('Error sending welcome message:', welcomeError);
          // Don't fail authentication if welcome message fails
        }
      }
      
      // Process referral if startParam (referral code) was provided
      // CRITICAL FIX: Process referrals for BOTH new users AND existing users who don't have a referrer yet
      let referralProcessed = false;
      const finalStartParam = effectiveStartParam || startParam;
      if (finalStartParam && finalStartParam !== telegramUser.id.toString()) {
        console.log(`🔄 Processing Mini App referral: referralCode=${finalStartParam}, user=${telegramUser.id}, isNewUser=${isNewUser}`);
        try {
          // First, find the referrer by referral code
          const referrer = await storage.getUserByReferralCode(finalStartParam);
          
          if (!referrer) {
            console.log(`❌ Invalid referral code from Mini App: ${finalStartParam}`);
          } else if (referrer.id === upsertedUser.id) {
            console.log(`⚠️ Self-referral prevented: ${upsertedUser.id}`);
          } else {
            // CANONICAL CHECK: Use referrals table as source of truth to check if referral exists
            const existingReferral = await storage.getReferralByUsers(referrer.id, upsertedUser.id);
            
            if (existingReferral) {
              console.log(`ℹ️ Referral already exists in referrals table: ${referrer.id} -> ${upsertedUser.id}`);
            } else {
              console.log(`👤 Found referrer via Mini App: ${referrer.id} (${referrer.firstName || 'No name'})`);
              await storage.createReferral(referrer.id, upsertedUser.id);
              console.log(`✅ Referral created via Mini App: ${referrer.id} -> ${upsertedUser.id}`);
              referralProcessed = true;
            }
          }
        } catch (referralError) {
          console.error('❌ Mini App referral processing failed:', referralError);
          // Don't fail authentication if referral processing fails
        }
      }
      
      res.json({ ...upsertedUser, referralProcessed });
    } catch (error) {
      console.error('Telegram authentication error:', error);
      res.status(500).json({ message: 'Authentication failed' });
    }
  });

  // Session token endpoint for WebSocket authentication
  app.get('/api/auth/session-token', authenticateTelegram, async (req: any, res) => {
    try {
      let sessionToken: string;
      
      // Development mode: Return predictable test token
      if (process.env.NODE_ENV === 'development') {
        sessionToken = 'test-session';
        console.log('🔧 Development mode: Returning test session token');
      } else {
        // Production mode: Always use Express session ID
        if (!req.sessionID) {
          console.error('❌ No session ID found - session not created properly');
          return res.status(500).json({ 
            message: 'Session not established',
            error: 'Express session not found'
          });
        }
        
        sessionToken = req.sessionID;
        console.log('🔐 Production mode: Using Express session ID for WebSocket auth:', sessionToken);
      }
      
      res.json({ 
        sessionToken,
        message: 'Session token generated successfully'
      });
    } catch (error) {
      console.error('❌ Error generating session token:', error);
      res.status(500).json({ 
        message: 'Failed to generate session token',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Auth routes
  app.get('/api/auth/user', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id; // Use the database UUID, not Telegram ID
      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Ensure referralCode exists
      if (!user.referralCode) {
        await storage.generateReferralCode(userId);
        const updatedUser = await storage.getUser(userId);
        user.referralCode = updatedUser?.referralCode || '';
      }
      
      // Friends Invited counts every non-banned referred user. No ad or
      // earnings threshold is required for the new referral program.
      const actualReferralsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .innerJoin(users, eq(referrals.refereeId, users.id))
        .where(and(
          eq(referrals.referrerId, userId),
          eq(users.banned, false)
        ));
      
      const friendsInvited = actualReferralsCount[0]?.count || 0;
      
      // Update DB if count is different (sync)
      if (user.friendsInvited !== friendsInvited) {
        await db
          .update(users)
          .set({ friendsInvited: friendsInvited })
          .where(eq(users.id, userId));
      }

      // Add referral link - use /start flow for reliable referral tracking
      const botUsername = await getBotUsername();
      const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;
      
      const telegramUser = req.user?.telegramUser;
      const adminFlag = telegramUser ? isAdmin(telegramUser.id.toString()) : false;

      // Check if AXN name task claimed today (daily reset)
      const { pool } = await import('./db');
      const axnNameCheckRes = await pool.query(`SELECT axn_name_last_claimed_at FROM users WHERE id = $1`, [userId]);
      const axnNameLastClaimed = axnNameCheckRes.rows[0]?.axn_name_last_claimed_at;
      const todayUTC = new Date().toISOString().slice(0, 10);
      const axnNameClaimedToday = axnNameLastClaimed
        ? new Date(axnNameLastClaimed).toISOString().slice(0, 10) === todayUTC
        : false;

      res.json({
        ...user,
        friendsInvited,
        referralLink,
        planStatus: 'Trial',
        isAdmin: adminFlag,
        axnNameClaimedToday,
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ message: "Failed to fetch user" });
    }
  });

  // Balance refresh endpoint - used after conversion to sync frontend
  app.get('/api/user/balance/refresh', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log('⚠️ Balance refresh requested without session - sending empty response');
        return res.json({ 
          success: true, 
          skipAuth: true, 
          balance: '0', 
          tonBalance: '0' 
        });
      }

      const user = await storage.getUser(userId);
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      const walletBal = user.walletBalance?.toString() || '0';
      console.log(`🔄 Balance refresh for user ${userId}: walletBalance=${walletBal}, TON=${user.tonBalance}`);
      
      res.json({
        success: true,
        balance: walletBal,
        tonBalance: user.tonBalance,
        axnBalance: walletBal
      });
    } catch (error) {
      console.error("Error refreshing balance:", error);
      res.status(500).json({ message: "Failed to refresh balance" });
    }
  });

  // Get current app settings (public endpoint for frontend to fetch ad limits and all dynamic settings)
  app.get('/api/app-settings', async (req: any, res) => {
    try {
      // Fetch all admin settings at once
      const settings = await db.select().from(adminSettings);
      
      // Helper function to get setting value with default
      const getSetting = (key: string, defaultValue: string): string => {
        const setting = settings.find(s => s.settingKey === key);
        return setting ? setting.settingValue : defaultValue;
      };

      const minWithdrawalAmount = parseFloat(getSetting('minimum_withdrawal_ton', '0.1')); // Minimum withdrawal
      const withdrawalFeeTON = parseFloat(getSetting('withdrawal_fee_ton', '0.01')); // withdrawal fee TON
      
      // Separate channel and bot task costs (in TON for admin, TON for users)
      const channelTaskCostTONAdmin = parseFloat(getSetting('channel_task_cost_ton_admin', '0.003')); // Default TON 0.003 per click
      const botTaskCostTONAdmin = parseFloat(getSetting('bot_task_cost_ton_admin', '0.003')); // Default TON 0.003 per click
      
      // TON costs for regular users
      const channelTaskCostTON = parseFloat(getSetting('channel_task_cost_ton', '0.0003')); // Default 0.0003 per click
      const botTaskCostTON = parseFloat(getSetting('bot_task_cost_ton', '0.0003')); // Default 0.0003 per click
      
      // Separate channel and bot task rewards (in AXN)
      const channelTaskRewardAXN = parseInt(getSetting('channel_task_reward', '30')); // Default 30 AXN per click
      const botTaskRewardAXN = parseInt(getSetting('bot_task_reward', '20')); // Default 20 AXN per click
      
      // Minimum convert amount in AXN (100,000 AXN = 1 TON)
      const minimumConvertAXN = parseInt(getSetting('minimum_convert_axn', '100')); // Default 100 AXN
      const minimumConvertTON = minimumConvertAXN / 100000; 
      
      // Minimum clicks for task creation
      const minimumClicks = parseInt(getSetting('minimum_clicks', '100')); // Default 500 clicks
      
      const withdrawalCurrency = getSetting('withdrawal_currency', 'TON');
      
      // Daily task rewards (for TaskSection.tsx)
      const streakReward = parseInt(getSetting('streak_reward', '100')); // Daily streak claim reward in AXN
      const shareTaskReward = parseInt(getSetting('share_task_reward', '1000')); // Share with friends reward in AXN
      const communityTaskReward = parseInt(getSetting('community_task_reward', '1000')); // Join community reward in AXN
      
      // Partner task reward
      const partnerTaskReward = parseInt(getSetting('partner_task_reward', '5')); // Partner task reward in AXN
      
      // Withdrawal requirement settings
      const withdrawalAdRequirementEnabled = getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true';
      const minimumAdsForWithdrawal = parseInt(getSetting('minimum_ads_for_withdrawal', '100'));
      const withdrawalInviteRequirementEnabled = getSetting('withdrawal_invite_requirement_enabled', 'true') === 'true';
      const minimumInvitesForWithdrawal = parseInt(getSetting('minimum_invites_for_withdrawal', '3'));
      
      // BUG currency settings
      const minimumConvertAXNToTON = parseInt(getSetting('minimum_convert_axn_to_ton', '10000'));
      const minimumConvertAXNToBug = parseInt(getSetting('minimum_convert_axn_to_bug', '1000'));
      // 100,000 AXN = 1 TON
      const axnToTonRate = parseInt(getSetting('axn_to_ton_rate', '100000')); 
      const axnToBugRate = parseInt(getSetting('axn_to_bug_rate', '1')); // 1 AXN = 1 BUG
      const bugRewardPerAd = parseInt(getSetting('bug_reward_per_ad', '1')); // BUG per ad watched
      const bugRewardPerTask = parseInt(getSetting('bug_reward_per_task', '10')); // BUG per task completed
      const bugRewardPerReferral = parseInt(getSetting('bug_reward_per_referral', '50')); // BUG per referral
      const minimumBugForWithdrawal = parseInt(getSetting('minimum_bug_for_withdrawal', '1000')); // Default: TON 0.1 = 1000 BUG
      const bugPerTON = parseInt(getSetting('bug_per_ton', '10000')); // Default: 1 TON = 10000 BUG
      const withdrawalBugRequirementEnabled = getSetting('withdrawal_bug_requirement_enabled', 'true') === 'true';
      const activePromoCode = getSetting('active_promo_code', ''); // Current active promo code
      
      // Compatibility values used by older task and withdrawal clients.
      const channelTaskCostTON_val = parseFloat(getSetting('channel_task_cost', '0.0003'));
      const channelTaskRewardAXN_val = parseInt(getSetting('channel_task_reward', '30'));
      const minWithdrawalAmount_val = minWithdrawalAmount;
      const withdrawalFeeTON_val = withdrawalFeeTON;
      const botTaskCostTON_val = parseFloat(getSetting('bot_task_cost', '0.0003'));
      const botTaskRewardAXN_val = parseInt(getSetting('bot_task_reward', '20'));
      const minimumConvertTON_val = minimumConvertTON;

      const taskCostPerClick = channelTaskCostTON_val; // Use channel cost as default
      const taskRewardPerClick = channelTaskRewardAXN_val / 10000; // Legacy format for compatibility
      
      const dailyAdLimit = parseInt(getSetting('daily_ad_limit', '50'));
      const rewardPerAd = parseInt(getSetting('reward_per_ad', '1000'));
      const seasonBroadcastActive = getSetting('season_broadcast_active', 'false') === 'true';
      const walletChangeFeeAXN = parseInt(getSetting('wallet_change_fee_axn', '5000'));
      
      res.json({
        dailyAdLimit,
        rewardPerAd,
        rewardPerAdAXN: rewardPerAd,
        seasonBroadcastActive,
        walletChangeFee: walletChangeFeeAXN,
        walletChangeFeeAXN: walletChangeFeeAXN,
        minWithdrawalAmount: minWithdrawalAmount_val,
        minWithdrawalAmountTON: minWithdrawalAmount_val,
        withdrawalFeeTON: withdrawalFeeTON_val,
        channelTaskCostTON: channelTaskCostTON_val,
        botTaskCostTON: botTaskCostTON_val,
        channelTaskRewardAXN: channelTaskRewardAXN_val,
        botTaskRewardAXN: botTaskRewardAXN_val,
        taskCostPerClick,
        taskRewardPerClick,
        taskRewardAXN: channelTaskRewardAXN_val, // Use channel reward as default
        minimumConvert: minimumConvertTON_val,
        minimumConvertAXN,
        minimumConvertTON: minimumConvertTON_val,
        minimumClicks,
        withdrawalCurrency,
        // Daily task rewards
        streakReward,
        shareTaskReward,
        communityTaskReward,
        partnerTaskReward,
        channelTaskReward: channelTaskRewardAXN_val,
        botTaskReward: botTaskRewardAXN_val,
        // Withdrawal requirement settings
        withdrawalAdRequirementEnabled,
        minimumAdsForWithdrawal,
        withdrawalInviteRequirementEnabled,
        minimumInvitesForWithdrawal,
        // BUG currency settings
        minimumConvertAXNToTON,
        minimumConvertAXNToBug,
        axnToTonRate,
        axnToBugRate,
        bugRewardPerAd,
        bugRewardPerTask,
        bugRewardPerReferral,
        minimumBugForWithdrawal,
        bugPerTON,
        withdrawalBugRequirementEnabled,
        activePromoCode,
        // Withdrawal packages (JSON array of {ton, bug} objects)
        withdrawalPackages: JSON.parse(getSetting('withdrawal_packages', '[{"ton":0.2,"bug":2000},{"ton":0.4,"bug":4000},{"ton":0.8,"bug":8000}]')),
        // AXN-specific settings
        minimum_withdrawal_sat: parseFloat(getSetting('minimum_withdrawal_sat', '20')),
        withdrawal_fee_sat: parseFloat(getSetting('withdrawal_fee_sat', '10')),
        withdraw_ads_required: getSetting('withdraw_ads_required', 'false') === 'true',
        minTradeAmount: parseInt(getSetting('min_trade_amount', '1000')),
        popupAdsEnabled: getSetting('popup_ads_enabled', 'true') === 'true',
        popupAdInterval: parseInt(getSetting('popup_ad_interval', '60')),
      });
    } catch (error) {
      console.error("Error fetching app settings:", error);
      res.status(500).json({ message: "Failed to fetch app settings" });
    }
  });

  // Ad watching endpoint - configurable daily limit and reward amount
  app.post('/api/ads/watch', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      
      // Get user to check daily ad limit
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Check if user is banned
      if (user.banned) {
        return res.status(403).json({ 
          banned: true,
          message: "Your account has been banned due to suspicious multi-account activity",
          reason: user.bannedReason
        });
      }
      
      // Check for multi-account ad watching abuse (before processing reward)
      if (user.deviceId) {
        try {
          const { detectAdWatchingAbuse, banUserForMultipleAccounts } = await import('./deviceTracking');
          const abuseCheck = await detectAdWatchingAbuse(userId, user.deviceId);
          
          if (abuseCheck.isAbuse && abuseCheck.shouldBan) {
            // Ban the user for multi-account ad watching
            const deviceInfo = {
              deviceId: user.deviceId,
              ip: user.lastLoginIp || undefined,
              userAgent: user.lastLoginUserAgent || undefined,
              fingerprint: user.deviceFingerprint || undefined,
            };
            
            await banUserForMultipleAccounts(
              userId,
              abuseCheck.reason || "Multiple accounts detected watching ads from the same device",
              deviceInfo,
              abuseCheck.relatedAccountIds
            );
            
            return res.status(403).json({
              banned: true,
              message: "Your account has been banned due to suspicious multi-account activity",
              reason: abuseCheck.reason
            });
          }
        } catch (abuseError) {
          console.error("⚠️ Ad watching abuse detection failed (non-critical):", abuseError);
        }
      }
      
      // Fetch admin settings for daily limit and reward amount
      const dailyAdLimitSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'daily_ad_limit')).limit(1);
      const rewardPerAdSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'reward_per_ad')).limit(1);
      const bugRewardPerAdSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'bug_reward_per_ad')).limit(1);
      
      const dailyAdLimit = dailyAdLimitSetting[0]?.settingValue ? parseInt(dailyAdLimitSetting[0].settingValue) : 50;
      const rewardPerAdAXN = rewardPerAdSetting[0]?.settingValue ? parseInt(rewardPerAdSetting[0].settingValue) : 1000;
      const bugRewardPerAd = bugRewardPerAdSetting[0]?.settingValue ? parseInt(bugRewardPerAdSetting[0].settingValue) : 1;
      
      // Enforce daily ad limit (configurable, default 50)
      const adsWatchedToday = user.adsWatchedToday || 0;
      if (adsWatchedToday >= dailyAdLimit) {
        return res.status(429).json({ 
          message: `Daily ad limit reached. You can watch up to ${dailyAdLimit} ads per day.`,
          limit: dailyAdLimit,
          watched: adsWatchedToday
        });
      }
      
      // Older settings used the former 100,000-unit earning denomination.
      // The canonical earning balance is now decimal GRAM.
      const adRewardGram = rewardPerAdAXN > 1 ? rewardPerAdAXN / 100_000 : rewardPerAdAXN;
      
      try {
        // Process reward with error handling to ensure success response
        await storage.addEarning({
          userId,
          amount: String(adRewardGram),
          source: 'ad_watch',
          description: 'Watched advertisement',
        });
        
        // Increment ads watched count
        await storage.incrementAdsWatched(userId);
        
        // Add BUG reward for watching ad
        if (bugRewardPerAd > 0) {
          await db
            .update(users)
            .set({
              bugBalance: sql`COALESCE(${users.bugBalance}, '0')::numeric + ${bugRewardPerAd}`,
              updatedAt: new Date()
            })
            .where(eq(users.id, userId));
          console.log(`🐛 Added ${bugRewardPerAd} BUG to user ${userId} for ad watch`);
        }
        
      } catch (earningError) {
        console.error("❌ Critical error adding earning:", earningError);
        // Even if earning fails, still try to return success to avoid user-facing errors
        // The ad was watched, so we should acknowledge it
      }
      
      // Get updated balance (with fallback)
      let updatedUser = await storage.getUser(userId);
      if (!updatedUser) {
        updatedUser = user; // Fallback to original user data
      }
      const newAdsWatched = updatedUser?.adsWatchedToday || (adsWatchedToday + 1);
      
      // Send real-time update to user (non-blocking)
      try {
        sendRealtimeUpdate(userId, {
          type: 'ad_reward',
          amount: adRewardGram.toString(),
          message: 'Ad reward earned!',
          timestamp: new Date().toISOString()
        });
      } catch (wsError) {
        // WebSocket errors should not affect the response
        console.error("⚠️ WebSocket update failed (non-critical):", wsError);
      }
      
      // ALWAYS return success response to ensure reward notification shows
      res.json({ 
        success: true, 
        gramReward: adRewardGram,
        rewardBUG: bugRewardPerAd,
        newBalance: updatedUser?.walletBalance?.toString() || updatedUser?.balance || user.balance || "0",
        newBugBalance: updatedUser?.bugBalance || "0",
        adsWatchedToday: newAdsWatched
      });
    } catch (error) {
      console.error("❌ Unexpected error in ad watch endpoint:", error);
      console.error("   Error details:", error instanceof Error ? error.message : String(error));
      console.error("   Stack trace:", error instanceof Error ? error.stack : 'N/A');
      
      // Return success anyway to prevent error notification from showing
      // The user watched the ad, so we should acknowledge it
      const adRewardGram = 0.0001;
      res.json({ 
        success: true, 
        gramReward: adRewardGram,
        newBalance: "0",
        adsWatchedToday: 0,
        warning: "Reward processing encountered an issue but was acknowledged"
      });
    }
  });

  // Check channel membership endpoint
  app.get('/api/streak/check-membership', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramId = req.user.user.telegram_id;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      if (!botToken) {
        if (process.env.NODE_ENV === 'development') {
          return res.json({ 
            success: true,
            isMember: true,
            channelUsername: config.telegram.channelId,
            channelUrl: config.telegram.channelUrl,
            message: 'Development mode: membership check bypassed'
          });
        }
        
        console.error('❌ TELEGRAM_BOT_TOKEN not configured');
        return res.status(500).json({ 
          success: false,
          isMember: false, 
          message: 'Channel verification is temporarily unavailable. Please try again later.',
          error_code: 'VERIFICATION_UNAVAILABLE'
        });
      }
      
      // Check membership for configured channel
      const isMember = await verifyChannelMembership(
        parseInt(telegramId), 
        config.telegram.channelId, 
        botToken
      );
      
      res.json({ 
        success: true,
        isMember,
        channelUsername: config.telegram.channelId,
        channelUrl: config.telegram.channelUrl
      });
    } catch (error) {
      console.error("Error checking channel membership:", error);
      res.json({ 
        success: false,
        isMember: false,
        message: 'Unable to verify channel membership. Please make sure you have joined the channel and try again.',
        error_code: 'VERIFICATION_ERROR'
      });
    }
  });

  // Streak claim endpoint (Claim Bonus - every 5 minutes, 1 AXN)
  app.post('/api/streak/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const telegramId = req.user.user.telegram_id;
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const isDevMode = process.env.NODE_ENV === 'development';
      
      // Skip channel verification in development mode
      if (!isDevMode) {
        // Verify channel membership before allowing claim
        if (botToken) {
          const isMember = await verifyChannelMembership(
            parseInt(telegramId), 
            config.telegram.channelId, 
            botToken
          );
          
          if (!isMember) {
            return res.status(403).json({ 
              success: false,
              message: 'Please join our Telegram channel first to claim your bonus.',
              requiresChannelJoin: true,
              channelUsername: config.telegram.channelId,
              channelUrl: config.telegram.channelUrl
            });
          }
        } else {
          return res.status(500).json({ 
            success: false,
            message: 'Channel verification is temporarily unavailable. Please try again later.',
            error_code: 'VERIFICATION_UNAVAILABLE'
          });
        }
      }
      
      const result = await storage.updateUserStreak(userId);
      
      if (parseFloat(result.rewardEarned) === 0) {
        return res.status(400).json({ 
          success: false,
          message: 'Please wait 5 minutes before claiming again!'
        });
      }
      
      sendRealtimeUpdate(userId, {
        type: 'streak_reward',
        amount: result.rewardEarned,
        message: '✅ Bonus claimed!',
        timestamp: new Date().toISOString()
      });
      
      res.json({ 
        success: true,
        newStreak: result.newStreak,
        rewardEarned: result.rewardEarned,
        isBonusDay: result.isBonusDay,
        message: 'Bonus claimed successfully'
      });
    } catch (error) {
      console.error("Error processing bonus claim:", error);
      res.status(500).json({ message: "Failed to claim bonus" });
    }
  });



  // Legacy task eligibility endpoint removed - using daily tasks system only

  // User stats endpoint
  app.get('/api/user/stats', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const stats = await storage.getUserStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching user stats:", error);
      res.status(500).json({ message: "Failed to fetch user stats" });
    }
  });
  
  // Leaderboard endpoints
  // Top 10 users by currently active NFT ownership.
  app.get('/api/leaderboard/nft-holders', async (req: any, res) => {
    try {
      const { pool } = await import('./db');
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const adminTgId = process.env.TELEGRAM_ADMIN_ID || null;

      const result = await pool.query(`
        SELECT
          u.id,
          u.username,
          u.first_name,
          COUNT(um.id)::int AS active_nfts
        FROM users u
        JOIN user_machines um ON um.user_id = u.id AND um.expires_at > NOW()
        WHERE u.banned = FALSE
          AND ($1::text IS NULL OR CAST(u.telegram_id AS TEXT) != $1)
          AND (u.username IS NULL OR u.username != 'admin')
        GROUP BY u.id, u.username, u.first_name
        ORDER BY active_nfts DESC, u.created_at ASC
        LIMIT 10
      `, [adminTgId]);

      const rows = result.rows.map((r: any, i: number) => ({
        rank: i + 1,
        username: r.username || null,
        firstName: r.first_name || 'Anonymous',
        activeNfts: Number(r.active_nfts) || 0,
      }));

      let myRank = null;
      if (userId) {
        const rankResult = await pool.query(`
          SELECT sub.rank, sub.username, sub.first_name, sub.active_nfts
          FROM (
            SELECT
              u.id,
              u.username,
              u.first_name,
              COUNT(um.id)::int AS active_nfts,
              RANK() OVER (ORDER BY COUNT(um.id) DESC, MIN(u.created_at) ASC) AS rank
            FROM users u
            JOIN user_machines um ON um.user_id = u.id AND um.expires_at > NOW()
            WHERE u.banned = FALSE
              AND ($1::text IS NULL OR CAST(u.telegram_id AS TEXT) != $1)
            GROUP BY u.id, u.username, u.first_name
          ) sub
          WHERE sub.id = $2
        `, [adminTgId, userId]);
        if (rankResult.rows.length > 0) {
          const r = rankResult.rows[0];
          myRank = { rank: Number(r.rank), username: r.username || null, firstName: r.first_name || 'Anonymous', activeNfts: Number(r.active_nfts) || 0 };
        }
      }

      return res.json({ leaderboard: rows, myRank });
    } catch (error) {
      console.error('NFT holders leaderboard error:', error);
      return res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/leaderboard/top', async (req: any, res) => {
    try {
      const topUser = await (storage as any).getTopUserByEarnings();
      res.json(topUser || { username: 'No data', profileImage: '', totalEarnings: '0' });
    } catch (error) {
      console.error("Error fetching top user:", error);
      res.status(500).json({ message: "Failed to fetch top user" });
    }
  });
  
  app.get('/api/leaderboard/monthly', async (req: any, res) => {
    try {
      // Get userId from session if available (optional - for rank calculation)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      const leaderboard = await storage.getMonthlyLeaderboard(userId);
      res.json(leaderboard);
    } catch (error) {
      console.error("Error fetching monthly leaderboard:", error);
      res.status(500).json({ message: "Failed to fetch monthly leaderboard" });
    }
  });

  // Invite & Earn stats: all rewards are credited automatically.
  app.get('/api/referrals/stats', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log('⚠️ Referral stats requested without session - sending empty response');
        return res.json({ 
          success: true, 
          skipAuth: true, 
          friendsInvited: 0,
          commissionEarned: 0,
        });
      }
      const friendsResult = await db.execute(sql`
        SELECT COUNT(*)::int AS count
        FROM referrals r
        JOIN users u ON u.id = r.referee_id
        WHERE r.referrer_id = ${userId}
          AND u.banned = FALSE
      `);
      const commissionResult = await db.execute(sql`
        SELECT COALESCE(SUM(amount::numeric), 0) AS total
        FROM earnings
        WHERE user_id = ${userId}
          AND source IN ('referral_milestone', 'referral_deposit_commission')
      `);
      
      res.json({
        friendsInvited: Number((friendsResult.rows[0] as any)?.count || 0),
        commissionEarned: Number((commissionResult.rows[0] as any)?.total || 0),
      });
    } catch (error) {
      console.error("Error fetching referral stats:", error);
      res.status(500).json({ message: "Failed to fetch referral stats" });
    }
  });

  // Get referral list with membership status and mining boost info
  app.get('/api/referrals/list', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.json({ referrals: [] });

      // Single optimized query: join referrals with users to get all data at once
      const referralRows = await db.execute(sql`
        SELECT
          r.referee_id,
          r.status,
          r.reward_amount,
          u.telegram_id,
          u.first_name,
          u.username,
          u.is_channel_group_verified
        FROM referrals r
        LEFT JOIN users u ON u.id = r.referee_id
        WHERE r.referrer_id = ${userId}
        ORDER BY r.created_at DESC
        LIMIT 100
      `);

      const rows = (referralRows as any).rows || [];
      const result = rows.map((row: any) => {
        // Use cached is_channel_group_verified instead of live Telegram API calls
        const channelMember = !!row.is_channel_group_verified;
        const isActive = row.status === 'completed' && channelMember;
        const totalSatsEarned = Math.round(parseFloat(row.reward_amount || '0'));
        return {
          refereeId: row.telegram_id || row.referee_id,
          name: row.first_name || row.username || `User ${row.telegram_id || row.referee_id}`,
          username: row.username,
          totalSatsEarned,
          referralStatus: row.status,
          channelMember,
          isActive,
          commissionRate: 10,
        };
      });

      res.json({ referrals: result });
    } catch (error) {
      console.error("Error fetching referral list:", error);
      res.status(500).json({ message: "Failed to fetch referral list" });
    }
  });


  // Withdrawal eligibility - check if user has watched enough ads for this withdrawal
  app.get('/api/withdrawal-eligibility', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ adsWatchedSinceLastWithdrawal: 0, canWithdraw: false });
      }
      
      // Get user's total ads watched
      const user = await storage.getUser(userId);
      if (!user) {
        return res.json({ adsWatchedSinceLastWithdrawal: 0, canWithdraw: false });
      }
      
      // Get user's last completed/approved withdrawal timestamp
      const lastWithdrawal = await db
        .select({ createdAt: withdrawals.createdAt })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          sql`${withdrawals.status} IN ('completed', 'approved')`
        ))
        .orderBy(desc(withdrawals.createdAt))
        .limit(1);
      
      // Get admin settings for withdrawal requirements
      const allSettings = await db.select().from(adminSettings);
      const getSetting = (key: string, defaultValue: string): string => {
        const setting = allSettings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };
      
      const withdrawalAdRequirementEnabled = getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true';
      const MINIMUM_ADS_FOR_WITHDRAWAL = parseInt(getSetting('minimum_ads_for_withdrawal', '100'));
      const MINIMUM_BUG_FOR_WITHDRAWAL = parseInt(getSetting('minimum_bug_for_withdrawal', '1000')); // Default: TON0.1 = 1000 BUG
      
      let adsWatchedSinceLastWithdrawal = 0;
      
      if (lastWithdrawal.length === 0) {
        // No previous withdrawal - count all ads watched
        adsWatchedSinceLastWithdrawal = user.adsWatched || 0;
      } else {
        // Count ads watched since last withdrawal
        // We use the earnings table to count ads since the last withdrawal
        const lastWithdrawalDate = lastWithdrawal[0].createdAt;
        
        const adsCountResult = await db
          .select({ count: sql<number>`count(*)` })
          .from(earnings)
          .where(and(
            eq(earnings.userId, userId),
            eq(earnings.source, 'ad_watch'),
            ...(lastWithdrawalDate ? [gte(earnings.createdAt, lastWithdrawalDate)] : [])
          ));
        
        adsWatchedSinceLastWithdrawal = adsCountResult[0]?.count || 0;
      }
      
      // Check BUG balance requirement
      const currentBugBalance = parseFloat(user.bugBalance || '0');
      const hasSufficientBug = currentBugBalance >= MINIMUM_BUG_FOR_WITHDRAWAL;
      
      // If ad requirement is disabled, user can always withdraw (regarding ads)
      const canWithdrawAds = !withdrawalAdRequirementEnabled || adsWatchedSinceLastWithdrawal >= MINIMUM_ADS_FOR_WITHDRAWAL;
      const canWithdraw = canWithdrawAds && hasSufficientBug;
      
      res.json({ 
        adsWatchedSinceLastWithdrawal,
        canWithdraw,
        canWithdrawAds,
        hasSufficientBug,
        bugBalance: currentBugBalance,
        requiredBug: MINIMUM_BUG_FOR_WITHDRAWAL,
        requiredAds: MINIMUM_ADS_FOR_WITHDRAWAL,
        adRequirementEnabled: withdrawalAdRequirementEnabled
      });
    } catch (error) {
      console.error("Error checking withdrawal eligibility:", error);
      res.status(500).json({ message: "Failed to check withdrawal eligibility" });
    }
  });

  // Search referral by code endpoint - auth removed to prevent popup spam on affiliates page
  app.get('/api/referrals/search/:code', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const currentUserId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!currentUserId) {
        console.log('⚠️ Referral search requested without session - skipping');
        return res.status(404).json({ message: "Referral not found", skipAuth: true });
      }
      const searchCode = req.params.code;

      // Find user by referral code
      const referralUser = await storage.getUserByReferralCode(searchCode);
      
      if (!referralUser) {
        return res.status(404).json({ message: "Referral not found" });
      }

      // Check if this referral belongs to the current user
      const referralRelationship = await storage.getReferralByUsers(currentUserId, referralUser.id);
      
      if (!referralRelationship) {
        return res.status(403).json({ message: "This referral does not belong to you" });
      }

      // Get referral stats
      const referralEarnings = await storage.getUserStats(referralUser.id);
      const referralCount = await storage.getUserReferrals(referralUser.id);

      res.json({
        id: searchCode,
        earnedToday: referralEarnings.todayEarnings || "0.00",
        allTime: (referralUser as any).total_earned || "0.00",
        invited: referralCount.length,
        joinedAt: referralRelationship.createdAt
      });
    } catch (error) {
      console.error("Error searching referral:", error);
      res.status(500).json({ message: "Failed to search referral" });
    }
  });

  // Earnings history endpoint
  app.get('/api/earnings', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const limit = parseInt(req.query.limit as string) || 20;
      const earnings = await storage.getUserEarnings(userId, limit);
      res.json(earnings);
    } catch (error) {
      console.error("Error fetching earnings:", error);
      res.status(500).json({ message: "Failed to fetch earnings" });
    }
  });





  // Debug endpoint for referral issues - auth removed to prevent popup spam
  app.get('/api/debug/referrals', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log('⚠️ Debug referrals requested without session - sending empty response');
        return res.json({ success: true, skipAuth: true, data: {} });
      }
      
      // Get user info
      const user = await storage.getUser(userId);
      
      // Get all earnings for this user
      const userEarnings = await db
        .select()
        .from(earnings)
        .where(eq(earnings.userId, userId))
        .orderBy(desc(earnings.createdAt));
      
      // Get referrals where user is referrer
      const myReferrals = await db
        .select()
        .from(referrals)
        .where(eq(referrals.referrerId, userId));
      
      // Get referrals where user is referee  
      const referredBy = await db
        .select()
        .from(referrals)
        .where(eq(referrals.refereeId, userId));
      
      res.json({
        user: {
          id: user?.id,
          referralCode: user?.referralCode,
          balance: user?.balance,
          totalEarned: (user as any)?.total_earned
        },
        earnings: userEarnings,
        myReferrals: myReferrals,
        referredBy: referredBy,
        counts: {
          totalEarnings: userEarnings.length,
          referralEarnings: userEarnings.filter(e => e.source === 'referral_milestone').length,
          commissionEarnings: userEarnings.filter(e => e.source === 'referral_deposit_commission').length,
          adEarnings: userEarnings.filter(e => e.source === 'ad_watch').length
        }
      });
    } catch (error) {
      console.error("Debug referrals error:", error);
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // Production database fix endpoint - run once to fix referrals
  app.post('/api/fix-production-referrals', async (req: any, res) => {
    try {
      console.log('🔧 Fixing production referral system...');
      
      // 1. Update existing referral bonuses from TON0.50 to TON0.01
      console.log('📝 Updating referral bonus amounts...');
      await db.execute(sql`
        UPDATE ${earnings} 
        SET amount = '0.01', 
            description = REPLACE(description, 'TON0.50', 'TON0.01')
        WHERE source = 'referral' 
        AND amount = '0.50'
      `);
      
      // 2. Ensure referrals table has correct default
      console.log('🔧 Updating referrals table...');
      await db.execute(sql`
        ALTER TABLE ${referrals} 
        ALTER COLUMN reward_amount SET DEFAULT 0.01
      `);
      
      // 3. Update existing pending referrals to new amount
      await db.execute(sql`
        UPDATE ${referrals} 
        SET reward_amount = '0.01' 
        WHERE reward_amount = '0.50'
      `);
      
      // 4. Generate referral codes for users who don't have them
      console.log('🔑 Generating missing referral codes...');
      const usersWithoutCodes = await db
        .select({ id: users.id })
        .from(users)
        .where(sql`${users.referralCode} IS NULL OR ${users.referralCode} = ''`);
      
      for (const user of usersWithoutCodes) {
        const referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
        await db
          .update(users)
          .set({ referralCode })
          .where(eq(users.id, user.id));
      }
      
      // 5. Get stats for response
      const totalReferralEarnings = await db
        .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
        .from(earnings)
        .where(eq(earnings.source, 'referral'));
      
      const totalReferrals = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);
      
      console.log('✅ Production referral system fixed successfully!');
      
      res.json({
        success: true,
        message: 'Production referral system fixed successfully!',
        changes: {
          updatedReferralBonuses: 'Changed from TON0.50 to TON0.01',
          totalReferralEarnings: totalReferralEarnings[0]?.total || '0',
          totalReferrals: totalReferrals[0]?.count || 0,
          generatedReferralCodes: usersWithoutCodes.length
        }
      });
      
    } catch (error) {
      console.error('❌ Error fixing production referrals:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  });

  
  // Get user's daily tasks (new system) - DISABLED
  app.get('/api/tasks/daily', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      
      // Get user's current ads count
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      const adsWatchedToday = user?.adsWatchedToday || 0;
      
      // dailyTasks table removed - return empty
      res.json({
        success: true,
        tasks: [],
        adsWatchedToday,
        resetInfo: {
          nextReset: "00:00 UTC",
          resetDate: new Date().toISOString().split('T')[0]
        }
      });
      
    } catch (error) {
      console.error('Error fetching daily tasks:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch daily tasks' 
      });
    }
  });
  
  // Claim a task reward
  app.post('/api/tasks/claim/:taskLevel', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const taskLevel = parseInt(req.params.taskLevel);
      
      if (!taskLevel || taskLevel < 1 || taskLevel > 9) {
        return res.status(400).json({ 
          success: false, 
          message: 'Invalid task level' 
        });
      }
      
      // dailyTasks table removed
      res.status(410).json({ success: false, message: 'Daily task system removed' });
      
    } catch (error) {
      console.error('Error claiming task:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to claim task reward' 
      });
    }
  });

  // Get daily task completion status
  app.get('/api/tasks/daily/status', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, completedTasks: [] });
      }

      const [user] = await db
        .select({
          taskShareCompleted: users.taskShareCompletedToday,
          taskChannelCompleted: users.taskChannelCompletedToday,
          taskCommunityCompleted: users.taskCommunityCompletedToday,
          lastStreakDate: users.lastStreakDate
        })
        .from(users)
        .where(eq(users.id, userId));

      const completedTasks = [];
      if (user?.taskShareCompleted) completedTasks.push('share-friends');
      if (user?.taskChannelCompleted) completedTasks.push('check-updates');
      if (user?.taskCommunityCompleted) completedTasks.push('join-community');
      
      if (user?.lastStreakDate) {
        const lastClaim = new Date(user.lastStreakDate);
        const hoursSinceLastClaim = (new Date().getTime() - lastClaim.getTime()) / (1000 * 60 * 60);
        if (hoursSinceLastClaim < 24) {
          completedTasks.push('claim-streak');
        }
      }

      res.json({
        success: true,
        completedTasks
      });
      
    } catch (error) {
      console.error('Error fetching task status:', error);
      res.json({ success: true, completedTasks: [] });
    }
  });

  // Unified home tasks API - advertiser tasks removed
  app.get('/api/tasks/home/unified', async (req: any, res) => {
    try {
      let userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) {
        return res.json({ success: true, tasks: [], completedTaskIds: [], totalAvailableTasks: 0 });
      }
      const [user] = await db.select({ referralCode: users.referralCode }).from(users).where(eq(users.id, userId));
      res.json({
        success: true,
        tasks: [],
        completedTaskIds: [],
        referralCode: user?.referralCode,
        totalAvailableTasks: 0
      });
      
    } catch (error) {
      console.error('Error fetching unified home tasks:', error);
      res.json({ success: true, tasks: [], completedTaskIds: [], totalAvailableTasks: 0 });
    }
  });

  // New simplified task completion endpoints with daily tracking
  app.post('/api/tasks/complete/share', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, skipAuth: true });
      }
      
      // Check if already completed today
      const [user] = await db
        .select({ taskShareCompletedToday: users.taskShareCompletedToday })
        .from(users)
        .where(eq(users.id, userId));
      
      if (user?.taskShareCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }
      
      // Reward: 0.0001  = 1,000 AXN
      const rewardAmount = '0.0001';
      
      // Get BUG reward setting
      const bugRewardSetting = await storage.getAppSetting('bug_reward_per_task', '10');
      const bugReward = parseInt(bugRewardSetting);
      
      await db.transaction(async (tx) => {
        // Task rewards go to the GRAM earning balance. AXN is farming-only.
        // Mark task complete and credit BUG only; addEarning handles GRAM.
        await tx.update(users)
          .set({ 
            bugBalance: sql`COALESCE(${users.bugBalance}, '0')::numeric + ${bugReward}`,
            taskShareCompletedToday: true,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Add earning record (also updates the GRAM balance)
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_share',
          description: 'Share with Friends task completed'
        });
      });
      
      console.log(`🐛 Added ${bugReward} BUG to user ${userId} for share task`);
      
      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount,
        rewardBUG: bugReward
      });
      
    } catch (error) {
      console.error('Error completing share task:', error);
      res.status(500).json({
        success: false,
        message: 'Failed to complete task'
      });
    }
  });

  // Send rich share message with photo + caption + inline WebApp button
  app.post('/api/share/send-rich-message', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      }
      
      // Get user data to find telegram ID and referral code
      const [user] = await db
        .select({
          telegramId: users.telegram_id,
          referralCode: users.referralCode
        })
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user || !user.telegramId) {
        return res.status(400).json({
          success: false,
          message: 'Telegram ID not found for user'
        });
      }
      
      if (!user.referralCode) {
        return res.status(400).json({
          success: false,
          message: 'Referral code not found for user'
        });
      }
      
      // Get app URL for WebApp button
      const appUrl = process.env.RENDER_EXTERNAL_URL || 
                    (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : null) ||
                    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
                    'https://vuuug.onrender.com';
      
      // Build the referral URL using /start flow for reliable referral tracking
      const botUsername = await getBotUsername();
      const webAppUrl = `https://t.me/${botUsername}?start=${user.referralCode}`;
      
      // Get share banner image URL
      const shareImageUrl = `${appUrl}/images/share_v5.jpg`;
      
      // Caption for the share message
      const caption = '💵 Get paid for completing tasks and watching ads.';
      
      // Send the photo message with inline button
      const result = await sendSharePhotoToChat(
        user.telegramId,
        shareImageUrl,
        caption,
        webAppUrl,
        '🚀 Start Earning'
      );
      
      if (result.success) {
        res.json({
          success: true,
          message: 'Share message sent! You can now forward it to friends.',
          messageId: result.messageId
        });
      } else {
        res.status(500).json({
          success: false,
          message: result.error || 'Failed to send share message'
        });
      }
      
    } catch (error: any) {
      console.error('Error sending rich share message:', error);
      res.status(500).json({
        success: false,
        message: error.message || 'Failed to send share message'
      });
    }
  });

  app.post('/api/tasks/complete/channel', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      const telegramUserId = req.user?.telegramUser?.id?.toString();
      
      if (!userId || !telegramUserId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication error - please try again'
        });
      }
      
      // Check if already completed today
      const [user] = await db
        .select({ taskChannelCompletedToday: users.taskChannelCompletedToday })
        .from(users)
        .where(eq(users.id, userId));
      
      if (user?.taskChannelCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(500).json({ success: false, message: 'Telegram bot not configured' });
      }
      
      const channelConfig = getChannelConfig();
      const isMember = await verifyChannelMembership(
        parseInt(telegramUserId), 
        channelConfig.channelId,
        botToken
      );
      
      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: `Please join the Telegram channel ${channelConfig.channelUrl || channelConfig.channelId} first to complete this task`,
          requiresChannelJoin: true
        });
      }
      
      const rewardAmount = '0.01';
      
      await db.transaction(async (tx) => {
        // Mark task complete only; addEarning handles the GRAM balance
        await tx.update(users)
          .set({ 
            taskChannelCompletedToday: true,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Add earning record (also updates the GRAM balance)
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_channel',
          description: 'Channel join reward'
        });
      });
      
      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });
      
    } catch (error) {
      console.error('Error completing channel task:', error);
      res.status(500).json({ success: false, message: 'Failed to complete task' });
    }
  });

  app.post('/api/tasks/complete/community', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      const telegramUserId = req.user?.telegramUser?.id?.toString();
      
      if (!userId || !telegramUserId) {
        return res.status(401).json({
          success: false,
          message: 'Authentication error - please try again'
        });
      }
      
      // Check if already completed today
      const [user] = await db
        .select({ taskCommunityCompletedToday: users.taskCommunityCompletedToday })
        .from(users)
        .where(eq(users.id, userId));
      
      if (user?.taskCommunityCompletedToday) {
        return res.status(400).json({
          success: false,
          message: 'Task already completed today'
        });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(500).json({ success: false, message: 'Telegram bot not configured' });
      }
      
      const channelConfig = getChannelConfig();
      const isMember = await verifyChannelMembership(
        parseInt(telegramUserId), 
        channelConfig.groupId,
        botToken
      );
      
      if (!isMember) {
        return res.status(403).json({
          success: false,
          message: `Please join the Telegram group ${channelConfig.groupUrl || channelConfig.groupId} first to complete this task`,
          requiresGroupJoin: true
        });
      }
      
      const rewardAmount = '0.01';
      
      await db.transaction(async (tx) => {
        // Mark task complete only; addEarning handles the GRAM balance
        await tx.update(users)
          .set({ 
            taskCommunityCompletedToday: true,
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Add earning record (also updates the GRAM balance)
        await storage.addEarning({
          userId,
          amount: rewardAmount,
          source: 'task_community',
          description: 'Community join reward'
        });
      });
      
      res.json({
        success: true,
        message: 'Task completed!',
        rewardAmount
      });
      
    } catch (error) {
      console.error('Error completing community task:', error);
      res.status(500).json({ success: false, message: 'Failed to complete task' });
    }
  });

  // Old task system removed - using daily tasks system only

  // ================================
  // NEW TASK SYSTEM ENDPOINTS
  // ================================

  // Get all task statuses for user
  app.get('/api/tasks/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      
      // Define hardcoded daily tasks that exactly match live system format
      // Fixed timestamp to prevent ordering issues
      const fallbackTimestamp = new Date('2025-09-18T11:15:16.000Z');
      
      const hardcodedDailyTasks = [
        {
          id: 'channel-visit-check-update',
          type: 'channel_visit',
          title: 'Channel visit (Check Update)',
          description: 'Visit our Telegram channel for updates and news',
          rewardPerUser: '0.00015000', // 8-decimal format to match live API
          url: 'https://t.me/PaidAdsNews',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'app-link-share',
          type: 'share_link', 
          title: 'App link share (Share link)',
          description: 'Share your affiliate link with friends',
          rewardPerUser: '0.00020000', // 8-decimal format to match live API
          url: 'share://referral',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'invite-friend-valid',
          type: 'invite_friend',
          title: 'Invite friend (valid)',
          description: 'Invite 1 valid friend to earn rewards',
          rewardPerUser: '0.00050000', // 8-decimal format to match live API
          url: 'invite://friend',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-mini',
          type: 'ads_goal_mini',
          title: 'Mini (Watch 15 ads)',
          description: 'Watch 15 ads to complete this daily goal',
          rewardPerUser: '0.00045000', // 8-decimal format to match live API
          url: 'watch://ads/mini',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-light',
          type: 'ads_goal_light',
          title: 'Light (Watch 25 ads)',
          description: 'Watch 25 ads to complete this daily goal',
          rewardPerUser: '0.00060000', // 8-decimal format to match live API
          url: 'watch://ads/light',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-medium',
          type: 'ads_goal_medium',
          title: 'Medium (Watch 45 ads)',
          description: 'Watch 45 ads to complete this daily goal',
          rewardPerUser: '0.00070000', // 8-decimal format to match live API
          url: 'watch://ads/medium',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        },
        {
          id: 'ads-goal-hard',
          type: 'ads_goal_hard',
          title: 'Hard (Watch 75 ads)',
          description: 'Watch 75 ads to complete this daily goal',
          rewardPerUser: '0.00080000', // 8-decimal format to match live API
          url: 'watch://ads/hard',
          limit: 100000,
          claimedCount: 0,
          status: 'active',
          isApproved: true,
          channelMessageId: null,
          createdAt: fallbackTimestamp
        }
      ];
      
      // Use hardcoded tasks only (deleted tables removed)
      const allTasks = hardcodedDailyTasks;
      
      // No completion tracking from deleted tables
      const completedIds = new Set<string>();
      
      // Filter out completed tasks and generate proper task links
      const availableTasks = allTasks
        .filter(task => !completedIds.has(task.id))
        .map(task => {
          // Extract username from URL for link generation
          const urlMatch = task.url?.match(/t\.me\/([^/?]+)/);
          const username = urlMatch ? urlMatch[1] : null;
          
          let channelPostUrl = null;
          let claimUrl = null;
          
          if (task.type === 'channel' && username) {
            // Use channel message ID if available, otherwise fallback to channel URL
            if (task.channelMessageId) {
              channelPostUrl = `https://t.me/${username}/${task.channelMessageId}`;
            } else {
              channelPostUrl = `https://t.me/${username}`;
            }
            claimUrl = channelPostUrl;
          } else if (task.type === 'bot' && username) {
            // Bot deep link with task ID
            claimUrl = `https://t.me/${username}?start=task_${task.id}`;
          } else if (task.type === 'daily' && username) {
            // Daily task using channel link
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'channel_visit' && username) {
            // Channel visit task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'share_link' && username) {
            // Share link task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type === 'invite_friend' && username) {
            // Invite friend task
            claimUrl = `https://t.me/${username}`;
          } else if (task.type.startsWith('ads_goal_')) {
            // Ads goal tasks don't need external URLs
            claimUrl = 'internal://ads-goal';
          }
          
          return {
            ...task,
            reward: task.rewardPerUser, // Map rewardPerUser to reward for frontend compatibility
            channelPostUrl,
            claimUrl,
            username // Include username for mobile fallback
          };
        });
      
      res.json({
        success: true,
        tasks: availableTasks,
        total: availableTasks.length
      });
    } catch (error) {
      console.error('❌ Error fetching tasks:', error);
      
      res.json({ success: true, tasks: [], total: 0 });
    }
  });


  // CRITICAL: Public referral data repair endpoint (no auth needed for emergency fix)
  app.post('/api/emergency-fix-referrals', async (req: any, res) => {
    try {
      console.log('🚨 EMERGENCY: Running referral data repair...');
      
      // Step 1: Run the referral data synchronization
      await storage.fixExistingReferralData();
      
      // Step 2: Ensure all users have referral codes
      await storage.ensureAllUsersHaveReferralCodes();
      
      // Step 3: syncFriendsInvitedCounts removed
      
      // Step 4: Get repair summary
      const totalReferralsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);
      
      const completedReferralsResult = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.status, 'completed'));

      const totalReferralEarningsResult = await db
        .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
        .from(earnings)
        .where(sql`${earnings.source} IN ('referral_milestone', 'referral_deposit_commission')`);
      
      console.log('✅ Emergency referral repair completed successfully!');
      
      res.json({
        success: true,
        message: 'Emergency referral data repair completed successfully! Your friendsInvited count has been synced for withdrawal unlock.',
        summary: {
          totalReferrals: totalReferralsResult[0]?.count || 0,
          completedReferrals: completedReferralsResult[0]?.count || 0,
          totalReferralEarnings: totalReferralEarningsResult[0]?.total || '0',
          message: 'All missing referral data has been restored. Check your app now!'
        }
      });
    } catch (error) {
      console.error('❌ Error in emergency referral repair:', error);
      res.status(500).json({
        success: false,
        message: 'Emergency repair failed',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  // Admin routes



  // Setup webhook endpoint (call this once to register with Telegram)
  app.post('/api/telegram/setup-webhook', async (req: any, res) => {
    try {
      const { webhookUrl } = req.body;
      
      if (!webhookUrl) {
        return res.status(400).json({ message: 'Webhook URL is required' });
      }
      
      const success = await setupTelegramWebhook(webhookUrl);
      
      if (success) {
        res.json({ success: true, message: 'Webhook set up successfully' });
      } else {
        res.status(500).json({ success: false, message: 'Failed to set up webhook' });
      }
    } catch (error) {
      console.error('Setup webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // One-time production database fix endpoint
  app.get('/api/fix-production-db', async (req: any, res) => {
    try {
      const { fixProductionDatabase } = await import('../fix-production-db.js');
      console.log('🔧 Running production database fix...');
      await fixProductionDatabase();
      res.json({ 
        success: true, 
        message: 'Production database fixed successfully! Your app should work now.',
        instructions: 'Try using your Telegram bot - it should now send messages properly!'
      });
    } catch (error) {
      console.error('Fix production DB error:', error);
      res.status(500).json({ 
        success: false, 
        error: error instanceof Error ? error.message : String(error),
        message: 'Database fix failed. Check the logs for details.'
      });
    }
  });

  // Auto-setup webhook endpoint (automatically determines URL)
  app.get('/api/telegram/auto-setup', async (req: any, res) => {
    try {
      // Get the current domain from the request
      const protocol = req.headers['x-forwarded-proto'] || 'https';
      const host = req.headers.host;
      const webhookUrl = `${protocol}://${host}/api/telegram/webhook`;
      
      console.log('Setting up Telegram webhook:', webhookUrl);
      
      const success = await setupTelegramWebhook(webhookUrl);
      
      if (success) {
        res.json({ 
          success: true, 
          message: 'Webhook set up successfully',
          webhookUrl 
        });
      } else {
        res.status(500).json({ 
          success: false, 
          message: 'Failed to set up webhook',
          webhookUrl 
        });
      }
    } catch (error) {
      console.error('Auto-setup webhook error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // Test endpoint removed - bot uses inline buttons only
  app.get('/api/telegram/test/:chatId', async (req: any, res) => {
    res.json({ 
      success: false, 
      message: 'Test endpoint removed - bot uses inline buttons only'
    });
  });

  // Admin stats endpoint
  app.get('/api/admin/stats', authenticateAdmin, async (req: any, res) => {
    try {
      const stats = await storage.getAppStats();
      res.json({
        totalUsers: stats.totalUsers,
        totalEarnings: stats.totalEarnings,
        totalWithdrawals: stats.totalPayouts,
        tonWithdrawn: stats.totalPayouts,
        pendingWithdrawals: stats.pendingWithdrawals,
        successfulWithdrawals: stats.approvedWithdrawals,
        rejectedWithdrawals: stats.rejectedWithdrawals,
        dailyActiveUsers: stats.activeUsersToday,
        totalAdsWatched: stats.totalAdsWatched,
        todayAdsWatched: stats.adsWatchedToday,
        totalMiningSats: stats.totalMiningSats ?? '0',
        miningToday: stats.miningToday ?? '0',
        usersWithReferrals: stats.usersWithReferrals ?? 0,
        totalSatsWithdrawn: stats.totalSatsWithdrawn ?? '0',
        activePromos: 0
      });
    } catch (error) {
      console.error('Error fetching admin stats:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/admin/users', authenticateAdmin, async (req: any, res) => {
    try {
      console.log('🔍 Admin requesting user list...');
      const usersList = await storage.getAllUsersWithStats();
      console.log(`✅ Sending ${usersList.length} users to admin panel`);
      res.json(usersList);
    } catch (error) {
      console.error('❌ Error fetching admin users:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/admin/ban-logs', authenticateAdmin, async (req: any, res) => {
    try {
      const logs = await storage.getBanLogs();
      res.json(logs);
    } catch (error) {
      console.error('Error fetching ban logs:', error);
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/admin/user-ads/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const earningsList = await storage.getUserEarnings(userId, 100);
      const adEarnings = earningsList.filter(e => e.source === 'ad' || e.source === 'monetag' || e.source === 'adgram');
      res.json(adEarnings);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/admin/user-tasks/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const earningsList = await storage.getUserEarnings(userId, 100);
      const taskEarnings = earningsList.filter(e => e.source === 'task' || e.source === 'channel' || e.source === 'bot' || e.source === 'community' || e.source === 'advertiser');
      res.json(taskEarnings);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/admin/user-withdrawals/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const withdrawalsList = await storage.getUserWithdrawals(userId);
      res.json(withdrawalsList);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/admin/user-referrals/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const referralsList = await storage.getUserReferrals(userId);
      res.json(referralsList);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  app.get('/api/admin/user-ban-history/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const logs = await storage.getBanLogs();
      const userLogs = logs.filter((l: any) => l.bannedUserId === userId || l.userId === userId);
      res.json(userLogs);
    } catch (error) {
      res.status(500).json({ message: 'Internal server error' });
    }
  });

  // Get admin settings
  app.get('/api/admin/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const settings = await db.select().from(adminSettings);
      
      // Helper function to get setting value
      const getSetting = (key: string, defaultValue: any) => {
        const setting = settings.find(s => s.settingKey === key);
        return setting?.settingValue || defaultValue;
      };
      
      // Return all settings in format expected by frontend with NEW defaults
      res.json({
        dailyAdLimit: parseInt(getSetting('daily_ad_limit', '500')),
        rewardPerAd: parseInt(getSetting('reward_per_ad', '2')),
        walletChangeFee: parseInt(getSetting('wallet_change_fee', '100')),
        minWithdrawalAmountTON: parseFloat(getSetting('minimum_withdrawal_ton', '0.5')),
        withdrawalFeeTON: parseFloat(getSetting('withdrawal_fee_ton', '5')),
        channelTaskCost: parseFloat(getSetting('channel_task_cost_usd', '0.003')),
        botTaskCost: parseFloat(getSetting('bot_task_cost_usd', '0.003')),
        channelTaskCostTON: parseFloat(getSetting('channel_task_cost_ton', '0.0003')),
        botTaskCostTON: parseFloat(getSetting('bot_task_cost_ton', '0.0003')),
        channelTaskReward: parseInt(getSetting('channel_task_reward', '30')),
        botTaskReward: parseInt(getSetting('bot_task_reward', '20')),
        partnerReward: parseInt(getSetting('partner_task_reward', '5')),
        minimumConvertAXN: parseInt(getSetting('minimum_convert_pad', '100')),
        minimumClicks: parseInt(getSetting('minimum_clicks', '100')),
        minTradeAmount: parseInt(getSetting('min_trade_amount', '1000')),
        seasonBroadcastActive: getSetting('season_broadcast_active', 'false') === 'true',
        streakReward: parseInt(getSetting('streak_reward', '100')),
        shareTaskReward: parseInt(getSetting('share_task_reward', '1000')),
        communityTaskReward: parseInt(getSetting('community_task_reward', '1000')),
        withdrawalAdRequirementEnabled: getSetting('withdrawal_ad_requirement_enabled', 'true') === 'true',
        minimumAdsForWithdrawal: parseInt(getSetting('minimum_ads_for_withdrawal', '100')),
        withdrawalInviteRequirementEnabled: getSetting('withdrawal_invite_requirement_enabled', 'true') === 'true',
        minimumInvitesForWithdrawal: parseInt(getSetting('minimum_invites_for_withdrawal', '3')),
        bugRewardPerAd: parseInt(getSetting('bug_reward_per_ad', '1')),
        bugRewardPerTask: parseInt(getSetting('bug_reward_per_task', '10')),
        bugRewardPerReferral: parseInt(getSetting('bug_reward_per_referral', '50')),
        minimumBugForWithdrawal: parseInt(getSetting('minimum_bug_for_withdrawal', '1000')),
        padToBugRate: parseInt(getSetting('axn_to_bug_rate', '1')),
        minimumConvertPadToBug: parseInt(getSetting('minimum_convert_pad_to_bug', '1000')),
        bugPerUsd: parseInt(getSetting('bug_per_usd', '10000')),
        withdrawalBugRequirementEnabled: getSetting('withdrawal_bug_requirement_enabled', 'true') === 'true',
        ad_section1_reward: getSetting('ad_section1_reward', '0.0015'),
        ad_section1_limit: getSetting('ad_section1_limit', '250'),
        ad_section2_reward: getSetting('ad_section2_reward', '0.0001'),
        ad_section2_limit: getSetting('ad_section2_limit', '250'),
        withdrawalPackages: JSON.parse(getSetting('withdrawal_packages', '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]')),
      });
    } catch (error) {
      console.error("Error fetching admin settings:", error);
      res.status(500).json({ message: "Failed to fetch admin stats" });
    }
  });
  
  // Update admin settings
  app.put('/api/admin/settings', authenticateAdmin, async (req: any, res) => {
    try {
      const settings = req.body;
      console.log('💾 Saving admin settings (PUT):', JSON.stringify(settings));
      
      // Helper function to update a setting
      const updateSetting = async (key: string, value: any) => {
        if (value !== undefined && value !== null) {
          await db.execute(sql`
            INSERT INTO admin_settings (setting_key, setting_value, updated_at)
            VALUES (${key}, ${value.toString()}, NOW())
            ON CONFLICT (setting_key) 
            DO UPDATE SET setting_value = ${value.toString()}, updated_at = NOW()
          `);
        }
      };
      
      // Map frontend keys to DB keys
      const settingMap: Record<string, string> = {
        dailyAdLimit: 'daily_ad_limit',
        rewardPerAd: 'reward_per_ad',
        walletChangeFee: 'wallet_change_fee',
        minimum_withdrawal_ton: 'minimum_withdrawal_ton',
        withdrawal_fee_ton: 'withdrawal_fee_ton',
        channelTaskCost: 'channel_task_cost_usd',
        botTaskCost: 'bot_task_cost_usd',
        channelTaskCostTON: 'channel_task_cost_ton',
        botTaskCostTON: 'bot_task_cost_ton',
        channelTaskReward: 'channel_task_reward',
        botTaskReward: 'bot_task_reward',
        partnerTaskReward: 'partner_task_reward',
        minimumConvertAXN: 'minimum_convert_pad',
        minimumClicks: 'minimum_clicks',
        seasonBroadcastActive: 'season_broadcast_active',
        streakReward: 'streak_reward',
        shareTaskReward: 'share_task_reward',
        communityTaskReward: 'community_task_reward',
        withdrawalAdRequirementEnabled: 'withdrawal_ad_requirement_enabled',
        minimumAdsForWithdrawal: 'minimum_ads_for_withdrawal',
        withdrawalInviteRequirementEnabled: 'withdrawal_invite_requirement_enabled',
        minimumInvitesForWithdrawal: 'minimum_invites_for_withdrawal',
        bugRewardPerAd: 'bug_reward_per_ad',
        bugRewardPerTask: 'bug_reward_per_task',
        bugRewardPerReferral: 'bug_reward_per_referral',
        minimumBugForWithdrawal: 'minimum_bug_for_withdrawal',
        padToBugRate: 'axn_to_bug_rate',
        minimumConvertPadToBug: 'minimum_convert_pad_to_bug',
        bugPerUsd: 'bug_per_usd',
        withdrawalBugRequirementEnabled: 'withdrawal_bug_requirement_enabled',
        ad_section1_reward: 'ad_section1_reward',
        ad_section1_limit: 'ad_section1_limit',
        ad_section2_reward: 'ad_section2_reward',
        ad_section2_limit: 'ad_section2_limit',
        withdraw_ads_required: 'withdraw_ads_required',
        minTradeAmount: 'min_trade_amount',
      };

      for (const [feKey, dbKey] of Object.entries(settingMap)) {
        if (settings[feKey] !== undefined) {
          await updateSetting(dbKey, settings[feKey]);
        }
      }
      
      if (settings.withdrawalPackages !== undefined) {
        await updateSetting('withdrawal_packages', JSON.stringify(settings.withdrawalPackages));
      }
      
      broadcastUpdate({
        type: 'settings_updated',
        message: 'App settings have been updated by admin'
      });
      
      res.json({ success: true, message: "Settings updated successfully" });
    } catch (error) {
      console.error("Error updating admin settings:", error);
      res.status(500).json({ success: false, message: "Failed to update admin settings" });
    }
  });

  // Also support POST for settings
  app.post('/api/admin/settings', authenticateAdmin, async (req: any, res) => {
    // Redirect to PUT handler logic
    try {
      const settings = req.body;
      console.log('💾 Saving admin settings (POST):', JSON.stringify(settings));
      
      const updateSetting = async (key: string, value: any) => {
        if (value !== undefined && value !== null) {
          await db.execute(sql`
            INSERT INTO admin_settings (setting_key, setting_value, updated_at)
            VALUES (${key}, ${value.toString()}, NOW())
            ON CONFLICT (setting_key) 
            DO UPDATE SET setting_value = ${value.toString()}, updated_at = NOW()
          `);
        }
      };
      
      const settingMap: Record<string, string> = {
        dailyAdLimit: 'daily_ad_limit',
        rewardPerAd: 'reward_per_ad',
        walletChangeFee: 'wallet_change_fee',
        minimum_withdrawal_ton: 'minimum_withdrawal_ton',
        withdrawal_fee_ton: 'withdrawal_fee_ton',
        channelTaskCost: 'channel_task_cost_usd',
        botTaskCost: 'bot_task_cost_usd',
        channelTaskCostTON: 'channel_task_cost_ton',
        botTaskCostTON: 'bot_task_cost_ton',
        channelTaskReward: 'channel_task_reward',
        botTaskReward: 'bot_task_reward',
        partnerTaskReward: 'partner_task_reward',
        minimumConvertAXN: 'minimum_convert_pad',
        minimumClicks: 'minimum_clicks',
        seasonBroadcastActive: 'season_broadcast_active',
        streakReward: 'streak_reward',
        shareTaskReward: 'share_task_reward',
        communityTaskReward: 'community_task_reward',
        withdrawalAdRequirementEnabled: 'withdrawal_ad_requirement_enabled',
        minimumAdsForWithdrawal: 'minimum_ads_for_withdrawal',
        withdrawalInviteRequirementEnabled: 'withdrawal_invite_requirement_enabled',
        minimumInvitesForWithdrawal: 'minimum_invites_for_withdrawal',
        bugRewardPerAd: 'bug_reward_per_ad',
        bugRewardPerTask: 'bug_reward_per_task',
        bugRewardPerReferral: 'bug_reward_per_referral',
        minimumBugForWithdrawal: 'minimum_bug_for_withdrawal',
        padToBugRate: 'axn_to_bug_rate',
        minimumConvertPadToBug: 'minimum_convert_pad_to_bug',
        bugPerUsd: 'bug_per_usd',
        withdrawalBugRequirementEnabled: 'withdrawal_bug_requirement_enabled',
        ad_section1_reward: 'ad_section1_reward',
        ad_section1_limit: 'ad_section1_limit',
        ad_section2_reward: 'ad_section2_reward',
        ad_section2_limit: 'ad_section2_limit',
        withdraw_ads_required: 'withdraw_ads_required',
        minTradeAmount: 'min_trade_amount',
      };

      for (const [feKey, dbKey] of Object.entries(settingMap)) {
        if (settings[feKey] !== undefined) {
          await updateSetting(dbKey, settings[feKey]);
        }
      }
      
      if (settings.withdrawalPackages !== undefined) {
        await updateSetting('withdrawal_packages', JSON.stringify(settings.withdrawalPackages));
      }
      
      broadcastUpdate({
        type: 'settings_updated',
        message: 'App settings have been updated by admin'
      });
      
      res.json({ success: true, message: "Settings updated successfully" });
    } catch (error) {
      console.error("Error updating admin settings:", error);
      res.status(500).json({ success: false, message: "Failed to update admin settings" });
    }
  });
  
  // Toggle season broadcast
  app.post('/api/admin/season-broadcast', authenticateAdmin, async (req: any, res) => {
    try {
      const { active } = req.body;
      
      if (active === undefined) {
        return res.status(400).json({ message: "active field is required" });
      }
      
      await db.execute(sql`
        INSERT INTO admin_settings (setting_key, setting_value, updated_at)
        VALUES ('season_broadcast_active', ${active ? 'true' : 'false'}, NOW())
        ON CONFLICT (setting_key) 
        DO UPDATE SET setting_value = ${active ? 'true' : 'false'}, updated_at = NOW()
      `);
      
      res.json({ 
        success: true, 
        message: active ? "Season broadcast enabled" : "Season broadcast disabled",
        active 
      });
    } catch (error) {
      console.error("Error toggling season broadcast:", error);
      res.status(500).json({ success: false, message: "Failed to toggle season broadcast" });
    }
  });
  
  // Broadcast message to all users (for admin use)
  app.post('/api/admin/broadcast', authenticateAdmin, async (req: any, res) => {
    try {
      const { message } = req.body;
      
      if (!message) {
        return res.status(400).json({ message: "Message is required" });
      }
      
      // Get all users with Telegram IDs
      const allUsers = await db.select({ 
        telegramId: users.telegram_id 
      }).from(users).where(sql`${users.telegram_id} IS NOT NULL`);
      
      let successCount = 0;
      let failCount = 0;
      
      // Send message to each user
      for (const user of allUsers) {
        if (user.telegramId) {
          const sent = await sendUserTelegramNotification(user.telegramId, message);
          if (sent) {
            successCount++;
          } else {
            failCount++;
          }
        }
      }
      
      res.json({ 
        success: true, 
        message: `Broadcast sent`,
        details: {
          total: allUsers.length,
          sent: successCount,
          failed: failCount
        }
      });
    } catch (error) {
      console.error("Error broadcasting message:", error);
      res.status(500).json({ message: "Failed to broadcast message" });
    }
  });

  // Admin chart analytics endpoint - get real time-series data
  app.get('/api/admin/analytics/chart', authenticateAdmin, async (req: any, res) => {
    try {
      // Get data for last 7 days grouped by date
      const last7DaysData = await db.execute(sql`
        WITH date_series AS (
          SELECT generate_series(
            CURRENT_DATE - INTERVAL '6 days',
            CURRENT_DATE,
            INTERVAL '1 day'
          )::date AS date
        ),
        daily_stats AS (
          SELECT 
            DATE(e.created_at) as date,
            COUNT(DISTINCT e.user_id) as active_users,
            COALESCE(SUM(e.amount), 0) as earnings
          FROM ${earnings} e
          WHERE e.created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY DATE(e.created_at)
        ),
        daily_withdrawals AS (
          SELECT 
            DATE(w.created_at) as date,
            COALESCE(SUM(w.amount), 0) as withdrawals
          FROM ${withdrawals} w
          WHERE w.created_at >= CURRENT_DATE - INTERVAL '6 days'
            AND w.status IN ('completed', 'success', 'paid', 'Approved')
          GROUP BY DATE(w.created_at)
        ),
        daily_user_count AS (
          SELECT 
            DATE(u.created_at) as date,
            COUNT(*) as new_users
          FROM ${users} u
          WHERE u.created_at >= CURRENT_DATE - INTERVAL '6 days'
          GROUP BY DATE(u.created_at)
        )
        SELECT 
          ds.date,
          COALESCE(s.active_users, 0) as active_users,
          COALESCE(s.earnings, 0) as earnings,
          COALESCE(w.withdrawals, 0) as withdrawals,
          COALESCE(u.new_users, 0) as new_users
        FROM date_series ds
        LEFT JOIN daily_stats s ON ds.date = s.date
        LEFT JOIN daily_withdrawals w ON ds.date = w.date
        LEFT JOIN daily_user_count u ON ds.date = u.date
        ORDER BY ds.date ASC
      `);

      // Get cumulative user count for each day
      const totalUsersBeforeWeek = await db.select({ count: sql<number>`count(*)` })
        .from(users)
        .where(sql`${users.createdAt} < CURRENT_DATE - INTERVAL '6 days'`);
      
      // Ensure initial count is a number to prevent string concatenation
      let cumulativeUsers = Number(totalUsersBeforeWeek[0]?.count || 0);
      
      const chartData = last7DaysData.rows.map((row: any, index: number) => {
        cumulativeUsers += Number(row.new_users || 0);
        return {
          period: new Date(row.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          users: Number(cumulativeUsers), // Ensure it's a number in the output
          earnings: parseFloat(row.earnings || '0'),
          withdrawals: parseFloat(row.withdrawals || '0'),
          activeUsers: Number(row.active_users || 0)
        };
      });

      res.json({
        success: true,
        data: chartData
      });
    } catch (error) {
      console.error("Error fetching chart analytics:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to fetch analytics data" 
      });
    }
  });

  // Admin user tracking endpoint - search by UID/referral code OR user ID
  app.get('/api/admin/user-tracking/:uid', authenticateAdmin, async (req: any, res) => {
    try {
      const { uid } = req.params;
      
      // Search user by referral code OR user ID
      const userResults = await db
        .select()
        .from(users)
        .where(sql`${users.referralCode} = ${uid} OR ${users.id} = ${uid}`)
        .limit(1);
      
      if (userResults.length === 0) {
        return res.status(404).json({
          success: false,
          message: 'User not found - please check the UID/ID and try again'
        });
      }
      
      const user = userResults[0];
      
      // Get withdrawal count
      const withdrawalCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(withdrawals)
        .where(eq(withdrawals.userId, user.id));
      
      // Get referral count
      const referralCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.referrerId, user.id));
      
      res.json({
        success: true,
        user: {
          uid: user.referralCode,
          userId: user.id,
          balance: user.balance,
          totalEarnings: (user as any).total_earned,
          withdrawalCount: withdrawalCount[0]?.count || 0,
          referralCount: referralCount[0]?.count || 0,
          status: user.banned ? 'Banned' : 'Active',
          joinedDate: user.createdAt,
          adsWatched: user.adsWatched,
          walletAddress: user.tonWalletAddress || 'Not set'
        }
      });
    } catch (error) {
      console.error("Error fetching user tracking:", error);
      res.status(500).json({ 
        success: false,
        message: "Failed to fetch user data" 
      });
    }
  });

  app.get('/api/admin/user-tasks/:userId', authenticateAdmin, async (req: any, res) => {
    res.json([]);
  });

  app.get('/api/admin/user-ads/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const ads = await db.select().from(earnings).where(and(eq(earnings.userId, userId), eq(earnings.source, 'ad_watch')));
      res.json(ads);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get('/api/admin/user-referrals/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const refs = await db.select().from(referrals).where(eq(referrals.referrerId, userId));
      res.json(refs);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get('/api/admin/user-withdrawals/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const draws = await db.select().from(withdrawals).where(eq(withdrawals.userId, userId));
      res.json(draws);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get('/api/admin/user-ban-history/:userId', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId } = req.params;
      const logs = await db.select().from(banLogs).where(eq(banLogs.bannedUserId, userId));
      res.json(logs);
    } catch (error) {
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get('/api/admin/users', authenticateAdmin, async (req: any, res) => {
    try {
      const allUsers = await storage.getAllUsersWithStats();
      res.json(allUsers);
    } catch (error) {
      console.error('❌ Error fetching admin users:', error);
      res.status(500).json({ message: "Internal server error" });
    }
  });

  app.get('/api/admin/banned-users-details', authenticateAdmin, async (req: any, res) => {
    try {
      const allUsers = await storage.getAllUsersWithStats();
      const bannedUsers = allUsers.filter(user => user.banned);
      res.json(bannedUsers);
    } catch (error) {
      console.error("Error fetching banned users details:", error);
      res.status(500).json({ message: "Failed to fetch banned users" });
    }
  });

  // Admin ban/unban user endpoint (by URL param)
  app.post('/api/admin/users/:id/ban', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { banned } = req.body;
      
      await storage.updateUserBanStatus(id, banned);
      
      res.json({ 
        success: true,
        message: banned ? 'User banned successfully' : 'User unbanned successfully'
      });
    } catch (error) {
      console.error("Error updating user ban status:", error);
      res.status(500).json({ message: "Failed to update user status" });
    }
  });

  // Admin ban/unban user endpoint (by body)
  app.post('/api/admin/users/ban', authenticateAdmin, async (req: any, res) => {
    try {
      const { userId, banned, reason, banType, adminBanReason } = req.body;
      const targetId = userId || req.body.id;
      
      if (!targetId) {
        return res.status(400).json({ success: false, message: "User ID is required" });
      }
      
      console.log(`🔨 Admin Action (Ban): user=${targetId}, status=${banned}, reason=${reason}, banType=${banType}`);

      // Get admin user ID for logging
      const adminUserId = req.user?.telegramUser?.id?.toString() || 'admin';
      
      await storage.updateUserBanStatus(targetId, banned, reason, adminUserId, banType || 'admin', adminBanReason);
      
      res.json({ 
        success: true,
        message: banned ? 'User banned successfully' : 'User unbanned successfully'
      });
    } catch (error) {
      console.error("Error updating user ban status:", error);
      res.status(500).json({ success: false, message: "Failed to update user status" });
    }
  });

  // Admin unban user endpoint (compat)
  app.post('/api/admin/users/:id/unban', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const adminUserId = req.user?.telegramUser?.id?.toString() || 'admin';
      
      console.log(`🔨 Admin Action (Unban): user=${id}, admin=${adminUserId}`);

      const { unbanUser } = await import('./deviceTracking');
      try {
        await unbanUser(id, adminUserId);
      } catch (e) {
        console.warn("Device tracking unban failed, falling back to storage", e);
      }
      
      await storage.updateUserBanStatus(id, false, 'Unbanned by admin', adminUserId);
      
      res.json({ 
        success: true,
        message: 'User unbanned successfully'
      });
    } catch (error) {
      console.error("Error unbanning user:", error);
      res.status(500).json({ success: false, message: "Failed to unban user" });
    }
  });

  // Admin self-unban endpoint (for emergency recovery when admin is accidentally banned)
  app.post('/api/admin/self-unban', async (req: any, res) => {
    try {
      const { initData } = req.body;
      
      if (!initData) {
        return res.status(400).json({ success: false, message: "Missing Telegram initData" });
      }
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      const adminTelegramId = process.env.TELEGRAM_ADMIN_ID;
      
      if (!botToken || !adminTelegramId) {
        console.error('❌ Self-unban failed: Missing bot token or admin ID config');
        return res.status(500).json({ success: false, message: "Server configuration error" });
      }
      
      // Verify Telegram initData signature
      const { verifyTelegramWebAppData } = await import('./auth');
      const { isValid, user: telegramUser } = verifyTelegramWebAppData(initData, botToken);
      
      if (!isValid || !telegramUser) {
        console.log('❌ Self-unban failed: Invalid Telegram data signature');
        return res.status(401).json({ success: false, message: "Invalid authentication" });
      }
      
      // Verify the user is the admin
      if (telegramUser.id.toString() !== adminTelegramId) {
        console.log(`❌ Self-unban denied: User ${telegramUser.id} is not admin ${adminTelegramId}`);
        return res.status(403).json({ success: false, message: "Only admin can use this feature" });
      }
      
      // Find admin user by telegram_id
      const [adminUser] = await db
        .select({ id: users.id, banned: users.banned })
        .from(users)
        .where(eq(users.telegram_id, adminTelegramId));
      
      if (!adminUser) {
        return res.status(404).json({ success: false, message: "Admin user not found" });
      }
      
      if (!adminUser.banned) {
        return res.json({ success: true, message: "Admin is not banned" });
      }
      
      // Unban the admin
      const { unbanUser } = await import('./deviceTracking');
      const success = await unbanUser(adminUser.id, 'self-unban');
      
      if (success) {
        console.log(`✅ Admin ${adminTelegramId} successfully self-unbanned`);
        res.json({ 
          success: true,
          message: 'Admin successfully unbanned'
        });
      } else {
        res.status(400).json({ success: false, message: "Failed to unban admin" });
      }
    } catch (error) {
      console.error("Error in admin self-unban:", error);
      res.status(500).json({ success: false, message: "Failed to process self-unban" });
    }
  });

  // ============ Admin Task Management Endpoints (advertiserTasks table dropped) ============

  app.get('/api/admin/pending-tasks', authenticateAdmin, async (_req: any, res) => {
    res.json({ success: true, tasks: [] });
  });

  app.get('/api/admin/all-tasks', authenticateAdmin, async (_req: any, res) => {
    res.json({ success: true, tasks: [] });
  });

  app.post('/api/admin/tasks/:taskId/approve', authenticateAdmin, async (_req: any, res) => {
    res.status(410).json({ success: false, message: 'Advertiser task system removed' });
  });

  app.post('/api/admin/tasks/:taskId/reject', authenticateAdmin, async (_req: any, res) => {
    res.status(410).json({ success: false, message: 'Advertiser task system removed' });
  });

  app.post('/api/admin/tasks/:taskId/pause', authenticateAdmin, async (_req: any, res) => {
    res.status(410).json({ success: false, message: 'Advertiser task system removed' });
  });

  app.post('/api/admin/tasks/:taskId/resume', authenticateAdmin, async (_req: any, res) => {
    res.status(410).json({ success: false, message: 'Advertiser task system removed' });
  });

  app.delete('/api/admin/tasks/:taskId', authenticateAdmin, async (_req: any, res) => {
    res.status(410).json({ success: false, message: 'Advertiser task system removed' });
  });

  // ============ End Admin Task Management ============

  // Database setup endpoint for free plan deployments (call once after deployment)
  app.post('/api/setup-database', async (req: any, res) => {
    try {
      // Only allow this in production and with a setup key for security
      const { setupKey } = req.body;
      
      if (setupKey !== 'setup-database-schema-2024') {
        return res.status(403).json({ message: "Invalid setup key" });
      }

      console.log('🔧 Setting up database schema...');
      
      // Use drizzle-kit to push schema
      const { execSync } = await import('child_process');
      
      try {
        execSync('npx drizzle-kit push --force', { 
          stdio: 'inherit',
          cwd: process.cwd()
        });
        
        
        console.log('✅ Database setup completed successfully');
        
        res.json({
          success: true,
          message: 'Database schema setup completed successfully'
        });
      } catch (dbError) {
        console.error('Database setup error:', dbError);
        res.status(500).json({ 
          success: false, 
          message: 'Database setup failed',
          error: String(dbError)
        });
      }
    } catch (error) {
      console.error("Error setting up database:", error);
      res.status(500).json({ message: "Failed to setup database" });
    }
  });

  // Task/Promotion API routes
  
  // Get all active promotions/tasks for current user
  app.get('/api/tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const result = await storage.getAvailablePromotionsForUser(userId);
      res.json(result);
    } catch (error) {
      console.error("Error fetching tasks:", error);
      res.status(500).json({ message: "Failed to fetch tasks" });
    }
  });

  // Complete a task
  app.post('/api/tasks/:promotionId/complete', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const telegramUserId = req.user.telegramUser.id.toString();
      const { promotionId } = req.params;
      const { taskType, channelUsername, botUsername } = req.body;
      
      // Validate required parameters
      if (!taskType) {
        console.log(`❌ Task completion blocked: Missing taskType for user ${userId}`);
        return res.status(400).json({ 
          success: false, 
          message: '❌ Task cannot be completed: Missing task type parameter.' 
        });
      }
      
      // Validate taskType is one of the allowed values
      const allowedTaskTypes = [
        'channel', 'bot', 'daily', 'fix',
        'channel_visit', 'share_link', 'invite_friend',
        'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'
      ];
      if (!allowedTaskTypes.includes(taskType)) {
        console.log(`❌ Task completion blocked: Invalid taskType '${taskType}' for user ${userId}`);
        return res.status(400).json({ 
          success: false, 
          message: '❌ Task cannot be completed: Invalid task type.' 
        });
      }
      
      console.log(`📋 Task completion attempt:`, {
        userId,
        telegramUserId,
        promotionId,
        taskType,
        channelUsername,
        botUsername
      });
      
      // Perform Telegram verification based on task type
      let isVerified = false;
      let verificationMessage = '';
      
      if (taskType === 'channel' && channelUsername) {
        // Verify channel membership using Telegram Bot API
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
          isVerified = false;
        } else {
          const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelUsername}`, process.env.BOT_TOKEN || botToken);
          isVerified = isMember;
        }
        verificationMessage = isVerified 
          ? 'Channel membership verified successfully' 
          : `Please join the channel @${channelUsername} first to complete this task`;
      } else if (taskType === 'bot' && botUsername) {
        // For bot tasks, we'll consider them verified if the user is in the WebApp
        // (since they would need to interact with the bot to access the WebApp)
        isVerified = true;
        verificationMessage = 'Bot interaction verified';
      } else if (taskType === 'daily') {
        // Daily tasks require channel membership if channelUsername is provided
        if (channelUsername) {
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          if (!botToken) {
            console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
            isVerified = false;
          } else {
            const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelUsername}`, process.env.BOT_TOKEN || botToken);
            isVerified = isMember;
          }
          verificationMessage = isVerified 
            ? 'Daily task verification successful' 
            : `Please join the channel @${channelUsername} first to complete this task`;
        } else {
          isVerified = true;
          verificationMessage = 'Daily task completed';
        }
      } else if (taskType === 'fix') {
        // Fix tasks are verified by default (user opening link is verification)
        isVerified = true;
        verificationMessage = 'Fix task completed';
      } else if (taskType === 'channel_visit') {
        // Channel visit task requires channel membership verification
        const botToken = process.env.TELEGRAM_BOT_TOKEN;
        if (!botToken) {
          console.log('⚠️ TELEGRAM_BOT_TOKEN not configured, skipping channel verification');
          isVerified = false;
          verificationMessage = 'Channel verification failed - bot token not configured';
        } else {
          // Extract channel username from promotion URL
          const promotion = await (storage as any).getPromotion(promotionId);
          const channelMatch = promotion?.url?.match(/t\.me\/([^/?]+)/);
          const channelName = channelMatch ? channelMatch[1] : 'PaidAdsNews';
          
          const isMember = await verifyChannelMembership(parseInt(telegramUserId), `@${channelName}`, botToken);
          isVerified = isMember;
          verificationMessage = isVerified 
            ? 'Channel membership verified successfully' 
            : `Please join the channel @${channelName} first to complete this task`;
        }
      } else if (taskType === 'share_link') {
        // Share link task requires user to have shared their affiliate link  
        const hasSharedToday = await storage.hasSharedLinkToday(userId);
        isVerified = hasSharedToday;
        verificationMessage = isVerified
          ? 'App link sharing verified successfully'
          : 'Not completed yet. Please share your affiliate link first.';
      } else if (taskType === 'invite_friend') {
        // Invite friend task requires exactly 1 valid referral today
        const hasValidReferralToday = await storage.hasValidReferralToday(userId);
        isVerified = hasValidReferralToday;
        verificationMessage = isVerified 
          ? 'Valid friend invitation verified for today' 
          : 'Not completed yet. Please invite a friend using your referral link first.';
      } else if (taskType.startsWith('ads_goal_')) {
        // Ads goal tasks require checking user's daily ad count
        const hasMetGoal = await storage.checkAdsGoalCompletion(userId, taskType);
        const user = await storage.getUser(userId);
        const adsWatchedToday = user?.adsWatchedToday || 0;
        
        // Get required ads for this task type
        const adsGoalThresholds = {
          'ads_goal_mini': 15,
          'ads_goal_light': 25,
          'ads_goal_medium': 45,
          'ads_goal_hard': 75
        };
        const requiredAds = adsGoalThresholds[taskType as keyof typeof adsGoalThresholds] || 0;
        
        isVerified = hasMetGoal;
        verificationMessage = isVerified 
          ? 'Ads goal achieved successfully!' 
          : `Not eligible yet. Watch ${requiredAds - adsWatchedToday} more ads (${adsWatchedToday}/${requiredAds} watched).`;
      } else {
        console.log(`❌ Task validation failed: Invalid task type '${taskType}' or missing parameters`, {
          taskType,
          channelUsername,
          botUsername,
          promotionId,
          userId
        });
        return res.status(400).json({ 
          success: false, 
          message: '❌ Task cannot be completed: Invalid task type or missing parameters.' 
        });
      }
      
      if (!isVerified) {
        console.log(`❌ Task verification failed for user ${userId}:`, verificationMessage);
        let friendlyMessage = '❌ Verification failed. Please complete the required action first.';
        if (taskType === 'channel' && channelUsername) {
          friendlyMessage = `❌ Verification failed. Please make sure you joined the required channel @${channelUsername}.`;
        } else if (taskType === 'bot' && botUsername) {
          friendlyMessage = `❌ Verification failed. Please make sure you started the bot @${botUsername}.`;
        }
        return res.status(400).json({ 
          success: false, 
          message: verificationMessage,
          friendlyMessage
        });
      }
      
      console.log(`✅ Task verification successful for user ${userId}:`, verificationMessage);
      
      // Get promotion to fetch actual reward amount
      const promotion = await (storage as any).getPromotion(promotionId);
      if (!promotion) {
        return res.status(404).json({ 
          success: false, 
          message: 'Task not found' 
        });
      }
      
      const rewardAmount = promotion.rewardPerUser || '0.00025';
      console.log(`🔍 Promotion details:`, { rewardPerUser: promotion.rewardPerUser, type: promotion.type, id: promotion.id });
      
      // Determine if this is a daily task (new task types that reset daily)
      const isDailyTask = [
        'channel_visit', 'share_link', 'invite_friend',
        'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'
      ].includes(taskType);
      
      if (isDailyTask) {
        console.log(`💰 Using dynamic reward amount: ${rewardAmount} TON`);
      } else {
        console.log(`💰 Using dynamic reward amount: TON${rewardAmount}`);
      }
      
      // Complete the task using appropriate method
      const result = isDailyTask 
        ? await storage.completeDailyTask(promotionId, userId, rewardAmount)
        : await (storage as any).completeTask(promotionId, userId, rewardAmount);
      
      if (result.success) {
        // Get updated balance for real-time sync
        let updatedBalance;
        try {
          updatedBalance = await storage.getUserBalance(userId);
          console.log(`💰 Balance updated for user ${userId}: TON${updatedBalance?.balance || '0'}`);
          
          // Send real-time balance update to WebSocket clients
          const currencySymbol = isDailyTask ? '' : '';
          const balanceUpdate = {
            type: 'balance_update',
            balance: updatedBalance?.balance || '0',
            delta: rewardAmount,
            message: `🎉 Task completed! +${currencySymbol}${parseFloat(rewardAmount).toFixed(5)}`
          };
          sendRealtimeUpdate(userId, balanceUpdate);
          console.log(`📡 Real-time balance update sent to user ${userId}`);
          
        } catch (balanceError) {
          console.error('⚠️ Failed to fetch updated balance for real-time sync:', balanceError);
        }
        
        res.json({ 
          ...result, 
          verificationMessage,
          rewardAmount,
          newBalance: updatedBalance?.balance || '0'
        });
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error completing task:", error);
      res.status(500).json({ message: "Failed to complete task" });
    }
  });

  // Promotional system endpoints removed - using daily tasks system only
  
  // Wallet management endpoints
  
  // Get user's saved wallet details - auth removed to prevent popup spam
  app.get('/api/wallet/details', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet details requested without session - sending empty response");
        return res.json({ success: true, skipAuth: true, wallet: null });
      }
      
      const [user] = await db
        .select({
          tonWalletAddress: users.tonWalletAddress,
          tonWalletComment: users.tonWalletComment,
          telegramUsername: users.telegramUsername,
          cwalletId: users.cwalletId,
          walletUpdatedAt: users.walletUpdatedAt
        })
        .from(users)
        .where(eq(users.id, userId));
      
      if (!user) {
        return res.status(404).json({ 
          success: false, 
          message: 'User not found' 
        });
      }
      
      res.json({
        success: true,
        walletDetails: {
          tonWalletAddress: user.tonWalletAddress || '',
          tonWalletComment: user.tonWalletComment || '',
          telegramUsername: user.telegramUsername || '',
          cwalletId: user.cwalletId || '',
          cwallet_id: user.cwalletId || '', // Support both formats
          canWithdraw: true
        }
      });
      
    } catch (error) {
      console.error('❌ Error fetching wallet details:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch wallet details' 
      });
    }
  });
  
  // Save user's wallet details - auth removed to prevent popup spam
  app.post('/api/wallet/save', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet save requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      const { tonWalletAddress, tonWalletComment, telegramUsername } = req.body;
      
      console.log('💾 Saving wallet details for user:', userId);
      
      // Update user's wallet details
      await db
        .update(users)
        .set({
          tonWalletAddress: tonWalletAddress || null,
          tonWalletComment: tonWalletComment || null,
          telegramUsername: telegramUsername || null,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log('✅ Wallet details saved successfully');
      
      res.json({
        success: true,
        message: 'Wallet details saved successfully.'
      });
      
    } catch (error) {
      console.error('❌ Error saving wallet details:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to save wallet details' 
      });
    }
  });

  // Save Cwallet ID endpoint - auth removed to prevent popup spam
  app.post('/api/wallet/cwallet', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Cwallet save requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      const { cwalletId } = req.body;
      
      console.log('💾 Saving Cwallet ID for user:', userId);
      
      if (!cwalletId || !cwalletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid  wallet address'
        });
      }
      
      // Validate  wallet address (must start with UQ or EQ)
      if (!/^(UQ|EQ)[A-Za-z0-9_-]{46}/.test(cwalletId.trim())) {
        console.log('🚫 Invalid  wallet address format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid  wallet address'
        });
      }
      
      // 🔒 WALLET LOCK: Check if wallet is already set - only allow one-time setup
      const [existingUser] = await db
        .select({ cwalletId: users.cwalletId })
        .from(users)
        .where(eq(users.id, userId));
      
      if (existingUser?.cwalletId) {
        console.log('🚫 Wallet already set - only one time setup allowed');
        return res.status(400).json({
          success: false,
          message: 'Wallet already set — only one time setup allowed'
        });
      }
      
      // 🔐 UNIQUENESS CHECK: Ensure wallet ID is not already used by another account
      const walletToCheck = cwalletId?.trim();
      if (walletToCheck) {
        const [walletInUse] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, walletToCheck),
            sql`${users.id} != ${userId}`
          ))
          .limit(1);
        
        if (walletInUse) {
          console.log('🚫  wallet address already linked to another account');
          return res.status(400).json({
            success: false,
            message: 'This  wallet address is already linked to another account.'
          });
        }
      }
      
      // Update user's Cwallet ID
      await db
        .update(users)
        .set({
          cwalletId: cwalletId.trim(),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log('✅  wallet address saved successfully');
      
      res.json({
        success: true,
        message: ' wallet address saved successfully.'
      });
      
    } catch (error) {
      console.error('❌ Error saving  wallet address:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to save  wallet address' 
      });
    }
  });

  // Alternative Cwallet save endpoint for compatibility - /api/set-wallet
  app.post('/api/set-wallet', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet save (set-wallet) requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      
      const { cwallet_id, cwalletId } = req.body;
      const walletId = cwallet_id || cwalletId; // Support both formats
      
      console.log('💾 Saving Cwallet ID via /api/set-wallet for user:', userId);
      
      if (!walletId || !walletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Missing  wallet address'
        });
      }
      
      // Validate  wallet address (must start with UQ or EQ)
      if (!/^(UQ|EQ)[A-Za-z0-9_-]{46}/.test(walletId.trim())) {
        console.log('🚫 Invalid  wallet address format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid  wallet address'
        });
      }
      
      // 🔒 WALLET LOCK: Check if wallet is already set - only allow one-time setup
      const [existingUser] = await db
        .select({ cwalletId: users.cwalletId })
        .from(users)
        .where(eq(users.id, userId));
      
      if (existingUser?.cwalletId) {
        console.log('🚫 Wallet already set - only one time setup allowed');
        return res.status(400).json({
          success: false,
          message: 'Wallet already set — only one time setup allowed'
        });
      }
      
      // 🔐 UNIQUENESS CHECK: Ensure wallet ID is not already used by another account
      const walletToCheck = cwalletId?.trim();
      if (walletToCheck) {
        const [walletInUse] = await db
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, walletToCheck),
            sql`${users.id} != ${userId}`
          ))
          .limit(1);
        
        if (walletInUse) {
          console.log('🚫  wallet address already linked to another account');
          return res.status(400).json({
            success: false,
            message: 'This  wallet address is already linked to another account.'
          });
        }
      }
      
      // Update user's Cwallet ID in database - permanent storage
      await db
        .update(users)
        .set({
          cwalletId: walletId.trim(),
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log('✅ Cwallet ID saved permanently via /api/set-wallet');
      
      res.json({
        success: true,
        message: 'Wallet saved successfully'
      });
      
    } catch (error) {
      console.error('❌ Error saving Cwallet ID via /api/set-wallet:', error);
      res.status(500).json({ 
        success: false, 
        message: error instanceof Error ? error.message : 'Failed to save wallet'
      });
    }
  });
  
  // Change wallet endpoint - requires dynamic AXN fee from admin settings
  app.post('/api/wallet/change', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Wallet change requested without session - skipping");
        return res.status(401).json({
          success: false,
          message: 'Please log in to change wallet'
        });
      }
      
      const { newWalletId } = req.body;
      
      console.log('🔄 Wallet change request for user:', userId);
      
      if (!newWalletId || !newWalletId.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid  wallet address'
        });
      }
      
      // Validate  wallet address (must start with UQ or EQ)
      if (!/^(UQ|EQ)[A-Za-z0-9_-]{46}/.test(newWalletId.trim())) {
        console.log('🚫 Invalid  wallet address format');
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid  wallet address'
        });
      }
      
      // Get wallet change fee from admin settings (stored in AXN)
      const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
      const feeInPad = parseInt(walletChangeFee);
      const feeInTon = feeInPad / 10000000;
      
      console.log(`💰 Wallet change fee: ${feeInPad} AXN (${feeInTon} )`);
      
      // Use database transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        // Get current user with balance
        const [user] = await tx
          .select({
            id: users.id,
            walletBalance: users.walletBalance,
            cwalletId: users.cwalletId,
            telegramId: users.telegram_id
          })
          .from(users)
          .where(eq(users.id, userId));
        
        if (!user) {
          throw new Error('User not found');
        }
        
        // Check if user has an existing wallet
        if (!user.cwalletId) {
          throw new Error('No wallet set. Please set up your wallet first.');
        }
        
        // Check if new wallet is same as current
        if (user.cwalletId === newWalletId.trim()) {
          throw new Error('New wallet ID is the same as current wallet');
        }
        
        // Check wallet uniqueness
        const [walletInUse] = await tx
          .select({ id: users.id })
          .from(users)
          .where(and(
            eq(users.cwalletId, newWalletId.trim()),
            sql`${users.id} != ${userId}`
          ))
          .limit(1);
        
        if (walletInUse) {
          throw new Error('This  wallet address is already linked to another account');
        }
        
        const currentBalance = parseFloat(user.walletBalance?.toString() || '0');
        const currentBalancePad = Math.floor(currentBalance * 10000000);
        
        if (currentBalancePad < feeInPad) {
          throw new Error(`Insufficient balance. You need ${feeInPad} AXN to change wallet. Current balance: ${currentBalancePad} AXN`);
        }
        
        // Deduct fee from walletBalance (Season 2 primary balance)
        const newBalance = currentBalance - feeInTon;
        
        // Update wallet and walletBalance atomically
        await tx
          .update(users)
          .set({
            cwalletId: newWalletId.trim(),
            walletBalance: newBalance.toFixed(8),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Record transaction
        await tx.insert(transactions).values({
          userId: userId,
          amount: feeInTon.toFixed(8),
          type: 'deduction',
          source: 'wallet_change_fee',
          description: `Fee for changing wallet ID (${feeInPad} AXN)`,
          metadata: { oldWallet: user.cwalletId, newWallet: newWalletId.trim(), feePad: feeInPad }
        });
        
        return {
          newBalance: newBalance.toFixed(8),
          newWallet: newWalletId.trim(),
          feeCharged: feeInTon.toFixed(8),
          feePad: feeInPad,
          telegramId: user.telegramId
        };
      });
      
      console.log('✅ Wallet changed successfully with fee deduction');
      
      // Send notification via WebSocket
      if (result.telegramId && wss) {
        wss.clients.forEach((client: WebSocket) => {
          if ((client as any).userId === userId && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({
              type: 'wallet_changed',
              message: `Wallet updated successfully! ${result.feePad} AXN fee deducted.`,
              data: {
                newWalletId: result.newWallet,
                newBalance: result.newBalance,
                feeCharged: result.feePad
              }
            }));
          }
        });
      }
      
      res.json({
        success: true,
        message: 'Wallet updated successfully',
        data: {
          newWalletId: result.newWallet,
          newBalance: result.newBalance,
          feeCharged: result.feeCharged,
          feePad: result.feePad
        }
      });
      
    } catch (error) {
      console.error('❌ Error changing wallet:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to change wallet'
      });
    }
  });
  

  // AXN conversion endpoint (supports TON, TON, BUG)
  app.post('/api/convert-to-usd', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { padAmount, convertTo = '' } = req.body;
      
      console.log('💵 AXN conversion request:', { userId, padAmount, convertTo });
      
      const convertAmount = parseFloat(padAmount);
      if (!padAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid AXN amount'
        });
      }
      
      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        // Lock user row and get current balances
        const [user] = await tx
          .select({ 
            walletBalance: users.walletBalance,
            tonBalance: users.tonBalance,
            bugBalance: users.bugBalance
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }
        
        const currentPadBalance = parseFloat(user.walletBalance?.toString() || '0');
        
        if (currentPadBalance < convertAmount) {
          throw new Error('Insufficient AXN balance');
        }
        
        const newPadBalance = currentPadBalance - convertAmount;
        let updateData: any = {
          walletBalance: String(Math.round(newPadBalance)),
          updatedAt: new Date()
        };
        
        let convertedAmount = 0;
        let convertedCurrency = convertTo;
        
        if (convertTo === '' || convertTo === 'TON') {
          const conversionRateSetting = await storage.getAppSetting('axn_to_ton_rate', '100000');
          const AXN_TO_TON_RATE = parseFloat(conversionRateSetting);
          convertedAmount = convertAmount / AXN_TO_TON_RATE;
          const currentTonBalance = parseFloat(user.tonBalance || '0');
          updateData.tonBalance = (currentTonBalance + convertedAmount).toFixed(10);
          console.log(`✅ AXN to TON: ${convertAmount} AXN → ${convertedAmount.toFixed(6)} TON`);
        } else if (convertTo === 'BUG') {
          const padToBugRateSetting = await storage.getAppSetting('axn_to_bug_rate', '1');
          const AXN_TO_BUG_RATE = parseFloat(padToBugRateSetting);
          convertedAmount = convertAmount * AXN_TO_BUG_RATE;
          const currentBugBalance = parseFloat(user.bugBalance || '0');
          updateData.bugBalance = (currentBugBalance + convertedAmount).toFixed(10);
          console.log(`✅ AXN to BUG: ${convertAmount} AXN → ${convertedAmount.toFixed(0)} BUG`);
        }
        
        await tx.update(users).set(updateData).where(eq(users.id, userId));
        
        return {
          padAmount: convertAmount,
          convertedAmount,
          convertedCurrency,
          newPadBalance
        };
      });
      
      sendRealtimeUpdate(userId, { type: 'balance_update' });
      
      res.json({
        success: true,
        message: `Converted to ${result.convertedCurrency} successfully!`,
        ...result
      });
      
    } catch (error) {
      console.error('❌ Error converting AXN:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';
      res.status(errorMessage === 'Insufficient AXN balance' ? 400 : 500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // AXN to  conversion endpoint
  app.post('/api/convert-to-ton', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️  conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { padAmount } = req.body;
      
      console.log('💎 AXN to  conversion request:', { userId, padAmount });
      
      const convertAmount = parseFloat(padAmount);
      if (!padAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid AXN amount'
        });
      }

      // Get minimum conversion from admin settings
      const minConvertSetting = await storage.getAppSetting('minimum_convert_axn_to_ton', '10000');
      const minimumConvertAXN = parseFloat(minConvertSetting);

      if (convertAmount < minimumConvertAXN) {
        return res.status(400).json({
          success: false,
          message: `Minimum ${minimumConvertAXN.toLocaleString()} AXN required for  conversion`
        });
      }
      
      // Get conversion rate from admin settings (default: 100,000 AXN = 1 TON)
      const conversionRateSetting = await storage.getAppSetting('axn_to_ton_rate', '100000');
      const AXN_TO_TON_RATE = parseFloat(conversionRateSetting);
      const tonAmount = convertAmount / AXN_TO_TON_RATE;
      
      console.log(`📊 Using conversion rate: ${AXN_TO_TON_RATE} AXN = 1 TON`);
      
      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({ 
            walletBalance: users.walletBalance,
            tonBalance: users.tonBalance
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }
        
        const currentPadBalance = parseFloat(user.walletBalance?.toString() || '0');
        const currentTonBalance = parseFloat(user.tonBalance || '0');
        
        if (currentPadBalance < convertAmount) {
          throw new Error('Insufficient AXN balance');
        }
        
        const newPadBalance = currentPadBalance - convertAmount;
        const newTonBalance = currentTonBalance + tonAmount;
        
        await tx
          .update(users)
          .set({
            walletBalance: String(Math.round(newPadBalance)),
            tonBalance: newTonBalance.toFixed(10),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        console.log(`✅ AXN to  conversion successful: ${convertAmount} AXN → ${tonAmount.toFixed(6)} TON`);
        
        return {
          padAmount: convertAmount,
          tonAmount,
          newPadBalance,
          newTonBalance
        };
      });
      
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        balance: String(result.newPadBalance),
        tonBalance: result.newTonBalance.toFixed(10)
      });
      
      res.json({
        success: true,
        message: 'Conversion to  successful!',
        ...result
      });
      
    } catch (error) {
      console.error('❌ Error converting AXN to TON:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';
      
      res.status(errorMessage === 'Insufficient AXN balance' ? 400 : 500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // AXN to BUG conversion endpoint
  app.post('/api/convert-to-bug', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ BUG conversion requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }

      const { padAmount } = req.body;
      
      console.log('🐛 AXN to BUG conversion request:', { userId, padAmount });
      
      const convertAmount = parseFloat(padAmount);
      if (!padAmount || isNaN(convertAmount) || convertAmount <= 0) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid AXN amount'
        });
      }

      // Get minimum conversion from admin settings
      const minConvertSetting = await storage.getAppSetting('minimum_convert_pad_to_bug', '1000');
      const minimumConvertAXN = parseFloat(minConvertSetting);

      if (convertAmount < minimumConvertAXN) {
        return res.status(400).json({
          success: false,
          message: `Minimum ${minimumConvertAXN.toLocaleString()} AXN required for BUG conversion`
        });
      }
      
      // Get conversion rate from admin settings (default: 1 AXN = 1 BUG)
      const conversionRateSetting = await storage.getAppSetting('axn_to_bug_rate', '1');
      const AXN_TO_BUG_RATE = parseFloat(conversionRateSetting);
      const bugAmount = convertAmount / AXN_TO_BUG_RATE;
      
      console.log(`📊 Using conversion rate: ${AXN_TO_BUG_RATE} AXN = 1 BUG`);
      
      // Use transaction to ensure atomicity
      const result = await db.transaction(async (tx) => {
        const [user] = await tx
          .select({ 
            walletBalance: users.walletBalance,
            bugBalance: users.bugBalance
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }
        
        const currentPadBalance = parseFloat(user.walletBalance?.toString() || '0');
        const currentBugBalance = parseFloat(user.bugBalance || '0');
        
        if (currentPadBalance < convertAmount) {
          throw new Error('Insufficient AXN balance');
        }
        
        const newPadBalance = currentPadBalance - convertAmount;
        const newBugBalance = currentBugBalance + bugAmount;
        
        await tx
          .update(users)
          .set({
            walletBalance: String(Math.round(newPadBalance)),
            bugBalance: newBugBalance.toFixed(10),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        console.log(`✅ AXN to BUG conversion successful: ${convertAmount} AXN → ${bugAmount.toFixed(0)} BUG`);
        
        return {
          padAmount: convertAmount,
          bugAmount,
          newPadBalance,
          newBugBalance
        };
      });
      
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        balance: String(result.newPadBalance),
        bugBalance: result.newBugBalance.toFixed(10)
      });
      
      res.json({
        success: true,
        message: 'Conversion to BUG successful!',
        ...result
      });
      
    } catch (error) {
      console.error('❌ Error converting AXN to BUG:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to convert';
      
      res.status(errorMessage === 'Insufficient AXN balance' ? 400 : 500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // Setup TONT wallet (Optimism network only)
  app.post('/api/wallet/usdt', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Please log in to set up wallet'
        });
      }
      
      const { usdtAddress } = req.body;
      
      if (!usdtAddress || !usdtAddress.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your TONT wallet address'
        });
      }
      
      // Validate Optimism TONT address (0x... format, 42 characters)
      if (!/^0x[a-fA-F0-9]{40}/.test(usdtAddress.trim())) {
        return res.status(400).json({
          success: false,
          message: 'Please enter a valid Optimism TONT address'
        });
      }
      
      // Check if address is already in use
      const [existingWallet] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.usdtWalletAddress, usdtAddress.trim()),
          sql`${users.id} != ${userId}`
        ))
        .limit(1);
      
      if (existingWallet) {
        return res.status(400).json({
          success: false,
          message: 'This TONT address is already linked to another account'
        });
      }
      
      // Check if user already has a TONT wallet - if yes, charge fee for change
      const [currentUser] = await db
        .select({ 
          usdtWalletAddress: users.usdtWalletAddress,
          walletBalance: users.walletBalance
        })
        .from(users)
        .where(eq(users.id, userId));
      
      const isChangingWallet = currentUser?.usdtWalletAddress && currentUser.usdtWalletAddress.trim() !== '';
      
      if (isChangingWallet) {
        // Get wallet change fee from admin settings
        const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
        const feeInPad = parseInt(walletChangeFee);
        
        const currentBalance = parseFloat(currentUser.walletBalance?.toString() || '0');
        const currentBalancePad = currentBalance < 1 ? Math.floor(currentBalance * 10000000) : Math.floor(currentBalance);
        
        if (currentBalancePad < feeInPad) {
          return res.status(400).json({
            success: false,
            message: `Insufficient balance. You need ${feeInPad} AXN to change wallet. Current balance: ${currentBalancePad} AXN`
          });
        }
        
        // Deduct fee from walletBalance (Season 2 primary balance)
        const newBalancePad = currentBalancePad - feeInPad;
        
        // Update wallet and deduct fee
        await db
          .update(users)
          .set({
            usdtWalletAddress: usdtAddress.trim(),
            walletBalance: newBalancePad.toString(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Record transaction
        await db.insert(transactions).values({
          userId: userId,
          amount: feeInPad.toString(),
          type: 'deduction',
          description: `TONT wallet change fee`,
        } as any);
        
        console.log(`✅ TONT wallet changed for user ${userId} - Fee: ${feeInPad} AXN deducted`);
        
        // Send real-time update
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: newBalancePad.toString()
        });
      } else {
        // First time setup - no fee
        await db
          .update(users)
          .set({
            usdtWalletAddress: usdtAddress.trim(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        console.log(`✅ TONT wallet set for user ${userId} (first time - no fee)`);
      }
      
      res.json({
        success: true,
        message: 'TONT wallet saved successfully'
      });
      
    } catch (error) {
      console.error('❌ Error setting TONT wallet:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save TONT wallet'
      });
    }
  });

  // Setup Telegram Stars username
  app.post('/api/wallet/telegram-stars', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.status(401).json({
          success: false,
          message: 'Please log in to set up username'
        });
      }
      
      let { telegramUsername } = req.body;
      
      if (!telegramUsername || !telegramUsername.trim()) {
        return res.status(400).json({
          success: false,
          message: 'Please enter your Telegram username'
        });
      }
      
      // Auto-add @ if not present
      telegramUsername = telegramUsername.trim();
      if (!telegramUsername.startsWith('@')) {
        telegramUsername = '@' + telegramUsername;
      }
      
      // Validate username format: @username (letters, numbers, underscores only, no spaces or special chars)
      if (!/^@[a-zA-Z0-9_]{1,32}/.test(telegramUsername)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid username format. Use only letters, numbers, and underscores (e.g., @szxzyz)'
        });
      }
      
      // Check if user already has a Telegram username - if yes, charge fee for change
      const [currentUser] = await db
        .select({ 
          telegramStarsUsername: users.telegramStarsUsername,
          walletBalance: users.walletBalance
        })
        .from(users)
        .where(eq(users.id, userId));
      
      const isChangingUsername = currentUser?.telegramStarsUsername && currentUser.telegramStarsUsername.trim() !== '';
      
      if (isChangingUsername) {
        // Get wallet change fee from admin settings
        const walletChangeFee = await storage.getAppSetting('walletChangeFee', 5000);
        const feeInPad = parseInt(walletChangeFee);
        
        const currentBalance = parseFloat(currentUser.walletBalance?.toString() || '0');
        const currentBalancePad = currentBalance < 1 ? Math.floor(currentBalance * 10000000) : Math.floor(currentBalance);
        
        if (currentBalancePad < feeInPad) {
          return res.status(400).json({
            success: false,
            message: `Insufficient balance. You need ${feeInPad} AXN to change username. Current balance: ${currentBalancePad} AXN`
          });
        }
        
        // Deduct fee from walletBalance (Season 2 primary balance)
        const newBalancePad = currentBalancePad - feeInPad;
        
        // Update username and deduct fee
        await db
          .update(users)
          .set({
            telegramStarsUsername: telegramUsername,
            walletBalance: newBalancePad.toString(),
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        // Record transaction
        await db.insert(transactions).values({
          userId: userId,
          amount: feeInPad.toString(),
          type: 'deduction',
          description: `Telegram Stars username change fee`,
        } as any);
        
        console.log(`✅ Telegram Stars username changed for user ${userId} - Fee: ${feeInPad} AXN deducted`);
        
        // Send real-time update
        sendRealtimeUpdate(userId, {
          type: 'balance_update',
          balance: newBalancePad.toString()
        });
      } else {
        // First time setup - no fee
        await db
          .update(users)
          .set({
            telegramStarsUsername: telegramUsername,
            walletUpdatedAt: new Date(),
            updatedAt: new Date()
          })
          .where(eq(users.id, userId));
        
        console.log(`✅ Telegram Stars username set for user ${userId}: ${telegramUsername} (first time - no fee)`);
      }
      
      res.json({
        success: true,
        message: 'Telegram username saved successfully',
        username: telegramUsername
      });
      
    } catch (error) {
      console.error('❌ Error setting Telegram Stars username:', error);
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : 'Failed to save username'
      });
    }
  });

  // Advertiser Task System routes removed (tables dropped)


  // Advertiser task create route removed (advertiserTasks table dropped)

  // Record task click (when publisher clicks on a task)
  // advertiser-tasks click/claim/increase-limit/has-clicked/pause/resume/delete/verify-channel routes removed

  // claim/increase-limit/has-clicked/pause/resume/delete/verify-channel advertiser routes removed
  
  // User withdrawal endpoints
  
  // Get user's withdrawal history
  app.get('/api/withdrawals', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, withdrawals: [] });
      }
      
      // Get all user's withdrawals (show all statuses: pending, Approved, paid, rejected, etc.)
      const userWithdrawals = await db
        .select({
          id: withdrawals.id,
          amount: withdrawals.amount,
          method: withdrawals.method,
          status: withdrawals.status,
          details: withdrawals.details,
          comment: withdrawals.comment,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt
        })
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt));
      
      const depositRows = await db.execute(sql`
        SELECT id, gram_amount, status, payment_hash, created_at, credited_at
        FROM gram_deposits
        WHERE user_id = ${userId}
        ORDER BY created_at DESC
      `);
      const deposits = (depositRows.rows || []).map((deposit: any) => ({
        id: `gram-${deposit.id}`,
        amount: deposit.gram_amount,
        method: 'GRAM deposit',
        status: deposit.status,
        details: deposit.payment_hash ? `Payment: ${deposit.payment_hash}` : 'Blockchain verification pending',
        transactionHash: deposit.payment_hash,
        createdAt: deposit.credited_at || deposit.created_at,
        currency: 'GRAM',
        source: 'gram_deposit',
      }));

      res.json({ 
        success: true,
        withdrawals: [...userWithdrawals, ...deposits]
      });
      
    } catch (error) {
      console.error('❌ Error fetching user withdrawals:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch withdrawals' 
      });
    }
  });

  // Get user's deposit history (PDZ top-ups)
  app.get('/api/deposits/history', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, deposits: [] });
      }
      
      // Get PDZ top-up transactions from transactions table
      const depositHistory = await db
        .select({
          id: transactions.id,
          amount: transactions.amount,
          type: transactions.type,
          source: transactions.source,
          createdAt: transactions.createdAt
        })
        .from(transactions)
        .where(and(
          eq(transactions.userId, userId),
          eq(transactions.source, 'pdz_topup')
        ))
        .orderBy(desc(transactions.createdAt))
        .limit(10);
      
      res.json({ 
        success: true,
        deposits: depositHistory.map(d => ({
          id: d.id,
          amount: d.amount,
          status: 'completed',
          createdAt: d.createdAt
        }))
      });
      
    } catch (error) {
      console.error('❌ Error fetching deposit history:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch deposits' 
      });
    }
  });

  // Create new withdrawal request - auth removed to prevent popup spam
  app.post('/api/withdrawals', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Withdrawal requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      
      const { method, starPackage, amount: requestedAmount, withdrawalPackage, address: bodyAddress } = req.body;

      console.log('📝 Withdrawal request received:', { userId, method, starPackage, withdrawalPackage });

      // Validate withdrawal method
      const validMethods = ['', 'TONT', 'STARS', 'TON'];
      if (!method || !validMethods.includes(method)) {
        console.log("❌ Invalid withdrawal method:", method);
        return res.status(400).json({
          success: false,
          message: 'Invalid withdrawal method'
        });
      }

      // Check for pending withdrawals
      const pendingWithdrawals = await db
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          eq(withdrawals.status, 'pending')
        ))
        .limit(1);

      if (pendingWithdrawals.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'Cannot create new request until current one is processed'
        });
      }

      // Use transaction to ensure atomicity and prevent race conditions
      const newWithdrawal = await db.transaction(async (tx) => {
        // Lock user row and get balances, wallet addresses, and device info
        const [user] = await tx
          .select({ 
            balance: users.balance,
            tonBalance: users.tonBalance,
            bugBalance: users.bugBalance,
            cwalletId: users.cwalletId,
            usdtWalletAddress: users.usdtWalletAddress,
            tonWalletAddress: users.tonWalletAddress,
            telegramStarsUsername: users.telegramStarsUsername,
            friendsInvited: users.friendsInvited,
            telegram_id: users.telegram_id,
            username: users.username,
            banned: users.banned,
            bannedReason: users.bannedReason,
            deviceId: users.deviceId,
            adsWatched: users.adsWatched
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }

        // CRITICAL: Check if user is banned - prevent banned accounts from withdrawing
        if (user.banned) {
          throw new Error(`Account is banned: ${user.bannedReason || 'Multi-account violation'}`);
        }

        // CRITICAL: Check for duplicate accounts on same device trying to withdraw
        if (user.deviceId) {
          const duplicateAccounts = await tx
            .select({ id: users.id, banned: users.banned, isPrimaryAccount: users.isPrimaryAccount })
            .from(users)
            .where(and(
              eq(users.deviceId, user.deviceId),
              sql`${users.id} != ${userId}`
            ));

          if (duplicateAccounts.length > 0) {
            // Determine if current user is the primary account
            const [currentUserFull] = await tx
              .select({ isPrimaryAccount: users.isPrimaryAccount })
              .from(users)
              .where(eq(users.id, userId));
            
            const isPrimary = currentUserFull?.isPrimaryAccount === true;
            
            if (!isPrimary) {
              // Ban this duplicate account only
              const { banUserForMultipleAccounts, sendWarningToMainAccount } = await import('./deviceTracking');
              await banUserForMultipleAccounts(
                userId,
                'Duplicate account attempted withdrawal - only one account per device is allowed'
              );
              
              // Send warning to primary account
              const primaryAccount = duplicateAccounts.find(u => u.isPrimaryAccount === true) || duplicateAccounts[0];
              if (primaryAccount) {
                await sendWarningToMainAccount(primaryAccount.id);
              }
              
              throw new Error('Withdrawal blocked - multiple accounts detected on this device. This account has been banned.');
            }
          }
        }

        // ✅ Check if user has invited enough friends (based on admin settings)
        // First, get admin settings for invite requirement
        const [inviteRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_invite_requirement_enabled'))
          .limit(1);
        const withdrawalInviteRequirementEnabled = (inviteRequirementEnabledSetting?.settingValue || 'true') === 'true';
        
        const [minimumInvitesSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_invites_for_withdrawal'))
          .limit(1);
        const minimumInvitesForWithdrawal = parseInt(minimumInvitesSetting?.settingValue || '3');
        
        // Only check invite requirement if it's enabled in admin settings
        if (withdrawalInviteRequirementEnabled) {
          const friendsInvited = user.friendsInvited || 0;
          if (friendsInvited < minimumInvitesForWithdrawal) {
            const remaining = minimumInvitesForWithdrawal - friendsInvited;
            throw new Error(`Invite ${remaining} more friend${remaining !== 1 ? 's' : ''} to unlock withdrawals.`);
          }
        }
        
        // ✅ Check if user has watched enough ads (based on admin settings)
        const [adRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_ad_requirement_enabled'))
          .limit(1);
        const withdrawalAdRequirementEnabled = (adRequirementEnabledSetting?.settingValue || 'true') === 'true';
        
        const [minimumAdsSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_ads_for_withdrawal'))
          .limit(1);
        const minimumAdsForWithdrawal = parseInt(minimumAdsSetting?.settingValue || '100');
        
        // Only check ad requirement if it's enabled in admin settings
        if (withdrawalAdRequirementEnabled) {
          // Get ads watched since last withdrawal
          const lastApprovedWithdrawal = await tx
            .select({ createdAt: withdrawals.createdAt })
            .from(withdrawals)
            .where(and(
              eq(withdrawals.userId, String(userId)),
              sql`${withdrawals.status} IN ('completed', 'approved')`
            ))
            .orderBy(desc(withdrawals.createdAt))
            .limit(1);
          
          let adsWatchedSinceLastWithdrawal = user.adsWatched || 0;
          
          if (lastApprovedWithdrawal.length > 0) {
            const lastWithdrawalDate = lastApprovedWithdrawal[0].createdAt;
            const adsCountResult = await tx
              .select({ count: sql<number>`count(*)` })
              .from(earnings)
              .where(and(
                eq(earnings.userId, String(userId)),
                eq(earnings.source, 'ad_watch'),
                ...(lastWithdrawalDate ? [gte(earnings.createdAt, lastWithdrawalDate)] : [])
              ));
            adsWatchedSinceLastWithdrawal = adsCountResult[0]?.count || 0;
          }
          
          if (adsWatchedSinceLastWithdrawal < minimumAdsForWithdrawal) {
            const remaining = minimumAdsForWithdrawal - adsWatchedSinceLastWithdrawal;
            throw new Error(`Watch ${remaining} more ad${remaining !== 1 ? 's' : ''} to unlock withdrawals.`);
          }
        }

        // ✅ Get withdrawal packages from admin settings
        const [withdrawalPackagesSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_packages'))
          .limit(1);
        const withdrawalPackagesConfig = JSON.parse(withdrawalPackagesSetting?.settingValue || '[{"usd":0.2,"bug":2000},{"usd":0.4,"bug":4000},{"usd":0.8,"bug":8000}]');
        
        // Get BUG requirement settings from admin
        const [bugRequirementEnabledSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_bug_requirement_enabled'))
          .limit(1);
        const withdrawalBugRequirementEnabled = bugRequirementEnabledSetting?.settingValue !== 'false';
        
        const [bugPerUsdSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'bug_per_usd'))
          .limit(1);
        const bugPerUsd = parseInt(bugPerUsdSetting?.settingValue || '10000'); // Default: 1  = 10000 BUG
        
        // Determine BUG requirement based on package or FULL withdrawal
        const currentUsdBalanceForBug = parseFloat(user.tonBalance || '0');
        let minimumBugForWithdrawal: number;
        let packageTONAmount: number | null = null;
        
        if (withdrawalPackage && withdrawalPackage !== 'FULL') {
          // Package-based withdrawal: use package's BUG requirement
          const selectedPkg = withdrawalPackagesConfig.find((p: any) => p.ton === withdrawalPackage);
          if (!selectedPkg) {
            throw new Error('Invalid withdrawal package selected');
          }
          minimumBugForWithdrawal = selectedPkg.bug;
          packageTONAmount = selectedPkg.ton;
          
          // Check if user has enough  balance for this package
          if (currentUsdBalanceForBug < packageTONAmount!) {
            throw new Error(`Insufficient balance. You need ${packageTONAmount!.toFixed(2)} TON for this package.`);
          }
        } else {
          // FULL withdrawal: dynamic BUG requirement based on full  balance
          const bugPerTON = bugPerUsd * 5; // appSettings removed, using default TON price
          minimumBugForWithdrawal = Math.ceil(currentUsdBalanceForBug * bugPerTON);
        }
        
        const currentBugBalance = parseFloat(user.bugBalance || '0');
        if (withdrawalBugRequirementEnabled && currentBugBalance < minimumBugForWithdrawal) {
          const remaining = minimumBugForWithdrawal - currentBugBalance;
          const amountStr = packageTONAmount ? `${packageTONAmount.toFixed(2)} TON` : `${currentUsdBalanceForBug.toFixed(2)} TON`;
          throw new Error(`Earn ${remaining.toFixed(0)} more BUG to unlock your ${amountStr} withdrawal. Required: ${minimumBugForWithdrawal.toLocaleString()} BUG.`);
        }

        // Check if user has appropriate wallet address based on method
        let walletAddress: string;
        if (method === 'TON') {
          // Use address from request body first, fall back to saved tonWalletAddress
          walletAddress = (bodyAddress && bodyAddress.trim()) || user.tonWalletAddress || '';
          if (!walletAddress) {
            throw new Error('Please save your TON wallet address first');
          }
        } else if (method === 'STARS') {
          if (!user.telegramStarsUsername) {
            throw new Error('Telegram username not set');
          }
          walletAddress = user.telegramStarsUsername;
        } else {
          // Default to USDT/CWallet for legacy methods
          walletAddress = (bodyAddress && bodyAddress.trim()) || user.usdtWalletAddress || user.cwalletId || '';
          if (!walletAddress) {
            throw new Error('Wallet address not set');
          }
        }

        const currentUsdBalance = parseFloat(user.tonBalance || '0');
        
        console.log('Final withdrawal balance check:', { currentUsdBalance, method });
        
        if (method === 'TON' || method === 'STARS') {
           // We already checked this in storage.createPayoutRequest, but verifying again inside transaction
           // requestedAmount is not directly available here as a number, we'll use logic from storage
        }
        
        // Get minimum withdrawal and fee settings from admin settings
        const [minWithdrawalSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'minimum_withdrawal_ton'))
          .limit(1);
        const minWithdrawalAmount = parseFloat(minWithdrawalSetting?.settingValue || '0.5');
        
        const [feePercentTONSetting] = await tx
          .select({ settingValue: adminSettings.settingValue })
          .from(adminSettings)
          .where(eq(adminSettings.settingKey, 'withdrawal_fee_ton'))
          .limit(1);
        const feePercent = parseFloat(feePercentTONSetting?.settingValue || '5') / 100;
        
        // Calculate withdrawal amount and fee (ALL IN  ONLY)
        let withdrawalAmount: number; // Always in TON
        let fee: number;
        let usdToDeduct: number;
        let withdrawalDetails: any = {
          paymentDetails: walletAddress,
          walletAddress: walletAddress,
          method: method
        };

        if (method === 'STARS') {
          if (!starPackage) {
            throw new Error('Star package selection is required for Telegram Stars withdrawal');
          }
          
          const starPackages = [
            { stars: 15, usdCost: 0.30 },
            { stars: 25, usdCost: 0.50 },
            { stars: 50, usdCost: 1.00 },
            { stars: 100, usdCost: 2.00 }
          ];
          
          const selectedPkg = starPackages.find(p => p.stars === starPackage);
          if (!selectedPkg) {
            throw new Error('Invalid star package selected');
          }
          
          const totalCost = selectedPkg.usdCost * 1.05;
          if (currentUsdBalance < totalCost) {
            throw new Error(`Insufficient balance. You need TON${totalCost.toFixed(2)} (including 5% fee)`);
          }
          
          withdrawalAmount = selectedPkg.usdCost; //  amount
          fee = selectedPkg.usdCost * 0.05;
          usdToDeduct = totalCost;
          withdrawalDetails.starPackage = starPackage;
          withdrawalDetails.stars = starPackage;
          withdrawalDetails.telegramUsername = walletAddress;
        } else {
          // Determine the  amount to withdraw based on package selection
          let baseAmount: number;
          if (packageTONAmount !== null) {
            // Package-based withdrawal: use exact package amount
            baseAmount = packageTONAmount;
          } else {
            // FULL withdrawal: use full balance
            baseAmount = currentUsdBalance;
            
            // Check minimum withdrawal requirement only for FULL withdrawals
            const requiredMinimum = minWithdrawalAmount;
            if (baseAmount < requiredMinimum) {
              throw new Error(`Minimum ${requiredMinimum.toFixed(2)}`);
            }
          }
          
          // Use admin-configured fees
          fee = baseAmount * feePercent;
          withdrawalAmount = baseAmount - fee; // TON amount after fee
          usdToDeduct = baseAmount;
          
          // Store package info if applicable
          if (packageTONAmount !== null) {
            withdrawalDetails.withdrawalPackage = packageTONAmount;
          }
          // Always store BUG deduction amount for approval processing (both package and FULL withdrawals)
          withdrawalDetails.bugDeducted = minimumBugForWithdrawal;
          
          // Store wallet address based on method
          if (method === 'TON') {
            withdrawalDetails.tonWalletAddress = walletAddress;
          } else {
            withdrawalDetails.usdtWalletAddress = walletAddress;
          }
        }

        console.log(`📝 Creating withdrawal request for ${withdrawalAmount.toFixed(2)} TON via ${method} (balance will be deducted on approval)`);

        // Store the fee percentage from admin settings for consistent display
        const feePercentForDetails = method === 'TON' ? feePercent : (method === 'STARS' ? 0.05 : feePercent);
        withdrawalDetails.totalDeducted = usdToDeduct.toFixed(10);
        withdrawalDetails.fee = fee.toFixed(10);
        withdrawalDetails.feePercent = (feePercentForDetails * 100).toString(); // Store exact percentage (e.g., "5" or "2.5")
        withdrawalDetails.requestedAmount = usdToDeduct.toFixed(10); // Total amount before fee
        withdrawalDetails.netAmount = withdrawalAmount.toFixed(10); // Amount after fee

        // Deduct the TON balance IMMEDIATELY and atomically (before insert)
        const [balanceUpdated] = await tx
          .update(users)
          .set({
            tonBalance: sql`GREATEST(0, COALESCE(${users.tonBalance}, 0) - ${usdToDeduct.toFixed(10)})`,
            updatedAt: new Date()
          })
          .where(and(
            eq(users.id, userId),
            sql`COALESCE(${users.tonBalance}, 0) >= ${usdToDeduct.toFixed(10)}`
          ))
          .returning({ tonBalance: users.tonBalance });

        if (!balanceUpdated) {
          throw new Error(`Insufficient balance. You have ${currentUsdBalance.toFixed(2)} TON but need ${usdToDeduct.toFixed(2)} TON.`);
        }

        console.log(`💰 Withdrawal submitted: tonBalance deducted ${currentUsdBalance.toFixed(4)} → ${balanceUpdated.tonBalance} TON`);

        const withdrawalData: any = {
          userId,
          amount: withdrawalAmount.toFixed(10),
          method: method,
          status: 'pending',
          deducted: true,
          refunded: false,
          details: withdrawalDetails
        };

        const [withdrawal] = await tx.insert(withdrawals).values(withdrawalData).returning();
        console.log(`📋 Withdrawal request created for ${usdToDeduct.toFixed(2)} TON — balance deducted immediately`);
        
        return { 
          withdrawal, 
          withdrawnAmount: withdrawalAmount, //  amount
          fee: fee,
          feePercent: (feePercentForDetails * 100).toString(), // Fee percentage as string (exact value)
          method: method,
          starPackage: method === 'STARS' ? starPackage : undefined,
          userTelegramId: user.telegram_id,
          username: user.username,
          firstName: (user as any).firstName || user.username || 'Unknown',
          walletAddress: walletAddress
        };
      });

      console.log(`✅ Withdrawal request created: ${newWithdrawal.withdrawal.id} for user ${userId}, amount: TON${newWithdrawal.withdrawnAmount.toFixed(2)} via ${newWithdrawal.method}`);

      // Send withdrawal_requested notification via WebSocket
      sendRealtimeUpdate(userId, {
        type: 'withdrawal_requested',
        amount: newWithdrawal.withdrawnAmount.toFixed(2),
        method: newWithdrawal.method,
        message: 'You have sent a withdrawal request.'
      });

      // Send withdrawal notification to admin via Telegram bot with inline buttons
      // Format matches the approved withdrawal message format exactly
      const userName = newWithdrawal.firstName;
      const userTelegramId = newWithdrawal.userTelegramId || '';
      const userTelegramUsername = newWithdrawal.username ? `@${newWithdrawal.username}` : 'N/A';
      const currentDate = new Date().toUTCString();
      const walletAddress = newWithdrawal.walletAddress || 'N/A';
      const feeAmount = newWithdrawal.fee;
      const feePercent = newWithdrawal.feePercent;
      
      const _admBotName = await getBotUsername();
      const adminMessage = `💰 Withdrawal Request

🗣 User: ${userName}
🆔 User ID: ${userTelegramId}
🌐 Address: <code>${walletAddress}</code>
💸 Amount: ${newWithdrawal.withdrawnAmount.toFixed(5)} TON
🛂 Fee: ${feeAmount.toFixed(5)} (${feePercent}%)
📅 Date: ${currentDate}
🤖 Bot: @${_admBotName}`;

      // Create inline keyboard with Approve and Reject buttons
      const inlineKeyboard = {
        inline_keyboard: [[
          { text: "🔘 Approve", callback_data: `withdraw_paid_${newWithdrawal.withdrawal.id}` },
          { text: "❌ Reject", callback_data: `withdraw_reject_${newWithdrawal.withdrawal.id}` }
        ]]
      };

      // Send message with inline buttons to admin
      if (process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_ADMIN_ID) {
        fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: process.env.TELEGRAM_ADMIN_ID,
            text: adminMessage,
            parse_mode: 'HTML',
            reply_markup: inlineKeyboard
          })
        }).catch(err => {
          console.error('❌ Failed to send admin notification:', err);
        });
      }
      
      // Send notification to PaidAdzGroup for withdrawal requests (same format as admin notification)
      if (process.env.TELEGRAM_BOT_TOKEN) {
        const PAIDADZ_GROUP_CHAT_ID = '-1003402950172';
        // Use the exact same format as admin message
        const groupMessage = `💰 Withdrawal Request

🗣 User: <a href="tg://user?id=${userTelegramId}">${userName}</a>
🆔 User ID: ${userTelegramId}
💳 Username: ${userTelegramUsername}
🌐 Address:
${walletAddress}
💸 Amount: ${newWithdrawal.withdrawnAmount.toFixed(5)} TON
🛂 Fee: ${feeAmount.toFixed(5)} (${feePercent}%)
📅 Date: ${currentDate}
🤖 Bot: @${_admBotName}`;

        fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: PAIDADZ_GROUP_CHAT_ID,
            text: groupMessage,
            parse_mode: 'HTML'
          })
        }).catch(err => {
          console.error('❌ Failed to send group notification for withdrawal:', err);
        });
      }

      res.json({
        success: true,
        message: 'You have sent a withdrawal request',
        withdrawal: {
          id: newWithdrawal.withdrawal.id,
          amount: newWithdrawal.withdrawal.amount,
          status: newWithdrawal.withdrawal.status,
          method: newWithdrawal.withdrawal.method,
          createdAt: newWithdrawal.withdrawal.createdAt
        }
      });

    } catch (error) {
      console.error('❌ Error creating withdrawal request:', error);
      console.error('❌ Error details:', error instanceof Error ? error.message : String(error));
      console.error('❌ Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      const errorMessage = error instanceof Error ? error.message : 'Failed to create withdrawal request';
      
      // Return 400 for validation errors (user-facing errors), 500 for system errors
      // Use substring matching to catch all variations of user-facing errors
      const isValidationError = 
        errorMessage.includes('Insufficient') || 
        errorMessage.includes('balance') ||
        errorMessage.includes('Minimum withdrawal') ||
        errorMessage.includes('User not found') ||
        errorMessage.includes('wallet address') ||
        errorMessage.includes('invite') ||
        errorMessage.includes('friends') ||
        errorMessage.includes('already in use') ||
        errorMessage.includes('Cannot create new request') ||
        errorMessage.includes('Star package') ||
        errorMessage.includes('Invalid') ||
        errorMessage.includes('banned');
      
      if (isValidationError) {
        return res.status(400).json({ 
          success: false, 
          message: errorMessage
        });
      }
      
      res.status(500).json({ 
        success: false, 
        message: errorMessage
      });
    }
  });

  // Alternative withdrawal endpoint for compatibility - /api/withdraw
  app.post('/api/withdraw', async (req: any, res) => {
    try {
      // Get userId from session or req.user (lenient check)
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        console.log("⚠️ Withdrawal (/api/withdraw) requested without session - skipping");
        return res.json({ success: true, skipAuth: true });
      }
      
      const { walletAddress, comment } = req.body;

      console.log('📝 Withdrawal via /api/withdraw (withdrawing all  balance):', { userId });

      // Check for pending withdrawals
      const pendingWithdrawals = await db
        .select({ id: withdrawals.id })
        .from(withdrawals)
        .where(and(
          eq(withdrawals.userId, userId),
          eq(withdrawals.status, 'pending')
        ))
        .limit(1);

      if (pendingWithdrawals.length > 0) {
        return res.status(400).json({
          success: false,
          message: 'You already have a pending withdrawal'
        });
      }

      // Use transaction for atomicity
      const result = await db.transaction(async (tx) => {
        // Lock user row and get  balance, ban status, and device info
        const [user] = await tx
          .select({ 
            tonBalance: users.tonBalance,
            firstName: users.firstName,
            username: users.username,
            banned: users.banned,
            bannedReason: users.bannedReason,
            deviceId: users.deviceId
          })
          .from(users)
          .where(eq(users.id, userId))
          .for('update');
        
        if (!user) {
          throw new Error('User not found');
        }

        // CRITICAL: Check if user is banned
        if (user.banned) {
          throw new Error(`Account is banned: ${user.bannedReason || 'Multi-account violation'}`);
        }

        // CRITICAL: Check for duplicate accounts on same device
        if (user.deviceId) {
          const duplicateAccounts = await tx
            .select({ id: users.id, isPrimaryAccount: users.isPrimaryAccount })
            .from(users)
            .where(and(
              eq(users.deviceId, user.deviceId),
              sql`${users.id} != ${userId}`
            ));

          if (duplicateAccounts.length > 0) {
            // Determine if current user is the primary account
            const [currentUserFull] = await tx
              .select({ isPrimaryAccount: users.isPrimaryAccount })
              .from(users)
              .where(eq(users.id, userId));
            
            const isPrimary = currentUserFull?.isPrimaryAccount === true;
            
            if (!isPrimary) {
              // Ban this duplicate account only
              const { banUserForMultipleAccounts, sendWarningToMainAccount } = await import('./deviceTracking');
              await banUserForMultipleAccounts(
                userId,
                'Duplicate account attempted withdrawal - only one account per device is allowed'
              );
              
              // Send warning to primary account
              const primaryAccount = duplicateAccounts.find(u => u.isPrimaryAccount === true) || duplicateAccounts[0];
              if (primaryAccount) {
                await sendWarningToMainAccount(primaryAccount.id);
              }
              
              throw new Error('Withdrawal blocked - multiple accounts detected on this device. This account has been banned.');
            }
          }
        }

        const currentTonBalance = parseFloat(user.tonBalance || '0');
        
        if (currentTonBalance < 0.001) {
          throw new Error('You need at least 0.001 ');
        }

        // Deduct balance instantly
        await tx
          .update(users)
          .set({ tonBalance: '0', updatedAt: new Date() })
          .where(eq(users.id, userId));

        // Create withdrawal with deducted flag
        const [withdrawal] = await tx.insert(withdrawals).values({
          userId,
          amount: currentTonBalance.toFixed(8),
          method: 'ton_coin',
          status: 'pending',
          deducted: true,
          refunded: false,
          details: { walletAddress: walletAddress || '', comment: comment || '' }
        }).returning();
        
        return { withdrawal, withdrawnAmount: currentTonBalance, user };
      });

      console.log(`✅ Withdrawal via /api/withdraw: ${result.withdrawnAmount} TON`);

      // Send Admin Telegram Notification
      try {
        const { sendTelegramMessage } = await import('./telegram');
        const adminMessage = `💰 <b>New Withdrawal Request</b>\n\n` +
          `👤 <b>User:</b> ${result.user.firstName || 'N/A'} (@${result.user.username || 'N/A'})\n` +
          `🆔 <b>UID:</b> ${userId}\n` +
          `💸 <b>Amount:</b> ${result.withdrawnAmount.toFixed(8)} TON\n` +
          `💳 <b>Method:</b> ton_coin\n` +
          `🌐 <b>Address:</b> <code>${walletAddress || 'N/A'}</code>\n` +
          `📝 <b>ID:</b> <code>${result.withdrawal.id}</code>`;
        
        await sendTelegramMessage(adminMessage);
      } catch (notifyError) {
        console.error('❌ Failed to send admin notification:', notifyError);
      }

      // Send real-time update
      sendRealtimeUpdate(userId, {
        type: 'balance_update',
        tonBalance: '0'
      });

      res.json({
        success: true,
        message: 'You have sent a withdrawal request'
      });

    } catch (error) {
      console.error('❌ Error in /api/withdraw:', error);
      const errorMessage = error instanceof Error ? error.message : 'Failed to process withdrawal';
      res.status(500).json({ success: false, message: errorMessage });
    }
  });

  // Alternative withdrawal history endpoint - /api/withdraw/history
  app.get('/api/withdraw/history', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      
      if (!userId) {
        return res.json({ success: true, skipAuth: true, history: [] });
      }
      
      const history = await db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.userId, userId))
        .orderBy(desc(withdrawals.createdAt));
      
      res.json({ 
        success: true, 
        history 
      });
      
    } catch (error) {
      console.error('❌ Error fetching withdrawal history:', error);
      res.status(500).json({ success: false, message: 'Failed to fetch history' });
    }
  });
  
  // Admin withdrawal management endpoints
  
  // Get pending withdrawals (admin only)
  app.get('/api/admin/withdrawals/pending', authenticateAdmin, async (req: any, res) => {
    try {
      
      // Get pending withdrawals only
      const pendingWithdrawals = await db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          amount: withdrawals.amount,
          status: withdrawals.status,
          method: withdrawals.method,
          details: withdrawals.details,
          comment: withdrawals.comment,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          rejectionReason: withdrawals.rejectionReason,
          user: {
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            telegram_id: users.telegram_id
          }
        })
        .from(withdrawals)
        .leftJoin(users, eq(withdrawals.userId, users.id))
        .where(eq(withdrawals.status, 'pending'))
        .orderBy(desc(withdrawals.createdAt));
      
      res.json({
        success: true,
        withdrawals: pendingWithdrawals,
        total: pendingWithdrawals.length
      });
      
    } catch (error) {
      console.error('❌ Error fetching pending withdrawals:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch pending withdrawals' 
      });
    }
  });

  // Get processed withdrawals (approved/rejected) - admin only
  app.get('/api/admin/withdrawals/processed', authenticateAdmin, async (req: any, res) => {
    try {
      
      // Get all processed withdrawals (approved and rejected)
      const processedWithdrawals = await db
        .select({
          id: withdrawals.id,
          userId: withdrawals.userId,
          amount: withdrawals.amount,
          status: withdrawals.status,
          method: withdrawals.method,
          details: withdrawals.details,
          comment: withdrawals.comment,
          createdAt: withdrawals.createdAt,
          updatedAt: withdrawals.updatedAt,
          transactionHash: withdrawals.transactionHash,
          adminNotes: withdrawals.adminNotes,
          rejectionReason: withdrawals.rejectionReason,
          user: {
            firstName: users.firstName,
            lastName: users.lastName,
            username: users.username,
            telegram_id: users.telegram_id
          }
        })
        .from(withdrawals)
        .leftJoin(users, eq(withdrawals.userId, users.id))
        .where(sql`${withdrawals.status} IN ('paid', 'success', 'rejected', 'Successfull', 'Approved')`)
        .orderBy(desc(withdrawals.updatedAt));
      
      res.json({
        success: true,
        withdrawals: processedWithdrawals,
        total: processedWithdrawals.length
      });
      
    } catch (error) {
      console.error('❌ Error fetching processed withdrawals:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to fetch processed withdrawals' 
      });
    }
  });
  
  // Approve withdrawal (admin only)
  app.post('/api/admin/withdrawals/:withdrawalId/approve', authenticateAdmin, async (req: any, res) => {
    try {
      const { withdrawalId } = req.params;
      const { adminNotes } = req.body;
      
      // Approve the withdrawal — deducts balance and marks as Approved in DB
      const result = await storage.approveWithdrawal(withdrawalId, adminNotes, 'N/A');
      
      if (!result.success) {
        return res.status(400).json({ success: false, message: result.message });
      }

      console.log(`✅ Withdrawal ${withdrawalId} approved by admin ${req.user.telegramUser.id}`);

      // ── Auto-send AXN jetton on-chain ────────────────────────────────────────
      let txHash = 'N/A';
      let sendError: string | null = null;

      if (result.withdrawal) {
        const details = result.withdrawal.details as any;
        const walletAddress: string | undefined = details?.paymentDetails;
        const netAmount: number = parseFloat(details?.netAmount || result.withdrawal.amount);

        if (walletAddress && netAmount > 0) {
          try {
            console.log(`[AXN-SEND] Sending ${netAmount} AXN → ${walletAddress} for withdrawal ${withdrawalId}`);
            const { sendAXNJetton } = await import('./ton-service');
            const sendResult = await sendAXNJetton(walletAddress, netAmount);

            if (sendResult.success && sendResult.txHash) {
              txHash = sendResult.txHash;
              // Persist the transaction hash
              await storage.updateWithdrawalStatus(withdrawalId, 'Approved', txHash, adminNotes);
              console.log(`[AXN-SEND] ✅ AXN sent! txHash=${txHash}`);
            } else {
              sendError = sendResult.error || 'Unknown send error';
              console.error(`[AXN-SEND] ❌ Failed: ${sendError}`);
              // Notify admin via Telegram about send failure
              try {
                const botToken = process.env.TELEGRAM_BOT_TOKEN;
                const adminId = process.env.TELEGRAM_ADMIN_ID;
                if (botToken && adminId) {
                  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      chat_id: adminId,
                      text: `🚨 *AXN Send Failed*\nWithdrawal: ${withdrawalId}\nUser: ${result.withdrawal.userId}\nAmount: ${netAmount} AXN\nWallet: ${walletAddress}\nError: ${sendError}\n\n⚠️ DB is marked Approved but tokens were NOT sent. Use /api/admin/withdrawals/${withdrawalId}/resend to retry.`,
                      parse_mode: 'Markdown',
                    }),
                  });
                }
              } catch {}
            }
          } catch (sendErr: any) {
            sendError = sendErr?.message || String(sendErr);
            console.error(`[AXN-SEND] ❌ Exception: ${sendError}`);
          }
        } else {
          console.warn(`[AXN-SEND] ⚠️ No wallet address or zero amount — skipping on-chain send. walletAddress=${walletAddress}, netAmount=${netAmount}`);
        }

        // Real-time update to user
        sendRealtimeUpdate(result.withdrawal.userId, {
          type: 'withdrawal_approved',
          amount: result.withdrawal.amount,
          method: result.withdrawal.method,
          txHash,
          message: sendError
            ? `Your withdrawal of ${result.withdrawal.amount} AXN was approved but on-chain send failed. Admin will retry.`
            : `Your withdrawal of ${result.withdrawal.amount} AXN has been approved and sent to your wallet!`
        });

        broadcastUpdate({
          type: 'withdrawal_approved',
          withdrawalId: result.withdrawal.id,
          amount: result.withdrawal.amount,
          userId: result.withdrawal.userId,
          txHash
        });

        try {
          const { sendWithdrawalApprovedNotification } = await import('./telegram');
          await sendWithdrawalApprovedNotification(result.withdrawal, txHash);
        } catch (notifyErr) {
          console.error('⚠️ Failed to send withdrawal approval notification:', notifyErr);
        }
      }

      res.json({
        success: true,
        message: sendError
          ? `✅ Withdrawal approved (DB updated) but on-chain send failed: ${sendError}`
          : `✅ Withdrawal approved and ${result.withdrawal?.details && (result.withdrawal.details as any)?.netAmount} AXN sent on-chain`,
        txHash,
        sendError,
        withdrawal: result.withdrawal
      });
      
    } catch (error) {
      console.error('❌ Error approving withdrawal:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to approve withdrawal' 
      });
    }
  });

  // Resend AXN for an already-approved withdrawal (admin only) — for retrying failed sends
  app.post('/api/admin/withdrawals/:withdrawalId/resend', authenticateAdmin, async (req: any, res) => {
    try {
      const { withdrawalId } = req.params;
      const { pool } = await import('./db');
      const rows = await pool.query(`SELECT * FROM withdrawals WHERE id = $1`, [withdrawalId]);
      if (rows.rows.length === 0) return res.status(404).json({ success: false, message: 'Withdrawal not found' });

      const withdrawal = rows.rows[0];
      const details = typeof withdrawal.details === 'string' ? JSON.parse(withdrawal.details) : withdrawal.details;
      const walletAddress: string | undefined = details?.paymentDetails;
      const netAmount: number = parseFloat(details?.netAmount || withdrawal.amount);

      if (!walletAddress || netAmount <= 0) {
        return res.status(400).json({ success: false, message: 'No valid wallet address or amount in withdrawal details' });
      }

      console.log(`[AXN-RESEND] Resending ${netAmount} AXN → ${walletAddress} for withdrawal ${withdrawalId}`);
      const { sendAXNJetton } = await import('./ton-service');
      const sendResult = await sendAXNJetton(walletAddress, netAmount);

      if (sendResult.success && sendResult.txHash) {
        await storage.updateWithdrawalStatus(withdrawalId, 'Approved', sendResult.txHash, 'Resent by admin');
        console.log(`[AXN-RESEND] ✅ AXN resent! txHash=${sendResult.txHash}`);
        sendRealtimeUpdate(withdrawal.user_id, {
          type: 'withdrawal_approved',
          amount: withdrawal.amount,
          txHash: sendResult.txHash,
          message: `Your ${netAmount} AXN withdrawal has been sent to your wallet!`
        });
        return res.json({ success: true, txHash: sendResult.txHash });
      } else {
        return res.status(500).json({ success: false, message: sendResult.error || 'Send failed', txHash: null });
      }
    } catch (error: any) {
      console.error('❌ Error resending AXN:', error);
      res.status(500).json({ success: false, message: error?.message || 'Failed to resend' });
    }
  });
  
  // Reject withdrawal (admin only)
  app.post('/api/admin/withdrawals/:withdrawalId/reject', authenticateAdmin, async (req: any, res) => {
    try {
      const { withdrawalId } = req.params;
      const { adminNotes, reason } = req.body;
      
      // Reject the withdrawal using existing storage method
      const result = await storage.rejectWithdrawal(withdrawalId, adminNotes || reason);
      
      if (result.success) {
        console.log(`❌ Withdrawal ${withdrawalId} rejected by admin ${req.user.telegramUser.id}`);
        
        // Send real-time update to user (no Telegram notification)
        if (result.withdrawal) {
          sendRealtimeUpdate(result.withdrawal.userId, {
            type: 'withdrawal_rejected',
            amount: result.withdrawal.amount,
            method: result.withdrawal.method,
            message: `Your withdrawal of ${result.withdrawal.amount}  has been rejected`
          });
          
          // Broadcast to all admins for instant UI update
          broadcastUpdate({
            type: 'withdrawal_rejected',
            withdrawalId: result.withdrawal.id,
            amount: result.withdrawal.amount,
            userId: result.withdrawal.userId
          });
        }
        
        res.json({
          success: true,
          message: '❌ Withdrawal rejected',
          withdrawal: result.withdrawal
        });
      } else {
        res.status(400).json({
          success: false,
          message: result.message
        });
      }
      
    } catch (error) {
      console.error('❌ Error rejecting withdrawal:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to reject withdrawal' 
      });
    }
  });

  // Check if user has completed a task
  app.get('/api/tasks/:promotionId/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;
      
      const hasCompleted = await (storage as any).hasUserCompletedTask(promotionId, userId);
      res.json({ completed: hasCompleted ?? false });
    } catch (error) {
      console.error("Error checking task status:", error);
      res.status(500).json({ message: "Failed to check task status" });
    }
  });

  // NEW TASK STATUS SYSTEM ENDPOINTS

  // Verify task (makes it claimable if requirements are met)
  app.post('/api/tasks/:promotionId/verify', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;
      const { taskType } = req.body;
      
      if (!taskType) {
        return res.status(400).json({ 
          success: false, 
          message: 'Task type is required' 
        });
      }
      
      console.log(`🔍 Task verification attempt: UserID=${userId}, TaskID=${promotionId}, TaskType=${taskType}`);
      
      const result = await storage.verifyTask(userId, promotionId, taskType);
      
      if (result.success) {
        console.log(`✅ Task verification result: ${result.message}, Status: ${result.status}`);
        res.json(result);
      } else {
        console.log(`❌ Task verification failed: ${result.message}`);
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error verifying task:", error);
      res.status(500).json({ success: false, message: "Failed to verify task" });
    }
  });

  // Claim task reward (credits balance and marks as claimed)
  app.post('/api/tasks/:promotionId/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { promotionId } = req.params;
      
      console.log(`🎁 Task claim attempt: UserID=${userId}, TaskID=${promotionId}`);
      
      const result = await (storage as any).claimPromotionReward(userId, promotionId);
      
      if (result.success) {
        console.log(`✅ Task claimed successfully: ${result.message}, Reward: ${result.rewardAmount}`);
        
        // Send real-time balance update via WebSocket
        try {
          const connection = connectedUsers.get(req.sessionID);
          if (connection && connection.socket.readyState === 1) {
            connection.socket.send(JSON.stringify({
              type: 'balance_update',
              balance: result.newBalance,
              rewardAmount: result.rewardAmount,
              source: 'task_claim'
            }));
          }
        } catch (wsError) {
          console.error('Failed to send WebSocket balance update:', wsError);
        }
        
        res.json(result);
      } else {
        console.log(`❌ Task claim failed: ${result.message}`);
        res.status(400).json(result);
      }
    } catch (error) {
      console.error("Error claiming task reward:", error);
      res.status(500).json({ success: false, message: "Failed to claim task reward" });
    }
  });

  // Create promotion (via Telegram bot only - internal endpoint)
  app.post('/api/internal/promotions', authenticateTelegram, async (req: any, res) => {
    try {
      const promotion = await (storage as any).createPromotion(req.body);
      res.json(promotion);
    } catch (error) {
      console.error("Error creating promotion:", error);
      res.status(500).json({ message: "Failed to create promotion" });
    }
  });

  // Get user balance
  app.get('/api/user/balance', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const balance = await storage.getUserBalance(userId);
      
      if (!balance) {
        // Create initial balance if doesn't exist
        const newBalance = await storage.createOrUpdateUserBalance(userId, '0');
        res.json(newBalance);
      } else {
        res.json(balance);
      }
    } catch (error) {
      console.error("Error fetching user balance:", error);
      res.status(500).json({ message: "Failed to fetch balance" });
    }
  });

  // Add funds to main balance (via bot only - internal endpoint)
  app.post('/api/internal/add-funds', authenticateTelegram, async (req: any, res) => {
    try {
      const { userId, amount } = req.body;
      
      if (!userId || !amount) {
        return res.status(400).json({ message: "userId and amount are required" });
      }

      const balance = await storage.createOrUpdateUserBalance(userId, amount);
      res.json({ success: true, balance });
    } catch (error) {
      console.error("Error adding funds:", error);
      res.status(500).json({ message: "Failed to add funds" });
    }
  });

  // Deduct main balance for promotion creation (internal endpoint)
  app.post('/api/internal/deduct-balance', async (req: any, res) => {
    try {
      const { userId, amount } = req.body;
      
      if (!userId || !amount) {
        return res.status(400).json({ message: "userId and amount are required" });
      }

      const result = await storage.deductBalance(userId, amount);
      res.json(result);
    } catch (error) {
      console.error("Error deducting balance:", error);
      res.status(500).json({ message: "Failed to deduct balance" });
    }
  });

  // ================================
  // NEW TASK SYSTEM ENDPOINTS
  // ================================

  // Get all task statuses for user (dailyTasks table removed)
  app.get('/api/tasks/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      const adsToday = user?.adsWatchedToday || 0;
      res.json({ tasks: [], adsWatchedToday: adsToday });
    } catch (error) {
      console.error("Error fetching task status:", error);
      res.status(500).json({ message: "Failed to fetch task status" });
    }
  });



  // Increment ads counter
  app.post('/api/tasks/ads/increment', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const currentDate = new Date().toISOString().split('T')[0];
      
      // Get current user data
      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ message: 'User not found' });
      }
      
      const currentAds = (user.adsWatchedToday || 0) + 1;
      
      // Update user's ads watched count
      await db.update(users)
        .set({ 
          adsWatchedToday: currentAds,
          adsWatched: (user.adsWatched || 0) + 1,
          lastAdWatch: new Date()
        })
        .where(eq(users.id, userId));
      
      
      res.json({ 
        success: true, 
        adsWatchedToday: currentAds,
        message: `Ads watched today: ${currentAds}`
      });
    } catch (error) {
      console.error("Error incrementing ads counter:", error);
      res.status(500).json({ message: "Failed to increment ads counter" });
    }
  });

  // invite-friend/complete and tasks/:taskType/claim routes removed (dailyTasks table dropped)

  // Promo code endpoints
  // Redeem promo code
  app.post('/api/promo-codes/redeem', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const { code } = req.body;
      
      if (!code || !code.trim()) {
        return res.status(200).json({ 
          success: false,
          message: 'Please enter a promo code' 
        });
      }
      
      // Use promo code (validates all conditions including existence, limits, expiry)
      const result = await storage.usePromoCode(code.trim().toUpperCase(), userId);
      
      // Handle errors — always 200 so frontend can read the message
      if (!result.success) {
        return res.status(200).json({ 
          success: false, 
          message: result.message
        });
      }
      
      // Get promo code details for reward type
      const promoCode = await storage.getPromoCode(code.trim().toUpperCase());
      
      if (!promoCode) {
        return res.status(200).json({ 
          success: false, 
          message: 'Invalid promo code'
        });
      }
      
      // Add reward based on type. Legacy promo rows are normalized to GRAM
      // during migration and are accepted here only as a one-way compatibility
      // conversion, never returned as an active currency.
      let rewardType = promoCode.rewardType || 'AXN';
      if (rewardType === 'CIPHER') rewardType = 'GRAM';
      if (rewardType === 'PDZ') rewardType = '';
      const rewardAmount = result.reward;
      
      if (rewardType === 'GRAM') {
        // Add GRAM balance (balance field, not wallet_balance).
        const rewardNum = parseFloat(rewardAmount || '0');
        const { pool } = await import('./db');
        await pool.query(
          `UPDATE users SET balance = COALESCE(balance::numeric, 0) + $1 WHERE id = $2`,
          [rewardNum, userId]
        );
        await storage.logTransaction({
          userId,
          amount: rewardAmount || '0',
          type: 'credit',
          source: 'promo_code',
          description: `Redeemed promo code: ${code}`,
          metadata: { code, rewardType: 'GRAM' }
        });
        res.json({
          success: true,
          message: `+${rewardNum} GRAM added to your balance!`,
          reward: rewardAmount,
          rewardType: 'GRAM'
        });
      } else if (rewardType === 'AXN') {
        // Add AXN wallet_balance directly; GRAM earnings use balance.
        const rewardNum = parseFloat(rewardAmount || '0');
        const { pool } = await import('./db');
        await pool.query(
          `UPDATE users SET wallet_balance = COALESCE(wallet_balance::numeric, 0) + $1 WHERE id = $2`,
          [rewardNum, userId]
        );
        await storage.logTransaction({
          userId,
          amount: rewardAmount || '0',
          type: 'credit',
          source: 'promo_code',
          description: `Redeemed promo code: ${code}`,
          metadata: { code, rewardType: 'AXN' }
        });
        res.json({ 
          success: true, 
          message: `+${rewardNum} AXN added to your wallet!`,
          reward: rewardAmount,
          rewardType: 'AXN'
        });
      } else if (rewardType === '') {
        // Add  balance - direct update required since addEarning only handles AXN balance
        const [currentUser] = await db
          .select({ tonBalance: users.tonBalance })
          .from(users)
          .where(eq(users.id, userId));
        
        const currentTonBalance = parseFloat(currentUser?.tonBalance || '0');
        const newTonBalance = (currentTonBalance + parseFloat(rewardAmount || '0')).toFixed(8);
        
        await db
          .update(users)
          .set({ tonBalance: newTonBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));
        
        // Log transaction for tracking
        await storage.logTransaction({
          userId,
          amount: rewardAmount || '0',
          type: "credit",
          source: "promo_code",
          description: `Redeemed promo code: ${code}`,
          metadata: { code, rewardType: '' }
        });
        
        res.json({ 
          success: true, 
          message: `${rewardAmount}  added to your balance!`,
          reward: rewardAmount,
          rewardType: ''
        });
      } else if (rewardType === '') {
        // Add  balance
        await storage.addTONBalance(userId, rewardAmount || '0', 'promo_code', `Redeemed promo code: ${code}`);
        
        res.json({ 
          success: true, 
          message: `TON${rewardAmount}  added to your balance!`,
          reward: rewardAmount,
          rewardType: ''
        });
      } else if (rewardType === 'BUG') {
        // Add BUG balance
        const [currentUser] = await db
          .select({ bugBalance: users.bugBalance })
          .from(users)
          .where(eq(users.id, userId));
        
        const currentBugBalance = parseFloat(currentUser?.bugBalance || '0');
        const newBugBalance = (currentBugBalance + parseFloat(rewardAmount || '0')).toFixed(2);
        
        await db
          .update(users)
          .set({ bugBalance: newBugBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));
        
        // Log transaction for tracking
        await storage.logTransaction({
          userId,
          amount: rewardAmount || '0',
          type: "credit",
          source: "promo_code",
          description: `Redeemed promo code: ${code}`,
          metadata: { code, rewardType: 'BUG' }
        });
        
        res.json({ 
          success: true, 
          message: `${rewardAmount} BUG added to your balance!`,
          reward: rewardAmount,
          rewardType: 'BUG'
        });
      } else if (promoCode.rewardType === 'TON' && (promoCode.rewardCurrency === 'ton_app' || promoCode.rewardCurrency === 'App')) {
        // TON App Balance — treat as TON balance
        const [currentUser] = await db
          .select({ tonBalance: users.tonBalance })
          .from(users)
          .where(eq(users.id, userId));
        const currentBalance = parseFloat(currentUser?.tonBalance || '0');
        const newBalance = (currentBalance + parseFloat(rewardAmount || '0')).toFixed(6);
        
        await db
          .update(users)
          .set({ tonBalance: newBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));
        
        await storage.logTransaction({
          userId,
          amount: rewardAmount || '0',
          type: "addition",
          source: "promo_code",
          description: `Redeemed promo code: ${code}`,
          metadata: { code, rewardType: 'TON_APP' }
        });
        
        res.json({ 
          success: true, 
          message: `${rewardAmount} TON added to your App Balance!`,
          reward: rewardAmount,
          rewardType: 'TON_APP'
        });
      } else if (promoCode.rewardType === 'TON' && (promoCode.rewardCurrency === 'ton_withdraw' || promoCode.rewardCurrency === 'Withdraw')) {
        // TON Withdraw Balance
        const [currentUser] = await db
          .select({ tonBalance: users.tonBalance })
          .from(users)
          .where(eq(users.id, userId));
        
        const currentBalance = parseFloat(currentUser?.tonBalance || '0');
        const newBalance = (currentBalance + parseFloat(rewardAmount || '0')).toFixed(6);
        
        await db
          .update(users)
          .set({ tonBalance: newBalance, updatedAt: new Date() })
          .where(eq(users.id, userId));
        
        await storage.logTransaction({
          userId,
          amount: rewardAmount || '0',
          type: "addition",
          source: "promo_code",
          description: `Redeemed promo code: ${code}`,
          metadata: { code, rewardType: 'TON_WITHDRAW' }
        });
        
        res.json({ 
          success: true, 
          message: `${rewardAmount} TON added to your Withdraw Balance!`,
          reward: rewardAmount,
          rewardType: 'TON_WITHDRAW'
        });
      } else {
        // Default: Add AXN balance
        const rewardPad = parseInt(rewardAmount || '0');
        
        await storage.addEarning({
          userId,
          amount: rewardAmount || '0',
          source: 'promo_code',
          description: `Redeemed promo code: ${code}`,
        });
        
        res.json({ 
          success: true, 
          message: `${rewardPad} AXN added to your balance!`,
          reward: rewardAmount,
          rewardType: 'AXN'
        });
      }
    } catch (error) {
      console.error("Error redeeming promo code:", error);
      res.status(500).json({ message: "Failed to redeem promo code" });
    }
  });

  // Create promo code (admin only)
  app.post('/api/promo-codes/create', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user.user.id;
      const user = await storage.getUser(userId);
      
      // Check the same configured admin identity used by the signed admin
      // middleware; never grant access to a hard-coded development account.
      const configuredAdminId = process.env.TELEGRAM_ADMIN_ID;
      const isConfiguredAdmin = Boolean(
        configuredAdminId && user?.telegram_id === configuredAdminId,
      );
      if (!isConfiguredAdmin) {
        return res.status(403).json({ message: 'Unauthorized: Admin access required' });
      }
      
      const { code, rewardAmount, rewardType, usageLimit, perUserLimit, expiresAt } = req.body;
      
      if (!rewardAmount) {
        return res.status(400).json({ message: 'Reward amount is required' });
      }
      
      // Auto-generate code if not provided or if "GENERATE" is passed
      let finalCode = code?.trim();
      if (!finalCode || finalCode === 'GENERATE') {
        // Generate random 8-character code
        finalCode = 'PROMO' + Math.random().toString(36).substring(2, 10).toUpperCase();
        console.log('🎲 Auto-generated promo code:', finalCode);
      }
      
      // Validate reward type - AXN, TON, TON, BUG supported (PDZ is deprecated)
      let finalRewardType = rewardType || '';
      // Convert legacy PDZ to TON
      if (finalRewardType === 'PDZ') finalRewardType = '';
      if (finalRewardType !== 'AXN' && finalRewardType !== '' && finalRewardType !== '' && finalRewardType !== 'BUG') {
        return res.status(400).json({ message: 'Reward type must be AXN, TON, TON, or BUG' });
      }
      
      const promoCode = await storage.createPromoCode({
        code: finalCode.toUpperCase(),
        rewardAmount: rewardAmount.toString(),
        rewardType: finalRewardType,
        rewardCurrency: finalRewardType,
        usageLimit: usageLimit || null,
        perUserLimit: perUserLimit || 1,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      });
      
      res.json({ 
        success: true, 
        message: `Promo code created successfully (${finalRewardType})`,
        promoCode 
      });
    } catch (error) {
      console.error("Error creating promo code:", error);
      res.status(500).json({ message: "Failed to create promo code" });
    }
  });

  // Admin create promo code
  app.post('/api/admin/promo-codes', authenticateAdmin, async (req: any, res) => {
    try {
      const { code, rewardAmount, rewardType, usageLimit, perUserLimit, expiresAt } = req.body;
      
      if (!code || !rewardAmount) {
        return res.status(400).json({ success: false, message: "Code and reward amount are required" });
      }

      console.log(`🎫 Creating promo code: ${code}, amount=${rewardAmount}, type=${rewardType}`);

      const promoCode = await storage.createPromoCode({
        code: code.toUpperCase(),
        rewardAmount: rewardAmount.toString(),
        rewardType: rewardType || 'AXN',
        rewardCurrency: rewardType || 'AXN',
        usageLimit: usageLimit ? parseInt(usageLimit) : null,
        perUserLimit: perUserLimit ? parseInt(perUserLimit) : 1,
        isActive: true,
        expiresAt: expiresAt ? new Date(expiresAt) : null
      });
      
      res.json({ 
        success: true, 
        message: "Promo code created successfully",
        promoCode 
      });
    } catch (error) {
      console.error("Error creating promo code:", error);
      res.status(500).json({ success: false, message: "Failed to create promo code" });
    }
  });

  // Get all promo codes (admin only)
  app.get('/api/admin/promo-codes', authenticateAdmin, async (req: any, res) => {
    try {
      const promoCodes = await storage.getAllPromoCodes();
      
      // Calculate stats for each promo code
      const promoCodesWithStats = promoCodes.map(promo => {
        const usageCount = promo.usageCount || 0;
        const usageLimit = promo.usageLimit || 0;
        const remainingCount = usageLimit > 0 ? Math.max(0, usageLimit - usageCount) : Infinity;
        const totalDistributed = parseFloat(promo.rewardAmount) * usageCount;
        const rewardType = promo.rewardType || 'AXN';
        
        return {
          ...promo,
          rewardType,
          usageCount,
          remainingCount: remainingCount === Infinity ? 'Unlimited' : remainingCount,
          totalDistributed: totalDistributed.toFixed(8)
        };
      });
      
      res.json({ 
        success: true, 
        promoCodes: promoCodesWithStats 
      });
    } catch (error) {
      console.error("Error fetching promo codes:", error);
      res.status(500).json({ message: "Failed to fetch promo codes" });
    }
  });

  // Toggle promo code active status (admin only)
  app.patch('/api/admin/promo-codes/:id', authenticateAdmin, async (req: any, res) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;
      const result = await storage.updatePromoCodeStatus(id, !!isActive);
      if (result?.success) {
        res.json({ success: true, message: `Promo code ${isActive ? 'activated' : 'deactivated'}` });
      } else {
        res.status(400).json({ success: false, message: 'Failed to update promo code' });
      }
    } catch (error) {
      console.error('Error toggling promo code:', error);
      res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ArcPay Integration Routes
  const { createArcPayCheckout, verifyArcPayWebhookSignature, parseArcPayWebhook } = await import('./arcpay');

  // Create ArcPay payment checkout
  app.post('/api/arcpay/create-payment', authenticateTelegram, async (req: any, res) => {
    try {
      // Get user ID from the authenticated user object
      // authenticateTelegram sets req.user as { telegramUser: {...}, user: {...} }
      const userId = req.user?.user?.id;
      const userEmail = req.user?.user?.email;

      // Accept both tonAmount (new) and pdzAmount (legacy) for backward compatibility
      const tonAmount = req.body.tonAmount ?? req.body.pdzAmount;

      if (!userId) {
        console.error('❌ ArcPay: No user ID found in authenticated request:', {
          hasUser: !!req.user,
          userKeys: req.user ? Object.keys(req.user) : null,
          hasUserObject: !!req.user?.user
        });
        return res.status(401).json({ error: 'Unauthorized - user not found' });
      }

      // Validate amount - differentiate between empty/invalid vs too small
      console.log(`💳 Payment request - amount: ${tonAmount}, type: ${typeof tonAmount}`);

      // Check if amount is missing or not a number
      if (tonAmount === undefined || tonAmount === null || typeof tonAmount !== 'number') {
        console.error(`❌ Invalid amount type: ${typeof tonAmount}, value: ${tonAmount}`);
        return res.status(400).json({ error: 'Enter valid amount' });
      }

      // Check if amount is 0 or negative
      if (isNaN(tonAmount) || tonAmount <= 0) {
        console.error(`❌ Invalid amount value: ${tonAmount}`);
        return res.status(400).json({ error: 'Enter valid amount' });
      }

      // Check if amount is below minimum
      if (tonAmount < 0.1) {
        console.error(`❌ Amount below minimum: ${tonAmount} < 0.1`);
        return res.status(400).json({ error: 'Minimum top-up is 0.1 ' });
      }

      console.log(`✅ Amount validated: ${tonAmount}  - creating ArcPay payment for user ${userId}`);

      // Create checkout
      const result = await createArcPayCheckout(tonAmount, userId, userEmail);

      if (!result.success) {
        return res.status(400).json({ error: result.error });
      }

      res.json({
        success: true,
        paymentUrl: result.paymentUrl,
      });
    } catch (error: any) {
      console.error('❌ Error creating ArcPay payment:', error);
      res.status(500).json({ error: 'Failed to create payment request' });
    }
  });

  // ArcPay Webhook Handler
  app.post('/arcpay/webhook', async (req: any, res) => {
    try {
      const rawBody = JSON.stringify(req.body);
      const signature = req.headers['x-arcpay-signature'] || '';

      console.log('🔔 ArcPay webhook received:', {
        eventType: req.body.event,
        orderId: req.body.order_id,
      });

      // Verify webhook signature (disable for testing, enable in production)
      // const isValid = verifyArcPayWebhookSignature(rawBody, signature);
      // if (!isValid) {
      //   console.error('❌ Invalid webhook signature');
      //   return res.status(401).json({ error: 'Invalid signature' });
      // }

      // Parse webhook payload
      const webhook = parseArcPayWebhook(rawBody);
      if (!webhook) {
        return res.status(400).json({ error: 'Invalid webhook payload' });
      }

      const { event, order_id, status, amount, metadata } = webhook;
      const userId = metadata?.userId;
      // Accept both tonAmount (new) and pdzAmount (legacy) for backward compatibility
      const tonAmount = metadata?.tonAmount || metadata?.pdzAmount || amount;

      if (!userId) {
        console.error('❌ No userId in webhook metadata');
        return res.status(400).json({ error: 'Missing user information' });
      }

      // Handle payment success
      if (event === 'payment.success' && status === 'completed') {
        console.log(`✅ Payment successful for user ${userId}, crediting ${tonAmount} TON`);

        try {
          // Get user
          const user = await storage.getUser(userId);
          if (!user) {
            console.error(`❌ User not found: ${userId}`);
            return res.status(404).json({ error: 'User not found' });
          }

          // Credit  to user
          const currentTon = parseFloat(user.tonBalance?.toString() || '0');
          const newTon = currentTon + tonAmount;

          // Update user's  balance
          await db.update(users).set({
            tonBalance: newTon.toString(),
            updatedAt: new Date(),
          }).where(eq(users.id, userId));

          // Record transaction
          await db.insert(transactions).values({
            userId,
            amount: tonAmount.toString(),
            type: 'addition',
            source: 'arcpay_ton_topup',
            description: `Top-up ${tonAmount}  via ArcPay (Order: ${order_id})`,
            metadata: {
              orderId: order_id,
              arcpayAmount: amount,
              arcpayCurrency: webhook.currency,
              transactionHash: webhook.transaction_hash,
            },
          });

          // ArcPay deposits arrive in TON; credit the referrer with 5% GRAM.
          try {
            await creditReferralDepositCommission(userId, Number(tonAmount), String(order_id));
          } catch (commissionError) {
            // Do not fail the user's deposit if the referral credit needs a retry.
            console.error('❌ Referral deposit commission error:', commissionError);
          }

          console.log(`💚  balance updated for user ${userId}: +${tonAmount} (Total: ${newTon})`);

          // CRITICAL: Send real-time update via WebSocket to the user's frontend
          sendRealtimeUpdate(userId, {
            type: 'balance_update',
            tonBalance: newTon.toString(),
            message: `🎉 Top-up successful! +${tonAmount}  credited.`
          });

          // Send notification to user via Telegram
          try {
            const message = `🎉 Top-up successful!\n\n✅ You received ${tonAmount} TON\n💎 New balance: ${newTon} TON`;
            await sendUserTelegramNotification(userId, message);
          } catch (notifError) {
            console.warn('⚠️ Failed to send Telegram notification:', notifError);
          }

          return res.json({
            success: true,
            message: ' credited successfully',
            newBalance: newTon,
          });
        } catch (dbError) {
          console.error('❌ Error crediting TON:', dbError);
          return res.status(500).json({ error: 'Failed to credit ' });
        }
      }

      // Handle payment failure
      if (event === 'payment.failed' && status === 'failed') {
        console.log(`❌ Payment failed for user ${userId}`);

        try {
          await sendUserTelegramNotification(
            userId,
            `❌ Payment failed for order ${order_id}. Please try again.`
          );
        } catch (notifError) {
          console.warn('⚠️ Failed to send Telegram notification:', notifError);
        }

        return res.json({
          success: true,
          message: 'Payment failure recorded',
        });
      }

      // Handle pending payments
      if (event === 'payment.pending' && status === 'pending') {
        console.log(`⏳ Payment pending for user ${userId}, order ${order_id}`);
        return res.json({
          success: true,
          message: 'Payment pending',
        });
      }

      return res.json({
        success: true,
        message: 'Webhook processed',
      });
    } catch (error) {
      console.error('❌ Webhook processing error:', error);
      res.status(500).json({ error: 'Webhook processing failed' });
    }
  });

  // Helper function to get today's date as YYYY-MM-DD
  const getTodayDate = () => {
    const now = new Date();
    return now.toISOString().split('T')[0];
  };

  // ==================== DAILY MISSIONS ====================

  // GET /api/missions/status - Get daily mission completion status
  app.get('/api/missions/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const today = getTodayDate();

      // dailyMissions table dropped - return empty status
      res.json({
        success: true,
        shareStory: { completed: false, claimed: false },
        dailyCheckin: { completed: false, claimed: false },
        checkForUpdates: { completed: false, claimed: false },
      });
    } catch (error) {
      console.error('❌ Error getting mission status:', error);
      res.status(500).json({ error: 'Failed to get mission status' });
    }
  });

  // POST /api/missions/share-story/claim - dailyMissions table dropped
  app.post('/api/missions/share-story/claim', authenticateTelegram, async (_req: any, res) => {
    res.status(410).json({ error: 'Mission system removed' });
  });

  // POST /api/missions/daily-checkin/claim - dailyMissions table dropped
  app.post('/api/missions/daily-checkin/claim', authenticateTelegram, async (_req: any, res) => {
    res.status(410).json({ error: 'Mission system removed' });
  });

  // POST /api/missions/check-for-updates/claim - dailyMissions table dropped
  app.post('/api/missions/check-for-updates/claim', authenticateTelegram, async (_req: any, res) => {
    res.status(410).json({ error: 'Mission system removed' });
  });

  // Daily tasks endpoints removed (dailyMissions table dropped)
  app.get('/api/daily-tasks/status', authenticateTelegram, async (req: any, res) => {
    res.json({ success: true, claimed: [], adsWatchedToday: 0 });
  });

  app.post('/api/daily-tasks/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const { taskId } = req.body;
      if (!taskId) return res.status(400).json({ error: 'taskId is required' });
      const boostRatePerHour = 0;

      res.json({ success: true, boostRatePerHour, message: `+${boostRatePerHour} AXN/h boost applied for 24h!` });
    } catch (err) {
      console.error('daily-tasks/claim error:', err);
      res.status(500).json({ error: 'Failed to claim task' });
    }
  });

  // POST /api/share/prepare-message - Prepare a share message for Telegram WebApp shareMessage()
  // Uses Bot API 8.0 savePreparedInlineMessage for native Telegram share dialog
  app.post('/api/share/prepare-message', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.telegram_id) {
        return res.status(400).json({ error: 'Telegram ID not found' });
      }

      if (!user.referralCode) {
        return res.status(400).json({ error: 'Referral code not found' });
      }

      const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
      if (!TELEGRAM_BOT_TOKEN) {
        return res.status(500).json({ error: 'Bot not configured' });
      }

      const botUsername = await getBotUsername();
      const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;
      
      const appUrl = process.env.RENDER_EXTERNAL_URL || 
                    (process.env.REPL_SLUG ? `https://${process.env.REPL_SLUG}.replit.app` : null) ||
                    (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : null) ||
                    'https://vuuug.onrender.com';

      const shareImageUrl = `${appUrl}/images/share_v5.jpg`;
      const webAppUrl = referralLink;

      console.log(`📤 Preparing share message for user ${userId}`);
      console.log(`   Image URL: ${shareImageUrl}`);
      console.log(`   WebApp URL: ${webAppUrl}`);
      console.log(`   Referral Link: ${referralLink}`);

      // Use savePreparedInlineMessage (Bot API 8.0+) to prepare the message
      // This creates a prepared message that can be shared via WebApp.shareMessage()
      // Use regular URL button to trigger /start command for reliable referral tracking
      const inlineResult = {
        type: 'photo',
        id: `share_${user.referralCode}_${Date.now()}`,
        photo_url: shareImageUrl,
        thumbnail_url: shareImageUrl,
        title: '⛏️ Money $AXN Mining',
        description: 'Plan → AXN Mining → TON Conversion → Withdraw',
        caption: '⛏️ Plan → AXN Mining → TON Conversion → Withdraw',
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: '🚀 Start Earning',
                url: referralLink
              }
            ]
          ]
        }
      };

      try {
        const prepareResponse = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/savePreparedInlineMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: parseInt(user.telegram_id),
            result: inlineResult,
            allow_user_chats: true,
            allow_bot_chats: true,
            allow_group_chats: true,
            allow_channel_chats: true
          })
        });

        const prepareResult = await prepareResponse.json() as { 
          ok?: boolean; 
          result?: { id: string }; 
          description?: string;
          error_code?: number;
        };

        if (prepareResult.ok && prepareResult.result?.id) {
          console.log(`✅ Prepared share message with ID: ${prepareResult.result.id}`);
          return res.json({
            success: true,
            messageId: prepareResult.result.id,
            referralLink
          });
        } else {
          console.error('❌ Failed to prepare share message:', prepareResult.description);
          // Return a fallback with just the referral link for URL-based sharing
          return res.json({
            success: false,
            error: prepareResult.description || 'Failed to prepare message',
            referralLink,
            fallbackUrl: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('⛏️ Plan → AXN Mining → TON Conversion → Withdraw')}`
          });
        }
      } catch (telegramError: any) {
        console.error('❌ Telegram API error:', telegramError);
        return res.json({
          success: false,
          error: telegramError.message || 'Telegram API error',
          referralLink,
          fallbackUrl: `https://t.me/share/url?url=${encodeURIComponent(referralLink)}&text=${encodeURIComponent('⛏️ Plan → AXN Mining → TON Conversion → Withdraw')}`
        });
      }

    } catch (error: any) {
      console.error('❌ Error preparing share message:', error);
      res.status(500).json({ error: 'Failed to prepare share message' });
    }
  });

  // POST /api/share/invite - Legacy endpoint (kept for backward compatibility)
  app.post('/api/share/invite', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'User not authenticated' });
      }

      const user = await storage.getUser(userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }

      if (!user.referralCode) {
        return res.status(400).json({ error: 'Referral code not found' });
      }

      const botUsername = await getBotUsername();
      const referralLink = `https://t.me/${botUsername}?start=${user.referralCode}`;

      // Return just the referral link for the new share flow
      return res.json({ 
        success: true, 
        message: 'Share link ready',
        referralLink 
      });

    } catch (error) {
      console.error('❌ Error sending invite:', error);
      res.status(500).json({ error: 'Failed to send invite' });
    }
  });

  // ============ COUNTRY BLOCKING API ============
  
  // GET /api/check-country - Check if user's country is blocked (for frontend blocking)
  app.get('/api/check-country', async (req: any, res) => {
    try {
      const { getClientIP, getCountryFromIP, getBlockedCountries, isVPNOrProxy } = await import('./countryBlocking');
      
      // Prevent caching so blocks take effect immediately
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      
      // Check if user is admin - admins are never blocked
      // SECURITY: Verify Telegram initData signature before trusting admin status
      const telegramData = req.headers['x-telegram-data'] || req.query.tgData;
      if (telegramData && botToken) {
        try {
          const { verifyTelegramWebAppData } = await import('./auth');
          const { isValid, user: verifiedUser } = verifyTelegramWebAppData(telegramData, botToken);
          
          if (isValid && verifiedUser && isAdmin(verifiedUser.id.toString())) {
            console.log(`✅ Admin user verified (${verifiedUser.id}), bypassing country check`);
            return res.json({ blocked: false, country: null, isAdmin: true });
          }
        } catch (e) {
          console.log('⚠️ Admin verification failed, continuing with country check');
        }
      }
      
      // In development mode, allow admin bypass via parsed (unverified) initData
      if (process.env.NODE_ENV === 'development' && telegramData) {
        try {
          const urlParams = new URLSearchParams(telegramData);
          const userString = urlParams.get('user');
          if (userString) {
            const telegramUser = JSON.parse(userString);
            if (isAdmin(telegramUser.id.toString())) {
              console.log('🔧 Dev mode: Admin bypass via parsed data');
              return res.json({ blocked: false, country: null, isAdmin: true });
            }
          }
        } catch (e) {
          // Continue with normal check
        }
      }
      
      const clientIP = getClientIP(req);
      const result = await getCountryFromIP(clientIP);
      
      if (!result.countryCode) {
        return res.json({ blocked: false, country: null });
      }
      
      const blockedCodes = await getBlockedCountries();
      const countryIsBlocked = blockedCodes.includes(result.countryCode.toUpperCase());
      
      // VPN BYPASS LOGIC: If user is from blocked country BUT using VPN/proxy/hosting, ALLOW access
      const usingVPN = isVPNOrProxy(result);
      const vpnBypass = countryIsBlocked && usingVPN;
      
      // Final blocked status: blocked only if country is blocked AND NOT using VPN
      const finalBlocked = countryIsBlocked && !usingVPN;
      
      if (vpnBypass) {
        console.log(`🔐 VPN bypass granted for ${result.countryCode} (IP: ${clientIP}, VPN: ${result.isVPN}, Hosting: ${result.isHosting})`);
      }
      
      res.json({
        blocked: finalBlocked,
        country: result.countryCode,
        countryName: result.countryName,
        isVPN: result.isVPN,
        isProxy: result.isProxy,
        isHosting: result.isHosting,
        vpnBypass
      });
    } catch (error) {
      console.error('❌ Error checking country:', error);
      res.json({ blocked: false, country: null });
    }
  });

  // GET /api/user-info - Get user's IP and detected country (for admin panel display)
  app.get('/api/user-info', async (req: any, res) => {
    try {
      const { getClientIP, getAllCountries, getCountryFromIP } = await import('./countryBlocking');
      
      const clientIP = getClientIP(req);
      const result = await getCountryFromIP(clientIP);
      
      let countryName = result.countryName || 'Unknown';
      let countryCode = result.countryCode || 'XX';
      
      // If we only got country code but no name, try to find it in our list
      if (countryCode !== 'XX' && countryName === 'Unknown') {
        const allCountries = getAllCountries();
        const found = allCountries.find(c => c.code === countryCode);
        if (found) {
          countryName = found.name;
        }
      }
      
      res.json({
        ip: clientIP || 'Unknown',
        country: countryName,
        countryCode: countryCode
      });
    } catch (error) {
      console.error('❌ Error fetching user info:', error);
      res.status(500).json({ 
        ip: 'Unknown',
        country: 'Unknown',
        countryCode: 'XX'
      });
    }
  });

  // GET /api/countries - Get all countries (public)
  app.get('/api/countries', async (req: any, res) => {
    try {
      const { getAllCountries } = await import('./countryBlocking');
      const allCountries = getAllCountries();
      res.json({ success: true, countries: allCountries });
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });

  // GET /api/blocked - Get list of blocked country codes (public)
  app.get('/api/blocked', async (req: any, res) => {
    try {
      const { getBlockedCountries } = await import('./countryBlocking');
      const blockedCodes = await getBlockedCountries();
      res.json({ success: true, blocked: blockedCodes });
    } catch (error) {
      console.error('❌ Error fetching blocked countries:', error);
      res.status(500).json({ error: 'Failed to fetch blocked countries' });
    }
  });

  // POST /api/block-country - Block a country (requires admin)
  app.post('/api/block-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ success: false, error: 'Invalid country code' });
      }
      
      const { blockCountry } = await import('./countryBlocking');
      const success = await blockCountry(country_code);
      
      if (success) {
        console.log(`🚫 Country blocked: ${country_code}`);
        
        // Broadcast to all clients so they recheck their country status immediately
        broadcastToAll({
          type: 'country_blocked',
          countryCode: country_code.toUpperCase(),
          message: `Country ${country_code} has been blocked`
        });
        
        res.json({ success: true, message: `Country ${country_code} blocked` });
      } else {
        res.status(500).json({ success: false, error: 'Failed to block country' });
      }
    } catch (error) {
      console.error('❌ Error blocking country:', error);
      res.status(500).json({ success: false, error: 'Failed to block country' });
    }
  });

  // POST /api/unblock-country - Unblock a country (requires admin)
  app.post('/api/unblock-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ success: false, error: 'Invalid country code' });
      }
      
      const { unblockCountry } = await import('./countryBlocking');
      const success = await unblockCountry(country_code);
      
      if (success) {
        console.log(`✅ Country unblocked: ${country_code}`);
        
        // Broadcast to all clients so they recheck their country status immediately
        broadcastToAll({
          type: 'country_unblocked',
          countryCode: country_code.toUpperCase(),
          message: `Country ${country_code} has been unblocked`
        });
        
        res.json({ success: true, message: `Country ${country_code} unblocked` });
      } else {
        res.status(500).json({ success: false, error: 'Failed to unblock country' });
      }
    } catch (error) {
      console.error('❌ Error unblocking country:', error);
      res.status(500).json({ success: false, error: 'Failed to unblock country' });
    }
  });

  // GET /api/admin/countries - Get all countries with block status
  app.get('/api/admin/countries', authenticateAdmin, async (req: any, res) => {
    try {
      const { getAllCountries, getBlockedCountries } = await import('./countryBlocking');
      
      const allCountries = getAllCountries();
      const blockedCodes = await getBlockedCountries();
      const blockedSet = new Set(blockedCodes);
      
      const countriesWithStatus = allCountries.map(country => ({
        ...country,
        blocked: blockedSet.has(country.code)
      }));
      
      res.json({ success: true, countries: countriesWithStatus });
    } catch (error) {
      console.error('❌ Error fetching countries:', error);
      res.status(500).json({ error: 'Failed to fetch countries' });
    }
  });
  
  // POST /api/admin/block-country - Block a country
  app.post('/api/admin/block-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ error: 'Invalid country code' });
      }
      
      const { blockCountry } = await import('./countryBlocking');
      const success = await blockCountry(country_code);
      
      if (success) {
        console.log(`🚫 Country blocked: ${country_code}`);
        res.json({ success: true, message: `Country ${country_code} blocked` });
      } else {
        res.status(500).json({ error: 'Failed to block country' });
      }
    } catch (error) {
      console.error('❌ Error blocking country:', error);
      res.status(500).json({ error: 'Failed to block country' });
    }
  });
  
  // POST /api/admin/unblock-country - Unblock a country
  app.post('/api/admin/unblock-country', authenticateAdmin, async (req: any, res) => {
    try {
      const { country_code } = req.body;
      
      if (!country_code || typeof country_code !== 'string' || country_code.length !== 2) {
        return res.status(400).json({ error: 'Invalid country code' });
      }
      
      const { unblockCountry } = await import('./countryBlocking');
      const success = await unblockCountry(country_code);
      
      if (success) {
        console.log(`✅ Country unblocked: ${country_code}`);
        res.json({ success: true, message: `Country ${country_code} unblocked` });
      } else {
        res.status(500).json({ error: 'Failed to unblock country' });
      }
    } catch (error) {
      console.error('❌ Error unblocking country:', error);
      res.status(500).json({ error: 'Failed to unblock country' });
    }
  });


  // Bitcoin price proxy - fetches from CoinGecko server-side to avoid browser CORS/network blocks
  let btcPriceCache: { price: number; change24h: number; history: number[]; ts: number } | null = null;

  app.get('/api/btc-price', async (_req, res) => {
    try {
      const now = Date.now();
      if (btcPriceCache && now - btcPriceCache.ts < 30000) {
        return res.json({ success: true, ...btcPriceCache });
      }

      // Use Binance public API (no key required, reliable)
      const [tickerRes, klinesRes] = await Promise.all([
        fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT'),
        fetch('https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24')
      ]);

      if (!tickerRes.ok || !klinesRes.ok) {
        return res.status(502).json({ success: false, message: 'Upstream error' });
      }

      const ticker = await tickerRes.json() as any;
      const klines = await klinesRes.json() as any[];

      const price: number = parseFloat(ticker.lastPrice);
      const change24h: number = parseFloat(ticker.priceChangePercent);
      // klines: [openTime, open, high, low, close, ...]
      const history: number[] = klines.map((k: any[]) => parseFloat(k[4]));

      btcPriceCache = { price, change24h, history, ts: now };
      return res.json({ success: true, price, change24h, history });
    } catch (err) {
      console.error('BTC price fetch error:', err);
      return res.status(500).json({ success: false, message: 'Failed to fetch price' });
    }
  });

  // Live BTC price only (lightweight, 30s polling)
  app.get('/api/btc-price/live', async (_req, res) => {
    try {
      const liveRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT');
      if (!liveRes.ok) return res.status(502).json({ success: false });
      const data = await liveRes.json() as any;
      const price: number = parseFloat(data.price);

      // Get 24h change separately
      let change24h = btcPriceCache?.change24h ?? 0;
      try {
        const changeRes = await fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
        if (changeRes.ok) {
          const changeData = await changeRes.json() as any;
          change24h = parseFloat(changeData.priceChangePercent);
        }
      } catch {}

      if (btcPriceCache) btcPriceCache = { ...btcPriceCache, price, change24h, ts: Date.now() };
      return res.json({ success: true, price, change24h });
    } catch {
      return res.status(500).json({ success: false });
    }
  });

  // ── Daily Activity ────────────────────────────────────────────────────────
  // Ensure columns exist (run once, idempotent)
  (async () => {
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_activity_day INTEGER DEFAULT 1`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_activity_claimed_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_well_balance DECIMAL(20,4) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_well_total_earned DECIMAL(20,4) DEFAULT '0'`);
    } catch {}
  })();

  const DAILY_REWARDS = [5,5,10,12,20,23,40,44,60,65,80,86,100,107,120,128,140,149,160,170,180,191,200,212,220,233,240,254,260,275];

  app.get('/api/daily-activity/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const rows = await db.execute(sql`SELECT daily_activity_day, daily_activity_claimed_at FROM users WHERE id = ${userId}`);
      const row = (rows as any).rows?.[0] || {};
      const day = Math.min(row.daily_activity_day ?? 1, 30);
      const claimedAt = row.daily_activity_claimed_at ? new Date(row.daily_activity_claimed_at) : null;
      const today = new Date();
      const claimed = claimedAt
        ? claimedAt.getFullYear() === today.getFullYear() &&
          claimedAt.getMonth() === today.getMonth() &&
          claimedAt.getDate() === today.getDate()
        : false;
      return res.json({ currentDay: day, claimed, nextReset: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).toISOString() });
    } catch (e) {
      return res.status(500).json({ message: "Failed" });
    }
  });

  app.post('/api/daily-activity/claim', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });
      const rows = await db.execute(sql`SELECT daily_activity_day, daily_activity_claimed_at, balance FROM users WHERE id = ${userId}`);
      const row = (rows as any).rows?.[0];
      if (!row) return res.status(404).json({ message: "User not found" });
      const today = new Date();
      const claimedAt = row.daily_activity_claimed_at ? new Date(row.daily_activity_claimed_at) : null;
      const alreadyClaimed = claimedAt
        ? claimedAt.getFullYear() === today.getFullYear() &&
          claimedAt.getMonth() === today.getMonth() &&
          claimedAt.getDate() === today.getDate()
        : false;
      if (alreadyClaimed) return res.status(400).json({ message: "Already claimed today" });
      const currentDay = Math.min(row.daily_activity_day ?? 1, 30);
      const reward = DAILY_REWARDS[currentDay - 1] || 5;
      const nextDay = currentDay >= 30 ? 1 : currentDay + 1;
      await db.execute(sql`UPDATE users SET balance = COALESCE(balance::numeric,0) + ${reward}, daily_activity_claimed_at = NOW(), daily_activity_day = ${nextDay} WHERE id = ${userId}`);
      return res.json({ success: true, day: currentDay, reward, nextDay });
    } catch (e) {
      return res.status(500).json({ message: "Failed to claim" });
    }
  });


  // Contest submission endpoint
  app.post('/api/contest/submit', authenticateTelegram, async (req: any, res) => {
    try {
      const { link, viewsRange } = req.body;
      if (!link || !viewsRange) {
        return res.status(400).json({ message: "Link and views range are required" });
      }

      const telegramUser = req.user?.telegramUser;
      const user = req.user?.user;

      const displayName = user?.firstName || telegramUser?.first_name || "Unknown";
      const tgUsername = telegramUser?.username ? `@${telegramUser.username}` : "—";
      const userId = user?.id || telegramUser?.id || "—";
      const telegramId = user?.telegramId || telegramUser?.id?.toString() || "—";
      const now = new Date().toLocaleString("en-US", { timeZone: "UTC", dateStyle: "medium", timeStyle: "short" });

      const message =
        `🏆 <b>New Contest Submission</b>\n\n` +
        `👤 <b>User Name:</b> ${displayName}\n` +
        `🆔 <b>User ID:</b> ${userId}\n` +
        `📱 <b>Telegram Username:</b> ${tgUsername}\n` +
        `📌 <b>Telegram ID:</b> ${telegramId}\n\n` +
        `🔗 <b>Video Link:</b> ${link}\n\n` +
        `👁 <b>Views Range:</b> ${viewsRange}\n\n` +
        `📅 <b>Date & Time (UTC):</b> ${now}`;

      await sendTelegramMessage(message);

      return res.json({ success: true, message: "Submission received. Admin will review and reward you soon." });
    } catch (error) {
      console.error("Contest submission error:", error);
      return res.status(500).json({ message: "Failed to submit. Please try again." });
    }
  });

  // ==================== NEW DAILY MISSIONS SYSTEM ====================

  function isSameUTCDay(a: Date, b: Date): boolean {
    return a.getUTCFullYear() === b.getUTCFullYear() &&
      a.getUTCMonth() === b.getUTCMonth() &&
      a.getUTCDate() === b.getUTCDate();
  }

  async function resetMissionsIfNewDay(userId: string): Promise<void> {
    const user = await storage.getUser(userId);
    if (!user) return;
    const now = new Date();
    const lastDate = (user as any).missionLastDate ? new Date((user as any).missionLastDate) : null;
    if (!lastDate || !isSameUTCDay(lastDate, now)) {
      await db.execute(sql`
        UPDATE users SET
          mission_last_date = NOW(),
          mission_login_claimed = FALSE,
          mission_announcement_claimed = FALSE,
          mission_watch_ad_claimed = FALSE,
          mission_share_app_claimed = FALSE,
          mission_app_time_claimed = FALSE,
          mission_community_claimed = FALSE,
          mission_bonus_claimed = FALSE,
          mission_app_time_seconds = 0,
          mission_invite_claimed = FALSE
        WHERE id = ${userId}
      `);
      // Send reset notification (only if user had missions before, i.e. lastDate exists)
      if (lastDate) {
        const telegramId = (user as any).telegramId;
        const firstName = (user as any).firstName || '';
        if (telegramId) {
          sendMissionResetNotification(telegramId, firstName).catch(() => {});
        }
      }
    }
  }

  // GET /api/daily-missions/status
  app.get('/api/daily-missions/status', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId);
      if (!user) return res.status(404).json({ error: 'User not found' });

      // Check if new referral today
      const referrals = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM referrals
        WHERE referrer_id = ${userId}
        AND DATE(created_at) = CURRENT_DATE
      `);
      const hasNewReferralToday = parseInt((referrals.rows[0] as any)?.cnt || '0') > 0;

      const u = user as any;
      const appTimeSecs = u.missionAppTimeSeconds ?? 0;
      const allCoreDone =
        u.missionLoginClaimed &&
        u.missionAnnouncementClaimed &&
        u.missionWatchAdClaimed &&
        u.missionShareAppClaimed &&
        u.missionAppTimeClaimed &&
        u.missionCommunityClaimed &&
        (hasNewReferralToday ? u.missionInviteClaimed : true);

      const now = new Date();
      const nextReset = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
      const secsUntilReset = Math.max(0, Math.floor((nextReset.getTime() - now.getTime()) / 1000));

      res.json({
        success: true,
        secsUntilReset,
        appTimeSeconds: appTimeSecs,
        hasNewReferralToday,
        login: { claimed: !!u.missionLoginClaimed },
        announcement: { claimed: !!u.missionAnnouncementClaimed },
        watchAd: { claimed: !!u.missionWatchAdClaimed },
        shareApp: { claimed: !!u.missionShareAppClaimed },
        appTime: { claimed: !!u.missionAppTimeClaimed, seconds: appTimeSecs },
        community: { claimed: !!u.missionCommunityClaimed },
        invite: { claimed: !!u.missionInviteClaimed, available: hasNewReferralToday },
        bonus: { claimed: !!u.missionBonusClaimed, available: allCoreDone },
      });
    } catch (err) {
      console.error('daily-missions/status error:', err);
      res.status(500).json({ error: 'Failed to get mission status' });
    }
  });

  // POST /api/daily-missions/claim/login
  app.post('/api/daily-missions/claim/login', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionLoginClaimed) return res.status(400).json({ error: 'Already claimed today' });
      const reward = 0.00002;
      await db.execute(sql`UPDATE users SET mission_login_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // POST /api/daily-missions/claim/announcement
  app.post('/api/daily-missions/claim/announcement', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionAnnouncementClaimed) return res.status(400).json({ error: 'Already claimed today' });
      const reward = 0.00001;
      await db.execute(sql`UPDATE users SET mission_announcement_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // POST /api/daily-missions/claim/watch-ad
  app.post('/api/daily-missions/claim/watch-ad', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionWatchAdClaimed) return res.status(400).json({ error: 'Already claimed today' });
      const reward = 0.00003;
      await db.execute(sql`UPDATE users SET mission_watch_ad_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // POST /api/daily-missions/claim/share-app
  app.post('/api/daily-missions/claim/share-app', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionShareAppClaimed) return res.status(400).json({ error: 'Already claimed today' });
      const reward = 0.00005;
      await db.execute(sql`UPDATE users SET mission_share_app_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // POST /api/daily-missions/track-app-time  { seconds: number }
  app.post('/api/daily-missions/track-app-time', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const { seconds } = req.body;
      if (!seconds || typeof seconds !== 'number' || seconds <= 0 || seconds > 120) {
        return res.status(400).json({ error: 'Invalid seconds value' });
      }
      await db.execute(sql`
        UPDATE users SET mission_app_time_seconds = LEAST(mission_app_time_seconds + ${Math.floor(seconds)}, 600)
        WHERE id = ${userId}
      `);
      const user = await storage.getUser(userId) as any;
      res.json({ success: true, totalSeconds: user.missionAppTimeSeconds ?? 0 });
    } catch (err) {
      res.status(500).json({ error: 'Failed to track time' });
    }
  });

  // POST /api/daily-missions/claim/app-time
  app.post('/api/daily-missions/claim/app-time', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionAppTimeClaimed) return res.status(400).json({ error: 'Already claimed today' });
      if ((user.missionAppTimeSeconds ?? 0) < 600) return res.status(400).json({ error: 'Not enough app time yet' });
      const reward = 0.00006;
      await db.execute(sql`UPDATE users SET mission_app_time_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // POST /api/daily-missions/claim/community
  app.post('/api/daily-missions/claim/community', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionCommunityClaimed) return res.status(400).json({ error: 'Already claimed today' });
      const reward = 0.00002;
      await db.execute(sql`UPDATE users SET mission_community_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // POST /api/daily-missions/claim/invite
  app.post('/api/daily-missions/claim/invite', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionInviteClaimed) return res.status(400).json({ error: 'Already claimed today' });
      const referrals = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ${userId} AND DATE(created_at) = CURRENT_DATE
      `);
      const hasNew = parseInt((referrals.rows[0] as any)?.cnt || '0') > 0;
      if (!hasNew) return res.status(400).json({ error: 'No new referral today' });
      const reward = 0.0005;
      await db.execute(sql`UPDATE users SET mission_invite_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim' });
    }
  });

  // POST /api/daily-missions/claim/bonus
  app.post('/api/daily-missions/claim/bonus', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      await resetMissionsIfNewDay(userId);
      const user = await storage.getUser(userId) as any;
      if (!user) return res.status(404).json({ error: 'User not found' });
      if (user.missionBonusClaimed) return res.status(400).json({ error: 'Already claimed today' });
      const referrals = await db.execute(sql`
        SELECT COUNT(*) as cnt FROM referrals WHERE referrer_id = ${userId} AND DATE(created_at) = CURRENT_DATE
      `);
      const hasNewReferral = parseInt((referrals.rows[0] as any)?.cnt || '0') > 0;
      const allCoreDone =
        user.missionLoginClaimed &&
        user.missionAnnouncementClaimed &&
        user.missionWatchAdClaimed &&
        user.missionShareAppClaimed &&
        user.missionAppTimeClaimed &&
        user.missionCommunityClaimed &&
        (hasNewReferral ? user.missionInviteClaimed : true);
      if (!allCoreDone) return res.status(400).json({ error: 'Complete all daily missions first' });
      const reward = 0.0001;
      await db.execute(sql`UPDATE users SET mission_bonus_claimed = TRUE, balance = COALESCE(balance::numeric, 0) + ${reward} WHERE id = ${userId}`);
      res.json({ success: true, reward, gramReward: reward, message: `+${reward} GRAM bonus claimed!` });
    } catch (err) {
      res.status(500).json({ error: 'Failed to claim bonus' });
    }
  });

  app.post("/api/game/sliding-sense/reward", authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const raw = req.body.amount ?? req.body.score;
      const parsed = parseFloat(raw);
      if (!raw || isNaN(parsed) || parsed <= 0 || parsed > 60) {
        return res.status(400).json({ error: 'Invalid reward amount' });
      }
      await db.execute(sql`
        UPDATE users
        SET balance = COALESCE(balance::numeric, 0) + ${parsed}
        WHERE id = ${userId}
      `);
      const updatedUser = await storage.getUser(userId);
      res.json({ success: true, earned: parsed, newBalance: updatedUser?.balance });
    } catch (err) {
      res.status(500).json({ error: 'Failed to credit reward' });
    }
  });

  app.post("/api/game/flip-sense/reward", authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const raw = req.body.amount ?? req.body.score;
      const parsed = parseFloat(raw);
      if (!raw || isNaN(parsed) || parsed <= 0 || parsed > 50) {
        return res.status(400).json({ error: 'Invalid reward amount' });
      }
      await db.execute(sql`
        UPDATE users
        SET balance = COALESCE(balance::numeric, 0) + ${parsed}
        WHERE id = ${userId}
      `);
      const updatedUser = await storage.getUser(userId);
      res.json({ success: true, earned: parsed, newBalance: updatedUser?.balance });
    } catch (err) {
      res.status(500).json({ error: 'Failed to credit reward' });
    }
  });

  app.post("/api/game/calculus-fest/reward", authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });
      const raw = req.body.amount ?? req.body.score;
      const parsed = parseFloat(raw);
      if (!raw || isNaN(parsed) || parsed <= 0 || parsed > 60) {
        return res.status(400).json({ error: 'Invalid reward amount' });
      }
      await db.execute(sql`
        UPDATE users
        SET balance = COALESCE(balance::numeric, 0) + ${parsed}
        WHERE id = ${userId}
      `);
      const updatedUser = await storage.getUser(userId);
      res.json({ success: true, earned: parsed, newBalance: updatedUser?.balance });
    } catch (err) {
      res.status(500).json({ error: 'Failed to credit reward' });
    }
  });

  // AXN Name Task — verify $AXN in Telegram name and award 30 AXN (one-time)
  // Badge count — how many tasks are available right now for the current user
  app.get('/api/tasks/badge-count', async (req: any, res) => {
    try {
      const userId = req.session?.user?.user?.id || req.user?.user?.id;
      if (!userId) return res.json({ count: 0 });

      // 1. AXN name task (one-time)
      const [userData] = await db
        .select({ axnNameRewardClaimed: users.axnNameRewardClaimed })
        .from(users)
        .where(eq(users.id, userId));
      const axnTask = userData?.axnNameRewardClaimed ? 0 : 1;

      // 2. Ad slot tasks (3 slots: Monetag, AdsGram, Gigapub — daily cooldown resets at UTC midnight)
      let adTasks = 3;
      try {
        // Ensure table exists first
        await db.execute(sql`
          CREATE TABLE IF NOT EXISTS ad_slot_cooldowns (
            id SERIAL PRIMARY KEY,
            user_id VARCHAR NOT NULL,
            slot INTEGER NOT NULL,
            last_watched_at TIMESTAMP NOT NULL DEFAULT NOW(),
            UNIQUE(user_id, slot)
          )
        `);
        const todayUTC = new Date(); todayUTC.setUTCHours(0, 0, 0, 0);
        const slotRows = await db.execute(sql`
          SELECT COUNT(*)::int AS watched
          FROM ad_slot_cooldowns
          WHERE user_id = ${userId}
            AND last_watched_at >= ${todayUTC}
        `);
        const watchedToday = Number((slotRows.rows[0] as any)?.watched ?? 0);
        adTasks = Math.max(0, 3 - watchedToday);
      } catch {
        adTasks = 3;
      }

      return res.json({ count: axnTask + adTasks });
    } catch {
      return res.json({ count: 0 });
    }
  });

  app.post('/api/tasks/axn-name/verify', authenticateTelegram, async (req: any, res) => {
    return res.status(400).json({ success: false, message: 'Please use the updated app version.' });
  });

  app.post('/api/axn-name/verify', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      const telegramUser = req.user?.telegramUser;
      if (!user || !telegramUser) return res.status(401).json({ success: false, message: 'Not authenticated' });

      const { pool } = await import('./db');

      // Daily reset: check if claimed today (UTC date)
      const checkRes = await pool.query(`SELECT axn_name_last_claimed_at FROM users WHERE id = $1`, [user.id]);
      const lastClaimed: Date | null = checkRes.rows[0]?.axn_name_last_claimed_at;
      if (lastClaimed) {
        const todayUTC = new Date().toISOString().slice(0, 10);
        const lastClaimedUTC = new Date(lastClaimed).toISOString().slice(0, 10);
        if (todayUTC === lastClaimedUTC) {
          return res.status(400).json({ success: false, message: 'Already claimed today. Come back tomorrow!' });
        }
      }

      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) {
        return res.status(500).json({ success: false, message: 'Telegram bot not configured' });
      }

      // Fetch real-time user info from Telegram
      const tgId = telegramUser.id;
      const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/getChat?chat_id=${tgId}`);
      const tgData = await tgRes.json() as any;

      if (!tgData.ok) {
        return res.status(400).json({ success: false, message: 'Could not fetch your Telegram profile. Please start the bot first.' });
      }

      const tgFirstName: string = tgData.result?.first_name || '';
      const tgLastName: string = tgData.result?.last_name || '';
      const fullName = `${tgFirstName} ${tgLastName}`;

      const hasAxn = fullName.toLowerCase().includes('$axn');
      if (!hasAxn) {
        return res.json({
          success: false,
          hasAxn: false,
          message: `$AXN not found in your name. Current name: "${fullName.trim()}". Add $AXN and try again.`,
        });
      }

      // Award 0.01 GRAM (daily)
      const reward = 0.01;
      await pool.query(
        `UPDATE users SET balance = COALESCE(balance::numeric, 0) + $1, axn_name_last_claimed_at = NOW(), axn_name_reward_claimed = TRUE, tasks_completed = COALESCE(tasks_completed, 0) + 1 WHERE id = $2`,
        [reward, user.id]
      );

      return res.json({ success: true, hasAxn: true, gramReward: reward, message: `+${reward} GRAM earned! $AXN found in your name.` });
    } catch (error) {
      console.error('AXN name task error:', error);
      return res.status(500).json({ success: false, message: 'Internal server error' });
    }
  });

  // ── User Tasks (User-created promotional tasks) ───────────────────────────
  app.post('/api/user-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const { title, link, category, impressions } = req.body;
      if (!title || !link || !category || !impressions) {
        return res.status(400).json({ message: 'Missing required fields' });
      }
      if (!['channel_group', 'website_bot'].includes(category)) {
        return res.status(400).json({ message: 'Invalid category' });
      }
      const imp = parseInt(impressions, 10);
      if (isNaN(imp) || imp < 10) {
        return res.status(400).json({ message: 'Minimum 10 impressions required' });
      }
      const costPerImpression = 0.00035;
      const totalCost = imp * costPerImpression;

      const { pool } = await import('./db');
      const balRes = await pool.query(`SELECT balance FROM users WHERE id = $1`, [userId]);
      const currentBalance = parseFloat(balRes.rows[0]?.balance || '0');
      if (currentBalance < totalCost) {
        return res.status(400).json({ message: `Insufficient GRAM balance. Required: ${totalCost.toFixed(5)} GRAM, Available: ${currentBalance.toFixed(5)} GRAM` });
      }

      // ── Bot admin check for channel/group tasks ──────────────────────────────
      if (category === 'channel_group') {
        const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
        if (botToken && link) {
          const match = link.match(/t\.me\/(?:joinchat\/)?([^/?+\s]+)/i);
          if (match && !match[1].startsWith('+')) {
            const channelUsername = '@' + match[1];
            try {
              const meRes = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
              const meData = await meRes.json() as any;
              if (meData.ok) {
                const botId = meData.result.id;
                const memberRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ chat_id: channelUsername, user_id: botId }),
                });
                const memberData = await memberRes.json() as any;
                if (!memberData.ok) {
                  return res.status(400).json({ message: `Bot is not a member of ${channelUsername}. Please add the verification bot as admin in your channel/group first.` });
                }
                const status = memberData.result?.status;
                if (!['administrator', 'creator'].includes(status)) {
                  return res.status(400).json({ message: `Bot must be an admin in ${channelUsername}. Please promote the bot to admin in your channel/group.` });
                }
              }
            } catch (botCheckErr) {
              console.warn('Bot admin check failed (non-critical):', botCheckErr);
            }
          }
        }
      }

      // Deduct balance and create task atomically
      await pool.query('BEGIN');
      let newTaskId: number | null = null;
      try {
        await pool.query(`UPDATE users SET balance = COALESCE(balance::numeric, 0) - $1 WHERE id = $2`, [totalCost, userId]);
        const ins = await pool.query(
          `INSERT INTO user_tasks (user_id, title, link, category, impressions, reward_per_completion, total_cost, status) VALUES ($1,$2,$3,$4,$5,0.001,$6,'pending') RETURNING id`,
          [userId, title.slice(0, 100), link.slice(0, 500), category, imp, totalCost]
        );
        newTaskId = ins.rows[0].id;
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }

      // Notify admin via Telegram
      try {
        const adminTgId = process.env.TELEGRAM_ADMIN_ID;
        if (adminTgId && newTaskId) {
          const userRes = await pool.query(`SELECT username, telegram_id FROM users WHERE id = $1`, [userId]);
          const u = userRes.rows[0];
          const uLabel = u?.username ? `@${u.username}` : `TG ${u?.telegram_id || userId}`;
          const catLabel = category === 'channel_group' ? 'Channel/Group' : 'Website/Bot';
          const { sendUserTelegramNotification } = await import('./telegram');
          await sendUserTelegramNotification(
            adminTgId,
            `🆕 <b>New Mission Submitted</b>\n\n` +
              `👤 User: ${uLabel}\n` +
              `📋 Title: ${title.slice(0, 60)}\n` +
              `🏷 Type: ${catLabel}\n` +
              `👁 Impressions: ${imp}\n` +
              `💰 Cost paid: ${totalCost.toFixed(5)} GRAM\n` +
              `🔗 Link: ${link.slice(0, 80)}\n\n` +
              `Approve or reject in Admin Panel → Missions tab.`
          );
        }
      } catch (notifyErr) {
        console.warn('Admin notification failed (non-critical):', notifyErr);
      }

      return res.json({ success: true, taskId: newTaskId, message: 'Task submitted for review. It will appear after admin approval.' });
    } catch (e) {
      console.error('Create user task error:', e);
      return res.status(500).json({ message: 'Failed to create task' });
    }
  });

  app.get('/api/user-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const { pool } = await import('./db');
      const tasks = await pool.query(`
        SELECT t.*, u.username as creator_username,
          EXISTS(SELECT 1 FROM user_task_completions c WHERE c.task_id = t.id AND c.user_id = $1) as completed_by_me
        FROM user_tasks t
        LEFT JOIN users u ON u.id = t.user_id
        WHERE t.status = 'approved' AND t.completed_count < t.impressions
        ORDER BY t.created_at DESC
      `, [userId]);
      return res.json(tasks.rows);
    } catch (e) {
      return res.status(500).json({ message: 'Failed to fetch tasks' });
    }
  });

  app.post('/api/user-tasks/:taskId/complete', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const taskId = parseInt(req.params.taskId, 10);
      const { pool } = await import('./db');

      const taskRes = await pool.query(`SELECT * FROM user_tasks WHERE id = $1 AND status = 'approved'`, [taskId]);
      if (!taskRes.rows[0]) return res.status(404).json({ message: 'Task not found' });
      const task = taskRes.rows[0];

      if (task.completed_count >= task.impressions) {
        return res.status(400).json({ message: 'Task is fully completed' });
      }
      if (task.user_id === userId) {
        return res.status(400).json({ message: 'Cannot complete your own task' });
      }

      // ── Channel membership verification ──────────────────────────────────────
      if (task.category === 'channel_group' && task.link) {
        const botToken = process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '';
        const telegramUserId = req.user?.telegramUser?.id;
        if (botToken && telegramUserId) {
          const match = task.link.match(/t\.me\/(?:joinchat\/)?([^/?+\s]+)/i);
          if (match && !match[1].startsWith('+')) {
            const channelUsername = '@' + match[1];
            try {
              const isMember = await verifyChannelMembership(parseInt(telegramUserId), channelUsername, botToken);
              if (!isMember) {
                return res.status(400).json({ message: 'Please join the channel/group first, then claim your reward.' });
              }
            } catch (verifyErr: any) {
              const errMsg = String(verifyErr?.message || '');
              if (
                errMsg.includes('chat not found') ||
                errMsg.includes('bot was kicked') ||
                errMsg.includes('CHAT_NOT_FOUND') ||
                errMsg.includes('Forbidden') ||
                errMsg.includes('not enough rights')
              ) {
                await pool.query(`UPDATE user_tasks SET status = 'paused' WHERE id = $1`, [taskId]);
                return res.status(400).json({ message: 'This task has been paused because the bot was removed from the channel/group.' });
              }
              // Unknown error — allow completion (don't block user due to API issues)
            }
          }
        }
      }

      await pool.query('BEGIN');
      try {
        await pool.query(
          `INSERT INTO user_task_completions (user_id, task_id) VALUES ($1, $2)`,
          [userId, taskId]
        );
        await pool.query(
          `UPDATE users SET balance = COALESCE(balance::numeric, 0) + $1 WHERE id = $2`,
          [task.reward_per_completion, userId]
        );
        await pool.query(
          `UPDATE user_tasks SET completed_count = completed_count + 1 WHERE id = $1`,
          [taskId]
        );
        await pool.query('COMMIT');
        return res.json({ success: true, earned: task.reward_per_completion });
      } catch (e: any) {
        await pool.query('ROLLBACK');
        if (e.code === '23505') return res.status(400).json({ message: 'Already completed this task' });
        throw e;
      }
    } catch (e) {
      console.error('Complete user task error:', e);
      return res.status(500).json({ message: 'Failed to complete task' });
    }
  });

  // ── My Tasks (missions created by current user) ───────────────────────────
  app.get('/api/my-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const { pool } = await import('./db');
      const tasks = await pool.query(`
        SELECT id, title, link, category, impressions, completed_count, reward_per_completion, total_cost, status, created_at
        FROM user_tasks WHERE user_id = $1
        ORDER BY created_at DESC
      `, [userId]);
      return res.json(tasks.rows);
    } catch (e) {
      return res.status(500).json({ message: 'Failed to fetch your tasks' });
    }
  });

  // ── User: Delete own task with correct refund ────────────────────────────
  app.delete('/api/my-tasks/:taskId', authenticateTelegram, async (req: any, res) => {
    try {
      const userId = req.user?.user?.id;
      if (!userId) return res.status(401).json({ message: 'Unauthorized' });
      const taskId = parseInt(req.params.taskId, 10);
      const { pool } = await import('./db');

      const taskRes = await pool.query(
        `SELECT id, user_id, impressions, completed_count, status FROM user_tasks WHERE id = $1`,
        [taskId]
      );
      if (!taskRes.rows[0]) return res.status(404).json({ message: 'Task not found' });
      const task = taskRes.rows[0];

      if (task.user_id !== userId) return res.status(403).json({ message: 'Not your task' });
      if (task.status === 'rejected') return res.status(400).json({ message: 'Rejected tasks cannot be deleted — balance was already refunded on rejection.' });

      const COST_PER_IMPRESSION = 0.00035;
      const remaining = Math.max(0, (task.impressions || 0) - (task.completed_count || 0));
      const refund = remaining * COST_PER_IMPRESSION;

      await pool.query('BEGIN');
      try {
        await pool.query(`DELETE FROM user_task_completions WHERE task_id = $1`, [taskId]);
        await pool.query(`DELETE FROM user_tasks WHERE id = $1`, [taskId]);
        if (refund > 0) {
          await pool.query(
            `UPDATE users SET balance = COALESCE(balance::numeric, 0) + $1 WHERE id = $2`,
            [refund, userId]
          );
        }
        await pool.query('COMMIT');
      } catch (e) {
        await pool.query('ROLLBACK');
        throw e;
      }

      const msg = refund > 0
        ? `Mission deleted. +${refund} GRAM refunded (${remaining} unused impressions × 0.00035).`
        : 'Mission deleted. No refund — all impressions were already used.';
      return res.json({ success: true, refund, message: msg });
    } catch (e) {
      console.error('Delete my-task error:', e);
      return res.status(500).json({ message: 'Failed to delete task' });
    }
  });

  // ── Admin: User Task Approval ─────────────────────────────────────────────
  app.get('/api/admin/user-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      const tasks = await pool.query(`
        SELECT t.*, u.username as creator_username, u.telegram_id as creator_telegram_id
        FROM user_tasks t
        LEFT JOIN users u ON u.id = t.user_id
        ORDER BY t.created_at DESC
      `);
      return res.json(tasks.rows);
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  app.post('/api/admin/user-tasks/:taskId/approve', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      await pool.query(`UPDATE user_tasks SET status = 'approved' WHERE id = $1`, [req.params.taskId]);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  app.post('/api/admin/user-tasks/:taskId/reject', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      // Refund balance to task creator
      const taskRes = await pool.query(`SELECT user_id, total_cost FROM user_tasks WHERE id = $1`, [req.params.taskId]);
      if (taskRes.rows[0]) {
        await pool.query(`UPDATE users SET balance = COALESCE(balance::numeric, 0) + $1 WHERE id = $2`,
          [taskRes.rows[0].total_cost, taskRes.rows[0].user_id]);
      }
      await pool.query(`UPDATE user_tasks SET status = 'rejected' WHERE id = $1`, [req.params.taskId]);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  app.post('/api/admin/user-tasks/:taskId/pause', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      const taskRes = await pool.query(`SELECT status FROM user_tasks WHERE id = $1`, [req.params.taskId]);
      if (!taskRes.rows[0]) return res.status(404).json({ message: 'Not found' });
      const currentStatus = taskRes.rows[0].status;
      const newStatus = currentStatus === 'paused' ? 'approved' : 'paused';
      await pool.query(`UPDATE user_tasks SET status = $1 WHERE id = $2`, [newStatus, req.params.taskId]);
      return res.json({ success: true, status: newStatus });
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  app.delete('/api/admin/user-tasks/:taskId', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      await pool.query(`DELETE FROM user_task_completions WHERE task_id = $1`, [req.params.taskId]);
      await pool.query(`DELETE FROM user_tasks WHERE id = $1`, [req.params.taskId]);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  // ── Admin: Partner Task Creation ──────────────────────────────────────────
  app.post('/api/admin/partner-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { title, totalImpressions, gramReward } = req.body;
      const { description, url } = req.body;
      if (!title) return res.status(400).json({ message: 'Title required' });
      const { pool } = await import('./db');
      const imp = parseInt(totalImpressions || '0', 10);
      const reward = Number(gramReward);
      if (!Number.isFinite(reward) || reward <= 0) {
        return res.status(400).json({ message: 'A valid GRAM reward is required' });
      }
      await pool.query(
        `INSERT INTO bounty_tasks (title, description, url, reward_axn, key_cost, total_impressions, is_active) VALUES ($1,$2,$3,$4,0,$5,TRUE)`,
        [title.slice(0, 100), (description || '').slice(0, 300), url || '', reward, imp]
      );
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ message: 'Failed to create partner task' });
    }
  });

  app.delete('/api/admin/partner-tasks/:taskId', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      await pool.query(`DELETE FROM bounty_task_completions WHERE task_id = $1`, [req.params.taskId]);
      await pool.query(`DELETE FROM bounty_tasks WHERE id = $1`, [req.params.taskId]);
      return res.json({ success: true });
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  app.get('/api/admin/partner-tasks', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      const result = await pool.query(
        `SELECT id, title, description, url, reward_axn AS gram_reward, total_impressions, completed_count, is_active, is_paused, created_at
         FROM bounty_tasks
         ORDER BY id DESC`
      );
      return res.json(result.rows.map((task: any) => ({ ...task, gramReward: task.gram_reward })));
    } catch (e) {
      return res.status(500).json({ message: 'Failed to fetch partner tasks' });
    }
  });

  // ── Admin: Pause/Resume Partner Task ──────────────────────────────────────
  app.post('/api/admin/partner-tasks/:taskId/toggle-pause', authenticateTelegram, async (req: any, res) => {
    try {
      const telegramUser = req.user?.telegramUser;
      if (!telegramUser || !isAdmin(telegramUser.id.toString())) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const { pool } = await import('./db');
      const current = await pool.query(`SELECT is_paused FROM bounty_tasks WHERE id = $1`, [req.params.taskId]);
      if (current.rows.length === 0) return res.status(404).json({ message: 'Task not found' });
      const newPaused = !current.rows[0].is_paused;
      await pool.query(`UPDATE bounty_tasks SET is_paused = $1 WHERE id = $2`, [newPaused, req.params.taskId]);
      return res.json({ success: true, is_paused: newPaused });
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  // ── TON Auto-Withdrawal System ────────────────────────────────────────────
  // ── GRAM Deposit System ───────────────────────────────────────────────────
  app.post('/api/gram-deposit/create', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: 'Not authenticated' });

      const walletAddress = String(req.body.walletAddress || '').trim();
      const gramAmount = String(req.body.gramAmount || '').trim();
      if (!walletAddress) return res.status(400).json({ message: 'Connect your wallet first' });
      if (!/^(?:\d+)(?:\.\d{1,9})?$/.test(gramAmount) || Number(gramAmount) <= 0) {
        return res.status(400).json({ message: 'Enter a valid GRAM amount' });
      }
      if (Number(gramAmount) > 10_000_000) {
        return res.status(400).json({ message: 'Amount is too large' });
      }

      // The app balance is GRAM. The TON wallet is the underlying chain rail:
      // 1 GRAM is backed by exactly 1 TON (1,000,000,000 nanoTON).
      const tonAmountNano = gramToNanoTon(gramAmount);
      const { pool } = await import('./db');
      const result = await pool.query(
        `INSERT INTO gram_deposits
          (user_id, wallet_address, gram_amount, ton_amount_nano, status, expires_at)
         VALUES ($1, $2, $3, $4, 'pending', NOW() + INTERVAL '30 minutes')
         RETURNING id, gram_amount, ton_amount_nano, expires_at`,
        [user.id, walletAddress, gramAmount, tonAmountNano],
      );
      const purchase = result.rows[0];
      return res.json({
        success: true,
        purchaseId: purchase.id,
        gramAmount: purchase.gram_amount,
        tonAmountNano: purchase.ton_amount_nano,
        tonAmount: Number(purchase.ton_amount_nano) / 1e9,
        expiresAt: purchase.expires_at,
      });
    } catch (error) {
      console.error('[GRAM-DEPOSIT] create error:', error);
      return res.status(500).json({ message: 'Could not create purchase request' });
    }
  });

  app.get('/api/gram-deposit/status/:id', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: 'Not authenticated' });
      const { pool } = await import('./db');
      const owned = await pool.query(
        `SELECT id, user_id FROM gram_deposits WHERE id = $1 AND user_id = $2`,
        [req.params.id, user.id],
      );
      if (!owned.rows[0]) return res.status(404).json({ message: 'Deposit request not found' });
      return res.json(await settleGramDeposit(req.params.id));
    } catch (error: any) {
      console.error('[GRAM-DEPOSIT] status error:', error);
      const detail = error?.message || String(error);
      return res.status(500).json({ message: `❌ Payment verification failed: ${detail}` });
    }
  });

  app.post('/api/gram-deposit/verify/:id', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: 'Not authenticated' });
      const { pool } = await import('./db');
      const owned = await pool.query(
        `SELECT id FROM gram_deposits WHERE id = $1 AND user_id = $2`,
        [req.params.id, user.id],
      );
      if (!owned.rows[0]) return res.status(404).json({ message: 'Purchase request not found' });
      return res.json(await settleGramDeposit(req.params.id));
    } catch (error: any) {
      console.error('[GRAM-DEPOSIT] verify error:', error);
      const detail = error?.message || String(error);
      return res.status(500).json({ message: `❌ Payment verification failed: ${detail}` });
    }
  });

  // Create table on first run
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ton_withdrawals (
      id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id VARCHAR NOT NULL,
      wallet_address VARCHAR NOT NULL,
      axn_amount DECIMAL(30,10) NOT NULL,
      ton_payment_hash VARCHAR,
      axn_tx_hash VARCHAR,
      status VARCHAR NOT NULL DEFAULT 'pending_payment',
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);

  // POST /api/ton-withdraw/initiate
  app.post('/api/ton-withdraw/initiate', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: 'Not authenticated' });
      const { pool } = await import('./db');

      const walletAddress = req.body.walletAddress?.trim();
      const axnAmount = parseFloat(req.body.axnAmount);

      if (!walletAddress) return res.status(400).json({ message: 'TON wallet address required' });
      if (!axnAmount || axnAmount < 1000) return res.status(400).json({ message: 'Minimum withdrawal is 1,000 AXN' });

      // Server-side time lock: withdraw only open 10 PM–midnight IST (16:30–18:30 UTC)
      // Admin (TELEGRAM_ADMIN_ID) is exempt from the time lock
      const adminTelegramId = process.env.TELEGRAM_ADMIN_ID;
      const isAdminUser = adminTelegramId && user.telegram_id === adminTelegramId;
      if (!isAdminUser) {
        const now = new Date();
        const utcTotal = now.getUTCHours() * 60 + now.getUTCMinutes();
        const openAt = 16 * 60 + 30;  // 16:30 UTC = 10:00 PM IST
        const closeAt = 18 * 60 + 30; // 18:30 UTC = midnight IST
        if (utcTotal < openAt || utcTotal >= closeAt) {
          return res.status(400).json({ message: 'Withdraw is currently locked. Opens at 10:00 PM IST (4:30 PM UTC) daily.' });
        }
      }

      // Check user balance
      const userRow = await pool.query(`SELECT wallet_balance FROM users WHERE id = $1`, [user.id]);
      const balance = parseFloat(userRow.rows[0]?.wallet_balance || '0');
      if (balance < 1000) return res.status(400).json({ message: 'Minimum 1,000 AXN required to withdraw' });
      if (balance < axnAmount) return res.status(400).json({ message: `Insufficient balance. You have ${Math.floor(balance)} AXN` });

      // Block if payment is already confirmed or being sent (truly in-progress, cannot cancel)
      const inProgress = await pool.query(
        `SELECT id FROM ton_withdrawals WHERE user_id = $1 AND status IN ('payment_confirmed','axn_sent') AND expires_at > NOW()`,
        [user.id]
      );
      if (inProgress.rows.length > 0) {
        return res.status(400).json({ message: 'A withdrawal is already being processed. Please wait for it to complete.' });
      }

      // Auto-cancel any stale pending_payment records and refund their balance
      const stalePending = await pool.query(
        `UPDATE ton_withdrawals SET status = 'cancelled', updated_at = NOW()
         WHERE user_id = $1 AND status = 'pending_payment'
         RETURNING axn_amount`,
        [user.id]
      );
      if (stalePending.rows.length > 0) {
        const refundTotal = stalePending.rows.reduce((sum: number, r: any) => sum + parseFloat(r.axn_amount), 0);
        await pool.query(
          `UPDATE users SET wallet_balance = COALESCE(wallet_balance::numeric,0) + $1 WHERE id = $2`,
          [refundTotal, user.id]
        );
        console.log(`[TON-WITHDRAW] Auto-cancelled ${stalePending.rows.length} pending record(s), refunded ${refundTotal} AXN to user ${user.id}`);
      }

      // Deduct balance immediately to prevent double-spend
      await pool.query(
        `UPDATE users SET wallet_balance = COALESCE(wallet_balance::numeric,0) - $1 WHERE id = $2`,
        [axnAmount, user.id]
      );

      // Create claim (expires in 30 min)
      const claim = await pool.query(
        `INSERT INTO ton_withdrawals (user_id, wallet_address, axn_amount, status, expires_at)
         VALUES ($1, $2, $3, 'pending_payment', NOW() + INTERVAL '30 minutes')
         RETURNING id, expires_at`,
        [user.id, walletAddress, axnAmount]
      );
      const { id: claimId, expires_at } = claim.rows[0];

      return res.json({
        success: true,
        claimId,
        treasuryAddress: 'UQDeroBz4zvOntJ4xuMdiwFtNddMhJ4cGxghF9B7fYz50q8b',
        feeNano: '30000000',
        feeTon: '0.03',
        axnAmount,
        expiresAt: expires_at,
      });
    } catch (e) {
      console.error('[TON-WITHDRAW] initiate error:', e);
      return res.status(500).json({ message: 'Failed to initiate withdrawal' });
    }
  });

  // GET /api/ton-withdraw/status/:id
  app.get('/api/ton-withdraw/status/:id', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: 'Not authenticated' });
      const { pool } = await import('./db');

      const row = await pool.query(
        `SELECT id, axn_amount, wallet_address, ton_payment_hash, axn_tx_hash, status, expires_at, created_at
         FROM ton_withdrawals WHERE id = $1 AND user_id = $2`,
        [req.params.id, user.id]
      );
      if (!row.rows[0]) return res.status(404).json({ message: 'Claim not found' });
      return res.json({ claim: row.rows[0] });
    } catch (e) {
      return res.status(500).json({ message: 'Failed to get status' });
    }
  });

  // POST /api/ton-withdraw/cancel/:id — user cancels a pending_payment withdrawal and gets refund
  app.post('/api/ton-withdraw/cancel/:id', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: 'Not authenticated' });
      const { pool } = await import('./db');

      const result = await pool.query(
        `UPDATE ton_withdrawals SET status = 'cancelled', updated_at = NOW()
         WHERE id = $1 AND user_id = $2 AND status = 'pending_payment'
         RETURNING axn_amount`,
        [req.params.id, user.id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ message: 'No cancellable withdrawal found. It may have already been processed.' });
      }

      const refundAmount = parseFloat(result.rows[0].axn_amount);
      await pool.query(
        `UPDATE users SET wallet_balance = COALESCE(wallet_balance::numeric,0) + $1 WHERE id = $2`,
        [refundAmount, user.id]
      );

      console.log(`[TON-WITHDRAW] User ${user.id} cancelled claim ${req.params.id}, refunded ${refundAmount} AXN`);
      return res.json({ success: true, refundedAmount: refundAmount });
    } catch (e) {
      console.error('[TON-WITHDRAW] cancel error:', e);
      return res.status(500).json({ message: 'Failed to cancel withdrawal' });
    }
  });

  // GET /api/ton-withdraw/history — user's withdrawal history
  app.get('/api/ton-withdraw/history', authenticateTelegram, async (req: any, res) => {
    try {
      const user = req.user?.user;
      if (!user) return res.status(401).json({ message: 'Not authenticated' });
      const { pool } = await import('./db');
      const rows = await pool.query(
        `SELECT id, axn_amount, wallet_address, status, ton_payment_hash, axn_tx_hash, created_at, expires_at
         FROM ton_withdrawals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
        [user.id]
      );
      return res.json({ claims: rows.rows });
    } catch (e) {
      return res.status(500).json({ message: 'Failed' });
    }
  });

  // ── Admin: Treasury Status ─────────────────────────────────────────────────
  app.get('/api/admin/treasury-status', authenticateAdmin, async (_req: any, res) => {
    try {
      const { getTreasuryInfo } = await import('./ton-service');
      const info = await getTreasuryInfo();
      const { pool } = await import('./db');
      const pending = await pool.query(`SELECT COUNT(*) as c FROM ton_withdrawals WHERE status='pending_payment'`);
      const failed  = await pool.query(`SELECT COUNT(*) as c FROM ton_withdrawals WHERE status='failed'`);
      const needRetry = await pool.query(
        `SELECT id, user_id, wallet_address, axn_amount, status, created_at
         FROM ton_withdrawals WHERE status IN ('failed','payment_confirmed') ORDER BY created_at DESC LIMIT 20`
      );
      res.json({ success: true, treasury: info, pending: pending.rows[0]?.c, failed: failed.rows[0]?.c, needRetry: needRetry.rows });
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || 'Failed' });
    }
  });

  // ── Admin: Retry failed/stuck ton_withdrawal ───────────────────────────────
  app.post('/api/admin/ton-withdraw/:id/retry', authenticateAdmin, async (req: any, res) => {
    try {
      const { pool } = await import('./db');
      const row = await pool.query(
        `SELECT * FROM ton_withdrawals WHERE id = $1`, [req.params.id]
      );
      if (!row.rows[0]) return res.status(404).json({ success: false, message: 'Not found' });
      const claim = row.rows[0];
      if (!['failed', 'payment_confirmed', 'completed'].includes(claim.status)) {
        return res.status(400).json({ success: false, message: `Cannot retry status: ${claim.status}` });
      }
      const { sendAXNJetton } = await import('./ton-service');
      console.log(`[ADMIN-RETRY] Sending ${claim.axn_amount} AXN → ${claim.wallet_address}`);
      const result = await sendAXNJetton(claim.wallet_address, parseFloat(claim.axn_amount));
      if (result.success) {
        await pool.query(
          `UPDATE ton_withdrawals SET status='completed', axn_tx_hash=$1, updated_at=NOW() WHERE id=$2`,
          [result.txHash, claim.id]
        );
        // Notify user + group
        try {
          const userRow = await pool.query(`SELECT telegram_id, username, first_name FROM users WHERE id=$1`, [claim.user_id]);
          const u = userRow.rows[0];
          const telegramId = u?.telegram_id;
          const botToken = process.env.TELEGRAM_BOT_TOKEN;
          const WITHDRAWAL_GROUP_ID = process.env.WITHDRAWAL_GROUP_ID || '-1002769424144';
          const shortAddr = claim.wallet_address.length > 10
            ? `${claim.wallet_address.slice(0, 4)}...${claim.wallet_address.slice(-4)}`
            : claim.wallet_address;
          const amountStr = parseFloat(claim.axn_amount).toFixed(0);
          const dateStr = new Date().toUTCString();

          if (botToken) {
            const { getBotUsername } = await import('./telegram');
            const botName = await getBotUsername();
            const botBtn = { text: `@${botName}`, url: `https://t.me/${botName}` };

            if (telegramId) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: telegramId,
                  text: `✅ <b>Withdrawal Completed!</b>\n\nYour withdrawal of <b>${amountStr} AXN</b> has been sent to your TON wallet.\n🌐 Wallet: <code>${shortAddr}</code>\n🔗 Tx Hash: <code>${result.txHash}</code>`,
                  parse_mode: 'HTML',
                  reply_markup: { inline_keyboard: [[{ text: '💬 Share in Group', url: 'https://t.me/PaidAdzGroup' }]] }
                })
              });
            }
            const userName = u?.first_name || u?.username || 'Unknown';
            await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: WITHDRAWAL_GROUP_ID,
                text: `✅ <b>Withdrawal Successful</b>\n\n🗣 User: ${userName}\n🆔 User ID: ${telegramId || ''}\n🌐 Address: <code>${shortAddr}</code>\n💸 Amount: ${amountStr} AXN\n🔗 Hash: <code>${result.txHash}</code>\n📅 Date: ${dateStr}`,
                parse_mode: 'HTML',
                reply_markup: { inline_keyboard: [[botBtn]] }
              })
            });
          }
        } catch {}
        return res.json({ success: true, txHash: result.txHash });
      } else {
        await pool.query(`UPDATE ton_withdrawals SET status='failed', updated_at=NOW() WHERE id=$1`, [claim.id]);
        return res.status(500).json({ success: false, message: result.error });
      }
    } catch (e: any) {
      res.status(500).json({ success: false, message: e?.message || 'Retry failed' });
    }
  });

  // Start background TON withdrawal poller
  startTonPoller();

  return httpServer;
}

// ── TON Withdrawal Background Poller ──────────────────────────────────────
async function startTonPoller() {
  const { pool } = await import('./db');
  const { checkPaymentReceived, sendAXNJetton } = await import('./ton-service');

  async function poll() {
    try {
      // 0. Settle pending GRAM deposits independently of the client.
      // This covers manual transfers and payments made after the popup closes.
      const pendingGramDeposits = await pool.query(
        `SELECT gd.id
         FROM gram_deposits gd
         WHERE (
           gd.status = 'pending' AND gd.expires_at > NOW()
         ) OR (
           gd.status = 'credited'
           AND EXISTS (
             SELECT 1 FROM referrals r
             WHERE r.referee_id = gd.user_id
           )
           AND NOT EXISTS (
             SELECT 1 FROM transactions t
             WHERE t.source = 'referral_deposit_commission'
               AND t.metadata->>'orderId' = 'gram_deposit_' || gd.id
           )
         )
         ORDER BY created_at ASC
         LIMIT 100`,
      );
      for (const deposit of pendingGramDeposits.rows) {
        try {
          const result = await settleGramDeposit(deposit.id);
          if (result.status === 'credited' && result.gramAmount) {
            console.log(`[GRAM-POLLER] ✅ Credited ${result.gramAmount} GRAM for deposit ${deposit.id}`);
          }
        } catch (error) {
          console.error(`[GRAM-POLLER] Failed to settle deposit ${deposit.id}:`, error);
        }
      }

      // 1. Expire old pending_payment claims and refund
      const expired = await pool.query(
        `UPDATE ton_withdrawals SET status = 'expired', updated_at = NOW()
         WHERE status = 'pending_payment' AND expires_at < NOW()
         RETURNING user_id, axn_amount`
      );
      for (const row of expired.rows) {
        await pool.query(
          `UPDATE users SET wallet_balance = COALESCE(wallet_balance::numeric,0) + $1 WHERE id = $2`,
          [parseFloat(row.axn_amount), row.user_id]
        );
        console.log(`[TON-POLLER] Expired & refunded ${row.axn_amount} AXN to user ${row.user_id}`);
      }

      // 2. Check pending_payment claims for received TON
      const pending = await pool.query(
        `SELECT id, user_id, wallet_address, axn_amount, created_at
         FROM ton_withdrawals WHERE status = 'pending_payment' AND expires_at > NOW()`
      );

      for (const claim of pending.rows) {
        const { found, txHash } = await checkPaymentReceived(claim.wallet_address, new Date(claim.created_at));
        if (!found) continue;

        console.log(`[TON-POLLER] Payment confirmed for claim ${claim.id}, hash: ${txHash}`);
        await pool.query(
          `UPDATE ton_withdrawals SET status = 'payment_confirmed', ton_payment_hash = $1, updated_at = NOW() WHERE id = $2`,
          [txHash, claim.id]
        );

        // Send AXN jetton
        const sendResult = await sendAXNJetton(claim.wallet_address, parseFloat(claim.axn_amount));
        if (sendResult.success) {
          await pool.query(
            `UPDATE ton_withdrawals SET status = 'completed', axn_tx_hash = $1, updated_at = NOW() WHERE id = $2`,
            [sendResult.txHash, claim.id]
          );
          console.log(`[TON-POLLER] ✅ AXN sent for claim ${claim.id}`);

          // Notify user + group via Telegram
          try {
            const userRow = await pool.query(`SELECT telegram_id, username, first_name FROM users WHERE id = $1`, [claim.user_id]);
            const u = userRow.rows[0];
            const telegramId = u?.telegram_id;
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const WITHDRAWAL_GROUP_ID = process.env.WITHDRAWAL_GROUP_ID || '-1002769424144';
            const shortAddr = claim.wallet_address.length > 10
              ? `${claim.wallet_address.slice(0, 4)}...${claim.wallet_address.slice(-4)}`
              : claim.wallet_address;
            const dateStr = new Date().toUTCString();
            const amountStr = parseFloat(claim.axn_amount).toFixed(0);

            if (botToken) {
              const { getBotUsername } = await import('./telegram');
              const botName = await getBotUsername();
              const botBtn = { text: `@${botName}`, url: `https://t.me/${botName}` };

              // 1. Personal notification to user
              if (telegramId) {
                await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    chat_id: telegramId,
                    text: `✅ <b>Withdrawal Completed!</b>\n\nYour withdrawal of <b>${amountStr} AXN</b> has been sent to your TON wallet.\n🌐 Wallet: <code>${shortAddr}</code>\n🔗 Tx Hash: <code>${sendResult.txHash}</code>\n\nThanks for using Axionet!`,
                    parse_mode: 'HTML',
                    reply_markup: { inline_keyboard: [[{ text: '💬 Share in Group', url: 'https://t.me/PaidAdzGroup' }]] }
                  }),
                });
              }

              // 2. Group notification
              const userName = u?.first_name || u?.username || 'Unknown';
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: WITHDRAWAL_GROUP_ID,
                  text: `✅ <b>Withdrawal Successful</b>\n\n🗣 User: ${userName}\n🆔 User ID: ${telegramId || ''}\n🌐 Address: <code>${shortAddr}</code>\n💸 Amount: ${amountStr} AXN\n🔗 Hash: <code>${sendResult.txHash}</code>\n📅 Date: ${dateStr}`,
                  parse_mode: 'HTML',
                  reply_markup: { inline_keyboard: [[botBtn]] }
                }),
              });
              console.log(`[TON-POLLER] ✅ Group notification sent for claim ${claim.id}`);
            }
          } catch (notifyErr) {
            console.error(`[TON-POLLER] Notification error for claim ${claim.id}:`, notifyErr);
          }
        } else {
          await pool.query(
            `UPDATE ton_withdrawals SET status = 'failed', updated_at = NOW() WHERE id = $1`,
            [claim.id]
          );
          console.error(`[TON-POLLER] ❌ AXN send failed for claim ${claim.id}: ${sendResult.error}`);

          // Notify admin
          try {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const adminId = process.env.TELEGRAM_ADMIN_ID;
            if (botToken && adminId) {
              await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  chat_id: adminId,
                  text: `🚨 *AXN Send Failed*\nClaim: ${claim.id}\nUser: ${claim.user_id}\nAmount: ${claim.axn_amount} AXN\nError: ${sendResult.error}`,
                  parse_mode: 'Markdown',
                }),
              });
            }
          } catch {}
        }
      }
    } catch (e) {
      console.error('[TON-POLLER] poll error:', e);
    }
  }

  // Poll every 30 seconds
  console.log('[TON-POLLER] Starting TON withdrawal poller...');
  poll(); // run immediately
  setInterval(poll, 30_000);
}
