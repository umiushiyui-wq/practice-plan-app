const HISTORY_KEY = process.env.LOCAL_HISTORY_KEY ?? "nagosui:local-activity-history";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const MAX_ENTRIES = 300;

type BaseEntry = {
  id: string;
  recordedAt: string;
};

export type SlackHistoryEntry = BaseEntry & {
  category: "slack";
  kind: "reminder" | "attendance-image";
  practiceDayId: string;
  practiceDateLabel: string;
  success: boolean;
  summary: string;
  detail?: string;
  part?: string;
  isTest?: boolean;
};

export type AvailabilityHistoryEntry = BaseEntry & {
  category: "availability";
  practiceDayId: string;
  practiceDateLabel: string;
  memberName: string;
  summary: string;
};

export type PieceSelectionHistoryEntry = BaseEntry & {
  category: "piece-selection";
  pieceId: string;
  pieceTitle: string;
  memberName: string;
  selected: boolean;
  actor: "self" | "admin";
};

export type HistoryEntry = SlackHistoryEntry | AvailabilityHistoryEntry | PieceSelectionHistoryEntry;

// Plain `Omit<HistoryEntry, K>` collapses the union to only its common keys.
// Distributing over each member first preserves the per-category fields.
type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;
type NewHistoryEntry = DistributiveOmit<HistoryEntry, "id" | "recordedAt">;

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function canUseFileFallback() {
  return process.env.NODE_ENV !== "production";
}

function parseEntries(raw: string | null): HistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

async function readFromRedis(): Promise<HistoryEntry[]> {
  const redis = redisConfig();
  if (!redis) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);

  const response = await fetch(`${redis.url}/get/${encodeURIComponent(HISTORY_KEY)}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${redis.token}` },
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Upstash read failed: ${response.status}`);
  }

  const payload = (await response.json()) as { result?: string | null };
  return parseEntries(payload.result ?? null);
}

async function writeToRedis(entries: HistoryEntry[]) {
  const redis = redisConfig();
  if (!redis) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);

  const response = await fetch(`${redis.url}/set/${encodeURIComponent(HISTORY_KEY)}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${redis.token}`,
      "Content-Type": "text/plain"
    },
    body: JSON.stringify(entries)
  });

  if (!response.ok) {
    throw new Error(`Upstash write failed: ${response.status}`);
  }
}

async function historyFilePath() {
  const path = await import("node:path");
  return path.join(process.cwd(), ".data", "local-activity-history.json");
}

async function readFromFile(): Promise<HistoryEntry[]> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(await historyFilePath(), "utf8");
    return parseEntries(content);
  } catch {
    return [];
  }
}

async function writeToFile(entries: HistoryEntry[]) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = await historyFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(entries, null, 2), "utf8");
}

export async function readHistory(): Promise<HistoryEntry[]> {
  if (redisConfig()) return readFromRedis();
  if (canUseFileFallback()) return readFromFile();
  throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);
}

// Concurrent read-modify-write cycles on the same key silently drop entries
// (a fast check/uncheck from a member's checkbox is enough to trigger this).
// Chaining onto this promise serializes appends within a single server process.
let writeQueue: Promise<void> = Promise.resolve();

export function appendHistoryEntry(entry: NewHistoryEntry): Promise<void> {
  const task = writeQueue.then(async () => {
    const fullEntry = {
      ...entry,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      recordedAt: new Date().toISOString()
    } as HistoryEntry;

    const existing = await readHistory().catch(() => [] as HistoryEntry[]);
    const next = [fullEntry, ...existing].slice(0, MAX_ENTRIES);

    if (redisConfig()) {
      await writeToRedis(next);
    } else if (canUseFileFallback()) {
      await writeToFile(next);
    }
  });

  writeQueue = task.catch(() => undefined);
  return task;
}
