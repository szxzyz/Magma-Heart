import pkg from 'pg';
const { Client } = pkg;
import { db } from './db';
import { sql } from 'drizzle-orm';

type CurrencySource = 'legacy_cipher' | 'gram';

async function establishCurrencySource(): Promise<CurrencySource> {
  return db.transaction(async (tx) => {
    const existing = await tx.execute(sql`
      SELECT source_currency
      FROM currency_migration_state
      WHERE migration_key = 'axionet_currency_v1'
      FOR UPDATE
    `);
    if ((existing as any).rows?.length > 0) {
      const establishedSource = (existing as any).rows[0].source_currency as CurrencySource;
      const currentTables = await tx.execute(sql`
        SELECT
          to_regclass('public.cipher_deposits') IS NOT NULL AS has_cipher_deposits,
          to_regclass('public.gram_deposits') IS NOT NULL AS has_gram_deposits
      `);
      const current = (currentTables as any).rows?.[0];
      if (establishedSource === 'gram' && current?.has_cipher_deposits) {
        throw new Error(
          '[MIGRATION] Recorded GRAM state conflicts with surviving cipher_deposits; refusing startup.',
        );
      }
      if (establishedSource === 'legacy_cipher' && current?.has_cipher_deposits && current?.has_gram_deposits) {
        throw new Error(
          '[MIGRATION] Both legacy and GRAM deposit tables exist during conversion; refusing startup.',
        );
      }
      return establishedSource;
    }

    const signals = await tx.execute(sql`
      SELECT
        to_regclass('public.cipher_deposits') IS NOT NULL AS has_cipher_deposits,
        to_regclass('public.gram_deposits') IS NOT NULL AS has_gram_deposits,
        EXISTS (
          SELECT 1 FROM admin_settings
          WHERE setting_key = 'gram_currency_migration_v1'
        ) AS has_currency_marker,
        EXISTS (
          SELECT 1 FROM admin_settings
          WHERE setting_key IN (
            'gram_promo_conversion_v1',
            'gram_task_conversion_v1',
            'partner_reward_200_backfill'
          )
        ) AS has_partial_marker,
        (SELECT COUNT(*) FROM users) AS user_count
    `);
    const signal = (signals as any).rows[0];
    const hasCipherDeposits = Boolean(signal?.has_cipher_deposits);
    const hasGramDeposits = Boolean(signal?.has_gram_deposits);
    const hasCurrencyMarker = Boolean(signal?.has_currency_marker);
    const hasPartialMarker = Boolean(signal?.has_partial_marker);
    const userCount = Number(signal?.user_count || 0);

    let source: CurrencySource;
    if (hasCurrencyMarker && hasCipherDeposits) {
      throw new Error(
        '[MIGRATION] Currency marker conflicts with surviving cipher_deposits; refusing startup.',
      );
    } else if (hasCurrencyMarker) {
      // The prior guarded migration is authoritative: its marker means the
      // earning currency has already been converted to GRAM.
      source = 'gram';
    } else if (hasCipherDeposits && !hasGramDeposits) {
      // A surviving legacy deposit table is definitive evidence that the
      // earning values still need conversion, even if an older deployment
      // wrote one of the feature-specific markers first.
      source = 'legacy_cipher';
    } else if (!hasCipherDeposits && !hasGramDeposits && !hasPartialMarker && userCount === 0) {
      // A genuinely empty database has no legacy values to convert.
      source = 'gram';
    } else {
      throw new Error(
        '[MIGRATION] Ambiguous currency state. Refusing to mutate balances; ' +
        'set or reconcile the currency migration state before startup.',
      );
    }

    await tx.execute(sql`
      INSERT INTO currency_migration_state
        (migration_key, migration_version, source_currency, status, details)
      VALUES (
        'axionet_currency_v1',
        1,
        ${source},
        'established',
        ${JSON.stringify({
          hasCipherDeposits,
          hasGramDeposits,
          hasCurrencyMarker,
          hasPartialMarker,
          userCount,
        })}::jsonb
      )
    `);
    console.log(`✅ [MIGRATION] Currency source established as ${source}`);
    return source;
  });
}

