import { sql } from 'drizzle-orm';
import {
  index,
  jsonb,
  pgTable,
  timestamp,
  varchar,
  decimal,
  integer,
  boolean,
  text,
  serial,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Session table
export const sessions = pgTable(
  "sessions",
  {
    sid: varchar("sid").primaryKey(),
    sess: jsonb("sess").notNull(),
    expire: timestamp("expire").notNull(),
  },
  (table) => [index("IDX_session_expire").on(table.expire)],
);

// Users table
export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  telegram_id: varchar("telegram_id", { length: 20 }).unique(),
  username: varchar("username"),
  email: text("email"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  personalCode: text("personal_code"),
  balance: decimal("balance", { precision: 20, scale: 0 }).default("0"),
  tonBalance: decimal("ton_balance", { precision: 30, scale: 10 }).default("0"),
  tonAppBalance: decimal("ton_app_balance", { precision: 30, scale: 10 }).default("0"),
  adsWatched: integer("ads_watched").default(0),
  dailyAdsWatched: integer("daily_ads_watched").default(0),
  adsWatchedToday: integer("ads_watched_today").default(0),
  dailyEarnings: decimal("daily_earnings", { precision: 30, scale: 10 }),
  lastAdWatch: timestamp("last_ad_watch"),
  lastAdDate: timestamp("last_ad_date"),
  currentStreak: integer("current_streak").default(0),
  lastStreakDate: timestamp("last_streak_date"),
  level: integer("level").default(1),
  referredBy: varchar("referred_by"),
  referralCode: text("referral_code"),
  friendsInvited: integer("friends_invited"),
  firstAdWatched: boolean("first_ad_watched").default(false),
  flagged: boolean("flagged").default(false),
  flagReason: text("flag_reason"),
  banned: boolean("banned").default(false),
  bannedReason: text("banned_reason"),
  bannedAt: timestamp("banned_at"),
  banType: varchar("ban_type", { length: 20 }).default("system"),
  adminBanReason: text("admin_ban_reason"),
  deviceId: text("device_id"),
  deviceFingerprint: jsonb("device_fingerprint"),
  isPrimaryAccount: boolean("is_primary_account").default(true),
  lastLoginAt: timestamp("last_login_at"),
  lastLoginIp: text("last_login_ip"),
  lastLoginDevice: text("last_login_device"),
  lastLoginUserAgent: text("last_login_user_agent"),
  channelVisited: boolean("channel_visited").default(false),
  appShared: boolean("app_shared").default(false),
  lastResetDate: timestamp("last_reset_date"),
  axnNameRewardClaimed: boolean("axn_name_reward_claimed").default(false),
  taskShareCompletedToday: boolean("task_share_completed_today").default(false),
  taskChannelCompletedToday: boolean("task_channel_completed_today").default(false),
  taskCommunityCompletedToday: boolean("task_community_completed_today").default(false),
  taskCheckinCompletedToday: boolean("task_checkin_completed_today").default(false),
  extraAdsWatchedToday: integer("extra_ads_watched_today").default(0),
  lastExtraAdDate: timestamp("last_extra_ad_date"),
  tonWalletAddress: text("ton_wallet_address"),
  tonWalletComment: text("ton_wallet_comment"),
  usdtWalletAddress: text("usdt_wallet_address"),
  telegramStarsUsername: text("telegram_stars_username"),
  telegramUsername: text("telegram_username_wallet"),
  cwalletId: text("cwallet_id"),
  walletUpdatedAt: timestamp("wallet_updated_at"),
  pendingReferralBonus: decimal("pending_referral_bonus", { precision: 30, scale: 10 }).default("0"),
  totalClaimedReferralBonus: decimal("total_claimed_referral_bonus", { precision: 30, scale: 10 }).default("0"),
  usdBalance: decimal("usd_balance", { precision: 30, scale: 10 }).default("0"),
  pdzBalance: decimal("pdz_balance", { precision: 30, scale: 10 }).default("0"),
  bugBalance: decimal("bug_balance", { precision: 30, scale: 10 }).default("0"),
  withdraw_balance: decimal("withdraw_balance", { precision: 30, scale: 10 }).default("0"),
  total_earnings: decimal("total_earnings", { precision: 30, scale: 10 }).default("0"),
  total_earned: decimal("total_earned", { precision: 30, scale: 10 }).default("0"),
  appVersion: text("app_version"),
  browserFingerprint: text("browser_fingerprint"),
  registeredAt: timestamp("registered_at").defaultNow(),
  referrerUid: text("referrer_uid"),
  isChannelGroupVerified: boolean("is_channel_group_verified").default(false),
  lastMembershipCheck: timestamp("last_membership_check"),
  adSection1Boost: decimal("ad_section1_boost", { precision: 20, scale: 8 }).default("0"),
  adSection2Boost: decimal("ad_section2_boost", { precision: 20, scale: 8 }).default("0"),
  adSection1Count: integer("ad_section1_count").default(0),
  adSection2Count: integer("ad_section2_count").default(0),
  lastMiningClaim: timestamp("last_mining_claim").defaultNow(),
  miningRate: decimal("mining_rate", { precision: 20, scale: 8 }).default("0.00001"),
  referralMiningBoost: decimal("referral_mining_boost", { precision: 20, scale: 8 }).default("0"),
  activePlanId: varchar("active_plan_id"),
  planExpiresAt: timestamp("plan_expires_at"),
  missionLastDate: timestamp("mission_last_date"),
  missionLoginClaimed: boolean("mission_login_claimed").default(false),
  missionAnnouncementClaimed: boolean("mission_announcement_claimed").default(false),
  missionWatchAdClaimed: boolean("mission_watch_ad_claimed").default(false),
  missionShareAppClaimed: boolean("mission_share_app_claimed").default(false),
  missionAppTimeClaimed: boolean("mission_app_time_claimed").default(false),
  missionCommunityClaimed: boolean("mission_community_claimed").default(false),
  missionBonusClaimed: boolean("mission_bonus_claimed").default(false),
  missionAppTimeSeconds: integer("mission_app_time_seconds").default(0),
  missionInviteClaimed: boolean("mission_invite_claimed").default(false),
  keyBalance: integer("key_balance").default(0),
  tasksCompleted: integer("tasks_completed").default(0),
  dailyCheckinClaimed: boolean("daily_checkin_claimed").default(false),
  dailyInviteClaimed: boolean("daily_invite_claimed").default(false),
  dailyUpdatesClaimed: boolean("daily_updates_claimed").default(false),
  dailyTasksDate: timestamp("daily_tasks_date"),
  mysteryBoxDate: timestamp("mystery_box_date"),
  miningBalance: decimal("mining_balance", { precision: 20, scale: 0 }).default("0"),
  walletBalance: decimal("wallet_balance", { precision: 20, scale: 0 }).default("0"),
  migrationCompleted: boolean("migration_completed").default(false),
  migrationIntroSeen: boolean("migration_intro_seen").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// User Ad Watches — per-slot tracking
export const userAdWatches = pgTable("user_ad_watches", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  adSlot: integer("ad_slot").notNull(),
  watchedCount: integer("watched_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Earnings table
export const earnings = pgTable("earnings", {
  id: integer("id").primaryKey().generatedAlwaysAsIdentity(),
  userId: varchar("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 30, scale: 10 }).notNull(),
  source: varchar("source").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Transactions table
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 30, scale: 10 }).notNull(),
  type: varchar("type").notNull(),
  source: varchar("source").notNull(),
  description: text("description"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Withdrawals table
export const withdrawals = pgTable("withdrawals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  amount: decimal("amount", { precision: 30, scale: 10 }).notNull(),
  status: varchar("status").default('pending'),
  method: varchar("method").notNull(),
  details: jsonb("details"),
  comment: text("comment"),
  transactionHash: varchar("transaction_hash"),
  adminNotes: text("admin_notes"),
  rejectionReason: text("rejection_reason"),
  deducted: boolean("deducted").default(false),
  refunded: boolean("refunded").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Referrals table
export const referrals = pgTable("referrals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  referrerId: varchar("referrer_id").references(() => users.id).notNull(),
  refereeId: varchar("referee_id").references(() => users.id).notNull(),
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).default("1000"),
  usd_reward_amount: decimal("usd_reward_amount", { precision: 30, scale: 10 }).default("0"),
  tonRewardAmount: decimal("ton_reward_amount", { precision: 30, scale: 10 }).default("0"),
  bugRewardAmount: decimal("bug_reward_amount", { precision: 30, scale: 10 }).default("0"),
  status: varchar("status").default('pending'),
  createdAt: timestamp("created_at").defaultNow(),
});

// User balances table
export const userBalances = pgTable("user_balances", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").unique().notNull().references(() => users.id),
  balance: decimal("balance", { precision: 20, scale: 8 }).default("0"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Admin settings table
export const adminSettings = pgTable("admin_settings", {
  id: serial("id").primaryKey(),
  settingKey: varchar("setting_key").notNull().unique(),
  settingValue: text("setting_value").notNull(),
  description: text("description"),
  updatedBy: varchar("updated_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Ban logs table
export const banLogs = pgTable("ban_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  bannedUserId: varchar("banned_user_id").references(() => users.id).notNull(),
  bannedUserUid: text("banned_user_uid"),
  ip: text("ip"),
  deviceId: text("device_id"),
  userAgent: text("user_agent"),
  fingerprint: jsonb("fingerprint"),
  reason: text("reason").notNull(),
  banType: varchar("ban_type").notNull(),
  bannedBy: varchar("banned_by"),
  relatedAccountIds: jsonb("related_account_ids"),
  referrerUid: text("referrer_uid"),
  telegramId: text("telegram_id"),
  appVersion: text("app_version"),
  browserFingerprint: text("browser_fingerprint"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Spin data table
export const spinData = pgTable("spin_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull().unique(),
  freeSpinUsed: boolean("free_spin_used").default(false),
  extraSpins: integer("extra_spins").default(0),
  spinAdsWatched: integer("spin_ads_watched").default(0),
  inviteSpinsEarned: integer("invite_spins_earned").default(0),
  lastSpinDate: varchar("last_spin_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Spin history table
export const spinHistory = pgTable("spin_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id).notNull(),
  rewardType: varchar("reward_type").notNull(),
  rewardAmount: decimal("reward_amount", { precision: 30, scale: 10 }).notNull(),
  spinType: varchar("spin_type").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Blocked countries for geo-restriction
export const blockedCountries = pgTable("blocked_countries", {
  id: serial("id").primaryKey(),
  countryCode: varchar("country_code", { length: 2 }).notNull().unique(),
  createdAt: timestamp("created_at").defaultNow(),
});

// User farming table (simple farming system)
export const userFarming = pgTable("user_farming", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").unique().notNull().references(() => users.id),
  startedAt: timestamp("started_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Insert schemas
export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true, updatedAt: true });
export const insertEarningSchema = createInsertSchema(earnings).omit({ createdAt: true });
export const insertTransactionSchema = createInsertSchema(transactions).omit({ id: true, createdAt: true });
export const insertWithdrawalSchema = createInsertSchema(withdrawals).omit({ id: true, createdAt: true, updatedAt: true });
export const insertUserBalanceSchema = createInsertSchema(userBalances).omit({ id: true, createdAt: true, updatedAt: true });
export const insertReferralSchema = createInsertSchema(referrals).omit({ id: true, createdAt: true });
export const insertAdminSettingSchema = createInsertSchema(adminSettings).omit({ id: true, createdAt: true, updatedAt: true });
export const insertBanLogSchema = createInsertSchema(banLogs).omit({ id: true, createdAt: true });
export const insertSpinDataSchema = createInsertSchema(spinData).omit({ id: true, createdAt: true, updatedAt: true });
export const insertSpinHistorySchema = createInsertSchema(spinHistory).omit({ id: true, createdAt: true });
export const insertBlockedCountrySchema = createInsertSchema(blockedCountries).omit({ id: true, createdAt: true });
export const insertUserFarmingSchema = createInsertSchema(userFarming).omit({ id: true, createdAt: true, updatedAt: true });

// Types
export type UpsertUser = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;
export type InsertEarning = z.infer<typeof insertEarningSchema>;
export type Earning = typeof earnings.$inferSelect;
export type InsertWithdrawal = z.infer<typeof insertWithdrawalSchema>;
export type Withdrawal = typeof withdrawals.$inferSelect;
export type Referral = typeof referrals.$inferSelect;
export type InsertReferral = z.infer<typeof insertReferralSchema>;
export type Transaction = typeof transactions.$inferSelect;
export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type UserBalance = typeof userBalances.$inferSelect;
export type InsertUserBalance = z.infer<typeof insertUserBalanceSchema>;
export type AdminSetting = typeof adminSettings.$inferSelect;
export type InsertAdminSetting = z.infer<typeof insertAdminSettingSchema>;
export type BanLog = typeof banLogs.$inferSelect;
export type InsertBanLog = z.infer<typeof insertBanLogSchema>;
export type SpinData = typeof spinData.$inferSelect;
export type InsertSpinData = z.infer<typeof insertSpinDataSchema>;
export type SpinHistory = typeof spinHistory.$inferSelect;
export type InsertSpinHistory = z.infer<typeof insertSpinHistorySchema>;
export type BlockedCountry = typeof blockedCountries.$inferSelect;
export type InsertBlockedCountry = z.infer<typeof insertBlockedCountrySchema>;
export type UserFarming = typeof userFarming.$inferSelect;
export type InsertUserFarming = typeof userFarming.$inferInsert;
