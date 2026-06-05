import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { openSlackConversation, postSlackMessage } from "@/lib/slack";

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

type PracticeDayLike = {
  id?: unknown;
  practiceDate?: unknown;
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

function formatReminderDate(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return `${parsed.getMonth() + 1}\u6708${parsed.getDate()}\u65e5`;
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

  return {
    id: practiceDayId,
    practiceDate: day.practiceDate,
    respondedMemberIds: Array.isArray(day.respondedMemberIds)
      ? day.respondedMemberIds.filter((id): id is string => typeof id === "string")
      : []
  };
}

export async function POST(_request: Request, context: { params: Promise<{ practiceDayId: string }> }) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN \u304c\u672a\u8a2d\u5b9a\u3067\u3059\u3002" }, { status: 500 });
    }

    const { practiceDayId } = await context.params;
    const current = await readCurrentState();
    const practiceDay = findPracticeDay(current.state, practiceDayId);
    if (!practiceDay) {
      return NextResponse.json({ error: "\u7df4\u7fd2\u65e5\u304c\u898b\u3064\u304b\u308a\u307e\u305b\u3093\u3002" }, { status: 404 });
    }

    const members = getMembers(current.state);
    const respondedMemberIds = new Set(practiceDay.respondedMemberIds);
    const unanswered = members.filter((member) => !respondedMemberIds.has(member.id));
    const targets = unanswered.filter((member) => member.slackUserId);
    const missingSlackUserIdCount = unanswered.length - targets.length;
    const failures: Array<{ memberId: string; name: string; error: string }> = [];
    const dateLabel = formatReminderDate(practiceDay.practiceDate);
    const text = `${dateLabel}\u306e\u51fa\u5e2d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044\uff01\n${PLAYER_URL}`;

    let sentCount = 0;
    for (const target of targets) {
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

    return NextResponse.json({
      ok: true,
      sentCount,
      missingSlackUserIdCount,
      failedCount: failures.length,
      skippedAnsweredCount: members.length - unanswered.length,
      totalUnansweredCount: unanswered.length,
      failures
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Slack\u901a\u77e5\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002" },
      { status: 500 }
    );
  }
}