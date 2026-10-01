const HISTORY_KEY = process.env.LOCAL_HISTORY_KEY ?? "nagosui:local-activity-history";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const MAX_ENTRIES = 300;

type BaseEntry = {
  id: string;
  recordedAt: string;
};

export type SlackHistoryEntry = BaseEntry & {
  category: "slack";
  kind: "reminder" | "attendance-image" | "schedule-change";
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

// The activity history above is capped at MAX_ENTRIES and gets flooded by
// availability edits, so the last reminder per practice day is kept separately.
const LAST_REMINDER_KEY = process.env.LOCAL_LAST_REMINDER_KEY ?? "nagosui:last-slack-reminders";

export type LastReminder = {
  sentAt: string;
  summary: string;
};

type LastReminderMap = Record<string, LastReminder>;

function parseLastReminders(raw: string | null): LastReminderMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as LastReminderMap) : {};
  } catch {
    return {};
  }
}

async function lastReminderFilePath() {
  const path = await import("node:path");
  return path.join(process.cwd(), ".data", "last-slack-reminders.json");
}

async function readLastReminderMap(): Promise<LastReminderMap> {
  const redis = redisConfig();
  if (redis) {
    const response = await fetch(`${redis.url}/get/${encodeURIComponent(LAST_REMINDER_KEY)}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${redis.token}` },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Upstash read failed: ${response.status}`);
    const payload = (await response.json()) as { result?: string | null };
    return parseLastReminders(payload.result ?? null);
  }

  if (canUseFileFallback()) {
    try {
      const fs = await import("node:fs/promises");
      return parseLastReminders(await fs.readFile(await lastReminderFilePath(), "utf8"));
    } catch {
      return {};
    }
  }

  throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);
}

export async function readLastReminder(practiceDayId: string): Promise<LastReminder | null> {
  const map = await readLastReminderMap();
  if (map[practiceDayId]) return map[practiceDayId];

  // Reminders sent before this map existed only live in the activity history.
  const entries = await readHistory().catch(() => [] as HistoryEntry[]);
  const fromHistory = entries.find(
    (entry): entry is SlackHistoryEntry =>
      entry.category === "slack" && entry.kind === "reminder" && entry.practiceDayId === practiceDayId
  );
  return fromHistory ? { sentAt: fromHistory.recordedAt, summary: fromHistory.summary } : null;
}

let lastReminderWriteQueue: Promise<void> = Promise.resolve();

export function recordLastReminder(practiceDayId: string, reminder: LastReminder): Promise<void> {
  const task = lastReminderWriteQueue.then(async () => {
    const map = await readLastReminderMap().catch(() => ({}) as LastReminderMap);
    const next = { ...map, [practiceDayId]: reminder };
    const redis = redisConfig();

    if (redis) {
      const response = await fetch(`${redis.url}/set/${encodeURIComponent(LAST_REMINDER_KEY)}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${redis.token}`,
          "Content-Type": "text/plain"
        },
        body: JSON.stringify(next)
      });
      if (!response.ok) throw new Error(`Upstash write failed: ${response.status}`);
    } else if (canUseFileFallback()) {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const filePath = await lastReminderFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
    }
  });

  lastReminderWriteQueue = task.catch(() => undefined);
  return task;
}
