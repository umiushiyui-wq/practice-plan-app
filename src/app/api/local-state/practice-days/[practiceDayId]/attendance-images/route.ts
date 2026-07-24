import { NextResponse } from "next/server";
import { config, TIME_ZONE } from "@/lib/config";
import { uploadSlackFile } from "@/lib/slack";
import { PART_SLACK_CHANNELS, TEST_SLACK_CHANNEL_ID } from "@/lib/partSlackChannels";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type PracticeDayLike = {
  id?: unknown;
  practiceDate?: unknown;
};

type AppStateLike = {
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

function formatAttendanceDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}月${parsed.getDate()}日`;
}

function formatSendTimeLabel() {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: false
  }).formatToParts(new Date());
  const hour = parts.find((part) => part.type === "hour")?.value ?? "0";
  const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
  return `${hour}時${minute}分`;
}

function findPracticeDay(state: unknown, practiceDayId: string) {
  if (!state || typeof state !== "object") return null;
  const practiceDays = (state as AppStateLike).practiceDays;
  if (!Array.isArray(practiceDays)) return null;
  const day = practiceDays.find((item) => item.id === practiceDayId);
  if (!day || typeof day.practiceDate !== "string") return null;

  return {
    id: practiceDayId,
    practiceDate: day.practiceDate
  };
}

function decodeJpegImage(imageBase64: unknown) {
  if (typeof imageBase64 !== "string" || !imageBase64.trim()) {
    throw new Error("JPEG画像がありません。");
  }

  const cleanBase64 = imageBase64.replace(/^data:image\/jpeg;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("JPEG画像のサイズが不正です。");
  }

  return buffer;
}

export async function POST(request: Request, context: { params: Promise<{ practiceDayId: string }> }) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN が未設定です。" }, { status: 500 });
    }

    const { practiceDayId } = await context.params;
    const body = (await request.json().catch(() => null)) as
      | { part?: unknown; imageBase64?: unknown; isTest?: unknown }
      | null;
    const part = typeof body?.part === "string" ? body.part : "";
    const isTest = body?.isTest === true;
    const channel = isTest ? TEST_SLACK_CHANNEL_ID : PART_SLACK_CHANNELS[part];
    if (!channel) {
      return NextResponse.json({ error: `送信先チャンネル未設定のパートです: ${part}` }, { status: 400 });
    }

    const imageBuffer = decodeJpegImage(body?.imageBase64);
    const current = await readCurrentState();
    const practiceDay = findPracticeDay(current.state, practiceDayId);
    if (!practiceDay) {
      return NextResponse.json({ error: "練習日が見つかりません。" }, { status: 404 });
    }

    const dateLabel = formatAttendanceDate(practiceDay.practiceDate);
    const sentAtLabel = formatSendTimeLabel();
    const text = isTest
      ? `【テスト送信】${dateLabel}の${part}の出欠情報です（${sentAtLabel}現在）`
      : `${dateLabel}の${part}の出欠情報です（${sentAtLabel}現在）`;
    const uploaded = await uploadSlackFile({
      botToken: config.slackBotToken,
      channel,
      filename: `attendance-${practiceDay.practiceDate}.jpg`,
      title: `${dateLabel} ${part} の出欠${isTest ? "（テスト）" : ""}`,
      initialComment: text,
      fileBuffer: imageBuffer,
      mimeType: "image/jpeg"
    });

    if (!uploaded.ok) {
      return NextResponse.json({ error: uploaded.error ?? "slack_upload_failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Slack送信に失敗しました。" },
      { status: 500 }
    );
  }
}
