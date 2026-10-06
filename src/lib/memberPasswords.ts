import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

// 奏者のパスワードは共有データ（誰でも読める）には入れず、ハッシュ化してこの別キーに保存する。
const PASSWORDS_KEY = process.env.LOCAL_MEMBER_PASSWORDS_KEY ?? "nagosui:member-passwords";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";
// 管理画面の「パスワードをリセット」で入っていた旧形式の値（未設定扱い）
const LEGACY_UNSET_PASSWORD = "__unset__";
const SCRYPT_KEY_LENGTH = 32;

type PasswordRecords = Record<string, string>; // memberId -> "scrypt$<salt>$<hash>"

function redisConfig() {
  const url = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

function canUseFileFallback() {
  return process.env.NODE_ENV !== "production";
}

function parseRecords(raw: string | null): PasswordRecords {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

async function passwordsFilePath() {
  const path = await import("node:path");
  return path.join(process.cwd(), ".data", "member-passwords.json");
}

async function readRecords(): Promise<PasswordRecords> {
  const redis = redisConfig();
  if (redis) {
    const response = await fetch(`${redis.url}/get/${encodeURIComponent(PASSWORDS_KEY)}`, {
      headers: { Authorization: `Bearer ${redis.token}` },
      cache: "no-store"
    });
    if (!response.ok) throw new Error(`Upstash read failed: ${response.status}`);
    const payload = (await response.json()) as { result?: string | null };
    return parseRecords(payload.result ?? null);
  }

  if (!canUseFileFallback()) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);
  try {
    const fs = await import("node:fs/promises");
    return parseRecords(await fs.readFile(await passwordsFilePath(), "utf8"));
  } catch {
    return {};
  }
}

async function writeRecords(records: PasswordRecords) {
  const redis = redisConfig();
  if (redis) {
    const response = await fetch(`${redis.url}/set/${encodeURIComponent(PASSWORDS_KEY)}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${redis.token}`, "Content-Type": "text/plain" },
      body: JSON.stringify(records)
    });
    if (!response.ok) throw new Error(`Upstash write failed: ${response.status}`);
    return;
  }

  if (!canUseFileFallback()) throw new Error(STORAGE_NOT_CONFIGURED_MESSAGE);
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = await passwordsFilePath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(records, null, 2), "utf8");
}

// 同じプロセス内での読み書きを1件ずつ順番に行い、同時更新で記録が消えないようにする
let writeQueue: Promise<unknown> = Promise.resolve();

function updateRecords(update: (records: PasswordRecords) => PasswordRecords | null) {
  const task = writeQueue.then(async () => {
    const current = await readRecords();
    const next = update(current);
    if (next) await writeRecords(next);
    return next ?? current;
  });
  writeQueue = task.catch(() => undefined);
  return task;
}

function scryptAsync(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => (error ? reject(error) : resolve(derivedKey)));
  });
}

async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

async function verifyHash(password: string, stored: string) {
  const [scheme, saltBase64, hashBase64] = stored.split("$");
  if (scheme !== "scrypt" || !saltBase64 || !hashBase64) return false;
  const expected = Buffer.from(hashBase64, "base64");
  const actual = await scryptAsync(password, Buffer.from(saltBase64, "base64"));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function listPasswordMemberIds() {
  return Object.keys(await readRecords());
}

export async function hasMemberPassword(memberId: string) {
  return memberId in (await readRecords());
}

// 未設定のときだけ設定する（設定済みなら false）
export async function setMemberPasswordIfUnset(memberId: string, password: string) {
  const hashed = await hashPassword(password);
  let didSet = false;
  await updateRecords((records) => {
    if (records[memberId]) return null;
    didSet = true;
    return { ...records, [memberId]: hashed };
  });
  return didSet;
}

export async function verifyMemberPassword(memberId: string, password: string) {
  const stored = (await readRecords())[memberId];
  return stored ? verifyHash(password, stored) : false;
}

export async function resetMemberPassword(memberId: string) {
  await updateRecords((records) => {
    if (!(memberId in records)) return null;
    const { [memberId]: _removed, ...rest } = records;
    return rest;
  });
}

type MemberLike = { id?: unknown; password?: unknown; [key: string]: unknown };

// 共有データの members[].password を取り除いた状態を返す。取り除くものがなければ null。
export function stripMemberPasswords(state: unknown): unknown | null {
  if (!state || typeof state !== "object") return null;
  const members = (state as { members?: unknown }).members;
  if (!Array.isArray(members) || !members.some((member) => member && typeof member === "object" && "password" in member)) {
    return null;
  }

  return {
    ...(state as Record<string, unknown>),
    members: members.map((member: MemberLike) => {
      if (!member || typeof member !== "object" || !("password" in member)) return member;
      const { password: _password, ...rest } = member;
      return rest;
    })
  };
}

// 旧形式（共有データに平文で入っている）のパスワードを、ハッシュ化して別キーへ移す。
// 移し終えたら、パスワードを取り除いた共有データを返す（移すものがなければ null）。
export async function migratePlaintextMemberPasswords(state: unknown): Promise<unknown | null> {
  const stripped = stripMemberPasswords(state);
  if (!stripped) return null;

  const members = ((state as { members: MemberLike[] }).members ?? []).filter(
    (member): member is MemberLike & { id: string } => !!member && typeof member === "object" && typeof member.id === "string"
  );
  const toSet: Record<string, string> = {};
  const toReset: string[] = [];
  for (const member of members) {
    if (typeof member.password !== "string") continue;
    const password = member.password;
    if (password === LEGACY_UNSET_PASSWORD) toReset.push(member.id);
    else if (password.trim()) toSet[member.id] = await hashPassword(password);
  }

  // パスワードの移し替えが終わってから共有データ側を消す（逆順だと失敗時にパスワードが失われる）
  await updateRecords((records) => {
    const next = { ...records, ...toSet };
    for (const memberId of toReset) delete next[memberId];
    return next;
  });

  return stripped;
}
