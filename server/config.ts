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
    channel2Id: process.env.TELEGRAM_CHANNEL2_ID || '@LightningSatoshi',
    channel2Url: process.env.TELEGRAM_CHANNEL2_URL || 'https://t.me/LightningSatoshi',
    channel2Name: process.env.TELEGRAM_CHANNEL2_NAME || 'Lightning Satoshi',
    // Channel Payout (MoneyAdz)
    channelId: process.env.TELEGRAM_CHANNEL_ID || '@MoneyAdz',
    channelUrl: process.env.TELEGRAM_CHANNEL_URL || 'https://t.me/MoneyAdz',
    channelName: process.env.TELEGRAM_CHANNEL_NAME || 'Axionet Payouts',
    // Group settings (Axionetchat)
    groupId: process.env.TELEGRAM_GROUP_ID || '@Axionetchat',
    groupUrl: process.env.TELEGRAM_GROUP_URL || 'https://t.me/Axionetchat',
    groupName: process.env.TELEGRAM_GROUP_NAME || 'Axionet Chat',
    moneyCatsId: process.env.TELEGRAM_MONEYCATS_ID || '',
    moneyCatsUrl: process.env.TELEGRAM_MONEYCATS_URL || '',
    moneyCatsName: process.env.TELEGRAM_MONEYCATS_NAME || '',
  },
  
  // Bot configuration
  bot: {
    token: process.env.TELEGRAM_BOT_TOKEN || '',
    adminId: process.env.TELEGRAM_ADMIN_ID || '',
    username: process.env.BOT_USERNAME || 'MoneyAXNbot',
    botUrl: process.env.TELEGRAM_BOT_URL || 'https://t.me/MoneyAXNbot',
  },
};

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
