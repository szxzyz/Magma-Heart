import {
  users,
  earnings,
  referrals,
  withdrawals,
  userBalances,
  transactions,
  adminSettings,
  banLogs,
  userMachines,
  type User,
  type UpsertUser,
  type InsertEarning,
  type Earning,
  type Referral,
  type InsertReferral,
  type Withdrawal,
  type InsertWithdrawal,
  type UserBalance,
  type InsertUserBalance,
  type Transaction,
  type InsertTransaction,
  type AdminSetting,
  type BanLog,
  type UserMachine,
} from "../shared/schema";
import { getMachineType } from "../shared/machineTypes";
import { db } from "./db";
import { eq, desc, and, gte, lt, sql } from "drizzle-orm";
import crypto from "crypto";

// Payment system configuration
export interface PaymentSystem {
  id: string;
  name: string;
  emoji: string;
  minWithdrawal: number;
  fee: number;
}

export let PAYMENT_SYSTEMS: PaymentSystem[] = [
  { id: 'axn_withdraw', name: 'AXN', emoji: '⚡', minWithdrawal: 100, fee: 0 }
];

// Helper to update payment systems from admin settings
export function updatePaymentSystemsFromSettings(minWithdraw: number, fee: number) {
  PAYMENT_SYSTEMS = [
    { id: 'axn_withdraw', name: 'AXN', emoji: '⚡', minWithdrawal: minWithdraw, fee: fee }
  ];
}

// Interface for storage operations
export interface IStorage {
  getAllAdminSettings(): Promise<AdminSetting[]>;
  updateAdminSetting(key: string, value: string): Promise<void>;
  updatePaymentSystemsFromSettings(minWithdraw: number, fee: number): void;
  // User operations (mandatory for Replit Auth)
  getUser(id: string): Promise<User | undefined>;
  upsertUser(user: UpsertUser): Promise<{ user: User; isNewUser: boolean }>;
  
  // Earnings operations
  addEarning(earning: InsertEarning): Promise<Earning>;
  getUserEarnings(userId: string, limit?: number): Promise<Earning[]>;
  getUserStats(userId: string): Promise<{
    todayEarnings: string;
    weekEarnings: string;
    monthEarnings: string;
    totalEarnings: string;
  }>;
  
  // Balance operations
  updateUserBalance(userId: string, amount: string): Promise<void>;
  
  // Streak operations
  updateUserStreak(userId: string): Promise<{ newStreak: number; rewardEarned: string }>;
  
  // Ads tracking
  incrementAdsWatched(userId: string): Promise<void>;
  resetDailyAdsCount(userId: string): Promise<void>;
  canWatchAd(userId: string): Promise<boolean>;
  
  // Withdrawal operations
  createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal>;
  getUserWithdrawals(userId: string): Promise<Withdrawal[]>;
  
  // Admin withdrawal operations
  getAllPendingWithdrawals(): Promise<Withdrawal[]>;
  getAllWithdrawals(): Promise<Withdrawal[]>;
  updateWithdrawalStatus(withdrawalId: string, status: string, transactionHash?: string, adminNotes?: string): Promise<Withdrawal>;
  
  // Referral operations
  createReferral(referrerId: string, referredId: string): Promise<Referral>;
  getUserReferrals(userId: string): Promise<Referral[]>;
  
  // Generate referral code
  generateReferralCode(userId: string): Promise<string>;
  getUserByReferralCode(referralCode: string): Promise<User | null>;
  
  // Admin operations
  getAllUsers(): Promise<User[]>;
  updateUserBanStatus(userId: string, banned: boolean, reason?: string, adminId?: string, banType?: string, adminBanReason?: string): Promise<void>;
  
  // Telegram user operations
  getUserByTelegramId(telegramId: string): Promise<User | undefined>;
  upsertTelegramUser(telegramId: string, userData: Omit<UpsertUser, 'id' | 'telegramId'>): Promise<{ user: User; isNewUser: boolean }>;
  
  // Daily reset system
  performDailyReset(): Promise<void>;
  checkAndPerformDailyReset(): Promise<void>;
  
  // User balance operations
  getUserBalance(userId: string): Promise<UserBalance | undefined>;
  createOrUpdateUserBalance(userId: string, balance?: string): Promise<UserBalance>;
  deductBalance(userId: string, amount: string): Promise<{ success: boolean; message: string }>;
  addBalance(userId: string, amount: string): Promise<void>;
  
  // Admin/Statistics operations
  getAppStats(): Promise<{
    totalUsers: number;
    activeUsersToday: number;
    totalInvites: number;
    totalEarnings: string;
    totalReferralEarnings: string;
    totalPayouts: string;
    tonWithdrawn: string;
    newUsersLast24h: number;
    totalAdsWatched: number;
    adsWatchedToday: number;
    pendingWithdrawals: number;
    approvedWithdrawals: number;
    rejectedWithdrawals: number;
    pendingDeposits: number;
    totalMiningSats?: string;
    miningToday?: string;
    usersWithReferrals?: number;
    totalSatsWithdrawn?: string;
  }>;
  checkAndActivateReferralOnChannelJoin(userId: string): Promise<void>;

  // Deposit operations (deposits table dropped - use any)
  getPendingDeposit(userId: string): Promise<any | undefined>;
  createDeposit(deposit: any): Promise<any>;
  getUserDeposits(userId: string): Promise<any[]>;
  getDeposit(depositId: string): Promise<any | undefined>;

  // Referral Tasks (userReferralTasks table dropped)
  getUserReferralTasks(userId: string): Promise<any[]>;
  claimReferralTask(userId: string, taskId: string): Promise<{ success: boolean; message: string; gramReward?: string; miningBoost?: string }>;

  // Farming operations
  getFarmingState(userId: string): Promise<{
    isActive: boolean;
    startedAt: string | null;
    minedAxn: number;
    remainingSeconds: number;
    elapsedSeconds: number;
  }>;
  startFarming(userId: string): Promise<{ success: boolean; message: string }>;
  claimFarming(userId: string): Promise<{ success: boolean; amount: number; message: string }>;

  // Machine operations
  getUserMachines(userId: string): Promise<UserMachine[]>;
  purchaseMachine(userId: string, machineType: string): Promise<{ success: boolean; message: string; machine?: UserMachine }>;
  claimMachineRewards(userId: string, machineType?: string): Promise<{ success: boolean; amount: number; message: string }>;
  getMachineStats(userId: string): Promise<{
    totalMachines: number;
    activeMachines: number;
    hourlyAxn: number;
    dailyAxn: number;
    unclaimedAxn: number;
  }>;
}

export class DatabaseStorage implements IStorage {
  // User operations (mandatory for Replit Auth)
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async updateUserVerificationStatus(userId: string, isVerified: boolean): Promise<void> {
    await db.update(users)
      .set({ 
        isChannelGroupVerified: isVerified,
        lastMembershipCheck: new Date()
      })
      .where(eq(users.id, userId));
  }

  async getUserByTelegramId(telegramId: string): Promise<User | undefined> {
    try {
      // Use raw SQL to avoid Drizzle ORM issues
      const result = await db.execute(sql`
        SELECT * FROM users WHERE telegram_id = ${telegramId} LIMIT 1
      `);
      const user = result.rows[0] as User | undefined;
      return user;
    } catch (error) {
      console.error('Error in getUserByTelegramId:', error);
      throw error;
    }
  }

  async upsertUser(userData: UpsertUser): Promise<{ user: User; isNewUser: boolean }> {
    // Check if user already exists
    const existingUser = await this.getUser(userData.id!);
    const isNewUser = !existingUser;
    
    const [user] = await db
      .insert(users)
      .values(userData)
      .onConflictDoUpdate({
        target: users.id,
        set: {
          ...userData,
          updatedAt: new Date(),
        },
      })
      .returning();
    
    // Auto-generate referral code for new users if they don't have one
    if (isNewUser && !user.referralCode) {
      try {
        await this.generateReferralCode(user.id);
      } catch (error) {
        console.error('Failed to generate referral code for new user:', error);
      }
    }
    
    // Auto-create balance record for new users
    if (isNewUser) {
      try {
        await this.createOrUpdateUserBalance(user.id, '0');
        console.log(`✅ Created balance record for new user: ${user.id}`);
      } catch (error) {
        console.error('Failed to create balance record for new user:', error);
      }
    }
    
    return { user, isNewUser };
  }

  async upsertTelegramUser(telegramId: string, userData: Omit<UpsertUser, 'id' | 'telegramId'>): Promise<{ user: User; isNewUser: boolean }> {
    // Sanitize user data to prevent SQL issues
    const sanitizedData = {
      ...userData,
      firstName: userData.firstName || '',
      lastName: userData.lastName || '',
      username: userData.username || null,
      personalCode: userData.personalCode || telegramId,
      withdraw_balance: '0',
      total_earnings: '0',
      adsWatched: userData.adsWatched || 0,
      dailyAdsWatched: userData.dailyAdsWatched || 0,
      dailyEarnings: userData.dailyEarnings || '0',
      level: userData.level || 1,
      flagged: userData.flagged || false,
      banned: userData.banned || false
      // NOTE: Don't generate referral code here - it will be handled separately for new users only
    };
    
    // Check if user already exists by Telegram ID
    let existingUser = await this.getUserByTelegramId(telegramId);
    
    // If not found by telegram_id, check if user exists by personal_code (for migration scenarios)
    if (!existingUser && sanitizedData.personalCode) {
      const result = await db.execute(sql`
        SELECT * FROM users WHERE personal_code = ${sanitizedData.personalCode} LIMIT 1
      `);
      const userByPersonalCode = result.rows[0] as User | undefined;
      
      if (userByPersonalCode) {
        // User exists but doesn't have telegram_id set - update it
        const updateResult = await db.execute(sql`
          UPDATE users 
          SET telegram_id = ${telegramId},
              first_name = ${sanitizedData.firstName}, 
              last_name = ${sanitizedData.lastName}, 
              username = ${sanitizedData.username},
              updated_at = NOW()
          WHERE personal_code = ${sanitizedData.personalCode}
          RETURNING *
        `);
        const user = updateResult.rows[0] as User;
        return { user, isNewUser: false };
      }
    }
    
    const isNewUser = !existingUser;
    
    if (existingUser) {
      // For existing users, update fields and ensure referral code exists
      const result = await db.execute(sql`
        UPDATE users 
        SET first_name = ${sanitizedData.firstName}, 
            last_name = ${sanitizedData.lastName}, 
            username = ${sanitizedData.username},
            updated_at = NOW()
        WHERE telegram_id = ${telegramId}
        RETURNING *
      `);
      const user = result.rows[0] as User;
      
      // Ensure existing user has referral code
      if (!user.referralCode) {
        console.log('🔄 Generating missing referral code for existing user:', user.id);
        try {
          await this.generateReferralCode(user.id);
          // Fetch updated user with referral code
          const updatedUser = await this.getUser(user.id);
          return { user: updatedUser || user, isNewUser };
        } catch (error) {
          console.error('Failed to generate referral code for existing user:', error);
          return { user, isNewUser };
        }
      }
      
      return { user, isNewUser };
    } else {
      // For new users, check if email already exists
      // If it does, we'll create a unique email by appending the telegram ID
      let finalEmail = userData.email;
      try {
        // Try to create with the provided email first
        const result = await db.execute(sql`
          INSERT INTO users (
            telegram_id, email, first_name, last_name, username, personal_code, 
            withdraw_balance, total_earnings, ads_watched, daily_ads_watched, 
            daily_earnings, level, flagged, banned
          )
          VALUES (
            ${telegramId}, ${finalEmail}, ${sanitizedData.firstName}, ${sanitizedData.lastName}, 
            ${sanitizedData.username}, ${sanitizedData.personalCode}, ${'0'}, 
            ${'0'}, ${sanitizedData.adsWatched}, ${sanitizedData.dailyAdsWatched}, 
            ${sanitizedData.dailyEarnings}, ${sanitizedData.level}, ${sanitizedData.flagged}, 
            ${sanitizedData.banned}
          )
          RETURNING *
        `);
        const user = result.rows[0] as User;
        
        // Auto-generate referral code for new users
        try {
          await this.generateReferralCode(user.id);
        } catch (error) {
          console.error('Failed to generate referral code for new Telegram user:', error);
        }
        
        // Auto-create balance record for new users
        try {
          await this.createOrUpdateUserBalance(user.id, '0');
          console.log(`✅ Created balance record for new Telegram user: ${user.id}`);
        } catch (error) {
          console.error('Failed to create balance record for new Telegram user:', error);
        }
        
        // Fetch updated user with referral code
        const updatedUser = await this.getUser(user.id);
        return { user: updatedUser || user, isNewUser };
      } catch (error: any) {
        // Handle unique constraint violations
        if (error.code === '23505') {
          if (error.constraint === 'users_email_unique') {
            finalEmail = `${telegramId}@telegram.user`;
          } else if (error.constraint === 'users_personal_code_unique') {
            // If personal_code conflict, use telegram ID as personal code
            sanitizedData.personalCode = `tg_${telegramId}`;
          }
          
          // Try again with modified data
          const result = await db.execute(sql`
            INSERT INTO users (
              telegram_id, email, first_name, last_name, username, personal_code, 
              withdraw_balance, total_earnings, ads_watched, daily_ads_watched, 
              daily_earnings, level, flagged, banned
            )
            VALUES (
              ${telegramId}, ${finalEmail}, ${sanitizedData.firstName}, ${sanitizedData.lastName}, 
              ${sanitizedData.username}, ${sanitizedData.personalCode}, ${'0'}, 
              ${'0'}, ${sanitizedData.adsWatched}, ${sanitizedData.dailyAdsWatched}, 
              ${sanitizedData.dailyEarnings}, ${sanitizedData.level}, ${sanitizedData.flagged}, 
              ${sanitizedData.banned}
            )
            RETURNING *
          `);
          const user = result.rows[0] as User;
          
          // Auto-generate referral code for new users
          try {
            await this.generateReferralCode(user.id);
          } catch (error) {
            console.error('Failed to generate referral code for new Telegram user:', error);
          }
          
          // Auto-create balance record for new users
          try {
            await this.createOrUpdateUserBalance(user.id, '0');
            console.log(`✅ Created balance record for new Telegram user: ${user.id}`);
          } catch (error) {
            console.error('Failed to create balance record for new Telegram user:', error);
          }
          
          // Fetch updated user with referral code
          const updatedUser = await this.getUser(user.id);
          return { user: updatedUser || user, isNewUser };
        } else {
          throw error;
        }
      }
    }
  }

