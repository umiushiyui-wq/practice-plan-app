import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type AvailabilityBreak = {
  start: string;
  end: string;
};

type AttendanceRecordPatch = {
  practiceDayId: string;
  memberId: string;
  start: string;
  end: string;
  breaks: AvailabilityBreak[];
  absent: boolean;
  clear?: boolean;
};

type PracticeDayLike = {
  id?: unknown;
  actualAvailabilities?: Array<{ memberId?: unknown; start?: unknown; end?: unknown; breaks?: unknown }>;
  actualAbsentMemberIds?: unknown[];
  actualRespondedMemberIds?: unknown[];
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

function parsePatch(value: unknown): AttendanceRecordPatch | null {
  const patch = value && typeof value === "object" && "patch" in value ? (value as { patch: unknown }).patch : value;
  if (!patch || typeof patch !== "object") return null;

  const candidate = patch as Partial<AttendanceRecordPatch>;
  if (typeof candidate.practiceDayId !== "string" || typeof candidate.memberId !== "string") {
    return null;
  }

  // 「未記録に戻す」操作: 実際の出欠の記録を消して未回答状態に戻す
  if (candidate.clear === true) {
    return {
      practiceDayId: candidate.practiceDayId,
      memberId: candidate.memberId,
      start: "",
      end: "",
      breaks: [],
      absent: false,
      clear: true
    };
  }

  if (typeof candidate.absent !== "boolean") {
    return null;
  }

  if (!candidate.absent && (typeof candidate.start !== "string" || typeof candidate.end !== "string")) {
    return null;
  }

  return {
    practiceDayId: candidate.practiceDayId,
    memberId: candidate.memberId,
    start: typeof candidate.start === "string" ? candidate.start : "",
    end: typeof candidate.end === "string" ? candidate.end : "",
    breaks: Array.isArray(candidate.breaks)
      ? candidate.breaks
          .filter((item): item is AvailabilityBreak => {
            return !!item && typeof item === "object" && typeof item.start === "string" && typeof item.end === "string";
          })
          .map((item) => ({ start: item.start, end: item.end }))
      : [],
    absent: candidate.absent
  };
}

function patchAttendanceRecord(state: unknown, patch: AttendanceRecordPatch) {
  if (!state || typeof state !== "object") return null;

  const appState = state as AppStateLike;
  if (!Array.isArray(appState.practiceDays)) return null;

  let foundDay = false;
  const nextPracticeDays = appState.practiceDays.map((day) => {
    if (day.id !== patch.practiceDayId) return day;
    foundDay = true;

    const actualAvailabilities = Array.isArray(day.actualAvailabilities) ? day.actualAvailabilities : [];
    const actualAbsentMemberIds = Array.isArray(day.actualAbsentMemberIds)
      ? day.actualAbsentMemberIds.filter((id): id is string => typeof id === "string")
      : [];
    const actualRespondedMemberIds = Array.isArray(day.actualRespondedMemberIds)
      ? day.actualRespondedMemberIds.filter((id): id is string => typeof id === "string")
      : [];

    if (patch.clear) {
      return {
        ...day,
        actualAvailabilities: actualAvailabilities.filter((item) => item.memberId !== patch.memberId),
        actualAbsentMemberIds: actualAbsentMemberIds.filter((id) => id !== patch.memberId),
        actualRespondedMemberIds: actualRespondedMemberIds.filter((id) => id !== patch.memberId)
      };
    }

    return {
      ...day,
      actualAvailabilities: patch.absent
        ? actualAvailabilities.filter((item) => item.memberId !== patch.memberId)
        : [
            ...actualAvailabilities.filter((item) => item.memberId !== patch.memberId),
            { memberId: patch.memberId, start: patch.start, end: patch.end, breaks: patch.breaks }
          ],
      actualAbsentMemberIds: patch.absent
        ? Array.from(new Set([...actualAbsentMemberIds, patch.memberId]))
        : actualAbsentMemberIds.filter((id) => id !== patch.memberId),
      actualRespondedMemberIds: Array.from(new Set([...actualRespondedMemberIds, patch.memberId]))
    };
  });

  return foundDay ? { ...appState, practiceDays: nextPracticeDays } : null;
}

export async function PUT(request: NextRequest) {
  try {
    if (!readCurrentStateAllowed()) {
      return NextResponse.json({ error: STORAGE_NOT_CONFIGURED_MESSAGE }, { status: 500 });
    }

    const patch = parsePatch(await request.json());
    if (!patch) {
      return NextResponse.json({ error: "Invalid attendance record patch" }, { status: 400 });
    }

    const current = await readCurrentState();
    const nextState = patchAttendanceRecord(current.state, patch);
    if (!nextState) {
      return NextResponse.json({ error: "Practice day was not found" }, { status: 404 });
    }

    const stored = await writeCurrentState(nextState);

    return NextResponse.json({ ok: true, state: stored.state, updatedAt: stored.updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update attendance record" },
      { status: 500 }
    );
  }
}
