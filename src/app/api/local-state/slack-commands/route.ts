import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { verifySlackRequestSignature } from "@/lib/slack";
import { getPartNamesForChannel } from "@/lib/partSlackChannels";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const INSTRUMENT_ALIASES: Record<string, string> = {
  "フルート": "ふるぼえ"
};

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type MemberLike = {
  id?: unknown;
  name?: unknown;
  instrument?: unknown;
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
  selectedPracticeDayId?: unknown;
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

function formatDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  const weekdays = ["日", "月", "火", "水", "木", "金", "土"];
  return `${date}（${weekdays[parsed.getDay()]}）`;
}

function normalizeInstrumentName(instrument: string) {
  const trimmed = instrument.trim();
  return INSTRUMENT_ALIASES[trimmed] ?? trimmed;
}

function getMembers(state: unknown) {
  if (!state || typeof state !== "object") return [];
  const members = (state as AppStateLike).members;
  if (!Array.isArray(members)) return [];

  return members
    .filter((member): member is MemberLike & { id: string } => typeof member.id === "string")
    .map((member) => ({
      id: member.id,
      name: typeof member.name === "string" && member.name ? member.name : member.id,
      instrument: typeof member.instrument === "string" ? member.instrument : ""
    }));
}

function getUpcomingPracticeDays(state: unknown) {
  if (!state || typeof state !== "object") return [];
  const practiceDays = (state as AppStateLike).practiceDays;
  if (!Array.isArray(practiceDays)) return [];

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  return practiceDays
    .filter((item): item is PracticeDayLike & { practiceDate: string } => typeof item.practiceDate === "string")
    .map((item) => ({ item, date: new Date(`${item.practiceDate}T00:00:00`) }))
    .filter((entry) => !Number.isNaN(entry.date.getTime()) && entry.date.getTime() >= todayStart.getTime())
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function listUpcomingDates(state: unknown, limit = 8): string[] {
  return getUpcomingPracticeDays(state)
    .slice(0, limit)
    .map((entry) => entry.item.practiceDate);
}

function normalizePracticeDay(day: PracticeDayLike & { practiceDate: string }) {
  return {
    practiceDate: day.practiceDate,
    location: typeof day.location === "string" ? day.location : "",
    startTime: typeof day.startTime === "string" ? day.startTime : "00:00",
    endTime: typeof day.endTime === "string" ? day.endTime : "00:00",
    absentMemberIds: new Set(
      Array.isArray(day.absentMemberIds) ? day.absentMemberIds.filter((id): id is string => typeof id === "string") : []
    ),
    respondedMemberIds: new Set(
      Array.isArray(day.respondedMemberIds)
        ? day.respondedMemberIds.filter((id): id is string => typeof id === "string")
        : []
    ),
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

function getNextPracticeDay(state: unknown) {
  const day = getUpcomingPracticeDays(state)[0]?.item;
  return day ? normalizePracticeDay(day) : null;
}

function getPracticeDayByDate(state: unknown, dateStr: string) {
  if (!state || typeof state !== "object") return null;
  const practiceDays = (state as AppStateLike).practiceDays;
  if (!Array.isArray(practiceDays)) return null;

  const day = practiceDays.find(
    (item): item is PracticeDayLike & { practiceDate: string } => item.practiceDate === dateStr
  );
  return day ? normalizePracticeDay(day) : null;
}

function buildDateString(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// "2026-09-19" "2026/9/19" のようなフル指定、"9/19" "9-19" "9月19日" のような月日のみの指定（年は今年扱い）に対応する。
function parseTargetDate(text: string, now: Date): string | null {
  const trimmed = text.trim();

  const fullMatch = trimmed.match(/^(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (fullMatch) {
    const [, year, month, day] = fullMatch;
    return buildDateString(Number(year), Number(month), Number(day));
  }

  const shortMatch = trimmed.match(/^(\d{1,2})[\/\-月](\d{1,2})日?$/);
  if (shortMatch) {
    const [, month, day] = shortMatch;
    return buildDateString(now.getFullYear(), Number(month), Number(day));
  }

  return null;
}

function getMemberStatusLabel(day: NonNullable<ReturnType<typeof getNextPracticeDay>>, memberId: string): string {
  const availability = day.availabilities.find((item) => item.memberId === memberId);
  const hasSaved = day.respondedMemberIds.has(memberId);
  const isAbsent = hasSaved && day.absentMemberIds.has(memberId);
  if (isAbsent) return "欠席";
  if (!availability) return hasSaved ? "未入力" : "未回答";

  const segments = getAvailableSegments(availability);
  if (segments.length === 0) return `${availability.start}〜${availability.end}`;
  return segments.map((segment) => `${toTime(segment.start)}〜${toTime(segment.end)}`).join("、");
}

function ephemeral(text: string) {
  return NextResponse.json({
    response_type: "ephemeral",
    text,
    blocks: [{ type: "section", text: { type: "mrkdwn", text } }]
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();

  if (
    !verifySlackRequestSignature({
      timestamp: request.headers.get("x-slack-request-timestamp"),
      rawBody,
      signature: request.headers.get("x-slack-signature")
    })
  ) {
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  const form = new URLSearchParams(rawBody);
  const channelId = form.get("channel_id") ?? "";
  const teamId = form.get("team_id") ?? "";

  if (config.allowedSlackTeamId && teamId !== config.allowedSlackTeamId) {
    return ephemeral("許可されていないワークスペースからのリクエストです。");
  }

  const partNames = getPartNamesForChannel(channelId);
  if (partNames.length === 0) {
    return ephemeral("このチャンネルはパート出欠コマンドに対応していません。");
  }

  const text = (form.get("text") ?? "").trim();

  try {
    const current = await readCurrentState();

    if (text === "一覧" || text.toLowerCase() === "list") {
      const dates = listUpcomingDates(current.state);
      if (dates.length === 0) {
        return ephemeral("今後の練習予定が登録されていません。");
      }
      return ephemeral(
        [
          "*今後の練習日一覧*",
          ...dates.map((date) => `・${formatDateLabel(date)}`),
          "",
          "日付を指定するには `/出欠 9/19` のように入力してください。"
        ].join("\n")
      );
    }

    let day: ReturnType<typeof getNextPracticeDay>;
    if (text) {
      const targetDate = parseTargetDate(text, new Date());
      if (!targetDate) {
        return ephemeral(
          "日付の形式が正しくありません。例: `/出欠 9/19`、`/出欠 2026-09-19`\n今後の日程一覧は `/出欠 一覧`"
        );
      }
      day = getPracticeDayByDate(current.state, targetDate);
      if (!day) {
        return ephemeral(`${formatDateLabel(targetDate)} の練習予定が見つかりません。`);
      }
    } else {
      day = getNextPracticeDay(current.state);
      if (!day) {
        return ephemeral("次回の練習予定がまだ登録されていません。");
      }
    }

    const members = getMembers(current.state).filter((member) =>
      partNames.includes(normalizeInstrumentName(member.instrument))
    );
    if (members.length === 0) {
      return ephemeral(`${partNames.join("・")}のメンバーが登録されていません。`);
    }

    const sortedMembers = [...members].sort((a, b) => a.name.localeCompare(b.name, "ja"));
    const location = day.location.trim();
    const scheduleLabel = location ? `${day.startTime}〜${day.endTime} ＠${location}` : `${day.startTime}〜${day.endTime}`;

    const lines = [
      `*${formatDateLabel(day.practiceDate)} ${partNames.join("・")}の出欠状況*（${scheduleLabel}）`,
      ...sortedMembers.map((member) => `・${member.name}: ${getMemberStatusLabel(day, member.id)}`)
    ];

    return ephemeral(lines.join("\n"));
  } catch (error) {
    return ephemeral(`出欠情報の取得に失敗しました: ${error instanceof Error ? error.message : "unknown_error"}`);
  }
}
