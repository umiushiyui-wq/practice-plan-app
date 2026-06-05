import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { uploadSlackFile } from "@/lib/slack";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const ANNOUNCEMENT_CHANNEL_ID = "C0AN798ECE8";
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

function formatAnnouncementDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}\u6708${parsed.getDate()}\u65e5`;
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
    throw new Error("JPEG\u753b\u50cf\u304c\u3042\u308a\u307e\u305b\u3093\u3002");
  }

  const cleanBase64 = imageBase64.replace(/^data:image\/jpeg;base64,/, "");
  const buffer = Buffer.from(cleanBase64, "base64");
  if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error("JPEG\u753b\u50cf\u306e\u30b5\u30a4\u30ba\u304c\u4e0d\u6b63\u3067\u3059\u3002");
  }

  return buffer;
}

export async function POST(request: Request, context: { params: Promise<{ practiceDayId: string }> }) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN \u304c\u672a\u8a2d\u5b9a\u3067\u3059\u3002" }, { status: 500 });
    }

    const { practiceDayId } = await context.params;
    const body = (await request.json().catch(() => null)) as { imageBase64?: unknown } | null;
    const imageBuffer = decodeJpegImage(body?.imageBase64);
    const current = await readCurrentState();
    const practiceDay = findPracticeDay(current.state, practiceDayId);
    if (!practiceDay) {
      return NextResponse.json({ error: "\u7df4\u7fd2\u65e5\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002" }, { status: 404 });
    }

    const dateLabel = formatAnnouncementDate(practiceDay.practiceDate);
    const text = `${dateLabel}\u306e\u7df4\u7fd2\u5185\u5bb9\u304c\u516c\u958b\u3055\u308c\u307e\u3057\u305f`;
    const uploaded = await uploadSlackFile({
      botToken: config.slackBotToken,
      channel: ANNOUNCEMENT_CHANNEL_ID,
      filename: `practice-plan-${practiceDay.practiceDate}.jpg`,
      title: `${dateLabel}\u306e\u7df4\u7fd2\u5185\u5bb9`,
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
      { error: error instanceof Error ? error.message : "Slack\u30a2\u30ca\u30a6\u30f3\u30b9\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002" },
      { status: 500 }
    );
  }
}