  async getAppSetting(key: string, defaultValue: string | number): Promise<string> {
    try {
      const [setting] = await db
        .select({ settingValue: adminSettings.settingValue })
        .from(adminSettings)
        .where(eq(adminSettings.settingKey, key))
        .limit(1);
      
      if (setting && setting.settingValue) {
        return setting.settingValue;
      }
      return String(defaultValue);
    } catch (error) {
      console.error(`Error getting app setting ${key}:`, error);
      return String(defaultValue);
    }
  }

  async watchAd(userId: string, adType: string): Promise<any> {
    const user = await this.getUser(userId);
    if (!user) throw new Error("User not found");
    return { success: true, newBalance: user.balance };
  }

  async getAllAdminSettings(): Promise<AdminSetting[]> {
    return db.select().from(adminSettings);
  }

  async updateAdminSetting(key: string, value: string): Promise<void> {
    await db
      .insert(adminSettings)
      .values({
        settingKey: key,
        settingValue: value,
        updatedAt: new Date()
      })
      .onConflictDoUpdate({
        target: adminSettings.settingKey,
        set: {
          settingValue: value,
          updatedAt: new Date()
        }
      });
  }

  async updatePaymentSystemsFromSettings(minWithdraw: number, fee: number) {
    // In our simplified TON-only model, we update the app settings directly.
    // The payment system logic is handled by getAppSetting in WithdrawalPopup.
    await this.updateAdminSetting('minimum_withdrawal_ton', minWithdraw.toString());
    await this.updateAdminSetting('withdrawal_fee_ton', fee.toString());
    console.log(`✅ Payment system settings updated: Min=${minWithdraw}, Fee=${fee}`);
  }

  // ============================================================
  // FARMING SYSTEM
  // ============================================================

  async getFarmingState(userId: string): Promise<{
    isActive: boolean;
    startedAt: string | null;
    minedAxn: number;
    remainingSeconds: number;
    elapsedSeconds: number;
  }> {
    // Farming is calculated from owned NFT machine records. Do not expose the
    // old user-level session or legacy cycle to clients.
    return {
      isActive: false,
      startedAt: null,
      minedAxn: 0,
      remainingSeconds: 0,
      elapsedSeconds: 0,
    };
  }

  async startFarming(userId: string): Promise<{ success: boolean; message: string }> {
    // NFT farming is managed by user_machines. Keep this legacy endpoint
    // explicitly disabled so an old client cannot start a free farming session.
    const [ownedMachine] = await db
      .select({ id: userMachines.id })
      .from(userMachines)
      .where(eq(userMachines.userId, userId))
      .limit(1);
    if (!ownedMachine) {
      return { success: false, message: 'Purchase an NFT before starting farming.' };
    }
    return { success: false, message: 'Farming is managed from your owned NFTs.' };
  }

  async claimFarming(userId: string): Promise<{ success: boolean; amount: number; message: string }> {
    return {
      success: false,
      amount: 0,
      message: 'Farming rewards can only be claimed from owned NFTs.',
    };
  }


  // Transaction operations
  async addTransaction(transaction: InsertTransaction): Promise<Transaction> {
    const [newTransaction] = await db
      .insert(transactions)
      .values(transaction)
      .returning();
    
    console.log(`📊 Transaction recorded: ${transaction.type} of ${transaction.amount} AXN for user ${transaction.userId} - ${transaction.source}`);
    return newTransaction;
  }

  // Helper function to log transactions for referral system
  async logTransaction(transactionData: InsertTransaction): Promise<Transaction> {
    return this.addTransaction(transactionData);
  }

  // Earnings operations
  async addEarning(earning: InsertEarning): Promise<Earning> {
    const [newEarning] = await db
      .insert(earnings)
      .values(earning)
      .returning();
    
    // Log transaction for security and tracking
    await this.logTransaction({
      userId: earning.userId,
      amount: earning.amount,
      type: 'addition',
      source: earning.source,
      description: earning.description || `${earning.source} earning`,
      metadata: { earningId: newEarning.id }
    });
    
    // Update canonical user_balances table and keep users table in sync
    // All earnings contribute to available balance
    if (parseFloat(earning.amount) !== 0) {
      try {
        // Ensure user has a balance record first with improved error handling
        await this.createOrUpdateUserBalance(earning.userId);
        
        // Update canonical user_balances table
        await db
          .update(userBalances)
          .set({
            balance: sql`COALESCE(${userBalances.balance}, 0) + ${earning.amount}`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, earning.userId));
      } catch (balanceError) {
        console.error('Error updating user balance in addEarning:', balanceError);
        // Auto-create the record if it doesn't exist instead of throwing error
        try {
          console.log('🔄 Attempting to auto-create missing balance record...');
          await this.createOrUpdateUserBalance(earning.userId, '0');
          // Retry the balance update
          await db
            .update(userBalances)
            .set({
              balance: sql`COALESCE(${userBalances.balance}, 0) + ${earning.amount}`,
              updatedAt: new Date(),
            })
            .where(eq(userBalances.userId, earning.userId));
          console.log('✅ Successfully recovered from balance error');
        } catch (recoveryError) {
          console.error('❌ Failed to recover from balance error:', recoveryError);
          // Continue with the function - don't let balance errors block earnings
        }
      }
      
      try {
        // All non-farming earnings go to the GRAM balance. AXN is farming-only.
        await db
          .update(users)
          .set({
            balance: sql`COALESCE(${users.balance}, 0) + ${earning.amount}`,
            total_earned: sql`COALESCE(${users.total_earned}, 0) + ${earning.amount}`,
            total_earnings: sql`COALESCE(${users.total_earnings}, 0) + ${earning.amount}`,
            updatedAt: new Date(),
          })
          .where(eq(users.id, earning.userId));
      } catch (userUpdateError) {
        console.error('Error updating users table in addEarning:', userUpdateError);
        // Don't throw - the earning was already recorded
      }
    }
    
    return newEarning;
  }

  async getUserEarnings(userId: string, limit: number = 20): Promise<Earning[]> {
    return db
      .select()
      .from(earnings)
      .where(eq(earnings.userId, userId))
      .orderBy(desc(earnings.createdAt))
      .limit(limit);
  }

