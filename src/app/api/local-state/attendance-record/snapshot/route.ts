import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const ATTENDANCE_RECORD_UNLOCK_HOUR = 7;

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type PracticeDayLike = {
  id?: unknown;
  practiceDate?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  availabilities?: unknown;
  absentMemberIds?: unknown;
  respondedMemberIds?: unknown;
  actualAttendanceSnapshotAt?: unknown;
  [key: string]: unknown;
};

type AppStateLike = {
  practiceDays?: PracticeDayLike[];
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

function isAttendanceRecordUnlocked(practiceDate: string) {
  const unlockAt = new Date(`${practiceDate}T${String(ATTENDANCE_RECORD_UNLOCK_HOUR).padStart(2, "0")}:00:00+09:00`);
  return !Number.isNaN(unlockAt.getTime()) && Date.now() >= unlockAt.getTime();
}

// 自己申告(availabilities等)を「実際の出欠」(actual*)の初期値としてそのままコピーする。
// 既にコピー済みなら何もしない(冪等)。練習日当日7:00(JST)より前は何もしない。
function snapshotAttendanceRecord(state: unknown, practiceDayId: string) {
  if (!state || typeof state !== "object") return null;

  const appState = state as AppStateLike;
  if (!Array.isArray(appState.practiceDays)) return null;

  let foundDay = false;
  let didSnapshot = false;

  const nextPracticeDays = appState.practiceDays.map((day) => {
    if (day.id !== practiceDayId) return day;
    foundDay = true;

    if (day.actualAttendanceSnapshotAt) return day;
    if (typeof day.practiceDate !== "string" || !isAttendanceRecordUnlocked(day.practiceDate)) return day;

    didSnapshot = true;
    return {
      ...day,
      actualAvailabilities: Array.isArray(day.availabilities) ? day.availabilities : [],
      actualAbsentMemberIds: Array.isArray(day.absentMemberIds) ? day.absentMemberIds : [],
      actualRespondedMemberIds: Array.isArray(day.respondedMemberIds) ? day.respondedMemberIds : [],
      actualAttendanceSnapshotAt: new Date().toISOString()
    };
  });

  if (!foundDay) return null;
  if (!didSnapshot) return { appState, changed: false };

  return { appState: { ...appState, practiceDays: nextPracticeDays }, changed: true };
}

export async function POST(request: NextRequest) {
  try {
    if (!readCurrentStateAllowed()) {
      return NextResponse.json({ error: STORAGE_NOT_CONFIGURED_MESSAGE }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as { practiceDayId?: unknown } | null;
    if (!body || typeof body.practiceDayId !== "string") {
      return NextResponse.json({ error: "Invalid practiceDayId" }, { status: 400 });
    }

    const current = await readCurrentState();
    const result = snapshotAttendanceRecord(current.state, body.practiceDayId);
    if (!result) {
      return NextResponse.json({ error: "Practice day was not found" }, { status: 404 });
    }

    if (!result.changed) {
      return NextResponse.json({ ok: true, state: current.state, updatedAt: current.updatedAt });
    }

    const stored = await writeCurrentState(result.appState);
    return NextResponse.json({ ok: true, state: stored.state, updatedAt: stored.updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to snapshot attendance record" },
      { status: 500 }
    );
  }
}
