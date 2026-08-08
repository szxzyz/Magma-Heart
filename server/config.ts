// Application configuration
// Use environment variables for channel settings

export const config = {
  // Telegram channel settings - use numeric ID for more reliable verification
  // To get numeric channel ID:
  // 1. Add @userinfobot to your channel
  // 2. Forward a message from the channel to @userinfobot
  // 3. It will show the channel ID (looks like: -1001234567890)
  telegram: {
    // Channel New (LightningSatoshi)
    channel2Id: process.env.CHANNEL2_ID || '',
    channel2Url: process.env.CHANNEL2_LINK || '',
    channel2Name: process.env.CHANNEL2_NAME || '',
    // Channel Payout (MoneyAdz)
    channelId: process.env.CHANNEL_ID || '',
    channelUrl: process.env.CHANNEL_LINK || '',
    channelName: process.env.CHANNEL_NAME || '',
    // Group settings (Axionetchat)
    groupId: process.env.GROUP_ID || '',
    groupUrl: process.env.GROUP_LINK || '',
    groupName: process.env.GROUP_NAME || '',
    moneyCatsId: process.env.MONEYCATS_ID || process.env.TELEGRAM_MONEYCATS_ID || '',
    moneyCatsUrl: process.env.MONEYCATS_LINK || process.env.TELEGRAM_MONEYCATS_URL || '',
    moneyCatsName: process.env.MONEYCATS_NAME || process.env.TELEGRAM_MONEYCATS_NAME || '',
  },
  
  // Bot configuration
  bot: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminId: process.env.ADMIN_ID || '',
    superAdminId: process.env.SUPER_ADMIN_ID || '',
    username: process.env.BOT_USERNAME || '',
    botUrl: process.env.TELEGRAM_BOT_URL || '',
  },
};

const REQUIRED_PRODUCTION_VARS = [
  'TELEGRAM_BOT_TOKEN',
  'CHANNEL_ID',
  'CHANNEL_LINK',
  'GROUP_ID',
  'GROUP_LINK',
  'ADMIN_ID',
  'SUPER_ADMIN_ID',
] as const;

/**
 * Validate configuration before any server/database work starts.
 * Secrets and IDs are never returned or sent to the client.
 */
export function validateEnvironment(): void {
  const missing = REQUIRED_PRODUCTION_VARS.filter(name => !process.env[name]?.trim());
  if (missing.length === 0) return;

  const message = `Missing required environment variables: ${missing.join(', ')}`;
  if (process.env.NODE_ENV === 'production') {
    console.error(`❌ Configuration error: ${message}`);
    console.error('❌ Server startup aborted. Configure the required production variables before restarting.');
    process.exit(1);
  }

  console.warn(`⚠️ Development configuration warning: ${message}`);
}

export function isProtectedTelegramId(telegramId: string | number): boolean {
  const id = String(telegramId);
  return [process.env.ADMIN_ID, process.env.SUPER_ADMIN_ID]
    .filter(Boolean)
    .some(configuredId => configuredId === id);
}

// Helper function to get channel config for API responses
export function getChannelConfig() {
  return {
    channel2Id: config.telegram.channel2Id,
    channel2Url: config.telegram.channel2Url,
    channel2Name: config.telegram.channel2Name,
    channelId: config.telegram.channelId,
    channelUrl: config.telegram.channelUrl,
    channelName: config.telegram.channelName,
    groupId: config.telegram.groupId,
    groupUrl: config.telegram.groupUrl,
    groupName: config.telegram.groupName,
    moneyCatsId: config.telegram.moneyCatsId,
    moneyCatsUrl: config.telegram.moneyCatsUrl,
    moneyCatsName: config.telegram.moneyCatsName,
    botUsername: config.bot.username,
    botUrl: config.bot.botUrl,
  };
}
