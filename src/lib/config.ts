export const config = {
  appUrl: process.env.APP_URL ?? "http://localhost:3000",
  sessionSecret: process.env.SESSION_SECRET ?? "dev-secret-change-me",
  allowedSlackTeamId: process.env.ALLOWED_SLACK_TEAM_ID ?? "",
  slackClientId: process.env.SLACK_CLIENT_ID ?? "",
  slackClientSecret: process.env.SLACK_CLIENT_SECRET ?? "",
  slackRedirectUri:
    process.env.SLACK_REDIRECT_URI ?? "http://localhost:3000/api/auth/slack/callback",
  slackBotToken: process.env.SLACK_BOT_TOKEN ?? "",
  slackReminderChannelId: process.env.SLACK_REMINDER_CHANNEL_ID ?? ""
};

export const TIME_ZONE = "Asia/Tokyo";
