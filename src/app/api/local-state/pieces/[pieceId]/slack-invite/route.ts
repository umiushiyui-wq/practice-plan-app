import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { inviteToConversation, joinConversation, listConversationMembers } from "@/lib/slack";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type MemberLike = {
  id?: unknown;
  name?: unknown;
  slackUserId?: unknown;
};

type PieceLike = {
  id?: unknown;
  memberIds?: unknown[];
};

type AppStateLike = {
  members?: MemberLike[];
  pieces?: PieceLike[];
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

function findPiece(state: unknown, pieceId: string) {
  if (!state || typeof state !== "object") return null;
  const pieces = (state as AppStateLike).pieces;
  if (!Array.isArray(pieces)) return null;
  const piece = pieces.find((item) => item.id === pieceId);
  if (!piece) return null;

  return {
    id: pieceId,
    memberIds: Array.isArray(piece.memberIds)
      ? piece.memberIds.filter((id): id is string => typeof id === "string")
      : []
  };
}

export async function POST(request: Request, context: { params: Promise<{ pieceId: string }> }) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN が未設定です。" }, { status: 500 });
    }

    const { pieceId } = await context.params;
    const body = (await request.json().catch(() => null)) as { channelId?: unknown } | null;
    const channelId = typeof body?.channelId === "string" ? body.channelId.trim() : "";
    if (!channelId) {
      return NextResponse.json({ error: "チャンネルIDを入力してください。" }, { status: 400 });
    }

    const current = await readCurrentState();
    const piece = findPiece(current.state, pieceId);
    if (!piece) {
      return NextResponse.json({ error: "曲が見つかりません。" }, { status: 404 });
    }

    const memberIdSet = new Set(piece.memberIds);
    const members = getMembers(current.state).filter((member) => memberIdSet.has(member.id));
    const targets = members.filter((member) => member.slackUserId);
    const missingSlackUserIdCount = members.length - targets.length;

    let channelMembers = await listConversationMembers({ botToken: config.slackBotToken, channel: channelId });
    if (!channelMembers.ok && channelMembers.error === "not_in_channel") {
      const joined = await joinConversation({ botToken: config.slackBotToken, channel: channelId });
      if (!joined.ok) {
        return NextResponse.json(
          { error: `Botがチャンネルに参加できませんでした（${joined.error ?? "join_failed"}）。Botをチャンネルに招待するか、channels:join権限を付与してください。` },
          { status: 502 }
        );
      }
      channelMembers = await listConversationMembers({ botToken: config.slackBotToken, channel: channelId });
    }

    if (!channelMembers.ok) {
      return NextResponse.json(
        { error: `チャンネル参加者の取得に失敗しました（${channelMembers.error ?? "conversations_members_failed"}）。` },
        { status: 502 }
      );
    }

    const existingMemberSet = new Set(channelMembers.members);
    const toInvite = targets.filter((member) => !existingMemberSet.has(member.slackUserId));
    const alreadyMemberCount = targets.length - toInvite.length;

    if (toInvite.length === 0) {
      return NextResponse.json({
        ok: true,
        invitedCount: 0,
        alreadyMemberCount,
        missingSlackUserIdCount,
        failures: []
      });
    }

    let invited = await inviteToConversation({
      botToken: config.slackBotToken,
      channel: channelId,
      userIds: toInvite.map((member) => member.slackUserId)
    });

    if (!invited.ok && invited.error === "not_in_channel") {
      const joined = await joinConversation({ botToken: config.slackBotToken, channel: channelId });
      if (!joined.ok) {
        return NextResponse.json(
          { error: `Botがチャンネルに参加できませんでした（${joined.error ?? "join_failed"}）。Botをチャンネルに招待するか、channels:join権限を付与してください。` },
          { status: 502 }
        );
      }
      invited = await inviteToConversation({
        botToken: config.slackBotToken,
        channel: channelId,
        userIds: toInvite.map((member) => member.slackUserId)
      });
    }

    if (!invited.ok && invited.error !== "already_in_channel") {
      return NextResponse.json(
        { error: `招待に失敗しました（${invited.error ?? "invite_failed"}）。` },
        { status: 502 }
      );
    }

    const failedUserIds = new Set((invited.errors ?? []).filter((item) => !item.ok).map((item) => item.user));
    const failures = toInvite
      .filter((member) => failedUserIds.has(member.slackUserId))
      .map((member) => ({ memberId: member.id, name: member.name, error: "invite_failed" }));

    return NextResponse.json({
      ok: true,
      invitedCount: toInvite.length - failures.length,
      alreadyMemberCount,
      missingSlackUserIdCount,
      failures
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Slack招待に失敗しました。" },
      { status: 500 }
    );
  }
}