  async getUserStats(userId: string): Promise<{
    todayEarnings: string;
    weekEarnings: string;
    monthEarnings: string;
    totalEarnings: string;
  }> {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    const monthAgo = new Date(today.getFullYear(), today.getMonth() - 1, today.getDate());

    const [todayResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          gte(earnings.createdAt, today),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    const [weekResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          gte(earnings.createdAt, weekAgo),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    const [monthResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          gte(earnings.createdAt, monthAgo),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    const [totalResult] = await db
      .select({
        total: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(earnings)
      .where(
        and(
          eq(earnings.userId, userId),
          sql`${earnings.source} <> 'withdrawal'`
        )
      );

    return {
      todayEarnings: todayResult.total,
      weekEarnings: weekResult.total,
      monthEarnings: monthResult.total,
      totalEarnings: totalResult.total,
    };
  }

  async updateUserBalance(userId: string, amount: string): Promise<void> {
    // Ensure user has a balance record first
    await this.createOrUpdateUserBalance(userId);
    
    // Update the canonical user_balances table
    await db
      .update(userBalances)
      .set({
        balance: sql`${userBalances.balance} + ${amount}`,
        updatedAt: new Date(),
      })
      .where(eq(userBalances.userId, userId));
  }

  async convertAXNToTon(userId: string, axnAmount: number): Promise<{ success: boolean; message: string; tonAmount?: number }> {
    const user = await this.getUser(userId);
    if (!user) return { success: false, message: "User not found" };

    const currentBalance = parseFloat(user.walletBalance?.toString() || user.balance || "0");
    if (currentBalance < axnAmount) {
      return { success: false, message: "Insufficient AXN balance" };
    }

    // 100,000 AXN = 1 TON
    const tonAmount = axnAmount / 100000;

    await db.transaction(async (tx) => {
      // Deduct from walletBalance (Season 2 primary balance)
      await tx.update(users)
        .set({
          walletBalance: sql`COALESCE(${users.walletBalance}, 0) - ${axnAmount.toString()}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Add TON
      await tx.update(users)
        .set({
          tonBalance: sql`COALESCE(${users.tonBalance}, 0) + ${tonAmount.toString()}`,
          updatedAt: new Date(),
        })
        .where(eq(users.id, userId));

      // Record transaction
      await tx.insert(transactions).values({
        userId,
        amount: axnAmount.toString(),
        type: 'deduction',
        source: 'conversion',
        description: `Converted ${axnAmount} AXN to ${tonAmount} TON`,
      });
    });

    const updatedUser = await this.getUser(userId);
    return { success: true, message: "Conversion successful", tonAmount: parseFloat(updatedUser?.tonBalance || "0") };
  }

  // Helper function to get the correct day bucket start (12:00 PM UTC)
  private getDayBucketStart(date: Date): Date {
    const bucketStart = new Date(date);
    bucketStart.setUTCHours(12, 0, 0, 0);
    
    // If the event occurred before 12:00 PM UTC on its calendar day,
    // it belongs to the previous day's bucket
    if (date.getTime() < bucketStart.getTime()) {
      bucketStart.setUTCDate(bucketStart.getUTCDate() - 1);
    }
    
    return bucketStart;
  }

  async updateUserStreak(userId: string): Promise<{ newStreak: number; rewardEarned: string; isBonusDay: boolean }> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) {
      throw new Error("User not found");
    }

    const now = new Date();
    const lastStreakDate = user.lastStreakDate;
    let newStreak = (user.currentStreak || 0) + 1;
    let rewardEarned = "1";
    let isBonusDay = false;

    if (lastStreakDate) {
      const lastClaim = new Date(lastStreakDate);
      const minutesSinceLastClaim = (now.getTime() - lastClaim.getTime()) / (1000 * 60);
      
      if (minutesSinceLastClaim < 5) {
        return { newStreak: user.currentStreak || 0, rewardEarned: "0", isBonusDay: false };
      }
    }

    await db
      .update(users)
      .set({
        currentStreak: newStreak,
        lastStreakDate: now,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));

    if (parseFloat(rewardEarned) > 0) {
      await this.addEarning({
        userId,
        amount: rewardEarned,
        source: 'bonus_claim',
        description: `Bonus claim - earned 1 AXN`,
      });
    }

    return { newStreak, rewardEarned, isBonusDay };
  }

  // Helper function for consistent 12:00 PM UTC reset date calculation
  private getResetDate(date = new Date()): string {
    const utcDate = date.toISOString().split('T')[0];
    
    // If current time is before 12:00 PM UTC, consider it still "yesterday" for tasks
    if (date.getUTCHours() < 12) {
      const yesterday = new Date(date);
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      return yesterday.toISOString().split('T')[0];
    }
    
    return utcDate;
  }

  async incrementAdsWatched(userId: string): Promise<void> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (!user) return;

    const now = new Date();
    const currentResetDate = this.getResetDate(now); // Use 12:00 PM UTC bucket logic

    // Check if last ad was watched today (same reset period)
    let adsCount = 1; // Default for first ad of the day
    
    if (user.lastAdDate) {
      const lastAdResetDate = this.getResetDate(user.lastAdDate);
      
      // If same reset period, increment current count
      if (lastAdResetDate === currentResetDate) {
        adsCount = (user.adsWatchedToday || 0) + 1;
      }
    }

    console.log(`📊 ADS_COUNT_DEBUG: User ${userId}, Reset Date: ${currentResetDate}, New Count: ${adsCount}, Previous Count: ${user.adsWatchedToday || 0}`);

    await db
      .update(users)
      .set({
        adsWatchedToday: adsCount,
        adsWatched: sql`COALESCE(${users.adsWatched}, 0) + 1`, // Increment total ads watched
        lastAdDate: now,
        updatedAt: now,
      })
      .where(eq(users.id, userId));

    // updateTaskProgress removed (taskStatuses table dropped)
  }

  async resetDailyAdsCount(userId: string): Promise<void> {
    await db
      .update(users)
      .set({
        adsWatchedToday: 0,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  }

  async canWatchAd(userId: string): Promise<boolean> {
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) return false;
    
    const now = new Date();
    const currentResetDate = this.getResetDate(now);

    let currentCount = 0;
    
    if (user.lastAdDate) {
      const lastAdResetDate = this.getResetDate(user.lastAdDate);
      
      // If same reset period, use current count
      if (lastAdResetDate === currentResetDate) {
        currentCount = user.adsWatchedToday || 0;
      }
    }
    
    return currentCount < 160; // Daily limit of 160 ads
  }


  async createReferral(referrerId: string, referredId: string): Promise<Referral> {
    // Validate inputs
    if (!referrerId || !referredId) {
      throw new Error(`Invalid referral parameters: referrerId=${referrerId}, referredId=${referredId}`);
    }
    
    // Prevent self-referrals
    if (referrerId === referredId) {
      throw new Error('Users cannot refer themselves');
    }
    
    // Verify both users exist
    const referrer = await this.getUser(referrerId);
    const referred = await this.getUser(referredId);
    
    if (!referrer) {
      throw new Error(`Referrer user not found: ${referrerId}`);
    }
    
    if (!referred) {
      throw new Error(`Referred user not found: ${referredId}`);
    }
    
    // Check if referral already exists
    const existingReferral = await db
      .select()
      .from(referrals)
      .where(and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.refereeId, referredId)
      ))
      .limit(1);
    
    if (existingReferral.length > 0) {
      throw new Error('Referral relationship already exists');
    }
    
    // Create the referral relationship (initially pending)
    const [referral] = await db
      .insert(referrals)
      .values({
        referrerId,
        refereeId: referredId,
        rewardAmount: "0.01",
        status: 'pending', // Pending until friend watches 10 ads
      })
      .returning();
    
    // CRITICAL: Also update the referred user's referred_by field with the referrer's referral code
    // This ensures both the referrals table and the user's referred_by field are synchronized
    await db
      .update(users)
      .set({
        referredBy: referrer.referralCode, // Store the referrer's referral code, not their ID
        updatedAt: new Date(),
      })
      .where(eq(users.id, referredId));
    
    console.log(`✅ Referral relationship created (pending): ${referrerId} referred ${referredId}, referred_by updated to: ${referrer.referralCode}`);
    return referral;
  }

  // Activate the referral relationship when the referred user completes
  // the platform's membership check. Rewards are granted separately and
  // automatically by the AXN milestone and deposit paths.
  async checkAndActivateReferralOnChannelJoin(userId: string): Promise<void> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId));
      if (!user) return;

      const pendingReferrals = await db
        .select()
        .from(referrals)
        .where(and(
          eq(referrals.refereeId, userId),
          eq(referrals.status, 'pending')
        ));

      if (pendingReferrals.length === 0) return;

      for (const referral of pendingReferrals) {
        await db
          .update(referrals)
          .set({ status: 'completed' })
          .where(eq(referrals.id, referral.id));

        await db.update(users)
          .set({
            friendsInvited: sql`COALESCE(${users.friendsInvited}, 0) + 1`,
            updatedAt: new Date()
          })
          .where(eq(users.id, referral.referrerId));

        console.log(`✅ Referral activated on channel join: ${userId} -> ${referral.referrerId}`);
      }
    } catch (error) {
      console.error('Error activating referral on channel join:', error);
    }
  }

  /**
   * Grant the fixed referral reward once the referred user's NFTs have
   * produced 100 AXN. The referral row is locked so concurrent claims cannot
   * grant the reward twice.
   */
  async checkAndGrantReferralMilestone(referredUserId: string): Promise<void> {
    const { pool } = await import('./db');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const referralResult = await client.query(
        `SELECT id, referrer_id
         FROM referrals
         WHERE referee_id = $1
           AND COALESCE(referral_reward_granted, FALSE) = FALSE
         FOR UPDATE`,
        [referredUserId],
      );
      if (referralResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }

      const totalResult = await client.query(
        `SELECT COALESCE(SUM(total_claimed_axn::numeric), 0) AS total_axn
         FROM user_machines
         WHERE user_id = $1`,
        [referredUserId],
      );
      const totalAxn = Number(totalResult.rows[0]?.total_axn || 0);
      if (totalAxn < 100) {
        await client.query('ROLLBACK');
        return;
      }

      const { id: referralId, referrer_id: referrerId } = referralResult.rows[0];
      await client.query(
        `UPDATE users
         SET balance = COALESCE(balance::numeric, 0) + $1,
             total_earned = COALESCE(total_earned::numeric, 0) + $1,
             total_earnings = COALESCE(total_earnings::numeric, 0) + $1,
             updated_at = NOW()
         WHERE id = $2`,
        [0.01, referrerId],
      );
      await client.query(
        `UPDATE referrals
         SET referral_reward_granted = TRUE,
             reward_amount = $1,
             status = 'completed',
             completed_at = COALESCE(completed_at, NOW())
         WHERE id = $2`,
        [0.01, referralId],
      );
      const earningResult = await client.query(
        `INSERT INTO earnings (user_id, amount, source, description)
         VALUES ($1, $2, 'referral_milestone', 'Automatic reward: referred friend collected 100 AXN')
         RETURNING id`,
        [referrerId, 0.01],
      );
      await client.query(
        `INSERT INTO transactions (user_id, amount, type, source, description, metadata)
         VALUES ($1, $2, 'addition', 'referral_milestone',
                 'Automatic referral reward for 100 AXN milestone',
                 jsonb_build_object(
                   'referralId', $3,
                   'referredUserId', $4,
                   'milestoneAxn', 100,
                   'earningId', $5
                 ))`,
        [referrerId, 0.01, referralId, referredUserId, earningResult.rows[0]?.id],
      );
      await client.query('COMMIT');
      console.log(`✅ Referral milestone granted: ${referrerId} earned 0.01 GRAM for ${referredUserId}`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error granting referral milestone:', error);
    } finally {
      client.release();
    }
  }

  async getUserReferrals(userId: string): Promise<Referral[]> {
    return db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerId, userId))
      .orderBy(desc(referrals.createdAt));
  }

  // Get total count of ALL invites (regardless of status or if user watched ads)
  async getTotalInvitesCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(referrals)
      .where(eq(referrals.referrerId, userId));
    
    return result[0]?.count || 0;
  }

  // Clear orphaned referral - when referrer no longer exists
  async clearOrphanedReferral(userId: string): Promise<void> {
    try {
      // Clear the referredBy field on the user
      await db
        .update(users)
        .set({ 
          referredBy: null,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));
      
      console.log(`✅ Cleared orphaned referral for user ${userId}`);
    } catch (error) {
      console.error(`❌ Error clearing orphaned referral for user ${userId}:`, error);
      // Don't throw - this is a cleanup operation that shouldn't block main flow
    }
  }

  async getUserByReferralCode(referralCode: string): Promise<User | null> {
    const [user] = await db.select().from(users).where(eq(users.referralCode, referralCode)).limit(1);
    return user || null;
  }


  async getReferralByUsers(referrerId: string, refereeId: string): Promise<Referral | null> {
    const [referral] = await db
      .select()
      .from(referrals)
      .where(and(
        eq(referrals.referrerId, referrerId),
        eq(referrals.refereeId, refereeId)
      ))
      .limit(1);
    return referral || null;
  }

  // Helper method to ensure all users have referral codes
  async ensureAllUsersHaveReferralCodes(): Promise<void> {
    const usersWithoutCodes = await db
      .select()
      .from(users)
      .where(sql`${users.referralCode} IS NULL OR ${users.referralCode} = ''`);
    
    for (const user of usersWithoutCodes) {
      try {
        await this.generateReferralCode(user.id);
        console.log(`Generated referral code for user ${user.id}`);
      } catch (error) {
        console.error(`Failed to generate referral code for user ${user.id}:`, error);
      }
    }
  }

  // CRITICAL: Fix existing referral data by synchronizing referrals table with referred_by fields
  async fixExistingReferralData(): Promise<void> {
    try {
      console.log('🔄 Starting referral data synchronization...');
      
      // Find all users who have referred_by but no entry in referrals table
      const usersWithReferredBy = await db
        .select({
          userId: users.id,
          referredBy: users.referredBy,
          referralCode: users.referralCode
        })
        .from(users)
        .where(and(
          sql`${users.referredBy} IS NOT NULL`,
          sql`${users.referredBy} != ''`
        ));

      console.log(`Found ${usersWithReferredBy.length} users with referred_by field set`);

      for (const user of usersWithReferredBy) {
        try {
          // Skip if referredBy is null or empty
          if (!user.referredBy) continue;
          
          // Find the referrer by their referral code
          const referrer = await this.getUserByReferralCode(user.referredBy);
          
          if (referrer) {
            // Check if referral relationship already exists
            const existingReferral = await db
              .select()
              .from(referrals)
              .where(and(
                eq(referrals.referrerId, referrer.id),
                eq(referrals.refereeId, user.userId)
              ))
              .limit(1);

            if (existingReferral.length === 0) {
              // Create the missing referral relationship
              await db
                .insert(referrals)
                .values({
                  referrerId: referrer.id,
                  refereeId: user.userId,
                  rewardAmount: "0.01",
                  status: 'pending',
                });
              
              console.log(`✅ Created missing referral: ${referrer.id} -> ${user.userId}`);
            }
          } else {
            console.log(`⚠️  Referrer not found for referral code: ${user.referredBy}`);
          }
        } catch (error) {
          console.error(`❌ Error processing user ${user.userId}:`, error);
        }
      }
      
      console.log('✅ Referral data synchronization completed');
    } catch (error) {
      console.error('❌ Error in fixExistingReferralData:', error);
    }
  }

  async generateReferralCode(userId: string): Promise<string> {
    // First check if user already has a referral code
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    
    if (user && user.referralCode) {
      return user.referralCode;
    }
    
    // Generate a secure random referral code using crypto
    const code = crypto.randomBytes(6).toString('hex'); // 12-character hex code
    
    await db
      .update(users)
      .set({
        referralCode: code,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    
    return code;
  }

  // Admin operations
  async getAllUsers(): Promise<User[]> {
    return db
      .select()
      .from(users)
      .orderBy(desc(users.createdAt));
  }

  async updateUserBanStatus(userId: string, banned: boolean, reason?: string, adminId?: string, banType?: string, adminBanReason?: string): Promise<void> {
    await db
      .update(users)
      .set({
        banned,
        bannedReason: reason || null,
        banType: banned ? (banType || 'system') : null,
        adminBanReason: banned ? (adminBanReason || null) : null,
        bannedAt: banned ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
    
    // Log the ban action if ban_logs table exists and we have details
    try {
      const { logBanAction } = await import('./deviceTracking') as any;
      if (logBanAction) {
        await logBanAction({
          userId,
          banned,
          reason: reason || (banned ? 'Banned by admin' : 'Unbanned by admin'),
          adminId: adminId || 'system'
        });
      }
    } catch (e) {
      console.warn("Could not log ban action to device tracking:", e);
    }
  }

  async usePromoCode(code: string, userId: string): Promise<{ success: boolean; message: string; reward?: string; errorType?: string }> {
    try {
      const { pool } = await import('./db');
      const promoRes = await pool.query(`SELECT * FROM promo_codes WHERE code = $1 LIMIT 1`, [code]);
      const row = promoRes.rows[0];
      if (!row) return { success: false, message: 'Invalid promo code', errorType: 'not_found' };
      if (!row.is_active) return { success: false, message: 'This promo code is inactive', errorType: 'not_active' };
      if (row.expires_at && new Date(row.expires_at) < new Date()) return { success: false, message: 'This promo code has expired', errorType: 'expired' };
      if (row.usage_limit && row.use_count >= row.usage_limit) return { success: false, message: 'This promo code has reached its usage limit', errorType: 'limit_reached' };

      const usageRes = await pool.query(`SELECT COUNT(*) as cnt FROM promo_code_usage WHERE code = $1 AND user_id = $2`, [code, userId]);
      const usageCount = parseInt(usageRes.rows[0]?.cnt || '0');
      const perUserLimit = row.per_user_limit || 1;
      if (usageCount >= perUserLimit) return { success: false, message: 'You have already claimed this promo code', errorType: 'already_used' };

      await pool.query(`INSERT INTO promo_code_usage (id, code, user_id) VALUES (gen_random_uuid(), $1, $2)`, [code, userId]);
      await pool.query(`UPDATE promo_codes SET use_count = use_count + 1 WHERE code = $1`, [code]);

      return { success: true, message: 'Promo code redeemed!', reward: row.reward_amount?.toString() };
    } catch (e) {
      console.error('usePromoCode error:', e);
      return { success: false, message: 'Failed to redeem promo code', errorType: 'error' };
    }
  }

  async createPromoCode(data: any): Promise<any> {
    try {
      const id = `pc_${Math.random().toString(36).slice(2, 12)}`;
      await db.execute(sql`
        INSERT INTO promo_codes (id, code, reward_amount, reward_type, usage_limit, per_user_limit, is_active, expires_at)
        VALUES (${id}, ${data.code}, ${data.rewardAmount}, ${data.rewardType || 'AXN'}, ${data.usageLimit || null}, ${data.perUserLimit || 1}, TRUE, ${data.expiresAt || null})
      `);
      return { id, code: data.code, rewardAmount: data.rewardAmount, rewardType: data.rewardType || 'AXN' };
    } catch (e: any) {
      if (e?.message?.includes('unique') || e?.message?.includes('duplicate')) throw new Error('Promo code already exists');
      throw e;
    }
  }

  async getAllPromoCodes(): Promise<any[]> {
    try {
      const { pool } = await import('./db');
      const res = await pool.query(`SELECT * FROM promo_codes ORDER BY created_at DESC`);
      return res.rows || [];
    } catch { return []; }
  }

  async getPromoCode(code: string): Promise<any> {
    try {
      const { pool } = await import('./db');
      const res = await pool.query(`SELECT * FROM promo_codes WHERE code = $1 LIMIT 1`, [code]);
      const row = res.rows[0];
      if (!row) return undefined;
      return { ...row, rewardAmount: row.reward_amount, rewardType: row.reward_type, usageLimit: row.usage_limit, usageCount: row.use_count, perUserLimit: row.per_user_limit, isActive: row.is_active, expiresAt: row.expires_at };
    } catch { return undefined; }
  }

  async updatePromoCodeStatus(id: string, isActive: boolean): Promise<any> {
    try {
      const { pool } = await import('./db');
      await pool.query(`UPDATE promo_codes SET is_active = $1 WHERE id = $2`, [isActive, id]);
      return { success: true };
    } catch { return { success: false }; }
  }

  async getUserReferralEarnings(userId: string): Promise<string> {
    const [result] = await db
      .select({ total: sql<string>`COALESCE(SUM(${earnings.amount}), '0')` })
      .from(earnings)
      .where(and(
        eq(earnings.userId, userId),
        sql`${earnings.source} IN ('referral_milestone', 'referral_deposit_commission')`
      ));

    return result.total;
  }


  async createPayoutRequest(userId: string, amount: string, paymentSystemId: string, paymentDetails?: string): Promise<{ success: boolean; message: string; withdrawalId?: string }> {
    try {
      // Fetch settings outside transaction (read-only, no lock needed)
      const minWithdrawSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'minimum_withdrawal_sat')).limit(1);
      const feeSetting = await db.select().from(adminSettings).where(eq(adminSettings.settingKey, 'withdrawal_fee_sat')).limit(1);
      const minWithdrawValue = parseFloat(minWithdrawSetting[0]?.settingValue || "100");
      const feeValue = parseFloat(feeSetting[0]?.settingValue || "10");
      updatePaymentSystemsFromSettings(minWithdrawValue, feeValue);

      const effectivePaymentSystemId = 'axn_withdraw';
      const paymentSystem = PAYMENT_SYSTEMS.find(p => p.id === effectivePaymentSystemId);
      if (!paymentSystem) {
        return { success: false, message: 'Invalid payment system' };
      }

      const requestedAmount = parseFloat(amount);
      const fee = paymentSystem.fee;
      const netAmount = requestedAmount - fee;

      if (requestedAmount < paymentSystem.minWithdrawal) {
        return { success: false, message: `Minimum withdrawal is ${paymentSystem.minWithdrawal} AXN` };
      }
      if (netAmount <= 0) {
        return { success: false, message: `Withdrawal amount must be greater than the fee of ${fee} AXN` };
      }

      // --- ATOMIC TRANSACTION: lock user row, validate, deduct, create record ---
      return await db.transaction(async (tx) => {
        // Lock the user row to prevent race conditions
        const [user] = await tx
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .for('update');

        if (!user) {
          return { success: false, message: 'User not found' };
        }

        // Prevent duplicate pending withdrawals
        const [existingPending] = await tx
          .select({ id: withdrawals.id })
          .from(withdrawals)
          .where(and(eq(withdrawals.userId, userId), eq(withdrawals.status, 'pending')))
          .limit(1);

        if (existingPending) {
          return { success: false, message: 'You already have a pending withdrawal request. Please wait for it to be processed.' };
        }

        const userBalance = parseFloat(user.walletBalance?.toString() || '0');

        console.log('Balance check:', { userId, userBalance, requestedAmount });

        if (userBalance < requestedAmount) {
          return {
            success: false,
            message: `Insufficient AXN balance. You have ${Math.floor(userBalance)} AXN, but requested ${Math.floor(requestedAmount)} AXN.`
          };
        }

        const withdrawalDetails = {
          paymentSystem: paymentSystem.name,
          paymentDetails: paymentDetails,
          paymentSystemId: effectivePaymentSystemId,
          requestedAmount: requestedAmount.toString(),
          fee: fee.toString(),
          netAmount: netAmount.toString(),
          totalDeducted: requestedAmount.toString()
        };

        // Deduct balance atomically — use SQL-level check to prevent any race condition
        const [updated] = await tx
          .update(users)
          .set({
            walletBalance: sql`COALESCE(${users.walletBalance}, 0) - ${requestedAmount.toString()}`,
            updatedAt: new Date()
          })
          .where(and(
            eq(users.id, userId),
            sql`COALESCE(${users.walletBalance}, 0) >= ${requestedAmount.toString()}`
          ))
          .returning({ walletBalance: users.walletBalance });

        if (!updated) {
          return {
            success: false,
            message: `Insufficient AXN balance. You have ${Math.floor(userBalance)} AXN, but requested ${Math.floor(requestedAmount)} AXN.`
          };
        }
        console.log(`💰 Withdrawal submitted: walletBalance deducted ${userBalance} → ${updated.walletBalance}`);

        // Create pending withdrawal record (balance already deducted above)
        const [withdrawal] = await tx.insert(withdrawals).values({
          userId: userId,
          amount: amount,
          status: 'pending',
          method: paymentSystem.name,
          details: withdrawalDetails,
          deducted: true,
          refunded: false,
        }).returning();

        return {
          success: true,
          message: `Withdrawal request created successfully. You will receive ${Math.floor(netAmount)} AXN.`,
          withdrawalId: withdrawal.id
        };
      });
    } catch (error) {
      console.error('Error creating payout request:', error);
      return { success: false, message: 'Error processing payout request' };
    }
  }

  // ─── AXN Withdrawal Requests (manual admin approval — no auto-send) ───
  //
  // Rules:
  //  - 1 request per user per calendar day (UTC), regardless of outcome
  //  - Today's 30 daily ads (10 each across 3 ad providers) must be fully watched
  //  - Without any prior GRAM deposit: min 10,000 AXN, max 100,000 AXN / day
  //  - With a prior deposit: min 10,000 AXN, no daily maximum
  //  - Flat 10% fee is deducted; admin sends the net amount manually with a tx hash
  async getWithdrawalEligibility(userId: string): Promise<{
    adsCompletedToday: number;
    adsRequiredToday: number;
    adsRemaining: number;
    hasCompletedAdsToday: boolean;
    hasWithdrawnToday: boolean;
    hasDeposited: boolean;
    minWithdrawal: number;
    maxDailyWithdrawal: number | null;
    balance: number;
  }> {
    const { pool } = await import('./db');
    const todayDate = new Date().toISOString().slice(0, 10);

    const AD_SLOTS = [1, 2, 3];
    const AD_DAILY_LIMIT_PER_SLOT = 10;
    const adsRequiredToday = AD_SLOTS.length * AD_DAILY_LIMIT_PER_SLOT;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS ad_slot_watches (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL,
        slot INTEGER NOT NULL,
        watch_date DATE NOT NULL DEFAULT CURRENT_DATE,
        watch_count INTEGER NOT NULL DEFAULT 1,
        UNIQUE(user_id, slot, watch_date)
      )
    `);

    const adRows = await pool.query(
      `SELECT slot, watch_count FROM ad_slot_watches WHERE user_id = $1 AND watch_date = $2::date`,
      [userId, todayDate]
    );
    const watchedBySlot: Record<number, number> = {};
    for (const row of adRows.rows) {
      watchedBySlot[Number(row.slot)] = Number(row.watch_count);
    }
    const adsCompletedToday = AD_SLOTS.reduce(
      (sum, slot) => sum + Math.min(watchedBySlot[slot] || 0, AD_DAILY_LIMIT_PER_SLOT),
      0
    );

    const withdrawnTodayRows = await pool.query(
      `SELECT id FROM withdrawals WHERE user_id = $1 AND DATE(created_at) = $2::date LIMIT 1`,
      [userId, todayDate]
    );

    const depositRows = await pool.query(
      `SELECT id FROM gram_deposits WHERE user_id = $1 AND status = 'credited' LIMIT 1`,
      [userId]
    );
    const hasDeposited = depositRows.rows.length > 0;

    const user = await this.getUser(userId);
    const balance = parseFloat(user?.walletBalance?.toString() || '0');

    return {
      adsCompletedToday,
      adsRequiredToday,
      adsRemaining: Math.max(0, adsRequiredToday - adsCompletedToday),
      hasCompletedAdsToday: adsCompletedToday >= adsRequiredToday,
      hasWithdrawnToday: withdrawnTodayRows.rows.length > 0,
      hasDeposited,
      minWithdrawal: 10000,
      maxDailyWithdrawal: hasDeposited ? null : 100000,
      balance,
    };
  }

  async createAxnWithdrawalRequest(userId: string, amount: string, walletAddress: string): Promise<{
    success: boolean;
    message: string;
    withdrawalId?: string;
    netAmount?: number;
    fee?: number;
  }> {
    try {
      if (!walletAddress || walletAddress.trim().length < 4) {
        return { success: false, message: 'A valid wallet address is required' };
      }

      const requestedAmount = parseFloat(amount);
      if (!requestedAmount || isNaN(requestedAmount) || requestedAmount <= 0) {
        return { success: false, message: 'Invalid withdrawal amount' };
      }

      const eligibility = await this.getWithdrawalEligibility(userId);

      if (!eligibility.hasCompletedAdsToday) {
        return {
          success: false,
          message: `Complete all ${eligibility.adsRequiredToday} daily ads on the Task page before withdrawing (${eligibility.adsCompletedToday}/${eligibility.adsRequiredToday} done today).`,
        };
      }

      if (eligibility.hasWithdrawnToday) {
        return { success: false, message: 'You can only submit one withdrawal request per day. Please try again tomorrow.' };
      }

      if (requestedAmount < eligibility.minWithdrawal) {
        return { success: false, message: `Minimum withdrawal is ${eligibility.minWithdrawal.toLocaleString()} AXN` };
      }

      if (eligibility.maxDailyWithdrawal !== null && requestedAmount > eligibility.maxDailyWithdrawal) {
        return { success: false, message: `Maximum daily withdrawal is ${eligibility.maxDailyWithdrawal.toLocaleString()} AXN` };
      }

      const FEE_RATE = 0.10;
      const fee = requestedAmount * FEE_RATE;
      const netAmount = requestedAmount - fee;

      const { pool } = await import('./db');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');

        // Re-check "one request per day" and lock the user row inside the transaction
        // to prevent a race between two simultaneous submissions.
        const todayDate = new Date().toISOString().slice(0, 10);
        const withdrawnToday = await client.query(
          `SELECT id FROM withdrawals WHERE user_id = $1 AND DATE(created_at) = $2::date LIMIT 1`,
          [userId, todayDate]
        );
        if (withdrawnToday.rows.length > 0) {
          await client.query('ROLLBACK');
          return { success: false, message: 'You can only submit one withdrawal request per day. Please try again tomorrow.' };
        }

        const userRows = await client.query(`SELECT wallet_balance FROM users WHERE id = $1 FOR UPDATE`, [userId]);
        if (userRows.rows.length === 0) {
          await client.query('ROLLBACK');
          return { success: false, message: 'User not found' };
        }

        const currentBalance = parseFloat(userRows.rows[0].wallet_balance || '0');
        if (currentBalance < requestedAmount) {
          await client.query('ROLLBACK');
          return {
            success: false,
            message: `Insufficient AXN balance. You have ${Math.floor(currentBalance)} AXN, but requested ${Math.floor(requestedAmount)} AXN.`,
          };
        }

        const newBalance = (currentBalance - requestedAmount).toFixed(4);
        await client.query(
          `UPDATE users SET wallet_balance = $1, updated_at = NOW() WHERE id = $2`,
          [newBalance, userId]
        );

        const withdrawalDetails = {
          paymentSystem: 'AXN',
          paymentDetails: walletAddress,
          paymentSystemId: 'axn_withdraw',
          requestedAmount: requestedAmount.toString(),
          fee: fee.toFixed(4),
          feePercent: '10',
          netAmount: netAmount.toFixed(4),
          totalDeducted: requestedAmount.toString(),
        };

        const insertResult = await client.query(
          `INSERT INTO withdrawals (user_id, amount, status, method, details, deducted, refunded)
           VALUES ($1, $2, 'pending', 'AXN', $3, TRUE, FALSE)
           RETURNING id`,
          [userId, netAmount.toFixed(4), JSON.stringify(withdrawalDetails)]
        );

        await client.query('COMMIT');

        return {
          success: true,
          message: `Withdrawal request submitted. You will receive ${netAmount.toLocaleString(undefined, { maximumFractionDigits: 4 })} AXN after admin approval.`,
          withdrawalId: insertResult.rows[0].id,
          netAmount,
          fee,
        };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error('Error creating AXN withdrawal request:', error);
      return { success: false, message: 'Error processing withdrawal request' };
    }
  }

  async getAppStats(): Promise<{
    totalUsers: number;
    activeUsersToday: number;
    totalInvites: number;
    totalEarnings: string;
    totalReferralEarnings: string;
    totalPayouts: string;
    tonWithdrawn: string;
    newUsersLast24h: number;
    totalAdsWatched: number;
    adsWatchedToday: number;
    pendingWithdrawals: number;
    approvedWithdrawals: number;
    rejectedWithdrawals: number;
    pendingDeposits: number;
    totalMiningSats?: string;
    miningToday?: string;
    usersWithReferrals?: number;
    totalSatsWithdrawn?: string;
  }> {
    try {
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);

      // Total users
      const [totalUsersResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users);

      // Active users today (users who earned something today)
      const [activeUsersResult] = await db
        .select({ count: sql<number>`count(DISTINCT ${earnings.userId})` })
        .from(earnings)
        .where(gte(earnings.createdAt, today));

      // Total invites
      const [totalInvitesResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);

      // Total earnings (AXN)
      const [totalEarningsResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(total_earnings AS NUMERIC)), '0')` })
        .from(users);

      // Total referral earnings (commissions table removed)
      const totalReferralEarningsResult = { total: '0' };

      // Total payouts (approved withdrawals sum in TON)
      const [totalPayoutsResult] = await db
        .select({ total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), '0')` })
        .from(withdrawals)
        .where(sql`status IN ('completed', 'success', 'paid', 'Approved', 'approved')`);

      // Total TON withdrawn (same as total payouts since all withdrawals are in TON)
      const tonWithdrawnResult = totalPayoutsResult;

      // New users in last 24h
      const [newUsersResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(gte(users.createdAt, yesterday));

      // Ads stats
      const [adsRes] = await db.select({ 
        total: sql<number>`COALESCE(SUM(ads_watched), 0)`,
        today: sql<number>`COALESCE(SUM(ads_watched_today), 0)`
      }).from(users);

      // Withdrawal counts
      const [withdrawStatusRes] = await db.select({
        pending: sql<number>`COUNT(*) FILTER (WHERE status = 'pending')`,
        approved: sql<number>`COUNT(*) FILTER (WHERE status IN ('completed', 'success', 'paid', 'Approved', 'approved'))`,
        rejected: sql<number>`COUNT(*) FILTER (WHERE status = 'rejected')`
      }).from(withdrawals);

      // Pending deposits count (deposits table removed)
      const pendingDepositsRes = { count: 0 };

      // Total AXN mined (sum of all user balances + totalEarnings)
      const [totalMiningSatsRes] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(total_earnings AS NUMERIC)), '0')`
      }).from(users);

      // AXN mined today (sum of ad_watch earnings today)
      const [miningTodayRes] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), '0')`
      }).from(earnings).where(and(
        gte(earnings.createdAt, today),
        eq(earnings.source, 'ad_watch')
      ));

      // Users with at least 1 referral (completed)
      const [usersWithReferralsRes] = await db.select({
        count: sql<number>`COUNT(DISTINCT referrer_id)`
      }).from(referrals).where(eq(referrals.status, 'completed'));

      // Total AXN withdrawn (approved withdrawals)
      const [totalSatsWithdrawnRes] = await db.select({
        total: sql<string>`COALESCE(SUM(CAST(amount AS NUMERIC)), '0')`
      }).from(withdrawals).where(sql`status IN ('completed', 'success', 'paid', 'Approved', 'approved')`);

      return {
        totalUsers: Number(totalUsersResult.count || 0),
        activeUsersToday: Number(activeUsersResult.count || 0),
        totalInvites: Number(totalInvitesResult.count || 0),
        totalEarnings: totalEarningsResult.total || '0',
        totalReferralEarnings: totalReferralEarningsResult.total || '0',
        totalPayouts: totalPayoutsResult.total || '0',
        tonWithdrawn: tonWithdrawnResult.total || '0',
        newUsersLast24h: Number(newUsersResult.count || 0),
        totalAdsWatched: Number(adsRes.total || 0),
        adsWatchedToday: Number(adsRes.today || 0),
        pendingWithdrawals: Number(withdrawStatusRes.pending || 0),
        approvedWithdrawals: Number(withdrawStatusRes.approved || 0),
        rejectedWithdrawals: Number(withdrawStatusRes.rejected || 0),
        pendingDeposits: Number(pendingDepositsRes.count || 0),
        totalMiningSats: totalMiningSatsRes.total || '0',
        miningToday: miningTodayRes.total || '0',
        usersWithReferrals: Number(usersWithReferralsRes.count || 0),
        totalSatsWithdrawn: totalSatsWithdrawnRes.total || '0',
      };
    } catch (error) {
      console.error('❌ Error in getAppStats:', error);
      return {
        totalUsers: 0,
        activeUsersToday: 0,
        totalInvites: 0,
        totalEarnings: '0',
        totalReferralEarnings: '0',
        totalPayouts: '0',
        tonWithdrawn: '0',
        newUsersLast24h: 0,
        totalAdsWatched: 0,
        adsWatchedToday: 0,
        pendingWithdrawals: 0,
        approvedWithdrawals: 0,
        rejectedWithdrawals: 0,
        pendingDeposits: 0,
        totalMiningSats: '0',
        miningToday: '0',
        usersWithReferrals: 0,
        totalSatsWithdrawn: '0',
      };
    }
  }

  async getAllUsersWithStats(): Promise<any[]> {
    try {
      // Fetch users with real-time referral count from the referrals table
      const allUsers = await db.select({
        id: users.id,
        telegram_id: users.telegram_id,
        username: users.username,
        firstName: users.firstName,
        lastName: users.lastName,
        balance: users.balance,
        totalEarnings: users.total_earnings,
        tonBalance: users.tonBalance,
        bugBalance: users.bugBalance,
        adsWatched: users.adsWatched,
        adsWatchedToday: users.adsWatchedToday,
        referredBy: users.referredBy,
        personalCode: users.personalCode,
        referralCode: users.referralCode,
        banned: users.banned,
        bannedReason: users.bannedReason,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
        totalWithdrawn: users.totalClaimedReferralBonus,
        totalEarned: users.total_earned,
        friendsInvited: users.friendsInvited,
        referralCount: sql<number>`(SELECT count(*) FROM ${referrals} WHERE ${referrals.referrerId} = ${users.id})`
      }).from(users).orderBy(desc(users.createdAt));
      
      return allUsers.map(user => ({
        ...user,
        balance: user.balance?.toString() || '0',
        totalEarnings: user.totalEarnings?.toString() || '0',
        tonBalance: user.tonBalance?.toString() || '0',
        bugBalance: user.bugBalance?.toString() || '0',
        totalWithdrawn: user.totalWithdrawn?.toString() || '0',
        totalEarned: user.totalEarned?.toString() || '0',
        friendsInvited: user.friendsInvited ?? 0,
      }));
    } catch (error) {
      console.error('❌ Error in getAllUsersWithStats:', error);
      return [];
    }
  }

  async getBanLogs(): Promise<BanLog[]> {
    return db.select().from(banLogs).orderBy(desc(banLogs.createdAt));
  }

  // Withdrawal operations (missing implementations)
  async createWithdrawal(withdrawal: InsertWithdrawal): Promise<Withdrawal> {
    const [result] = await db.insert(withdrawals).values(withdrawal).returning();
    return result;
  }

  async getUserWithdrawals(userId: string): Promise<Withdrawal[]> {
    return db.select().from(withdrawals).where(eq(withdrawals.userId, userId)).orderBy(desc(withdrawals.createdAt));
  }

  async getAllPendingWithdrawals(): Promise<Withdrawal[]> {
    return db.select().from(withdrawals).where(eq(withdrawals.status, 'pending')).orderBy(desc(withdrawals.createdAt));
  }

  async getAllWithdrawals(): Promise<Withdrawal[]> {
    return db.select().from(withdrawals).orderBy(desc(withdrawals.createdAt));
  }

  async updateWithdrawalStatus(withdrawalId: string, status: string, transactionHash?: string, adminNotes?: string): Promise<Withdrawal> {
    const updateData: any = { status, updatedAt: new Date() };
    if (transactionHash) updateData.transactionHash = transactionHash;
    if (adminNotes) updateData.adminNotes = adminNotes;

    // Balance management is handled exclusively by approveWithdrawal / rejectWithdrawal.
    // This method only updates the status column — no balance side-effects.
    const [result] = await db.update(withdrawals).set(updateData).where(eq(withdrawals.id, withdrawalId)).returning();
    return result;
  }

  async approveWithdrawal(withdrawalId: string, adminNotes?: string, transactionHash?: string): Promise<{ success: boolean; message: string; withdrawal?: Withdrawal }> {
    try {
      // Get withdrawal details
      const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      if (!withdrawal) {
        return { success: false, message: 'Withdrawal not found' };
      }
      
      if (withdrawal.status !== 'pending') {
        return { success: false, message: 'Withdrawal is not pending' };
      }

      // Get user for logging and balance management
      const user = await this.getUser(withdrawal.userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      const withdrawalAmount = parseFloat(withdrawal.amount);
      
      // Get the total amount that should be deducted (includes fee) from withdrawal details
      // The withdrawal.amount is the NET amount after fee, but we need to deduct the TOTAL (with fee)
      const withdrawalDetails = withdrawal.details as any;
      const totalToDeduct = withdrawalDetails?.totalDeducted 
        ? parseFloat(withdrawalDetails.totalDeducted) 
        : withdrawalAmount;
      
      // ALL withdrawals use AXN walletBalance (Season 2 primary balance)
      const currency = 'AXN';

      // Deduct balance on approval ONLY if not already deducted at submission time
      if (!withdrawal.deducted) {
        const currentBalance = parseFloat(user.walletBalance?.toString() || user.balance || '0');
        if (currentBalance < totalToDeduct) {
          return { success: false, message: `Insufficient AXN balance. User has ${Math.floor(currentBalance)} AXN but withdrawal requires ${Math.floor(totalToDeduct)} AXN.` };
        }
        const newBalance = (currentBalance - totalToDeduct).toFixed(2);
        await db.update(users).set({
          walletBalance: newBalance,
          updatedAt: new Date()
        }).where(eq(users.id, withdrawal.userId));
        console.log(`💰 Withdrawal #${withdrawalId} approved — walletBalance deducted: ${currentBalance} → ${newBalance} AXN`);
      } else {
        console.log(`✅ Withdrawal #${withdrawalId} — balance already deducted at submission, skipping deduction`);
      }

      // Record withdrawal in earnings history for proper stats tracking
      const paymentSystemName = withdrawal.method;
      const description = `Withdrawal approved: ${withdrawal.amount} ${currency} via ${paymentSystemName}`;
      
      await db.insert(earnings).values({
        userId: withdrawal.userId,
        amount: `-${withdrawalAmount.toString()}`,
        source: 'withdrawal',
        description: description,
      });

      // Also log the transaction for audit trail
      await this.logTransaction({
        userId: withdrawal.userId,
        amount: `-${withdrawalAmount.toString()}`,
        type: 'debit',
        source: 'withdrawal',
        description: description,
        metadata: { withdrawalId, currency, method: paymentSystemName }
      });

      // Update withdrawal status to Approved and mark as deducted
      const updateData: any = { 
        status: 'Approved', 
        deducted: true,
        updatedAt: new Date() 
      };
      if (transactionHash) updateData.transactionHash = transactionHash;
      if (adminNotes) updateData.adminNotes = adminNotes;
      
      const [updatedWithdrawal] = await db.update(withdrawals).set(updateData).where(eq(withdrawals.id, withdrawalId)).returning();
      
      console.log(`✅ Withdrawal #${withdrawalId} approved with balance deduction — ${currency} balance updated ✅`);
      
      // Notification is sent by the caller (hash handler or admin panel route)
      
      return { success: true, message: 'Withdrawal approved and processed', withdrawal: updatedWithdrawal };
    } catch (error) {
      console.error('Error approving withdrawal:', error);
      return { success: false, message: 'Error processing withdrawal approval' };
    }
  }

  async rejectWithdrawal(withdrawalId: string, adminNotes?: string): Promise<{ success: boolean; message: string; withdrawal?: Withdrawal }> {
    try {
      // Get withdrawal details
      const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
      if (!withdrawal) {
        return { success: false, message: 'Withdrawal not found' };
      }
      
      if (withdrawal.status !== 'pending') {
        return { success: false, message: 'Withdrawal is not pending' };
      }

      // Get user and withdrawal details for potential refund
      const user = await this.getUser(withdrawal.userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }
      
      const withdrawalAmount = parseFloat(withdrawal.amount);
      const withdrawalDetails = withdrawal.details as any;
      const totalToRefund = withdrawalDetails?.totalDeducted
        ? parseFloat(withdrawalDetails.totalDeducted)
        : withdrawalAmount;

      // Determine which balance field was deducted based on the withdrawal method
      const isTonMethod = withdrawal.method === 'TON' || withdrawal.method === 'STARS' || withdrawal.method === 'TONT';
      const refundField = isTonMethod ? 'tonBalance' : 'walletBalance';

      if (isTonMethod) {
        // Refund to tonBalance
        const currentTonBalance = parseFloat(user.tonBalance || '0');
        const newTonBalance = (currentTonBalance + totalToRefund).toFixed(10);
        await db
          .update(users)
          .set({ tonBalance: newTonBalance, updatedAt: new Date() })
          .where(eq(users.id, withdrawal.userId));
        console.log(`💰 Withdrawal #${withdrawalId} rejected — tonBalance refunded: ${currentTonBalance} → ${newTonBalance}`);
      } else {
        // Refund to walletBalance (AXN)
        const currentSatBalance = parseFloat(user.walletBalance?.toString() || user.balance || '0');
        const newSatBalance = (currentSatBalance + totalToRefund).toFixed(2);
        await db
          .update(users)
          .set({ walletBalance: newSatBalance, updatedAt: new Date() })
          .where(eq(users.id, withdrawal.userId));
        console.log(`💰 Withdrawal #${withdrawalId} rejected — walletBalance refunded: ${currentSatBalance} → ${newSatBalance}`);
      }

      // Update withdrawal status to rejected, mark as refunded
      const updateData: any = { 
        status: 'rejected', 
        refunded: true,
        deducted: true,
        updatedAt: new Date() 
      };
      if (adminNotes) updateData.adminNotes = adminNotes;
      
      const [updatedWithdrawal] = await db.update(withdrawals).set(updateData).where(eq(withdrawals.id, withdrawalId)).returning();

      // Log refund transaction for audit trail
      await this.logTransaction({
        userId: withdrawal.userId,
        amount: totalToRefund.toString(),
        type: 'credit',
        source: 'withdrawal_refund',
        description: `Withdrawal #${withdrawalId} rejected — ${totalToRefund} AXN refunded`,
        metadata: { withdrawalId }
      });
      
      console.log(`✅ Withdrawal #${withdrawalId} rejected — ${totalToRefund} AXN refunded to user wallet`);
      
      return { success: true, message: 'Withdrawal rejected', withdrawal: updatedWithdrawal };
    } catch (error) {
      console.error('Error rejecting withdrawal:', error);
      return { success: false, message: 'Error processing withdrawal rejection' };
    }
  }

  async getWithdrawal(withdrawalId: string): Promise<Withdrawal | undefined> {
    const [withdrawal] = await db.select().from(withdrawals).where(eq(withdrawals.id, withdrawalId));
    return withdrawal;
  }


  // Ensure all required system tasks exist for production deployment
  async ensureSystemTasksExist(): Promise<void> {
    try {
      // Get first available user to be the owner, or create a system user
      let firstUser = await db.select({ id: users.id }).from(users).limit(1).then(users => users[0]);
      
      if (!firstUser) {
        console.log('⚠️ No users found, creating system user for task ownership');
        // Create a system user for task ownership
        const systemUser = await db.insert(users).values({
          id: 'system-user',
          username: 'System',
          firstName: 'System',
          lastName: 'Tasks',
          referralCode: 'SYSTEM',
          createdAt: new Date(),
          updatedAt: new Date()
        }).returning({ id: users.id });
        firstUser = systemUser[0];
        console.log('✅ System user created for task ownership');
      }

      // Define all system tasks with exact specifications
      const systemTasks = [
        // Fixed daily tasks
        {
          id: 'channel-visit-check-update',
          type: 'channel_visit',
          url: 'https://t.me/PaidAdsNews',
          rewardPerUser: '0.00015000', // 0.00015  formatted to 8 digits for precision
          title: 'Channel visit (Check Update)',
          description: 'Visit our Telegram channel for updates and news'
        },
        {
          id: 'app-link-share',
          type: 'share_link',
          url: 'share://referral',
          rewardPerUser: '0.00020000', // 0.00020  formatted to 8 digits for precision
          title: 'App link share (Share link)',
          description: 'Share your affiliate link with friends'
        },
        {
          id: 'invite-friend-valid',
          type: 'invite_friend',
          url: 'invite://friend',
          rewardPerUser: '0.00050000', // 0.00050  formatted to 8 digits for precision
          title: 'Invite friend (valid)',
          description: 'Invite 1 valid friend to earn rewards'
        },
        // Daily ads goal tasks
        {
          id: 'ads-goal-mini',
          type: 'ads_goal_mini',
          url: 'watch://ads/mini',
          rewardPerUser: '0.00045000', // 0.00045  formatted to 8 digits for precision
          title: 'Mini (Watch 15 ads)',
          description: 'Watch 15 ads to complete this daily goal'
        },
        {
          id: 'ads-goal-light',
          type: 'ads_goal_light',
          url: 'watch://ads/light',
          rewardPerUser: '0.00060000', // 0.00060  formatted to 8 digits for precision
          title: 'Light (Watch 25 ads)',
          description: 'Watch 25 ads to complete this daily goal'
        },
        {
          id: 'ads-goal-medium',
          type: 'ads_goal_medium',
          url: 'watch://ads/medium',
          rewardPerUser: '0.00070000', // 0.00070  formatted to 8 digits for precision
          title: 'Medium (Watch 45 ads)',
          description: 'Watch 45 ads to complete this daily goal'
        },
        {
          id: 'ads-goal-hard',
          type: 'ads_goal_hard',
          url: 'watch://ads/hard',
          rewardPerUser: '0.00080000', // 0.00080  formatted to 8 digits for precision
          title: 'Hard (Watch 75 ads)',
          description: 'Watch 75 ads to complete this daily goal'
        }
      ];

      // promotions table removed - system tasks no longer stored in DB
      console.log('✅ System tasks skipped (promotions table dropped)');
    } catch (error) {
      console.error('❌ Error ensuring system tasks exist:', error);
      // Don't throw - server should still start even if task creation fails
    }
  }


  // Ensure admin user with unlimited balance exists for production deployment
  async ensureAdminUserExists(): Promise<void> {
    try {
      const adminTelegramId = '6653616672';
      const maxBalance = '999999999'; // Unlimited AXN for admin testing
      
      // Check if admin user already exists
      const existingAdmin = await this.getUserByTelegramId(adminTelegramId);
      if (existingAdmin) {
        // Always keep admin balance at max for testing
        await db.update(users)
          .set({ 
            balance: maxBalance,
            updatedAt: new Date()
          })
          .where(eq(users.telegram_id, adminTelegramId));
        
        // Also update user_balances table
        await db.insert(userBalances).values({
          userId: existingAdmin.id,
          balance: maxBalance,
          createdAt: new Date(),
          updatedAt: new Date()
        }).onConflictDoUpdate({
          target: [userBalances.userId],
          set: {
            balance: maxBalance,
            updatedAt: new Date()
          }
        });
        
        console.log('✅ Admin balance set to ∞ AXN (999999999):', adminTelegramId);
        return;
      }

      // Create admin user with unlimited balance
      const adminUser = await db.insert(users).values({
        telegram_id: adminTelegramId,
        username: 'admin',
        balance: maxBalance,
        referralCode: 'ADMIN001',
        createdAt: new Date(),
        updatedAt: new Date()
      } as any).returning();

      if (adminUser[0]) {
        // Also create user balance record
        await db.insert(userBalances).values({
          userId: adminUser[0].id,
          balance: maxBalance,
          createdAt: new Date(),
          updatedAt: new Date()
        });

        console.log('✅ Admin user created with unlimited balance:', adminTelegramId);
      }
    } catch (error) {
      console.error('❌ Error ensuring admin user exists:', error);
      // Don't throw - server should still start even if admin creation fails
    }
  }

  async getAvailablePromotionsForUser(_userId: string): Promise<any> {
    return { success: true, tasks: [], total: 0 };
  }

  // dead code removed

  private _noop(): void { return; }

  // dead code removed


  // Task completion system removed - using Ads Watch Tasks system only


  // Get current date in YYYY-MM-DD format for 12:00 PM UTC reset
  private getCurrentTaskDate(): string {
    const now = new Date();
    const resetHour = 12; // 12:00 PM UTC
    
    // If current time is before 12:00 PM UTC, use yesterday's date
    if (now.getUTCHours() < resetHour) {
      now.setUTCDate(now.getUTCDate() - 1);
    }
    
    return now.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
  }


  async completeDailyTask(_promotionId: string, _userId: string, _rewardAmount: string): Promise<{ success: boolean; message: string }> {
    return { success: false, message: 'Daily task system removed' };
  }

  async checkAdsGoalCompletion(userId: string, adsGoalType: string): Promise<boolean> {
    const user = await this.getUser(userId);
    if (!user) return false;

    const currentDate = this.getCurrentTaskDate();
    const adsWatchedToday = user.adsWatchedToday || 0;

    // Define ads goal thresholds
    const adsGoalThresholds = {
      'ads_goal_mini': 15,
      'ads_goal_light': 25, 
      'ads_goal_medium': 45,
      'ads_goal_hard': 75
    };

    const requiredAds = adsGoalThresholds[adsGoalType as keyof typeof adsGoalThresholds];
    if (!requiredAds) return false;

    // Check if user has watched enough ads today
    return adsWatchedToday >= requiredAds;
  }

  // Helper method to check if user has valid referral today (only 1 allowed per day)
  async hasValidReferralToday(userId: string): Promise<boolean> {
    try {
      // Check if there's an actual new referral created today in the referrals table
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      
      const todayReferrals = await db
        .select({ count: sql`count(*)` })
        .from(referrals)
        .where(
          and(
            eq(referrals.referrerId, userId),
            gte(referrals.createdAt, startOfDay),
            lt(referrals.createdAt, endOfDay)
          )
        );

      const count = Number(todayReferrals[0]?.count || 0);
      console.log(`🔍 Referral validation for user ${userId}: ${count} new referrals today`);
      
      return count >= 1;
    } catch (error) {
      console.error('Error checking valid referral today:', error);
      return false;
    }
  }

  // Helper method to check if user has shared their link today
  async hasSharedLinkToday(userId: string): Promise<boolean> {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;
      
      // Use the new appShared field for faster lookup
      return user.appShared || false;
    } catch (error) {
      console.error('Error checking link share today:', error);
      return false;
    }
  }

  // Helper method to check if user has visited channel today
  async hasVisitedChannelToday(userId: string): Promise<boolean> {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;
      
      // Use the new channelVisited field for faster lookup
      return user.channelVisited || false;
    } catch (error) {
      console.error('Error checking channel visit today:', error);
      return false;
    }
  }

