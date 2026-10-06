import { NextResponse } from "next/server";
import { isPrivatePracticeDay, PRIVATE_DAY_SLACK_ERROR } from "@/lib/practiceDayVisibility";
import { config } from "@/lib/config";
import { openSlackConversation, postSlackMessage } from "@/lib/slack";
import { appendHistoryEntry } from "@/lib/history";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const PLAYER_URL = "https://practice-plan-app.vercel.app/player";

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type MemberLike = {
  id?: unknown;
  name?: unknown;
  slackUserId?: unknown;
};

type AvailabilityBreakLike = {
  start?: unknown;
  end?: unknown;
};

type AvailabilityLike = {
  memberId?: unknown;
  start?: unknown;
  end?: unknown;
  breaks?: AvailabilityBreakLike[];
};

type PracticeDayLike = {
  id?: unknown;
  practiceDate?: unknown;
  location?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  availabilities?: AvailabilityLike[];
  absentMemberIds?: unknown[];
  respondedMemberIds?: unknown[];
};

type AppStateLike = {
  members?: MemberLike[];
  practiceDays?: PracticeDayLike[];
};

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function canUseFileFallback() {
  return process.env.NODE_ENV !== "production";
}

function normalizeStoredState(value: unknown): { state: unknown | null; updatedAt: string | null } {
  if (!value || typeof value !== "object") {
    return { state: value ?? null, updatedAt: null };
  }

  const maybeStored = value as Partial<StoredLocalState>;
  if ("state" in maybeStored) {
    return {
      state: maybeStored.state ?? null,
      updatedAt: typeof maybeStored.updatedAt === "string" ? maybeStored.updatedAt : null
    };
  }

  return { state: value, updatedAt: null };
}

async function readFromRedis() {
  const redis = redisConfig();
  if (!redis) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);

  const response = await fetch(`${redis.url}/get/${encodeURIComponent(STATE_KEY)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${redis.token}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Upstash read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: string | null };
  return payload.result ? normalizeStoredState(JSON.parse(payload.result)) : { state: null, updatedAt: null };
}

async function localStatePath() {
  const path = await import("node:path");
  return path.join(process.cwd(), ".data", "local-practice-state.json");
}

async function readFromFile() {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(await localStatePath(), "utf8");
    return normalizeStoredState(JSON.parse(content));
  } catch {
    return { state: null, updatedAt: null };
  }
}

async function readCurrentState() {
  if (redisConfig()) return readFromRedis();
  if (canUseFileFallback()) return readFromFile();
  throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);
}

function toMinutes(time: string): number {
  const [hourText, minuteText] = time.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return 0;
  return hour * 60 + minute;
}

function toTime(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function getAvailableSegments(availability: { start: string; end: string; breaks: Array<{ start: string; end: string }> }) {
  const start = toMinutes(availability.start);
  const end = toMinutes(availability.end);
  if (start >= end) return [];

  const normalizedBreaks = availability.breaks
    .map((item) => ({ start: Math.max(start, toMinutes(item.start)), end: Math.min(end, toMinutes(item.end)) }))
    .filter((item) => item.start < item.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = start;

  for (const breakRange of normalizedBreaks) {
    if (cursor < breakRange.start) segments.push({ start: cursor, end: breakRange.start });
    cursor = Math.max(cursor, breakRange.end);
  }

  if (cursor < end) segments.push({ start: cursor, end });
  return segments;
}

function formatConfirmationDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日（${weekdays[parsed.getDay()]}）`;
}

function getMembers(state: unknown) {
  if (!state || typeof state !== "object") return [];
  const members = (state as AppStateLike).members;
  if (!Array.isArray(members)) return [];

  return members
    .filter((member) => typeof member.id === "string")
    .map((member) => ({
      id: member.id as string,
      name: typeof member.name === "string" ? member.name : "",
      slackUserId: typeof member.slackUserId === "string" ? member.slackUserId.trim() : ""
    }));
}

function findPracticeDay(state: unknown, practiceDayId: string) {
  if (!state || typeof state !== "object") return null;
  const practiceDays = (state as AppStateLike).practiceDays;
  if (!Array.isArray(practiceDays)) return null;
  const day = practiceDays.find((item) => item.id === practiceDayId);
  if (!day || typeof day.practiceDate !== "string") return null;

  const toIdList = (value: unknown[] | undefined) =>
    Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];

  return {
    id: practiceDayId,
    practiceDate: day.practiceDate,
    location: typeof day.location === "string" ? day.location.trim() : "",
    startTime: typeof day.startTime === "string" ? day.startTime : "",
    endTime: typeof day.endTime === "string" ? day.endTime : "",
    respondedMemberIds: toIdList(day.respondedMemberIds),
    absentMemberIds: new Set(toIdList(day.absentMemberIds)),
    availabilities: Array.isArray(day.availabilities)
      ? day.availabilities
          .filter(
            (item): item is AvailabilityLike & { memberId: string; start: string; end: string } =>
              typeof item.memberId === "string" && typeof item.start === "string" && typeof item.end === "string"
          )
          .map((item) => ({
            memberId: item.memberId,
            start: item.start,
            end: item.end,
            breaks: Array.isArray(item.breaks)
              ? item.breaks.filter(
                  (brk): brk is { start: string; end: string } => typeof brk.start === "string" && typeof brk.end === "string"
                )
              : []
          }))
      : []
  };
}

