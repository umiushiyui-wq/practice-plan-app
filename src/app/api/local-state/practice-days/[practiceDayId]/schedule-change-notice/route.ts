import { NextResponse } from "next/server";
import { isPrivatePracticeDay, PRIVATE_DAY_SLACK_ERROR } from "@/lib/practiceDayVisibility";
import { config } from "@/lib/config";
import { openSlackConversation, postSlackMessage } from "@/lib/slack";
import { appendHistoryEntry } from "@/lib/history";
import {
  buildScheduleChangeNoticeText,
  formatScheduleChangeDateLabel,
  type ScheduleDetails
} from "@/lib/scheduleChangeNotice";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

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

function findRespondedMemberIds(state: unknown, practiceDayId: string) {
  if (!state || typeof state !== "object") return null;
  const practiceDays = (state as AppStateLike).practiceDays;
  if (!Array.isArray(practiceDays)) return null;
  const day = practiceDays.find((item) => item.id === practiceDayId);
  if (!day) return null;

  return Array.isArray(day.respondedMemberIds)
    ? day.respondedMemberIds.filter((id): id is string => typeof id === "string")
    : [];
}

function parseScheduleDetails(value: unknown): ScheduleDetails | null {
  if (!value || typeof value !== "object") return null;
  const { practiceDate, startTime, endTime, location } = value as Record<string, unknown>;
  if (typeof practiceDate !== "string" || !DATE_PATTERN.test(practiceDate)) return null;
  if (typeof startTime !== "string" || !TIME_PATTERN.test(startTime)) return null;
  if (typeof endTime !== "string" || !TIME_PATTERN.test(endTime)) return null;

  return {
    practiceDate,
    startTime,
    endTime,
    location: typeof location === "string" ? location.trim().slice(0, 100) : ""
  };
}

export async function POST(request: Request, context: { params: Promise<{ practiceDayId: string }> }) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN が未設定です。" }, { status: 500 });
    }

    const { practiceDayId } = await context.params;
    const body = (await request.json().catch(() => null)) as {
      previous?: unknown;
      next?: unknown;
      resetAttendance?: unknown;
      targetMemberIds?: unknown;
    } | null;
    const previous = parseScheduleDetails(body?.previous);
    const next = parseScheduleDetails(body?.next);
    if (!previous || !next) {
      return NextResponse.json({ error: "変更前後の練習日時が正しくありません。" }, { status: 400 });
    }

    const current = await readCurrentState();
    const respondedMemberIds = findRespondedMemberIds(current.state, practiceDayId);
    if (!respondedMemberIds) {
      return NextResponse.json({ error: "練習日が見つかりません。" }, { status: 404 });
    }
    if (isPrivatePracticeDay(current.state, practiceDayId)) {
      return NextResponse.json({ error: PRIVATE_DAY_SLACK_ERROR }, { status: 400 });
    }

    // 出欠リセットと同時に送る場合、保存済みstateの回答者はすでに空になり得るため、クライアントが変更前の回答者を渡す。
    const targetMemberIds = Array.isArray(body?.targetMemberIds)
      ? body.targetMemberIds.filter((id): id is string => typeof id === "string")
      : respondedMemberIds;
    const resetAttendance = body?.resetAttendance === true;
    const targetMemberIdSet = new Set(targetMemberIds);
    const responded = getMembers(current.state).filter((member) => targetMemberIdSet.has(member.id));
    const targets = responded.filter((member) => member.slackUserId);
    const missingSlackUserIdCount = responded.length - targets.length;
    const failures: Array<{ memberId: string; name: string; error: string }> = [];
    const text = buildScheduleChangeNoticeText(practiceDayId, previous, next, resetAttendance);

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

    const summary = `送信 ${sentCount}人 / 失敗 ${failures.length}人 / 未登録 ${missingSlackUserIdCount}人${
      resetAttendance ? "（出欠リセットあり）" : ""
    }`;

    await appendHistoryEntry({
      category: "slack",
      kind: "schedule-change",
      practiceDayId,
      practiceDateLabel: formatScheduleChangeDateLabel(next),
      success: failures.length === 0,
      summary,
      detail: failures.length > 0 ? failures.map((failure) => `${failure.name}: ${failure.error}`).join("、") : undefined
    }).catch(() => null);

    return NextResponse.json({
      ok: true,
      sentCount,
      missingSlackUserIdCount,
      failedCount: failures.length,
      failures
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Slack通知を送信できませんでした。" },
      { status: 500 }
    );
  }
}