export async function ensureDatabaseSchema(): Promise<void> {
  if (process.env.DATABASE_URL) {
    // Same reasoning as server/db.ts: Render's Postgres (and most managed
    // Postgres reached over a private network) uses a self-signed cert.
    const migrationSslConfig = process.env.DATABASE_URL?.includes('sslmode=disable')
      ? false
      : { rejectUnauthorized: false };
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: migrationSslConfig
    });
    try {
      await client.connect();
      console.log('✅ Database connection verified for migrations');
    } catch (err) {
      console.error('❌ Migration connection test failed:', err);
    } finally {
      await client.end();
    }
  }
  try {
    console.log('🔄 [MIGRATION] Ensuring all database tables exist...');

    // Do not drop legacy tables during application startup. They may still
    // contain data needed for a staged migration or rollback.
    console.log('✅ [MIGRATION] Preserving legacy tables for compatibility');

    // Enable pgcrypto extension for gen_random_uuid() support
    try {
      await db.execute(sql`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
      console.log('✅ [MIGRATION] pgcrypto extension enabled');
    } catch (error) {
      console.log('⚠️ [MIGRATION] pgcrypto extension already exists or not available');
    }
    
    // Create all essential tables with correct schema
    
    // Sessions table - CRITICAL for connect-pg-simple authentication
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS sessions (
        sid VARCHAR NOT NULL PRIMARY KEY,
        sess JSONB NOT NULL,
        expire TIMESTAMP NOT NULL
      )
    `);
    console.log('✅ [MIGRATION] Sessions table ensured');

    // Source detection runs before the full settings setup below, so ensure
    // this compatibility table exists before establishCurrencySource().
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR NOT NULL,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_by VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // This state table is deliberately separate from feature-specific markers.
    // It records the source currency before any value conversion can run.
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS currency_migration_state (
        migration_key VARCHAR PRIMARY KEY,
        migration_version INTEGER NOT NULL,
        source_currency VARCHAR NOT NULL,
        status VARCHAR NOT NULL,
        details JSONB,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Users table with full schema
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS users (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        telegram_id VARCHAR(20) UNIQUE,
        username VARCHAR,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        profile_image_url TEXT,
        personal_code TEXT,
        balance DECIMAL(30, 10) DEFAULT '0',
        withdraw_balance DECIMAL(30, 10),
        total_earnings DECIMAL(30, 10),
        total_earned DECIMAL(30, 10) DEFAULT '0',
        ads_watched INTEGER DEFAULT 0,
        daily_ads_watched INTEGER DEFAULT 0,
        ads_watched_today INTEGER DEFAULT 0,
        daily_earnings DECIMAL(12, 8),
        last_ad_watch TIMESTAMP,
        last_ad_date TIMESTAMP,
        current_streak INTEGER DEFAULT 0,
        last_streak_date TIMESTAMP,
        level INTEGER DEFAULT 1,
        referred_by VARCHAR,
        referral_code TEXT,
        flagged BOOLEAN DEFAULT false,
        flag_reason TEXT,
        banned BOOLEAN DEFAULT false,
        banned_reason TEXT,
        banned_at TIMESTAMP,
        device_id TEXT,
        device_fingerprint JSONB,
        is_primary_account BOOLEAN DEFAULT true,
        last_login_at TIMESTAMP,
        last_login_ip TEXT,
        last_login_device TEXT,
        last_login_user_agent TEXT,
        channel_visited BOOLEAN DEFAULT false,
        app_shared BOOLEAN DEFAULT false,
        friends_invited INTEGER DEFAULT 0,
        first_ad_watched BOOLEAN DEFAULT false,
        last_reset_date TIMESTAMP,
        ton_wallet_address TEXT,
        ton_wallet_comment TEXT,
        telegram_username_wallet TEXT,
        cwallet_id TEXT,
        wallet_updated_at TIMESTAMP,
        pending_referral_bonus DECIMAL(12, 8) DEFAULT '0',
        total_claimed_referral_bonus DECIMAL(12, 8) DEFAULT '0',
        ton_balance DECIMAL(30, 10) DEFAULT '0',
        usd_balance DECIMAL(30, 10) DEFAULT '0',
        pdz_balance DECIMAL(30, 10) DEFAULT '0',
        bug_balance DECIMAL(30, 10) DEFAULT '0',
        usdt_wallet_address TEXT,
        telegram_stars_username TEXT,
        task_share_completed_today BOOLEAN DEFAULT false,
        task_channel_completed_today BOOLEAN DEFAULT false,
        task_community_completed_today BOOLEAN DEFAULT false,
        task_checkin_completed_today BOOLEAN DEFAULT false,
        extra_ads_watched_today INTEGER DEFAULT 0,
        last_extra_ad_date TIMESTAMP,
        app_version TEXT,
        browser_fingerprint TEXT,
        registered_at TIMESTAMP DEFAULT NOW(),
        referrer_uid TEXT,
        is_channel_group_verified BOOLEAN DEFAULT false,
        last_membership_check TIMESTAMP,
        last_mining_claim TIMESTAMP DEFAULT NOW(),
        mining_rate DECIMAL(20, 8) DEFAULT '0.00001',
        active_plan_id VARCHAR,
        plan_expires_at TIMESTAMP,
        ad_section1_boost DECIMAL(20, 8) DEFAULT '0',
        ad_section2_boost DECIMAL(20, 8) DEFAULT '0',
        ad_section1_count INTEGER DEFAULT 0,
        ad_section2_count INTEGER DEFAULT 0,
        ton_app_balance decimal(30, 10) DEFAULT '0',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ [MIGRATION] Users table ensured with full schema');
    
    // Add missing columns to existing users table (for production databases)
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_reason TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS device_id TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS device_fingerprint JSONB`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_primary_account BOOLEAN DEFAULT true`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS channel_visited BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS app_shared BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS friends_invited INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_ad_watched BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reset_date TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_wallet_address TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_wallet_comment TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_username_wallet TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS cwallet_id TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_updated_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_referral_bonus DECIMAL(12, 8) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS total_claimed_referral_bonus DECIMAL(12, 8) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ton_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS usd_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pdz_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS bug_balance DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS usdt_wallet_address TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_stars_username TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_share_completed_today BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_channel_completed_today BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_community_completed_today BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS task_checkin_completed_today BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS extra_ads_watched_today INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_extra_ad_date TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mystery_box_date TIMESTAMP`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mystery_box_count INTEGER DEFAULT 0`);
      
      // Add auto-ban system columns
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS app_version TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS browser_fingerprint TEXT`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS registered_at TIMESTAMP DEFAULT NOW()`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referrer_uid TEXT`);
      
      // Add mandatory channel/group join verification columns
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_channel_group_verified BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_membership_check TIMESTAMP`);
      
      // Add mining fields
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_mining_claim TIMESTAMP DEFAULT NOW()`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mining_rate DECIMAL(20, 8) DEFAULT '0.00001'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS active_plan_id VARCHAR`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_expires_at TIMESTAMP`);
      
      // Add ad boost tracking columns
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_section1_boost DECIMAL(20, 8) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_section2_boost DECIMAL(20, 8) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_section1_count INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ad_section2_count INTEGER DEFAULT 0`);
      
      // Add referral mining boost column
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_mining_boost DECIMAL(20, 8) DEFAULT '0'`);
      
      // Alter existing balance columns to new precision (safely handle existing data)
      await db.execute(sql`ALTER TABLE users ALTER COLUMN balance TYPE DECIMAL(30, 10) USING balance::numeric`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN usd_balance TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN ton_balance TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN pdz_balance TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN total_earned TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN total_earnings TYPE DECIMAL(30, 10)`);
      await db.execute(sql`ALTER TABLE users ALTER COLUMN withdraw_balance TYPE DECIMAL(30, 10)`);
      
      console.log('✅ [MIGRATION] Missing user task and wallet columns added');
    } catch (error) {
      // Columns might already exist - this is fine
      console.log('ℹ️ [MIGRATION] User task and wallet columns already exist or cannot be added');
    }

    // Check and add ton_app_balance column
    try {
      const tonAppBalanceCheck = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'users' AND column_name = 'ton_app_balance'
      `);
      if (tonAppBalanceCheck.rows.length === 0) {
        console.log('🔄 [MIGRATION] Adding ton_app_balance column to users table...');
        await db.execute(sql`ALTER TABLE users ADD COLUMN ton_app_balance decimal(30, 10) DEFAULT '0'`);
        console.log('✅ [MIGRATION] ton_app_balance column added');
      }
    } catch (e) {
      console.warn('⚠️ [MIGRATION] Failed to ensure ton_app_balance column:', e);
    }

    // mining_boosts table removed (dropped in migration)
    
    // Ensure referral_code column exists and has proper constraints
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS referral_code TEXT`);
      
      // Backfill referral codes for users that don't have them
      await db.execute(sql`
        UPDATE users 
        SET referral_code = 'REF' || UPPER(SUBSTRING(MD5(RANDOM()::TEXT) FROM 1 FOR 8))
        WHERE referral_code IS NULL OR referral_code = ''
      `);
      
      // Create unique constraint if it doesn't exist
      await db.execute(sql`
        DO $$  
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'users_referral_code_unique'
          ) THEN
            ALTER TABLE users ADD CONSTRAINT users_referral_code_unique UNIQUE (referral_code);
          END IF;
        END $$ 
      `);
      
      console.log('✅ [MIGRATION] Referral code column and constraints ensured');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Referral code setup complete or already exists');
    }
    
    // Earnings table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS earnings (
        id INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(12, 8) NOT NULL,
        source VARCHAR NOT NULL,
        description TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Transactions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(12, 8) NOT NULL,
        type VARCHAR NOT NULL,
        source VARCHAR NOT NULL,
        description TEXT,
        metadata JSONB,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Establish the source before touching deposits or any balance-like value.
    // Existing markers/data are treated as evidence; ambiguous states fail
    // closed instead of guessing and risking a second 100,000x conversion.
    const currencySource = await establishCurrencySource();

    // GRAM deposits are credited only after exact on-chain verification.
    // Keep existing installs compatible by renaming the legacy table and
    // converting its integer earning units exactly once.
    if (currencySource === 'legacy_cipher') {
      await db.transaction(async (tx) => {
        const conversion = await tx.execute(sql`
          INSERT INTO currency_migration_state
            (migration_key, migration_version, source_currency, status, details)
          VALUES (
            'axionet_currency_deposits_v1',
            1,
            'legacy_cipher',
            'converting',
            '{"conversion":"cipher_deposits_to_gram_deposits"}'::jsonb
          )
          ON CONFLICT (migration_key) DO NOTHING
          RETURNING migration_key
        `);
        if ((conversion as any).rows?.length > 0) {
          await tx.execute(sql`
            ALTER TABLE cipher_deposits RENAME TO gram_deposits
          `);
          await tx.execute(sql`
            ALTER TABLE gram_deposits RENAME COLUMN cipher_amount TO gram_amount
          `);
          await tx.execute(sql`
            ALTER TABLE gram_deposits ALTER COLUMN gram_amount TYPE DECIMAL(30, 10)
          `);
          await tx.execute(sql`
            UPDATE gram_deposits SET gram_amount = gram_amount / 100000
          `);
          await tx.execute(sql`
            UPDATE currency_migration_state
            SET status = 'complete', updated_at = NOW()
            WHERE migration_key = 'axionet_currency_deposits_v1'
          `);
        }
      });
    }
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS gram_deposits (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        wallet_address VARCHAR NOT NULL,
        gram_amount DECIMAL(30, 10) NOT NULL,
        ton_amount_nano NUMERIC(40, 0) NOT NULL,
        payment_hash VARCHAR UNIQUE,
        status VARCHAR NOT NULL DEFAULT 'pending',
        expires_at TIMESTAMP NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        credited_at TIMESTAMP
      )
    `);
    await db.execute(sql`ALTER TABLE gram_deposits ADD COLUMN IF NOT EXISTS gram_amount DECIMAL(30, 10)`);
    await db.execute(sql`ALTER TABLE gram_deposits ADD COLUMN IF NOT EXISTS payment_hash VARCHAR`);
    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS gram_deposits_payment_hash_idx ON gram_deposits(payment_hash) WHERE payment_hash IS NOT NULL`);
    
    // Withdrawals table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        amount DECIMAL(12, 8) NOT NULL,
        status VARCHAR DEFAULT 'pending',
        method VARCHAR NOT NULL,
        details JSONB,
        comment TEXT,
        transaction_hash VARCHAR,
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Add comment column to existing withdrawals table if missing
    try {
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS comment TEXT`);
      console.log('✅ [MIGRATION] Comment column added to withdrawals table');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Comment column already exists in withdrawals table');
    }
    
    // Add deducted and refunded columns to prevent double deduction/refund bugs
    try {
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS deducted BOOLEAN DEFAULT false`);
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS refunded BOOLEAN DEFAULT false`);
      
      // For existing withdrawals created under OLD system (balance was deducted during approval, not submission):
      // - Approved/Completed ones: Mark as deducted=true (balance was already taken during approval)
      // - Rejected ones: Mark as deducted=false and refunded=false (balance was never taken, or was returned)
      // - Pending ones: Mark as deducted=false (balance will be deducted when approved with compatibility logic)
      
      await db.execute(sql`
        UPDATE withdrawals 
        SET deducted = true 
        WHERE status IN ('Approved', 'Successfull', 'paid') AND (deducted IS NULL OR deducted = false)
      `);
      
      await db.execute(sql`
        UPDATE withdrawals 
        SET deducted = false, refunded = false
        WHERE status = 'rejected' AND (deducted IS NULL OR refunded IS NULL)
      `);
      
      await db.execute(sql`
        UPDATE withdrawals 
        SET deducted = false, refunded = false
        WHERE status = 'pending' AND (deducted IS NULL OR refunded IS NULL)
      `);
      
      console.log('✅ [MIGRATION] Deducted and refunded columns added to withdrawals table with correct legacy states');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Deducted and refunded columns already exist in withdrawals table');
    }
    
    // Add rejection_reason column for admin rejection messages
    try {
      await db.execute(sql`ALTER TABLE withdrawals ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
      console.log('✅ [MIGRATION] Rejection reason column added to withdrawals table');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Rejection reason column already exists in withdrawals table');
    }

    // Fix withdrawals.amount precision — old numeric(12,8) overflows for AXN amounts > 9999
    try {
      await db.execute(sql`
        ALTER TABLE withdrawals
        ALTER COLUMN amount TYPE NUMERIC(30, 10)
        USING amount::NUMERIC(30, 10)
      `);
      console.log('✅ [MIGRATION] withdrawals.amount column precision fixed to NUMERIC(30,10)');
    } catch (error: any) {
      if (error?.message?.includes('already') || error?.code === '42P16') {
        console.log('ℹ️ [MIGRATION] withdrawals.amount column precision already correct');
      } else {
        console.log('ℹ️ [MIGRATION] withdrawals.amount precision migration note:', error?.message);
      }
    }

    // Fix earnings.amount precision — old numeric(12,8) overflows for AXN amounts > 9999
    try {
      await db.execute(sql`
        ALTER TABLE earnings
        ALTER COLUMN amount TYPE NUMERIC(30, 10)
        USING amount::NUMERIC(30, 10)
      `);
      console.log('✅ [MIGRATION] earnings.amount column precision fixed to NUMERIC(30,10)');
    } catch (error: any) {
      console.log('ℹ️ [MIGRATION] earnings.amount precision migration note:', error?.message);
    }

    // Fix transactions.amount precision — old numeric(12,8) overflows for AXN amounts > 9999
    try {
      await db.execute(sql`
        ALTER TABLE transactions
        ALTER COLUMN amount TYPE NUMERIC(30, 10)
        USING amount::NUMERIC(30, 10)
      `);
      console.log('✅ [MIGRATION] transactions.amount column precision fixed to NUMERIC(30,10)');
    } catch (error: any) {
      console.log('ℹ️ [MIGRATION] transactions.amount precision migration note:', error?.message);
    }

    // Fix pending_referral_bonus and total_claimed_referral_bonus precision
    try {
      await db.execute(sql`
        ALTER TABLE users
        ALTER COLUMN pending_referral_bonus TYPE NUMERIC(30, 10)
        USING pending_referral_bonus::NUMERIC(30, 10)
      `);
      await db.execute(sql`
        ALTER TABLE users
        ALTER COLUMN total_claimed_referral_bonus TYPE NUMERIC(30, 10)
        USING total_claimed_referral_bonus::NUMERIC(30, 10)
      `);
      await db.execute(sql`
        ALTER TABLE users
        ALTER COLUMN daily_earnings TYPE NUMERIC(30, 10)
        USING daily_earnings::NUMERIC(30, 10)
      `);
      console.log('✅ [MIGRATION] users bonus/earnings column precision fixed to NUMERIC(30,10)');
    } catch (error: any) {
      console.log('ℹ️ [MIGRATION] users bonus/earnings precision migration note:', error?.message);
    }
    
    // promotions and task_completions tables removed (dropped in migration)
    
    // User balances table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_balances (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR UNIQUE NOT NULL REFERENCES users(id),
        balance DECIMAL(30, 10) DEFAULT '0',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Referrals table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS referrals (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        referrer_id VARCHAR NOT NULL REFERENCES users(id),
        referee_id VARCHAR NOT NULL REFERENCES users(id),
        reward_amount DECIMAL(30, 10) DEFAULT '0.01',
        usd_reward_amount DECIMAL(30, 10) DEFAULT '0',
        ton_reward_amount DECIMAL(30, 10) DEFAULT '0',
        bug_reward_amount DECIMAL(30, 10) DEFAULT '0',
        status VARCHAR DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(referrer_id, referee_id)
      )
    `);
    
    // Add missing columns to referrals table
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          IF to_regclass('public.referrals') IS NOT NULL
             AND EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'referrals' AND column_name = 'referred_id'
             )
             AND NOT EXISTS (
               SELECT 1 FROM information_schema.columns
               WHERE table_name = 'referrals' AND column_name = 'referee_id'
             ) THEN
            ALTER TABLE referrals RENAME COLUMN referred_id TO referee_id;
          END IF;
        END $$;
      `);
      await db.execute(sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referee_id VARCHAR`);
      await db.execute(sql`
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'referrals' AND column_name = 'referred_id'
          ) THEN
            UPDATE referrals
            SET referee_id = COALESCE(referee_id, referred_id)
            WHERE referee_id IS NULL;
          END IF;
        END $$;
      `);
      await db.execute(sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS usd_reward_amount DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS ton_reward_amount DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS bug_reward_amount DECIMAL(30, 10) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
      await db.execute(sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS referral_reward_granted BOOLEAN DEFAULT FALSE`);
      await db.execute(sql`ALTER TABLE referrals ADD COLUMN IF NOT EXISTS deposit_commission_earned DECIMAL(30, 10) DEFAULT '0'`);
      console.log('✅ [MIGRATION] Referral reward columns ensured');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] Referral reward columns already exist');
    }
    
    // referral_commissions, promo_codes, promo_code_usage, daily_tasks removed (dropped in migration)
    
    // Admin settings table - for configurable app parameters
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS admin_settings (
        id SERIAL PRIMARY KEY,
        setting_key VARCHAR NOT NULL,
        setting_value TEXT NOT NULL,
        description TEXT,
        updated_by VARCHAR,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    
    // Safely add unique constraint on setting_key after removing duplicates
    try {
      // Remove duplicate entries, keeping the one with the highest ID (most recent)
      await db.execute(sql`
        DELETE FROM admin_settings a
        USING admin_settings b
        WHERE a.id < b.id
        AND a.setting_key = b.setting_key
      `);
      
      // Add unique constraint if it doesn't exist
      await db.execute(sql`
        DO $$  
        BEGIN 
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint 
            WHERE conname = 'admin_settings_setting_key_unique'
          ) THEN
            ALTER TABLE admin_settings ADD CONSTRAINT admin_settings_setting_key_unique UNIQUE (setting_key);
          END IF;
        END $$ 
      `);
      
      console.log('✅ [MIGRATION] admin_settings unique constraint ensured');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] admin_settings unique constraint already exists or cannot be added');
    }

    // Convert the former integer earning currency to GRAM exactly once.
    // AXN farming/withdrawal records remain in AXN and are intentionally
    // excluded from this conversion.
    if (currencySource === 'legacy_cipher') {
      await db.transaction(async (tx) => {
        const conversion = await tx.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES ('gram_currency_migration_v1', 'done', 'Converted legacy earning balances and GRAM ledger values')
          ON CONFLICT (setting_key) DO NOTHING
          RETURNING setting_key
        `);
        if ((conversion as any).rows?.length > 0) {
          await tx.execute(sql`
            ALTER TABLE users ALTER COLUMN balance TYPE NUMERIC(30, 10)
              USING COALESCE(balance::numeric, 0) / 100000
          `);
          await tx.execute(sql`
            ALTER TABLE users ALTER COLUMN total_earned TYPE NUMERIC(30, 10)
              USING COALESCE(total_earned::numeric, 0) / 100000
          `);
          await tx.execute(sql`
            ALTER TABLE users ALTER COLUMN total_earnings TYPE NUMERIC(30, 10)
              USING COALESCE(total_earnings::numeric, 0) / 100000
          `);
          await tx.execute(sql`
            ALTER TABLE user_balances ALTER COLUMN balance TYPE NUMERIC(30, 10)
              USING COALESCE(balance::numeric, 0) / 100000
          `);
          await tx.execute(sql`
            UPDATE earnings
            SET amount = amount / 100000
            WHERE source NOT IN ('nft_reward', 'withdrawal', 'axn_withdrawal', 'ton_withdrawal')
          `);
          await tx.execute(sql`
            UPDATE transactions
            SET amount = amount / 100000
            WHERE source NOT IN ('nft_reward', 'withdrawal', 'axn_withdrawal', 'ton_withdrawal')
          `);
          await tx.execute(sql`
            UPDATE referrals
            SET reward_amount = reward_amount / 100000,
                deposit_commission_earned = deposit_commission_earned / 100000
            WHERE reward_amount IS NOT NULL OR deposit_commission_earned IS NOT NULL
          `);
        }
      });
    }
    
    // Initialize default admin settings if they don't exist
    await db.execute(sql`
      INSERT INTO admin_settings (setting_key, setting_value, description)
      VALUES 
        ('daily_ad_limit', '50', 'Maximum number of ads a user can watch per day'),
        ('ad_reward_hrum', '1000', 'Hrum reward amount per ad watched'),
        ('ad_reward_ton', '0.00010000', '$reward amount per ad watched'),
        ('withdrawal_currency', 'TON', 'Currency used for withdrawal displays ($or Hrum)')
      ON CONFLICT (setting_key) DO NOTHING
    `);
    
    // advertiser_tasks, deposits, task_clicks removed (dropped in migration)
    
    // Ban logs table for auto-ban system
    console.log('🔄 [MIGRATION] Creating ban_logs table...');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ban_logs (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        banned_user_id VARCHAR NOT NULL REFERENCES users(id),
        banned_user_uid TEXT,
        ip TEXT,
        device_id TEXT,
        user_agent TEXT,
        fingerprint JSONB,
        reason TEXT NOT NULL,
        ban_type VARCHAR NOT NULL,
        banned_by VARCHAR,
        related_account_ids JSONB,
        referrer_uid TEXT,
        telegram_id TEXT,
        app_version TEXT,
        browser_fingerprint TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ [MIGRATION] ban_logs table created');
    
    // Add missing columns to ban_logs if table already exists
    try {
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS referrer_uid TEXT`);
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS telegram_id TEXT`);
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS app_version TEXT`);
      await db.execute(sql`ALTER TABLE ban_logs ADD COLUMN IF NOT EXISTS browser_fingerprint TEXT`);
      console.log('✅ [MIGRATION] ban_logs columns updated');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] ban_logs columns already exist');
    }
    
    // daily_missions removed (dropped in migration)
    
    // Create index for ban logs performance
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_user_id ON ban_logs(banned_user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_device_id ON ban_logs(device_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_ip ON ban_logs(ip)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_ban_logs_created_at ON ban_logs(created_at)`);
    
    // promotion_claims removed (dropped in migration)
    
    // Blocked countries table for geo-restriction
    console.log('🔄 [MIGRATION] Creating blocked_countries table...');
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS blocked_countries (
        id SERIAL PRIMARY KEY,
        country_code VARCHAR(2) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ [MIGRATION] blocked_countries table created');
    
    // user_referral_tasks removed (dropped in migration)
    
    // Create index for blocked countries
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_blocked_countries_code ON blocked_countries(country_code)`);

    // Add ban type columns to users table if missing
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_type VARCHAR(20) DEFAULT 'system'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_ban_reason TEXT`);
      console.log('✅ [MIGRATION] ban_type and admin_ban_reason columns ensured on users table');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] ban_type/admin_ban_reason columns already exist or could not be added');
    }

    // Create indexes for performance
    await db.execute(sql`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON sessions(expire)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_users_telegram_id ON users(telegram_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_earnings_user_id ON earnings(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON withdrawals(user_id)`);
    // promotions/task_completions indexes removed (tables dropped)
    
    // Add indexes for referral performance
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_referrals_referrer_id ON referrals(referrer_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_referrals_referee_id ON referrals(referee_id)`);

    // User farming table — simple 2-hour farming sessions
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_farming (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR UNIQUE NOT NULL REFERENCES users(id),
        started_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_user_farming_user_id ON user_farming(user_id)`);

    // Ensure the unique constraint exists (safe, non-interactive — unlike
    // `drizzle-kit push`, which prompts interactively and cannot run
    // during an automated Render deploy).
    try {
      await db.execute(sql`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint
            WHERE conname = 'user_farming_user_id_unique'
          ) THEN
            ALTER TABLE user_farming ADD CONSTRAINT user_farming_user_id_unique UNIQUE (user_id);
          END IF;
        END $$
      `);
      console.log('✅ [MIGRATION] user_farming_user_id_unique constraint ensured');
    } catch (error) {
      console.log('ℹ️ [MIGRATION] user_farming_user_id_unique constraint already exists or cannot be added:', error);
    }

    console.log('✅ [MIGRATION] user_farming table ensured');

    // Mission system columns
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_last_date TIMESTAMP`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_login_claimed BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_announcement_claimed BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_watch_ad_claimed BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_share_app_claimed BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_app_time_claimed BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_community_claimed BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_bonus_claimed BOOLEAN DEFAULT FALSE`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_app_time_seconds INTEGER DEFAULT 0`);
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mission_invite_claimed BOOLEAN DEFAULT FALSE`);
    console.log('✅ [MIGRATION] Mission system columns ensured');

    // Key system columns
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS key_balance INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS tasks_completed INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_checkin_claimed BOOLEAN DEFAULT FALSE`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_invite_claimed BOOLEAN DEFAULT FALSE`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_updates_claimed BOOLEAN DEFAULT FALSE`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS daily_tasks_date TIMESTAMP`);
      console.log('✅ [MIGRATION] Key system columns ensured');
    } catch (e) {
      console.log('ℹ️ [MIGRATION] Key system columns already exist');
    }

    // Bounty tasks table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bounty_tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        reward_axn NUMERIC(30, 10) NOT NULL DEFAULT 0.0005,
        key_cost INTEGER NOT NULL DEFAULT 5,
        url TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ [MIGRATION] bounty_tasks table ensured');

    // One-time backfill: standardize legacy partner task rewards at 0.002
    // GRAM. Never run this independent of the established source currency.
    if (currencySource === 'legacy_cipher') {
      try {
        await db.transaction(async (tx) => {
          const backfillFlag = await tx.execute(sql`
            INSERT INTO admin_settings (setting_key, setting_value, description)
            VALUES ('partner_reward_200_backfill', 'done', 'One-time backfill of partner task rewards to 0.002 GRAM')
            ON CONFLICT (setting_key) DO NOTHING
            RETURNING setting_key
          `);
          if ((backfillFlag as any).rows?.length > 0) {
            await tx.execute(sql`UPDATE bounty_tasks SET reward_axn = 0.002`);
            console.log('✅ [MIGRATION] Partner task rewards backfilled to 0.002 GRAM (one-time)');
          }
        });
      } catch (e) {
        console.warn('⚠️ [MIGRATION] Partner reward backfill skipped:', e);
      }
    } else {
      const partnerState = await db.execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM admin_settings
            WHERE setting_key = 'partner_reward_200_backfill'
          ) AS has_marker,
          EXISTS (
            SELECT 1 FROM bounty_tasks
            WHERE reward_axn::numeric >= 1
          ) AS has_legacy_values
      `);
      const partnerRow = (partnerState as any).rows?.[0];
      if (!partnerRow?.has_marker && partnerRow?.has_legacy_values) {
        throw new Error(
          '[MIGRATION] GRAM source has unmarked legacy partner-task values; refusing conversion.',
        );
      }
    }

    // Bounty task completions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS bounty_task_completions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        task_id INTEGER NOT NULL,
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, task_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_btc_user ON bounty_task_completions(user_id)`);
    console.log('✅ [MIGRATION] bounty_task_completions table ensured');

    // Season 2 Migration columns
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS mining_balance DECIMAL(20, 0) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_balance DECIMAL(20, 0) DEFAULT '0'`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS migration_completed BOOLEAN DEFAULT FALSE`);
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS migration_intro_seen BOOLEAN DEFAULT FALSE`);
      console.log('✅ [MIGRATION] Season 2 compatibility columns ensured');
    } catch (e) {
      console.log('ℹ️ [MIGRATION] Season 2 migration columns already exist');
    }

    // User Ad Watches table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_ad_watches (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        ad_slot INTEGER NOT NULL,
        watched_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, ad_slot)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_user_ad_watches_user ON user_ad_watches(user_id)`);
    await db.execute(sql`ALTER TABLE user_ad_watches ADD COLUMN IF NOT EXISTS last_watched_at TIMESTAMP`);
    console.log('✅ [MIGRATION] user_ad_watches table ensured');

    // Promo Codes tables
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_codes (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(60) UNIQUE NOT NULL,
        reward_amount NUMERIC(20,2) NOT NULL DEFAULT 0,
        reward_type VARCHAR(10) DEFAULT 'AXN',
        usage_limit INTEGER,
        per_user_limit INTEGER DEFAULT 1,
        use_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT TRUE,
        expires_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Defensive: if promo_codes already existed from an older schema (e.g. missing/renamed
    // the code column), CREATE TABLE IF NOT EXISTS above is a no-op, so ensure columns exist here.
    try {
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS code VARCHAR(60)`);
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS reward_amount NUMERIC(20,2) NOT NULL DEFAULT 0`);
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS reward_type VARCHAR(10) DEFAULT 'AXN'`);
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS usage_limit INTEGER`);
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS per_user_limit INTEGER DEFAULT 1`);
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS use_count INTEGER DEFAULT 0`);
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE`);
      await db.execute(sql`ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMP`);
      // Backfill any NULL codes so the unique index/constraint can be created safely
      await db.execute(sql`UPDATE promo_codes SET code = 'LEGACY' || id WHERE code IS NULL`);
      console.log('✅ [MIGRATION] promo_codes columns ensured (legacy table compatibility)');
    } catch (e) {
      console.log('ℹ️ [MIGRATION] promo_codes column backfill note:', e);
    }
    if (currencySource === 'legacy_cipher') {
      await db.transaction(async (tx) => {
        const conversionFlag = await tx.execute(sql`
          INSERT INTO admin_settings (setting_key, setting_value, description)
          VALUES ('gram_promo_conversion_v1', 'done', 'Converted legacy GRAM promo code values')
          ON CONFLICT (setting_key) DO NOTHING
          RETURNING setting_key
        `);
        if ((conversionFlag as any).rows?.length > 0) {
          await tx.execute(sql`
            UPDATE promo_codes
            SET reward_amount = reward_amount / 100000
            WHERE UPPER(COALESCE(reward_type, '')) IN ('GRAM', 'CIPHER')
          `);
          await tx.execute(sql`
            UPDATE promo_codes
            SET reward_type = 'GRAM'
            WHERE UPPER(COALESCE(reward_type, '')) = 'CIPHER'
          `);
        }
      });
    } else {
      const promoState = await db.execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM admin_settings
            WHERE setting_key = 'gram_promo_conversion_v1'
          ) AS has_marker,
          EXISTS (
            SELECT 1 FROM promo_codes
            WHERE UPPER(COALESCE(reward_type, '')) = 'CIPHER'
          ) AS has_legacy_values
      `);
      const promoRow = (promoState as any).rows?.[0];
      if (!promoRow?.has_marker && promoRow?.has_legacy_values) {
        throw new Error(
          '[MIGRATION] GRAM source has unmarked legacy promo values; refusing conversion.',
        );
      }
    }
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_promo_codes_code ON promo_codes(code)`);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS promo_code_usage (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(60) NOT NULL,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        used_at TIMESTAMP DEFAULT NOW()
      )
    `);
    // Defensive: same legacy-table issue as promo_codes above — if promo_code_usage
    // already existed (e.g. old schema with promo_code_id instead of code), ensure column exists.
    try {
      await db.execute(sql`ALTER TABLE promo_code_usage ADD COLUMN IF NOT EXISTS code VARCHAR(60)`);
      await db.execute(sql`UPDATE promo_code_usage SET code = 'LEGACY' || id WHERE code IS NULL`);
      await db.execute(sql`ALTER TABLE promo_code_usage ALTER COLUMN code SET NOT NULL`);
      console.log('✅ [MIGRATION] promo_code_usage columns ensured (legacy table compatibility)');
    } catch (e) {
      console.log('ℹ️ [MIGRATION] promo_code_usage column backfill note:', e);
    }
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_promo_usage_code_user ON promo_code_usage(code, user_id)`);
    console.log('✅ [MIGRATION] promo_codes and promo_code_usage tables ensured');

    // AXN Name Task column
    try {
      await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS axn_name_reward_claimed BOOLEAN DEFAULT FALSE`);
      console.log('✅ [MIGRATION] axn_name_reward_claimed column ensured');
    } catch (e) {
      console.log('⚠️ [MIGRATION] axn_name_reward_claimed column note:', e);
    }

    // AXN Name Task daily reset column
    await db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS axn_name_last_claimed_at TIMESTAMP`);

    // User Tasks table (user-created promotional tasks)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_tasks (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        link TEXT NOT NULL,
        category VARCHAR(20) NOT NULL DEFAULT 'channel_group',
        impressions INTEGER NOT NULL DEFAULT 10,
        reward_per_completion NUMERIC(30, 10) NOT NULL DEFAULT 0.0001,
        total_cost NUMERIC(20,4) NOT NULL DEFAULT 0,
        completed_count INTEGER NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_user_tasks_user ON user_tasks(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_user_tasks_status ON user_tasks(status)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_user_tasks_category ON user_tasks(category)`);

    // Convert legacy user-created task prices/rewards exactly once. The
    // columns are retained for schema compatibility, but their values are
    // decimal GRAM at runtime.
    if (currencySource === 'legacy_cipher') {
      try {
        await db.transaction(async (tx) => {
          const taskConversion = await tx.execute(sql`
            INSERT INTO admin_settings (setting_key, setting_value, description)
            VALUES ('gram_task_conversion_v1', 'done', 'Converted legacy user and partner task values to GRAM')
            ON CONFLICT (setting_key) DO NOTHING
            RETURNING setting_key
          `);
          if ((taskConversion as any).rows?.length > 0) {
            await tx.execute(sql`
              UPDATE user_tasks
              SET reward_per_completion = reward_per_completion / 100000,
                  total_cost = total_cost / 100000
              WHERE reward_per_completion >= 1 OR total_cost >= 1
            `);
            await tx.execute(sql`
              UPDATE bounty_tasks
              SET reward_axn = reward_axn / 100000
              WHERE reward_axn >= 1
            `);
          }
        });
      } catch (e) {
        console.warn('⚠️ [MIGRATION] Task GRAM conversion skipped:', e);
      }
    } else {
      const taskState = await db.execute(sql`
        SELECT
          EXISTS (
            SELECT 1 FROM admin_settings
            WHERE setting_key = 'gram_task_conversion_v1'
          ) AS has_marker,
          EXISTS (
            SELECT 1 FROM user_tasks
            WHERE reward_per_completion::numeric >= 1
               OR total_cost::numeric >= 1
          ) OR EXISTS (
            SELECT 1 FROM bounty_tasks
            WHERE reward_axn::numeric >= 1
          ) AS has_legacy_values
      `);
      const taskRow = (taskState as any).rows?.[0];
      if (!taskRow?.has_marker && taskRow?.has_legacy_values) {
        throw new Error(
          '[MIGRATION] GRAM source has unmarked legacy task values; refusing conversion.',
        );
      }
    }

    // User Task Completions table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_task_completions (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR NOT NULL REFERENCES users(id),
        task_id INTEGER NOT NULL,
        completed_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(user_id, task_id)
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_utc_user ON user_task_completions(user_id)`);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_utc_task ON user_task_completions(task_id)`);
    console.log('✅ [MIGRATION] user_tasks and user_task_completions tables ensured');

    // Bounty tasks: add reward_per_user and total_impressions columns for admin control
    await db.execute(sql`ALTER TABLE bounty_tasks ADD COLUMN IF NOT EXISTS total_impressions INTEGER DEFAULT 0`);
    await db.execute(sql`ALTER TABLE bounty_tasks ADD COLUMN IF NOT EXISTS completed_count INTEGER DEFAULT 0`);

    // Bounty tasks: add is_paused column for pause/resume support
    await db.execute(sql`ALTER TABLE bounty_tasks ADD COLUMN IF NOT EXISTS is_paused BOOLEAN DEFAULT FALSE`);

    // Existing partner tasks are preserved during startup. Admins can remove
    // individual tasks explicitly through the admin API.

    // User machines table (passive GRAM/AXN earning machines)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS user_machines (
        id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id VARCHAR NOT NULL REFERENCES users(id),
        machine_type VARCHAR(50) NOT NULL,
        purchased_at TIMESTAMP DEFAULT NOW(),
        expires_at TIMESTAMP NOT NULL,
        last_claimed_at TIMESTAMP DEFAULT NOW(),
        total_claimed_axn NUMERIC(30,4) DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_user_machines_user_id ON user_machines(user_id)`);
    console.log('✅ [MIGRATION] user_machines table ensured');

    console.log('✅ [MIGRATION] All tables and indexes created successfully');
    
  } catch (error) {
    console.error('❌ [MIGRATION] Critical error ensuring database schema:', error);
    throw new Error(`Database migration failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}