  // Method to record that user shared their link (called from frontend)
  async recordLinkShare(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user already shared today
      const hasShared = await this.hasSharedLinkToday(userId);
      if (hasShared) {
        return { success: true, message: 'Link share already recorded today' };
      }

      // Update the appShared field
      await db.update(users)
        .set({ appShared: true })
        .where(eq(users.id, userId));

      return { success: true, message: 'Link share recorded successfully' };
    } catch (error) {
      console.error('Error recording link share:', error);
      return { success: false, message: 'Failed to record link share' };
    }
  }

  // promotions table not in schema - stub method
  async getPromotion(_promotionId: string): Promise<any | null> {
    return null;
  }

  // Deposit stubs (deposits table dropped)
  async getPendingDeposit(_userId: string): Promise<any | undefined> {
    return undefined;
  }
  async createDeposit(_deposit: any): Promise<any> {
    return null;
  }
  async getUserDeposits(_userId: string): Promise<any[]> {
    return [];
  }
  async getDeposit(_depositId: string): Promise<any | undefined> {
    return undefined;
  }

  // UserReferralTask stubs (userReferralTasks table dropped)
  async getUserReferralTasks(_userId: string): Promise<any[]> {
    return [];
  }
  async claimReferralTask(_userId: string, _taskId: string): Promise<{ success: boolean; message: string; gramReward?: string; miningBoost?: string }> {
    return { success: false, message: 'Referral task system removed' };
  }

  // ============== NEW TASK STATUS SYSTEM FUNCTIONS ==============
  
  // Get or create task status for user (taskStatuses table dropped - stub)
  async getTaskStatus(_userId: string, _promotionId: string, _periodDate?: string): Promise<any | null> {
    return null;
  }

  // Update or create task status (taskStatuses table dropped - stub)
  async setTaskStatus(
    _userId: string,
    _promotionId: string,
    _status: 'locked' | 'claimable' | 'claimed',
    _periodDate?: string,
    _progressCurrent?: number,
    _progressRequired?: number,
    _metadata?: any
  ): Promise<{ success: boolean; message: string }> {
    return { success: true, message: 'Task status system removed' };
  }

  // Verify task and update status to claimable
  async verifyTask(userId: string, promotionId: string, taskType: string): Promise<{ success: boolean; message: string; status?: 'claimable' | 'locked' | 'claimed' }> {
    try {
      const promotion = await this.getPromotion(promotionId);
      if (!promotion) {
        return { success: false, message: 'Task not found' };
      }

      const isDailyTask = ['channel_visit', 'share_link', 'invite_friend', 'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'].includes(taskType);
      const periodDate = isDailyTask ? this.getCurrentTaskDate() : undefined;

      // Check current status
      const currentStatus = await this.getTaskStatus(userId, promotionId, periodDate);
      if (currentStatus?.status === 'claimed') {
        return { success: false, message: 'Task already claimed', status: 'claimed' };
      }

      let verified = false;
      let progressCurrent = 0;
      let progressRequired = 0;

      // Perform verification based on task type
      switch (taskType) {
        case 'channel_visit':
          // Channel visit is immediately claimable after user clicks
          verified = true;
          break;
          
        case 'share_link':
          // Check if user has shared their link
          verified = await this.hasSharedLinkToday(userId);
          break;
          
        case 'invite_friend':
          // Check if user has valid referral today
          verified = await this.hasValidReferralToday(userId);
          break;
          
        case 'ads_goal_mini':
        case 'ads_goal_light':
        case 'ads_goal_medium':
        case 'ads_goal_hard':
          // Check if user met ads goal
          const user = await this.getUser(userId);
          const adsWatchedToday = user?.adsWatchedToday || 0;
          
          const adsGoalThresholds = {
            'ads_goal_mini': 15,
            'ads_goal_light': 25,
            'ads_goal_medium': 45,
            'ads_goal_hard': 75
          };
          
          progressRequired = adsGoalThresholds[taskType as keyof typeof adsGoalThresholds] || 0;
          progressCurrent = adsWatchedToday;
          verified = adsWatchedToday >= progressRequired;
          break;
          
        default:
          verified = true; // For other task types, assume verified
      }

      const newStatus = verified ? 'claimable' : 'locked';
      await this.setTaskStatus(userId, promotionId, newStatus, periodDate, progressCurrent, progressRequired);

      return { 
        success: true, 
        message: verified ? 'Task verified, ready to claim!' : 'Task requirements not met yet',
        status: newStatus
      };
    } catch (error) {
      console.error('Error verifying task:', error);
      return { success: false, message: 'Failed to verify task' };
    }
  }

  // Claim task reward
  async claimTaskReward(userId: string, promotionId: string): Promise<{ success: boolean; message: string; rewardAmount?: string; newBalance?: string }> {
    try {
      const promotion = await this.getPromotion(promotionId);
      if (!promotion) {
        return { success: false, message: 'Task not found' };
      }

      const isDailyTask = ['channel_visit', 'share_link', 'invite_friend', 'ads_goal_mini', 'ads_goal_light', 'ads_goal_medium', 'ads_goal_hard'].includes(promotion.type);
      const periodDate = isDailyTask ? this.getCurrentTaskDate() : undefined;

      // Check current status
      const currentStatus = await this.getTaskStatus(userId, promotionId, periodDate);
      if (!currentStatus) {
        return { success: false, message: 'Task status not found' };
      }
      
      if (currentStatus.status === 'claimed') {
        return { success: false, message: 'Task already claimed' };
      }
      
      if (currentStatus.status !== 'claimable') {
        return { success: false, message: 'Task not ready to claim' };
      }

      // Prevent users from claiming their own tasks
      if (promotion.ownerId === userId) {
        return { success: false, message: 'You cannot claim your own task' };
      }

      const rewardAmount = promotion.rewardPerUser || '0';
      
      // dailyTaskCompletions and taskCompletions tables removed - skip DB insert

      // Add reward to balance
      await this.addBalance(userId, rewardAmount);

      // Add earning record
      await this.addEarning({
        userId,
        amount: rewardAmount,
        source: isDailyTask ? 'daily_task_completion' : 'task_completion',
        description: `Task completed: ${promotion.title}`,
      });

      // Update task status to claimed
      await this.setTaskStatus(userId, promotionId, 'claimed', periodDate);

      // Get updated balance
      const updatedBalance = await this.getUserBalance(userId);

      console.log(`📊 TASK_CLAIM_LOG: UserID=${userId}, TaskID=${promotionId}, AmountRewarded=${rewardAmount}, Status=SUCCESS, Title="${promotion.title}"`);

      return { 
        success: true, 
        message: 'Task claimed successfully!',
        rewardAmount,
        newBalance: updatedBalance?.balance || '0'
      };
    } catch (error) {
      console.error('Error claiming task reward:', error);
      return { success: false, message: 'Failed to claim task reward' };
    }
  }

  // ============== END NEW TASK STATUS SYSTEM FUNCTIONS ==============

  // Method to record that user visited channel (called from frontend)
  async recordChannelVisit(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user already visited today
      const hasVisited = await this.hasVisitedChannelToday(userId);
      if (hasVisited) {
        return { success: true, message: 'Channel visit already recorded today' };
      }

      // Update the channelVisited field
      await db.update(users)
        .set({ channelVisited: true })
        .where(eq(users.id, userId));

      return { success: true, message: 'Channel visit recorded successfully' };
    } catch (error) {
      console.error('Error recording channel visit:', error);
      return { success: false, message: 'Failed to record channel visit' };
    }
  }

  // Method to increment referrals today count when a referral is made
  async incrementReferralsToday(userId: string): Promise<{ success: boolean; message: string }> {
    try {
      // Get current user data
      const user = await this.getUser(userId);
      if (!user) {
        return { success: false, message: 'User not found' };
      }

      // Increment referrals today count
      const newCount = (user.friendsInvited || 0) + 1;
      await db.update(users)
        .set({ friendsInvited: newCount })
        .where(eq(users.id, userId));

      return { success: true, message: `Referrals today count updated to ${newCount}` };
    } catch (error) {
      console.error('Error incrementing referrals today:', error);
      return { success: false, message: 'Failed to increment referrals today' };
    }
  }

  // Daily reset system - runs at 12:00 PM UTC
  async performDailyReset(): Promise<void> {
    try {
      console.log('🔄 Starting daily reset at 12:00 PM UTC...');
      
      const currentDate = new Date();
      const currentDateString = currentDate.toISOString().split('T')[0];
      const periodStart = new Date(currentDate);
      periodStart.setUTCHours(12, 0, 0, 0); // 12:00 PM UTC period start
      
      // 1. Check if reset was already performed for this period (idempotency)
      const usersNeedingReset = await db.select({ id: users.id })
        .from(users)
        .where(sql`${users.lastResetDate} < ${periodStart.toISOString()} OR ${users.lastResetDate} IS NULL`)
        .limit(1000); // Process in batches
      
      if (usersNeedingReset.length === 0) {
        console.log('🔄 Daily reset already completed for this period');
        return;
      }
      
      console.log(`🔄 Resetting ${usersNeedingReset.length} users for period ${currentDateString}`);
      
      // 2. Reset all users' daily counters and tracking fields
      await db.update(users)
        .set({ 
          adsWatchedToday: 0,
          channelVisited: false,
          appShared: false,
          friendsInvited: 0,
          lastResetDate: currentDate,
          lastAdDate: currentDate 
        })
        .where(sql`${users.lastResetDate} < ${periodStart.toISOString()} OR ${users.lastResetDate} IS NULL`);
      
      // 3. Create daily task completion records for all task types for this period
      const taskTypes = ['channel_visit', 'share_link', 'invite_friend', 'ads_mini', 'ads_light', 'ads_medium', 'ads_hard'];
      const taskRewards = {
        'channel_visit': '0.000025',
        'share_link': '0.000025', 
        'invite_friend': '0.00005',
        'ads_mini': '0.000035', // 15 ads
        'ads_light': '0.000055', // 25 ads
        'ads_medium': '0.000095', // 45 ads
        'ads_hard': '0.000155' // 75 ads
      };
      const taskRequirements = {
        'channel_visit': 1,
        'share_link': 1,
        'invite_friend': 1,
        'ads_mini': 15,
        'ads_light': 25,
        'ads_medium': 45,
        'ads_hard': 75
      };
      
      for (const user of usersNeedingReset) {
        for (const taskType of taskTypes) {
          try {
            // dailyTaskCompletions table removed - skip insert
          } catch (error) {
            console.warn(`⚠️ Failed to create daily task ${taskType} for user ${user.id}:`, error);
          }
        }
      }
      
      // 4. Clean up old daily task completions (older than 7 days)
      const weekAgo = new Date();
      weekAgo.setDate(weekAgo.getDate() - 7);
      const weekAgoString = weekAgo.toISOString().split('T')[0];
      
      // dailyTaskCompletions table removed - skip cleanup
      
      console.log('✅ Daily reset completed successfully at 12:00 PM UTC');
      console.log(`   - Reset ${usersNeedingReset.length} users for period ${currentDateString}`);
      console.log('   - Reset ads watched today to 0');
      console.log('   - Reset channel visited, app shared, link shared, friend invited to false');
      console.log('   - Reset friends invited count to 0');
      console.log('   - Created daily task completion records');
      console.log('   - Cleaned up old task completions');
    } catch (error) {
      console.error('❌ Error during daily reset:', error);
    }
  }

  // Check if it's time for daily reset (12:00 PM UTC)
  async checkAndPerformDailyReset(): Promise<void> {
    const now = new Date();
    
    // Check if it's exactly 12:00 PM UTC (within 1 minute window)
    const isResetTime = now.getUTCHours() === 12 && now.getUTCMinutes() === 0;
    
    if (isResetTime) {
      await this.performDailyReset();
    }
  }

  // Simplified methods for the new schema - no complex tracking needed
  async updatePromotionCompletedCount(promotionId: string): Promise<void> {
    // No-op since we removed complex tracking
    return;
  }

  async updatePromotionMessageId(promotionId: string, messageId: string): Promise<void> {
    // Note: message_id field doesn't exist in promotions schema
    // This could be tracked separately if needed in the future
    console.log(`📌 Promotion ${promotionId} posted with message ID: ${messageId}`);
  }

  async deactivateCompletedPromotions(): Promise<void> {
    // No-op since we removed complex tracking  
    return;
  }

  // User balance operations
  async getUserBalance(userId: string): Promise<UserBalance | undefined> {
    try {
      const [balance] = await db.select().from(userBalances).where(eq(userBalances.userId, userId));
      return balance;
    } catch (error) {
      console.error('Error getting user balance:', error);
      return undefined;
    }
  }

  async createOrUpdateUserBalance(userId: string, balance?: string): Promise<UserBalance> {
    try {
      // Use upsert pattern with ON CONFLICT to handle race conditions
      const [result] = await db.insert(userBalances)
        .values({
          userId,
          balance: balance || '0',
        })
        .onConflictDoUpdate({
          target: userBalances.userId,
          set: {
            balance: balance ? balance : sql`${userBalances.balance}`,
            updatedAt: new Date()
          }
        })
        .returning();
      return result;
    } catch (error) {
      console.error('Error creating/updating user balance:', error);
      // Fallback: try to get existing balance if upsert fails
      try {
        const existingBalance = await this.getUserBalance(userId);
        if (existingBalance) {
          return existingBalance;
        }
      } catch (fallbackError) {
        console.error('Fallback getUserBalance also failed:', fallbackError);
      }
      throw error;
    }
  }

  async deductBalance(userId: string, amount: string): Promise<{ success: boolean; message: string }> {
    try {
      // Check if user is admin - admins have unlimited balance
      const user = await this.getUser(userId);
      const isAdmin = user?.telegram_id === process.env.TELEGRAM_ADMIN_ID;
      
      if (isAdmin) {
        console.log('🔑 Admin has unlimited balance - allowing deduction');
        return { success: true, message: 'Balance deducted successfully (admin unlimited)' };
      }

      let balance = await this.getUserBalance(userId);
      if (!balance) {
        // Create balance record with 0 if user not found
        balance = await this.createOrUpdateUserBalance(userId, '0');
      }

      const currentBalance = parseFloat(balance.balance || '0');
      const deductAmount = parseFloat(amount);

      if (currentBalance < deductAmount) {
        return { success: false, message: 'Insufficient balance' };
      }

      await db.update(userBalances)
        .set({
          balance: sql`${userBalances.balance} - ${amount}`,
          updatedAt: new Date(),
        })
        .where(eq(userBalances.userId, userId));

      // Record transaction for balance deduction
      await this.addTransaction({
        userId,
        amount: `-${amount}`,
        type: 'deduction',
        source: 'task_creation',
        description: `Task creation cost deducted - fixed rate`,
        metadata: { 
          deductedAmount: amount,
          fixedCost: '0.01',
          reason: 'task_creation_fee'
        }
      });

      return { success: true, message: 'Balance deducted successfully' };
    } catch (error) {
      console.error('Error deducting balance:', error);
      return { success: false, message: 'Error deducting balance' };
    }
  }

  async addBalance(userId: string, amount: string): Promise<void> {
    try {
      // First ensure the user has a balance record
      let existingBalance = await this.getUserBalance(userId);
      if (!existingBalance) {
        // Create new balance record with the amount if user not found
        await this.createOrUpdateUserBalance(userId, amount);
      } else {
        // Add to existing balance
        await db.update(userBalances)
          .set({
            balance: sql`${userBalances.balance} + ${amount}`,
            updatedAt: new Date(),
          })
          .where(eq(userBalances.userId, userId));
      }
    } catch (error) {
      console.error('Error adding balance:', error);
      throw error;
    }
  }

  // Promotion claims methods (promotionClaims and promotions tables removed - stubs)
  async hasUserClaimedPromotion(_promotionId: string, _userId: string): Promise<boolean> {
    return false;
  }

  async incrementPromotionClaimedCount(_promotionId: string): Promise<void> {
    // promotions table removed
  }

  // ===== NEW SIMPLE TASK SYSTEM =====
  
  // Fixed task configuration for the 9 sequential ads-based tasks
  private readonly TASK_CONFIG = [
    { level: 1, required: 20, reward: "0.00033000" },
    { level: 2, required: 20, reward: "0.00033000" },
    { level: 3, required: 20, reward: "0.00033000" },
    { level: 4, required: 20, reward: "0.00033000" },
    { level: 5, required: 20, reward: "0.00033000" },
    { level: 6, required: 20, reward: "0.00033000" },
    { level: 7, required: 20, reward: "0.00033000" },
    { level: 8, required: 20, reward: "0.00033000" },
    { level: 9, required: 20, reward: "0.00033000" },
  ];

  // New daily reset - runs at 00:00 UTC instead of 12:00 PM UTC
  async performDailyResetV2(): Promise<void> {
    try {
      console.log('🔄 Starting daily reset at 00:00 UTC (new task system)...');
      
      const currentDate = new Date();
      const currentDateString = currentDate.toISOString().split('T')[0];
      const resetTime = new Date(currentDate);
      resetTime.setUTCHours(0, 0, 0, 0); // 00:00 UTC reset
      
      // Check if today's reset has already been performed
      const usersNeedingReset = await db.select({ id: users.id })
        .from(users)
        .where(sql`${users.lastResetDate} != ${currentDateString} OR ${users.lastResetDate} IS NULL`)
        .limit(1000);
      
      if (usersNeedingReset.length === 0) {
        console.log('🔄 Daily reset already completed for today');
        return;
      }
      
      console.log(`🔄 Resetting ${usersNeedingReset.length} users for ${currentDateString}`);
      
      // Reset all users' daily counters
      await db.update(users)
        .set({ 
          adsWatchedToday: 0,
          lastResetDate: currentDate,
          updatedAt: new Date(),
        })
        .where(sql`${users.lastResetDate} != ${currentDateString} OR ${users.lastResetDate} IS NULL`);
      
      console.log('✅ Daily reset completed successfully (new task system)');
      
    } catch (error) {
      console.error('❌ Error in daily reset (new task system):', error);
      throw error;
    }
  }

  // Check and perform daily reset (called every 5 minutes)
  async checkAndPerformDailyResetV2(): Promise<void> {
    try {
      const now = new Date();
      const currentHour = now.getUTCHours();
      const currentMinute = now.getUTCMinutes();
      
      // Run reset at 00:00-00:05 UTC to catch the reset window
      if (currentHour === 0 && currentMinute < 5) {
        await this.performDailyResetV2();
      }
    } catch (error) {
      console.error('❌ Error checking daily reset:', error);
      // Don't throw to avoid disrupting the interval
    }
  }

  // Get monthly leaderboard
  async getMonthlyLeaderboard(currentUserId?: string): Promise<any> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    
    const leaderboard = await db
      .select({
        id: users.id,
        username: users.username,
        firstName: users.firstName,
        totalEarned: sql<string>`COALESCE(SUM(${earnings.amount}), 0)`,
      })
      .from(users)
      .leftJoin(earnings, and(
        eq(users.id, earnings.userId),
        gte(earnings.createdAt, monthStart),
        sql`${earnings.source} <> 'withdrawal'`
      ))
      .where(eq(users.banned, false))
      .groupBy(users.id)
      .orderBy(desc(sql`COALESCE(SUM(${earnings.amount}), 0)`))
      .limit(100);

    let userRank = null;
    if (currentUserId) {
      const userIndex = leaderboard.findIndex(u => u.id === currentUserId);
      if (userIndex !== -1) {
        userRank = userIndex + 1;
      }
    }

    return {
      leaderboard: leaderboard.map((u, i) => ({
        ...u,
        rank: i + 1,
        displayName: u.username || u.firstName || 'Anonymous'
      })),
      userRank
    };
  }

  // Get valid (completed) referral count for a user
  async getValidReferralCount(userId: string): Promise<number> {
    const result = await db
      .select({ count: sql<number>`count(*)` })
      .from(referrals)
      .innerJoin(users, eq(referrals.refereeId, users.id))
      .where(and(
        eq(referrals.referrerId, userId),
        eq(referrals.status, 'completed'),
        eq(users.banned, false)
      ));
    
    return result[0]?.count || 0;
  }

  // Add  balance to user
  async addTONBalance(userId: string, amount: string, source: string, description: string): Promise<void> {
    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Invalid  amount');
      }

      // Get current  balance
      const [user] = await db
        .select({ tonBalance: users.tonBalance })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        throw new Error('User not found');
      }

      const currentUsdBalance = parseFloat(user.tonBalance || '0');
      const newUsdBalance = (currentUsdBalance + amountNum).toFixed(10);

      // Update user's  balance
      await db
        .update(users)
        .set({
          tonBalance: newUsdBalance,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Log the transaction
      await this.logTransaction({
        userId,
        amount: amount,
        type: 'credit',
        source: source,
        description: description,
        metadata: { rewardType: '' }
      });

      console.log(`✅ Added TON${amountNum}  to user ${userId}. New balance: TON${newUsdBalance}`);
    } catch (error) {
      console.error(`Error adding  balance:`, error);
      throw error;
    }
  }

  // Add BUG balance to user (CRITICAL FIX for referral earnings)
  async addBUGBalance(userId: string, amount: string, source: string, description: string): Promise<void> {
    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        throw new Error('Invalid BUG amount');
      }

      // Get current BUG balance
      const [user] = await db
        .select({ bugBalance: users.bugBalance })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        throw new Error('User not found');
      }

      const currentBugBalance = parseFloat(user.bugBalance || '0');
      const newBugBalance = (currentBugBalance + amountNum).toFixed(10);

      // Update user's BUG balance
      await db
        .update(users)
        .set({
          bugBalance: newBugBalance,
          updatedAt: new Date()
        })
        .where(eq(users.id, userId));

      // Log the transaction
      await this.logTransaction({
        userId,
        amount: amount,
        type: 'credit',
        source: source,
        description: description,
        metadata: { rewardType: 'BUG' }
      });

      console.log(`✅ Added ${amountNum} BUG to user ${userId}. New balance: ${newBugBalance}`);
    } catch (error) {
      console.error(`Error adding BUG balance:`, error);
      throw error;
    }
  }

  // Backfill BUG rewards for existing referrals (fix for users who earned before the update)
  async backfillExistingReferralBUGRewards(): Promise<void> {
    try {
      console.log('🔄 Starting backfill of BUG rewards for existing referrals...');
      
      // First, ensure columns exist
      try {
        await db.execute(sql`
          ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ton_reward_amount DECIMAL(30, 10) DEFAULT '0';
          ALTER TABLE referrals ADD COLUMN IF NOT EXISTS bug_reward_amount DECIMAL(30, 10) DEFAULT '0';
        `);
      } catch (error) {
        console.log('ℹ️ Referral columns already exist');
      }
      
      // Get all completed referrals that don't have bugRewardAmount set
      const referralsNeedingBugCredit = await db.execute(sql`
        SELECT id, referrer_id, status, ton_reward_amount, bug_reward_amount 
        FROM referrals 
        WHERE status = 'completed' AND (bug_reward_amount = '0' OR bug_reward_amount IS NULL)
        AND ton_reward_amount > 0
      `);

      const rows = referralsNeedingBugCredit.rows || [];
      console.log(`📊 Found ${rows.length} referrals needing BUG credit backfill`);

      for (const ref of rows) {
        try {
          // Parse  amount with strict validation
          const usdReward = ref.ton_reward_amount;
          if (!usdReward || usdReward === null) {
            console.log(`⏭️ Skipping referral ${ref.id} - no  reward amount stored`);
            continue;
          }

          const usdAmount = parseFloat(String(usdReward));
          if (isNaN(usdAmount) || usdAmount <= 0) {
            console.log(`⏭️ Skipping referral ${ref.id} - invalid  amount: ${usdReward}`);
            continue;
          }

          // Calculate BUG from  amount (50 BUG per )
          const bugAmount = usdAmount * 50;
          if (isNaN(bugAmount) || bugAmount <= 0) {
            console.log(`⏭️ Skipping referral ${ref.id} - calculated BUG amount is invalid: ${bugAmount}`);
            continue;
          }

          // Update referral record with BUG amount
          await db.execute(sql`
            UPDATE referrals 
            SET bug_reward_amount = ${bugAmount.toFixed(10)}
            WHERE id = ${ref.id}
          `);

          // Credit BUG to referrer's balance
          await this.addBUGBalance(
            String(ref.referrer_id),
            bugAmount.toFixed(10),
            'referral_backfill',
            `Backfilled BUG from referral reward (+${bugAmount.toFixed(2)} BUG)`
          );

          console.log(`✅ Backfilled ${bugAmount.toFixed(2)} BUG for referral ${ref.id} to user ${ref.referrer_id}`);
        } catch (error) {
          console.error(`⚠️ Failed to backfill referral ${ref.id}:`, error);
        }
      }

      console.log(`✅ Backfill of BUG rewards completed!`);
    } catch (error) {
      console.error('❌ Error during BUG rewards backfill:', error);
    }
  }

  async deductBalanceForWithdrawal(userId: string, amount: string, currency: string = ''): Promise<boolean> {
    try {
      const amountNum = parseFloat(amount);
      if (isNaN(amountNum) || amountNum <= 0) {
        console.error('Invalid deduction amount:', amount);
        return false;
      }

      // All withdrawals (TON, Stars, etc.) use tonBalance column; AXN uses walletBalance
      const [user] = await db
        .select({ tonBalance: users.tonBalance, walletBalance: users.walletBalance })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        console.error('User not found for balance deduction');
        return false;
      }

      if (currency === 'AXN') {
        const currentBalance = parseFloat(user.walletBalance?.toString() || '0');
        if (currentBalance < amountNum) {
          console.error(`Insufficient AXN walletBalance: ${currentBalance} < ${amountNum}`);
          return false;
        }
        const newBalance = Math.round(currentBalance - amountNum).toString();
        await db.update(users).set({ walletBalance: newBalance, updatedAt: new Date() }).where(eq(users.id, userId));
        return true;
      }

      const currentBalance = parseFloat(user.tonBalance || '0');
      if (currentBalance < amountNum) {
        console.error(`Insufficient TON balance: ${currentBalance} < ${amountNum}`);
        return false;
      }

      const newBalance = (currentBalance - amountNum).toFixed(10);
      await db.update(users).set({ tonBalance: newBalance, updatedAt: new Date() }).where(eq(users.id, userId));
      console.log(`💰 Deducted ${amountNum} TON from user ${userId}. New balance: ${newBalance}`);
      return true;
    } catch (error) {
      console.error('Error deducting balance for withdrawal:', error);
      return false;
    }
  }

  // ─── Machine Operations ───────────────────────────────────────
  async getUserMachines(userId: string): Promise<UserMachine[]> {
    return await db.select().from(userMachines).where(eq(userMachines.userId, userId)).orderBy(desc(userMachines.createdAt));
  }

  async purchaseMachine(userId: string, machineTypeId: string): Promise<{ success: boolean; message: string; machine?: UserMachine }> {
    const machineType = getMachineType(machineTypeId);
    if (!machineType) {
      return { success: false, message: 'Invalid machine type' };
    }

    const { pool } = await import('./db');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock the user row before checking the lifetime count. This serializes
      // purchases for a user, including the zero-existing-row case.
      await client.query(
        `SELECT id FROM users WHERE id = $1 FOR UPDATE`,
        [userId]
      );

      // A level is the lifetime number of purchases of this NFT type.
      // Lock the matching rows so two concurrent purchases cannot exceed level 10.
      const ownedResult = await client.query(
        `SELECT id FROM user_machines
         WHERE user_id = $1 AND machine_type = $2
         FOR UPDATE`,
        [userId, machineTypeId]
      );
      const currentLevel = ownedResult.rows.length;
      if (currentLevel >= 10) {
        await client.query('ROLLBACK');
        return {
          success: false,
          message: `${machineType.name} is already at Level 10, the maximum level.`,
        };
      }

      // Atomic deduction: only succeeds if balance >= price (no concurrent oversell)
      const deductResult = await client.query(
        `UPDATE users
         SET balance    = COALESCE(balance::numeric, 0) - $1,
             updated_at = NOW()
         WHERE id = $2
           AND COALESCE(balance::numeric, 0) >= $1
         RETURNING balance`,
        [machineType.priceGram, userId]
      );

      if (deductResult.rows.length === 0) {
        await client.query('ROLLBACK');
        // Fetch current balance only to give a helpful error message
        const balRow = await pool.query('SELECT balance FROM users WHERE id = $1', [userId]);
        const have = parseFloat(balRow.rows[0]?.balance || '0');
        return {
          success: false,
          message: `Insufficient GRAM balance. Need ${machineType.priceGram} GRAM, have ${have.toFixed(6)} GRAM`,
        };
      }

      const now = new Date();
      const expiresAt = new Date(now.getTime() + machineType.durationHours * 3_600_000);

      const machineResult = await client.query(
        `INSERT INTO user_machines
           (user_id, machine_type, purchased_at, expires_at, last_claimed_at, total_claimed_axn)
         VALUES ($1, $2, $3, $4, $3, 0)
         RETURNING *`,
        [userId, machineTypeId, now, expiresAt]
      );

      await client.query('COMMIT');

      // Map snake_case DB row → camelCase UserMachine shape
      const row = machineResult.rows[0];
      const machine: UserMachine = {
        id: row.id,
        userId: row.user_id,
        machineType: row.machine_type,
        purchasedAt: row.purchased_at,
        expiresAt: row.expires_at,
        lastClaimedAt: row.last_claimed_at,
        totalClaimedAxn: row.total_claimed_axn,
        createdAt: row.created_at,
      };

      return { success: true, message: `${machineType.name} purchased successfully!`, machine };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimMachineRewards(userId: string, machineType?: string): Promise<{ success: boolean; amount: number; message: string }> {
    const { pool } = await import('./db');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Lock all user machines for this session — prevents concurrent claims
      // If machineType is provided, only claim rewards from that NFT type
      const machinesResult = machineType
        ? await client.query(
            `SELECT * FROM user_machines WHERE user_id = $1 AND machine_type = $2 FOR UPDATE`,
            [userId, machineType]
          )
        : await client.query(
            `SELECT * FROM user_machines WHERE user_id = $1 FOR UPDATE`,
            [userId]
          );

      const machines = machinesResult.rows;
      if (machines.length === 0) {
        await client.query('ROLLBACK');
        return { success: false, amount: 0, message: 'No machines found' };
      }

      const now = new Date();
      let totalFlooredAxn = 0;
      // Track per-machine claimed amounts so each NFT's reward is recorded as
      // its own AXN transaction (source visible in the AXN history tab).
      const claimedByMachine: { machineId: string; machineTypeId: string; machineName: string; amount: number }[] = [];

      for (const row of machines) {
        const machineType = getMachineType(row.machine_type);
        if (!machineType) continue;

        const lastClaimed = new Date(row.last_claimed_at ?? row.purchased_at);
        const expiresAt   = new Date(row.expires_at);
        // Cap accumulation at expiry so expired machines stop earning
        const effectiveNow = now < expiresAt ? now : expiresAt;
        if (effectiveNow <= lastClaimed) continue;

        const elapsedHours = (effectiveNow.getTime() - lastClaimed.getTime()) / 3_600_000;
        const rawReward    = elapsedHours * machineType.hourlyAxn;
        const flooredReward = Math.floor(rawReward);

        if (flooredReward < 1) continue; // not a whole AXN yet — keep accumulating

        // Advance lastClaimedAt by exactly the time corresponding to the credited
        // whole AXN — fractional remainder stays in the unclaimed window for next claim
        const creditedHours  = flooredReward / machineType.hourlyAxn;
        const newLastClaimed = new Date(lastClaimed.getTime() + creditedHours * 3_600_000);
        const newTotalClaimed = parseFloat(row.total_claimed_axn ?? '0') + flooredReward;

        await client.query(
          `UPDATE user_machines
           SET last_claimed_at  = $1,
               total_claimed_axn = $2
           WHERE id = $3`,
          [newLastClaimed, newTotalClaimed.toFixed(4), row.id]
        );

        totalFlooredAxn += flooredReward;
        claimedByMachine.push({
          machineId: row.id,
          machineTypeId: machineType.id,
          machineName: machineType.name,
          amount: flooredReward,
        });
      }

      if (totalFlooredAxn < 1) {
        await client.query('ROLLBACK');
        return { success: false, amount: 0, message: 'No rewards to claim yet' };
      }

      // Atomic credit — no separate read needed
      await client.query(
        `UPDATE users
         SET wallet_balance = wallet_balance::numeric + $1,
             updated_at     = NOW()
         WHERE id = $2`,
        [totalFlooredAxn, userId]
      );

      // Record every claimed machine's reward as its own AXN transaction so it
      // shows up in the AXN / All transaction history tabs (source = NFT reward).
      for (const claim of claimedByMachine) {
        const earningResult = await client.query(
          `INSERT INTO earnings (user_id, amount, source, description)
           VALUES ($1, $2, 'nft_reward', $3)
           RETURNING id`,
          [userId, claim.amount, `${claim.machineName} NFT reward claim`],
        );
        await client.query(
          `INSERT INTO transactions (user_id, amount, type, source, description, metadata)
           VALUES ($1, $2, 'addition', 'nft_reward', $3,
                   jsonb_build_object('rewardType', 'AXN', 'machineId', $4, 'machineType', $5, 'earningId', $6))`,
          [
            userId,
            claim.amount,
            `${claim.machineName} farming reward claimed`,
            claim.machineId,
            claim.machineTypeId,
            earningResult.rows[0]?.id,
          ],
        );
      }

      await client.query('COMMIT');
      await this.checkAndGrantReferralMilestone(userId);
      return { success: true, amount: totalFlooredAxn, message: `Claimed ${totalFlooredAxn.toLocaleString()} AXN!` };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getMachineStats(userId: string): Promise<{
    totalMachines: number;
    activeMachines: number;
    hourlyAxn: number;
    dailyAxn: number;
    unclaimedAxn: number;
  }> {
    const machinesResult = await db.select().from(userMachines).where(eq(userMachines.userId, userId));

    const now = new Date();
    let hourlyAxn     = 0;
    let dailyAxn      = 0;
    let unclaimedAxn  = 0;
    let activeMachines = 0;

    for (const machine of machinesResult) {
      const machineType = getMachineType(machine.machineType);
      if (!machineType) continue;

      const expiresAt = new Date(machine.expiresAt);
      const isActive  = now < expiresAt;

      if (isActive) {
        activeMachines++;
        hourlyAxn += machineType.hourlyAxn;
        dailyAxn  += machineType.dailyAxn;
      }

      // Use same fractional-remainder logic as claimMachineRewards:
      // report floor(rawReward) so the displayed figure matches what would be credited
      const lastClaimed  = machine.lastClaimedAt ? new Date(machine.lastClaimedAt) : new Date(machine.purchasedAt!);
      const effectiveNow = now < expiresAt ? now : expiresAt;
      if (effectiveNow > lastClaimed) {
        const elapsedHours = (effectiveNow.getTime() - lastClaimed.getTime()) / 3_600_000;
        unclaimedAxn += Math.floor(elapsedHours * machineType.hourlyAxn);
      }
    }

    return {
      totalMachines: machinesResult.length,
      activeMachines,
      hourlyAxn:    Math.round(hourlyAxn * 100) / 100,
      dailyAxn:     Math.round(dailyAxn  * 100) / 100,
      unclaimedAxn,
    };
  }
}

export const storage = new DatabaseStorage();
