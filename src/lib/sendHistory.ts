const HISTORY_KEY = process.env.LOCAL_SEND_HISTORY_KEY ?? "nagosui:send-history";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
const MAX_ENTRIES = 300;

export type SendHistoryEntry = {
  id: string;
  type: "reminder" | "attendance-image";
  sentAt: string;
  practiceDayId: string;
  practiceDateLabel: string;
  success: boolean;
  summary: string;
  detail?: string;
  part?: string;
  isTest?: boolean;
};

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function canUseFileFallback() {
  return process.env.NODE_ENV !== "production";
}

function parseEntries(raw: string | null): SendHistoryEntry[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SendHistoryEntry[]) : [];
  } catch {
    return [];
  }
}

async function readFromRedis(): Promise<SendHistoryEntry[]> {
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

async function writeToRedis(entries: SendHistoryEntry[]) {
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
  return path.join(process.cwd(), ".data", "local-send-history.json");
}

async function readFromFile(): Promise<SendHistoryEntry[]> {
  try {
    const fs = await import("node:fs/promises");
    const content = await fs.readFile(await historyFilePath(), "utf8");
    return parseEntries(content);
  } catch {
    return [];
  }
}

async function writeToFile(entries: SendHistoryEntry[]) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = await historyFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(entries, null, 2), "utf8");
}

export async function readSendHistory(): Promise<SendHistoryEntry[]> {
  if (redisConfig()) return readFromRedis();
  if (canUseFileFallback()) return readFromFile();
  throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);
}

export async function appendSendHistoryEntry(entry: Omit<SendHistoryEntry, "id" | "sentAt">): Promise<void> {
  const fullEntry: SendHistoryEntry = {
    ...entry,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    sentAt: new Date().toISOString()
  };

  const existing = await readSendHistory().catch(() => [] as SendHistoryEntry[]);
  const next = [fullEntry, ...existing].slice(0, MAX_ENTRIES);

  if (redisConfig()) {
    await writeToRedis(next);
  } else if (canUseFileFallback()) {
    await writeToFile(next);
  }
}
