import { NextRequest, NextResponse } from "next/server";
import { APP_VERSION, APP_VERSION_HEADER } from "@/lib/appVersion";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const OUTDATED_CLIENT_MESSAGE = "新しいバージョンが公開されています。ページを再読み込みしてからやり直してください。";
const STALE_STATE_MESSAGE = "他の画面でデータが更新されていたため保存しませんでした。ページを再読み込みしてからやり直してください。";

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
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

  return stored.updatedAt;
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
  return stored.updatedAt;
}

export async function GET() {
  try {
    if (!redisConfig() && !canUseFileFallback()) {
      return NextResponse.json({ error: STORAGE_NOT_CONFIGURED_MESSAGE }, { status: 500 });
    }

    const payload = redisConfig() ? await readFromRedis() : await readFromFile();
    return NextResponse.json({ ...payload, appVersion: APP_VERSION });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read state" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = (await request.json()) as { state?: unknown; baseUpdatedAt?: unknown };
    if (!redisConfig() && !canUseFileFallback()) {
      return NextResponse.json({ error: STORAGE_NOT_CONFIGURED_MESSAGE }, { status: 500 });
    }

    // デプロイ前の古い画面からの全体保存は、新しいデータ項目を消しかねないので拒否する
    if (request.headers.get(APP_VERSION_HEADER) !== APP_VERSION) {
      return NextResponse.json({ error: OUTDATED_CLIENT_MESSAGE, outdated: true, appVersion: APP_VERSION }, { status: 409 });
    }

    // 状態全体の上書きは、読み込んだ時点の版(baseUpdatedAt)がサーバーの最新と一致するときだけ許可する。
    // 古いタブ（デプロイ前のコードを含む）が他の画面での変更を丸ごと消さないようにするため。
    // baseUpdatedAt を送らない古いクライアントも拒否する。
    const current = redisConfig() ? await readFromRedis() : await readFromFile();
    const baseUpdatedAt = typeof body.baseUpdatedAt === "string" || body.baseUpdatedAt === null ? body.baseUpdatedAt : undefined;
    if (baseUpdatedAt === undefined || baseUpdatedAt !== current.updatedAt) {
      return NextResponse.json(
        { error: STALE_STATE_MESSAGE, conflict: true, state: current.state, updatedAt: current.updatedAt },
        { status: 409 }
      );
    }

    const updatedAt = redisConfig() ? await writeToRedis(body.state) : await writeToFile(body.state);
    return NextResponse.json({ ok: true, updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to write state" },
      { status: 500 }
    );
  }
}
