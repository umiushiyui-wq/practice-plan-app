// 練習日時変更のSlack DM文面。管理画面の確認モーダル(プレビュー)とAPIルート(実送信)で共有する。

const PLAYER_URL = "https://practice-plan-app.vercel.app/player";

export type ScheduleDetails = {
  practiceDate: string;
  startTime: string;
  endTime: string;
  location: string;
};

function formatShortDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日（${weekdays[parsed.getDay()]}）`;
}

export function formatScheduleChangeDateLabel(details: ScheduleDetails) {
  return formatShortDate(details.practiceDate);
}

function formatScheduleLine(details: ScheduleDetails) {
  const location = details.location.trim() ? ` ＠${details.location.trim()}` : "";
  return `${formatShortDate(details.practiceDate)} ${details.startTime}〜${details.endTime}${location}`;
}

// 出欠入力の内容に影響するのは日付と時間だけなので、場所のみの変更は通知対象にしない。
export function hasScheduleTimeChanged(previous: ScheduleDetails, next: ScheduleDetails) {
  return (
    previous.practiceDate !== next.practiceDate ||
    previous.startTime !== next.startTime ||
    previous.endTime !== next.endTime
  );
}

// ?day= を付けると奏者ページでその練習日が選択された状態で開く。
export function buildScheduleChangeNoticeText(
  practiceDayId: string,
  previous: ScheduleDetails,
  next: ScheduleDetails,
  resetAttendance: boolean
) {
  return [
    resetAttendance ? "練習日時が変更されたため、この日の出欠入力をリセットしました。" : "練習日時が変更されました。",
    `変更前: ${formatScheduleLine(previous)}`,
    `変更後: ${formatScheduleLine(next)}`,
    resetAttendance
      ? "お手数ですが、もう一度出欠を入力してください！"
      : "出欠入力済みの方は、参加可能時間の修正をお願いします！",
    `${PLAYER_URL}?day=${encodeURIComponent(practiceDayId)}`
  ].join("\n");
}
