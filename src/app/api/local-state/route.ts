import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url, token } : null;
}

async function readFromRedis() {
  const config = redisConfig();
  if (!config) return null;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(["GET", STATE_KEY]),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Upstash read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: string | null };
  return payload.result ? JSON.parse(payload.result) : null;
}

async function writeToRedis(state: unknown) {
  const config = redisConfig();
  if (!config) return false;

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(["SET", STATE_KEY, JSON.stringify(state ?? null)])
  });

  if (!response.ok) {
    throw new Error(`Upstash write failed: ${response.status}`);
  }

  return true;
}

async function localStatePath() {
  const path = await import("node:path");
  return path.join(process.cwd(), ".data", "local-practice-state.json");
}

async function readFromFile() {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(await localStatePath(), "utf8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function writeToFile(state: unknown) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const statePath = await localStatePath();
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  await fs.writeFile(statePath, JSON.stringify(state ?? null, null, 2), "utf8");
}

export async function GET() {
  try {
    const state = redisConfig() ? await readFromRedis() : await readFromFile();
    return NextResponse.json({ state });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read state" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const wroteToRedis = await writeToRedis(body.state);
    if (!wroteToRedis) {
      await writeToFile(body.state);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to write state" },
      { status: 500 }
    );
  }
}
