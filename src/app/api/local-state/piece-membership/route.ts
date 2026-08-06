import { NextRequest, NextResponse } from "next/server";
import { appendHistoryEntry } from "@/lib/history";

export const runtime = "nodejs";

const STATE_KEY = process.env.LOCAL_STATE_KEY ?? "nagosui:local-practice-state";
const STORAGE_NOT_CONFIGURED_MESSAGE = "Redis/KV storage is not configured";

type StoredLocalState = {
  state: unknown;
  updatedAt: string;
};

type PieceMembershipPatch = {
  pieceId: string;
  memberId: string;
  selected: boolean;
  actor: "self" | "admin";
};

type PieceLike = {
  id?: unknown;
  title?: unknown;
  memberIds?: unknown[];
  [key: string]: unknown;
};

type MemberLike = {
  id?: unknown;
  name?: unknown;
};

type AppStateLike = {
  pieces?: PieceLike[];
  members?: MemberLike[];
  [key: string]: unknown;
};

function findMemberName(state: unknown, memberId: string): string {
  if (!state || typeof state !== "object") return memberId;
  const members = (state as AppStateLike).members;
  if (!Array.isArray(members)) return memberId;
  const member = members.find((item) => item.id === memberId);
  return typeof member?.name === "string" && member.name ? member.name : memberId;
}

function findPieceTitle(state: unknown, pieceId: string): string {
  if (!state || typeof state !== "object") return pieceId;
  const pieces = (state as AppStateLike).pieces;
  if (!Array.isArray(pieces)) return pieceId;
  const piece = pieces.find((item) => item.id === pieceId);
  return typeof piece?.title === "string" && piece.title ? piece.title : pieceId;
}

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

function parsePatch(value: unknown): PieceMembershipPatch | null {
  const patch = value && typeof value === "object" && "patch" in value ? (value as { patch: unknown }).patch : value;
  if (!patch || typeof patch !== "object") return null;

  const candidate = patch as Partial<PieceMembershipPatch>;
  if (
    typeof candidate.pieceId !== "string" ||
    typeof candidate.memberId !== "string" ||
    typeof candidate.selected !== "boolean" ||
    (candidate.actor !== "self" && candidate.actor !== "admin")
  ) {
    return null;
  }

  return {
    pieceId: candidate.pieceId,
    memberId: candidate.memberId,
    selected: candidate.selected,
    actor: candidate.actor
  };
}

function patchPieceMembership(state: unknown, patch: PieceMembershipPatch) {
  if (!state || typeof state !== "object") return null;

  const appState = state as AppStateLike;
  if (!Array.isArray(appState.pieces)) return null;

  let foundPiece = false;
  const nextPieces = appState.pieces.map((piece) => {
    if (piece.id !== patch.pieceId) return piece;
    foundPiece = true;

    const memberIds = Array.isArray(piece.memberIds) ? piece.memberIds.filter((id): id is string => typeof id === "string") : [];

    return {
      ...piece,
      memberIds: patch.selected
        ? Array.from(new Set([...memberIds, patch.memberId]))
        : memberIds.filter((id) => id !== patch.memberId)
    };
  });

  return foundPiece ? { ...appState, pieces: nextPieces } : null;
}

export async function PUT(request: NextRequest) {
  try {
    if (!readCurrentStateAllowed()) {
      return NextResponse.json({ error: STORAGE_NOT_CONFIGURED_MESSAGE }, { status: 500 });
    }

    const patch = parsePatch(await request.json());
    if (!patch) {
      return NextResponse.json({ error: "Invalid piece membership patch" }, { status: 400 });
    }

    const current = await readCurrentState();
    const nextState = patchPieceMembership(current.state, patch);
    if (!nextState) {
      return NextResponse.json({ error: "Piece was not found" }, { status: 404 });
    }

    const stored = await writeCurrentState(nextState);

    await appendHistoryEntry({
      category: "piece-selection",
      pieceId: patch.pieceId,
      pieceTitle: findPieceTitle(current.state, patch.pieceId),
      memberName: findMemberName(current.state, patch.memberId),
      selected: patch.selected,
      actor: patch.actor
    }).catch(() => null);

    return NextResponse.json({ ok: true, state: stored.state, updatedAt: stored.updatedAt });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update piece membership" },
      { status: 500 }
    );
  }
}
