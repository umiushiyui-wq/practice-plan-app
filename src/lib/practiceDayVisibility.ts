export const PRIVATE_DAY_SLACK_ERROR = "非公開の練習日のため、Slackには送信しません。";

// 非公開の練習日か（奏者に出欠を求めない日。Slack送信系はすべて止める）
export function isPrivatePracticeDay(state: unknown, practiceDayId: string) {
  if (!state || typeof state !== "object") return false;
  const practiceDays = (state as { practiceDays?: unknown }).practiceDays;
  if (!Array.isArray(practiceDays)) return false;
  const day = practiceDays.find((item) => item && typeof item === "object" && (item as { id?: unknown }).id === practiceDayId);
  return Boolean(day && (day as { isPrivate?: unknown }).isPrivate === true);
}
