import { NextResponse } from "next/server";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type PieceLike = {
  id?: unknown;
  slackChannelId?: unknown;
  [key: string]: unknown;
};

type AppStateLike = {
  pieces?: PieceLike[];
  [key: string]: unknown;
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

function makeStoredState(state: unknown): StoredLocalState {
  return {
    state: state ?? null,
    updatedAt: new Date().toISOString()
  };
}

async function readFromRedis() {
  const config = redisConfig();
  if (!config) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);

  const response = await fetch(`${config.url}/get/${encodeURIComponent(STATE_KEY)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`
    },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Upstash read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: string | null };
  return payload.result ? normalizeStoredState(JSON.parse(payload.result)) : { state: null, updatedAt: null };
}

async function writeToRedis(state: unknown) {
  const config = redisConfig();
  if (!config) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);
  const stored = makeStoredState(state);

  const response = await fetch(`${config.url}/set/${encodeURIComponent(STATE_KEY)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify(stored)
  });

  if (!response.ok) {
    throw new Error(`Upstash write failed: ${response.status}`);
  }

  return stored;
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

async function writeToFile(state: unknown) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const stored = makeStoredState(state);
  const statePath = await localStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(stored, null, 2), "utf8");
  return stored;
}

function readCurrentStateAllowed() {
  return redisConfig() || canUseFileFallback();
}

async function readCurrentState() {
  return redisConfig() ? await readFromRedis() : await readFromFile();
}

async function writeCurrentState(state: unknown) {
  return redisConfig() ? await writeToRedis(state) : await writeToFile(state);
}

function patchPieceSlackChannelId(state: unknown, pieceId: string, channelId: string) {
  if (!state || typeof state !== "object") return null;

  const appState = state as AppStateLike;
  if (!Array.isArray(appState.pieces)) return null;

  let found = false;
  const nextPieces = appState.pieces.map((piece) => {
    if (piece.id !== pieceId) return piece;
    found = true;
    return { ...piece, slackChannelId: channelId };
  });

  return found ? { ...appState, pieces: nextPieces } : null;
}

export async function PUT(request: Request, context: { params: Promise<{ pieceId: string }> }) {
  try {
    if (!readCurrentStateAllowed()) {
      return NextResponse.json({ error: STORAGE_NOT_CONFIGURED_MESSAGE }, { status: 500 });
    }

    const { pieceId } = await context.params;
    const body = (await request.json().catch(() => null)) as { channelId?: unknown } | null;
    const channelId = typeof body?.channelId === "string" ? body.channelId.trim() : "";

    const current = await readCurrentState();
    const nextState = patchPieceSlackChannelId(current.state, pieceId, channelId);
    if (!nextState) {
      return NextResponse.json({ error: "曲が見つかりません。" }, { status: 404 });
    }

    const stored = await writeCurrentState(nextState);
    return NextResponse.json({ ok: true, state: stored.state, updatedAt: stored.updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "チャンネルIDの保存に失敗しました。" },
      { status: 500 }
    );
  }
}