function getTargetMemberIdSet(value: unknown) {
  if (!value || typeof value !== "object" || !("targetMemberIds" in value)) return null;
  const targetMemberIds = (value as { targetMemberIds?: unknown }).targetMemberIds;
  if (!Array.isArray(targetMemberIds)) return null;
  return new Set(targetMemberIds.filter((id): id is string => typeof id === "string"));
}

// 本人が入力した内容を、DMで読める一行にする（欠席 / 13:00〜15:00、16:00〜18:00）
function describeAnswer(practiceDay: NonNullable<ReturnType<typeof findPracticeDay>>, memberId: string) {
  if (practiceDay.absentMemberIds.has(memberId)) return "欠席";

  const availability = practiceDay.availabilities.find((item) => item.memberId === memberId);
  if (!availability) return "出席（参加できる時間は未入力）";

  const segments = getAvailableSegments(availability);
  if (segments.length === 0) return `出席 ${availability.start}〜${availability.end}`;
  return `出席 ${segments.map((segment) => `${toTime(segment.start)}〜${toTime(segment.end)}`).join("、")}`;
}

// 入力済みの人に、受け付けた内容をDMで送り返して確認してもらう。
export async function POST(request: Request, context: { params: Promise<{ practiceDayId: string }> }) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN が未設定です。" }, { status: 500 });
    }

    const { practiceDayId } = await context.params;
    const body = await request.json().catch(() => null);
    const targetMemberIdSet = getTargetMemberIdSet(body);
    const current = await readCurrentState();
    const practiceDay = findPracticeDay(current.state, practiceDayId);
    if (!practiceDay) {
      return NextResponse.json({ error: "練習日が見つかりません。" }, { status: 404 });
    }
    if (isPrivatePracticeDay(current.state, practiceDayId)) {
      return NextResponse.json({ error: PRIVATE_DAY_SLACK_ERROR }, { status: 400 });
    }

    const members = getMembers(current.state);
    const scopedMembers = targetMemberIdSet ? members.filter((member) => targetMemberIdSet.has(member.id)) : members;
    const respondedMemberIds = new Set(practiceDay.respondedMemberIds);
    const answered = scopedMembers.filter((member) => respondedMemberIds.has(member.id));
    const targets = answered.filter((member) => member.slackUserId);
    const missingSlackUserIdCount = answered.length - targets.length;
    const failures: Array<{ memberId: string; name: string; error: string }> = [];
    const dateLabel = formatConfirmationDate(practiceDay.practiceDate);
    const practiceTime =
      practiceDay.startTime && practiceDay.endTime ? `${practiceDay.startTime}〜${practiceDay.endTime}` : "";
    const practiceInfo = [practiceTime, practiceDay.location ? `＠${practiceDay.location}` : ""].filter(Boolean).join(" ");

    let sentCount = 0;
    for (const target of targets) {
      const text = [
        `${dateLabel}${practiceInfo ? `（${practiceInfo}）` : ""}の出欠は、次の内容で受け付けています。`,
        `*${describeAnswer(practiceDay, target.id)}*`,
        "",
        "もし間違っていたら、こちらから入力し直してください！",
        PLAYER_URL
      ].join("\n");

      const conversation = await openSlackConversation({
        botToken: config.slackBotToken,
        userId: target.slackUserId
      });
      const channel = conversation.channel?.id;

      if (!conversation.ok || !channel) {
        failures.push({ memberId: target.id, name: target.name, error: conversation.error ?? "dm_open_failed" });
        continue;
      }

      const posted = await postSlackMessage({
        botToken: config.slackBotToken,
        channel,
        text
      });

      if (posted.ok) {
        sentCount += 1;
      } else {
        failures.push({ memberId: target.id, name: target.name, error: posted.error ?? "post_failed" });
      }
    }

    const summary = `送信 ${sentCount}人 / 失敗 ${failures.length}人 / 未登録 ${missingSlackUserIdCount}人`;
    await appendHistoryEntry({
      category: "slack",
      kind: "answer-confirmation",
      practiceDayId,
      practiceDateLabel: dateLabel,
      success: failures.length === 0,
      summary,
      detail: failures.length > 0 ? failures.map((failure) => `${failure.name}: ${failure.error}`).join("、") : undefined
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      sentCount,
      missingSlackUserIdCount,
      failedCount: failures.length,
      totalAnsweredCount: answered.length,
      skippedUnansweredCount: scopedMembers.length - answered.length,
      failures
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "確認メッセージを送信できませんでした。" },
      { status: 500 }
    );
  }
}
