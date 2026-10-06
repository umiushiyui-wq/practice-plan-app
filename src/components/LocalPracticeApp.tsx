"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { APP_OUTDATED_EVENT, APP_VERSION, APP_VERSION_HEADER } from "@/lib/appVersion";

export const INSTRUMENT_OPTIONS = [
  "ふるぼえ",
  "クラリネット",
  "サックス",
  "トランペット",
  "トロンボーン",
  "ホルン",
  "ユーフォニアム",
  "低音",
  "パーカッション"
];

const INSTRUMENT_ALIASES: Record<string, string> = {
  "フルート": "ふるぼえ"
};

export function normalizeInstrumentName(instrument: string) {
  const trimmed = instrument.trim();
  return INSTRUMENT_ALIASES[trimmed] ?? trimmed;
}

export function getInstrumentLabel(instrument: string) {
  return normalizeInstrumentName(instrument) || "未設定";
}

export function getInstrumentSortIndex(instrument: string) {
  const normalized = getInstrumentLabel(instrument);
  const index = INSTRUMENT_OPTIONS.indexOf(normalized);
  return index === -1 ? INSTRUMENT_OPTIONS.length : index;
}

export function getSortedInstrumentOptions(instruments: string[]) {
  const options = new Set(INSTRUMENT_OPTIONS);

  for (const instrument of instruments) {
    options.add(getInstrumentLabel(instrument));
  }

  return Array.from(options).sort((a, b) => {
    const order = getInstrumentSortIndex(a) - getInstrumentSortIndex(b);
    return order || a.localeCompare(b, "ja");
  });
}

export function compareMembersByInstrument<T extends { instrument: string; name: string }>(first: T, second: T) {
  const order = getInstrumentSortIndex(first.instrument) - getInstrumentSortIndex(second.instrument);
  return order || first.name.localeCompare(second.name, "ja");
}

// 乗り番のセクション名（例: "Fl 2nd", "A.Sax 1st", "St.B"）の先頭にある楽器略称をスコア順に並べる。
// ふるぼえ・低音のように1パートに複数楽器がいる場合も、パート内で楽器ごとにまとまるようにするため。
const CONDUCTOR_SECTION_ALIASES = ["cond", "conductor", "指揮", "指揮者"];
const ELECTRIC_BASS_SECTION_ALIASES = ["eb", "ebass", "elb", "elbass", "elecbass", "electricbass", "エレキベース", "エレベ", "エレキ"];
const SECTION_INSTRUMENT_ALIASES: string[][] = [
  CONDUCTOR_SECTION_ALIASES,
  ["picc", "pic", "ピッコロ"],
  ["fl", "flute", "フルート"],
  ["ob", "oboe", "オーボエ"],
  ["eh", "ehr", "englishhorn", "イングリッシュホルン"],
  ["fg", "bsn", "fag", "bassoon", "ファゴット", "バスーン"],
  ["escl", "esclarinet"],
  ["cl", "clarinet", "クラリネット"],
  ["acl", "altocl"],
  ["bcl", "bassclarinet", "バスクラ", "バスクラリネット"],
  ["ssax", "ssx"],
  ["asax", "asx", "アルト", "アルトサックス"],
  ["tsax", "tsx", "テナー", "テナーサックス"],
  ["bsax", "bsx", "バリトン", "バリトンサックス", "バリサク"],
  ["tp", "trp", "trumpet", "トランペット"],
  ["cor", "cornet", "コルネット"],
  ["flh", "flugelhorn"],
  ["hr", "hrn", "horn", "ホルン"],
  ["tb", "trb", "trombone", "トロンボーン"],
  ["btb", "btrb", "basstrombone", "バストロ", "バストロンボーン"],
  ["euph", "eup", "euphonium", "ユーフォ", "ユーフォニアム"],
  ["tu", "tuba", "チューバ"],
  ["stb", "cb", "kb", "contrabass", "コントラバス", "弦バス"],
  ELECTRIC_BASS_SECTION_ALIASES,
  ["perc", "timp", "ティンパニ", "パーカッション", "打楽器"]
];

const SECTION_INSTRUMENT_INDEX = new Map(
  SECTION_INSTRUMENT_ALIASES.flatMap((aliases, index) => aliases.map((alias) => [alias, index] as const))
);
const CONDUCTOR_SECTION_INDEX = SECTION_INSTRUMENT_ALIASES.indexOf(CONDUCTOR_SECTION_ALIASES);
const ELECTRIC_BASS_SECTION_INDEX = SECTION_INSTRUMENT_ALIASES.indexOf(ELECTRIC_BASS_SECTION_ALIASES);

export function normalizeSectionLabel(section: string) {
  return section.normalize("NFKC").trim().replace(/\s+/g, " ");
}

function getSectionSortKey(section: string) {
  const compact = normalizeSectionLabel(section).toLowerCase().replace(/[\s.\-_・]/g, "");
  const prefix = compact.match(/^[^\d]+/)?.[0] ?? "";
  const number = compact.match(/\d+/)?.[0];
  return {
    instrumentIndex: SECTION_INSTRUMENT_INDEX.get(prefix) ?? SECTION_INSTRUMENT_ALIASES.length,
    number: number === undefined ? Number.MAX_SAFE_INTEGER : Number(number)
  };
}

// 指揮者とエレキベースはパートを横断するので、セクションでパート自体を上書きする。
// Cond は全パートより上、E.B. は登録パートに関係なく低音パート(St.B の下)に並べる。
function getEffectivePartSortIndex(instrument: string, section: string) {
  if (section) {
    const { instrumentIndex } = getSectionSortKey(section);
    if (instrumentIndex === CONDUCTOR_SECTION_INDEX) return -1;
    if (instrumentIndex === ELECTRIC_BASS_SECTION_INDEX) return getInstrumentSortIndex("低音");
  }
  return getInstrumentSortIndex(instrument);
}

// パート順 → セクションの楽器(スコア順) → 番号(1st, 2nd...) → 名前。セクション未設定の人はパート内の最後。
export function compareMembersByInstrumentAndSection<T extends { id: string; instrument: string; name: string }>(
  first: T,
  second: T,
  memberSections: Record<string, string>
) {
  const firstSection = memberSections[first.id] ?? "";
  const secondSection = memberSections[second.id] ?? "";
  const partOrder =
    getEffectivePartSortIndex(first.instrument, firstSection) - getEffectivePartSortIndex(second.instrument, secondSection);
  if (partOrder) return partOrder;

  if (!firstSection || !secondSection) {
    if (firstSection !== secondSection) return firstSection ? -1 : 1;
    return first.name.localeCompare(second.name, "ja");
  }

  const firstKey = getSectionSortKey(firstSection);
  const secondKey = getSectionSortKey(secondSection);
  return (
    firstKey.instrumentIndex - secondKey.instrumentIndex ||
    firstKey.number - secondKey.number ||
    firstSection.localeCompare(secondSection, "ja", { numeric: true }) ||
    first.name.localeCompare(second.name, "ja")
  );
}

// 奏者のパスワードは共有データに入れない（サーバーでハッシュ化して別管理。設定済みかどうかは passwordMemberIds で分かる）
export type Member = {
  id: string;
  name: string;
  instrument: string;
  part: string;
  slackUserId?: string;
}

export type Piece = {
  id: string;
  title: string;
  conductorId: string;
  memberIds: string[];
  // memberId -> 乗り番のセクション名（例: "Tb 1st"）。キーは必ず memberIds に含まれる。
  memberSections: Record<string, string>;
  targetMinutes: number;
  dailyMaxMinutes: number;
  targetRangeStartDayId: string | null;
  targetRangeEndDayId: string | null;
  slackChannelId?: string;
};

export type AvailabilityBreak = {
  start: string;
  end: string;
};

export type Availability = {
  memberId: string;
  start: string;
  end: string;
  breaks: AvailabilityBreak[];
};

export type PlanSlot = {
  id: string;
  pieceId: string | null;
  customTitle?: string;
  start: string;
  end: string;
  duration: number;
  isLocked?: boolean;
  score?: number;
  reason?: string;
};

export type LocalPracticeDay = {
  id: string;
  practiceDate: string;
  location: string;
  startTime: string;
  endTime: string;
  availabilities: Availability[];
  absentMemberIds: string[];
  respondedMemberIds: string[];
  isPlanPublished: boolean;
  // 非公開の練習日（出欠の入力を求めない）。管理画面にだけ表示し、奏者向け画面・Slack送信からは除く。
  isPrivate: boolean;
  plan: PlanSlot[];
  // 「実際の出欠」（/admin/record 専用）。自己申告の availabilities 等とは独立して管理する。
  actualAvailabilities: Availability[];
  actualAbsentMemberIds: string[];
  actualRespondedMemberIds: string[];
  actualAttendanceSnapshotAt: string | null;
};

export type AppState = {
  members: Member[];
  pieces: Piece[];
  practiceDays: LocalPracticeDay[];
  selectedPracticeDayId: string;
  recentMinutes: Record<string, number>;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type AvailabilityPatch = {
  practiceDayId: string;
  memberId: string;
  start: string;
  end: string;
  breaks: AvailabilityBreak[];
  absent: boolean;
  clear?: boolean;
};

export type PieceMembershipPatch = {
  pieceId: string;
  memberId: string;
  selected: boolean;
  actor: "self" | "admin";
  // 指定時のみセクションを更新する（空文字で削除）。selected: false ならセクションも消える。
  section?: string;
};

export function applyPieceMembershipPatch(piece: Piece, patch: PieceMembershipPatch): Piece {
  if (!patch.selected) {
    const { [patch.memberId]: _removed, ...memberSections } = piece.memberSections;
    return { ...piece, memberIds: piece.memberIds.filter((id) => id !== patch.memberId), memberSections };
  }

  const memberIds = Array.from(new Set([...piece.memberIds, patch.memberId]));
  if (patch.section === undefined) return { ...piece, memberIds };

  const { [patch.memberId]: _previous, ...memberSections } = piece.memberSections;
  const section = normalizeSectionLabel(patch.section);
  return { ...piece, memberIds, memberSections: section ? { ...memberSections, [patch.memberId]: section } : memberSections };
}

export type AttendanceRecordPatch = {
  practiceDayId: string;
  memberId: string;
  start: string;
  end: string;
  breaks: AvailabilityBreak[];
  absent: boolean;
  clear?: boolean;
};

type LegacyPiece = Partial<Piece> & {
  id?: string;
  title?: string;
  conductorId?: string;
  memberIds?: string[];
  targetMinutes?: number;
  dailyMaxMinutes?: number;
};

type LegacyAppState = Partial<AppState> & {
  pieces?: LegacyPiece[];
  practiceDate?: string;
  startTime?: string;
  endTime?: string;
  availabilities?: Array<Partial<Availability> & { memberId?: string; start?: string; end?: string }>;
  plan?: PlanSlot[];
};

function normalizeAvailability(value: Partial<Availability> & { memberId?: string; start?: string; end?: string }): Availability {
  return {
    memberId: value.memberId ?? "",
    start: value.start ?? "",
    end: value.end ?? "",
    breaks: Array.isArray(value.breaks)
      ? value.breaks
          .filter((item): item is AvailabilityBreak => !!item && typeof item.start === "string" && typeof item.end === "string")
          .map((item) => ({ start: item.start, end: item.end }))
      : []
  };
}

const STORAGE_KEY = "nagosui-local-practice-app-v3";
const LEGACY_STORAGE_KEY = "nagosui-local-practice-app-v2";
const SETUP_CLEANUP_MINUTES = 45;
const SETUP_SLOT_TITLE = "\u5408\u594f\u6e96\u5099";
const CLEANUP_SLOT_TITLE = "\u7247\u4ed8\u3051";
const SETUP_SLOT_REASON = "\u5408\u594f\u6e96\u5099\u3068\u3057\u3066\u81ea\u52d5\u914d\u7f6e\u3057\u305f\u67a0\u3067\u3059\u3002";
const CLEANUP_SLOT_REASON = "\u7247\u4ed8\u3051\u3068\u3057\u3066\u81ea\u52d5\u914d\u7f6e\u3057\u305f\u67a0\u3067\u3059\u3002";

function isSetupUtilitySlot(slot: PlanSlot) {
  if (slot.pieceId) return false;
  const text = `${slot.customTitle ?? ""} ${slot.reason ?? ""}`;
  return text.includes(SETUP_SLOT_TITLE) || text.includes("\u6e96\u5099");
}

function isCleanupUtilitySlot(slot: PlanSlot) {
  if (slot.pieceId) return false;
  const text = `${slot.customTitle ?? ""} ${slot.reason ?? ""}`;
  return text.includes(CLEANUP_SLOT_TITLE) || text.includes("\u7247\u4ed8\u3051");
}

function makeUtilityPlanSlot(kind: "setup" | "cleanup", start: string, end: string, existing?: PlanSlot): PlanSlot {
  const startMinutes = toMinutes(start);
  const endMinutes = toMinutes(end);
  return {
    ...existing,
    id: existing?.id ?? makeId("s"),
    pieceId: null,
    customTitle: kind === "setup" ? SETUP_SLOT_TITLE : CLEANUP_SLOT_TITLE,
    start,
    end,
    duration: Math.max(0, endMinutes - startMinutes),
    isLocked: true,
    reason: kind === "setup" ? SETUP_SLOT_REASON : CLEANUP_SLOT_REASON
  };
}

export function ensureDefaultUtilitySlots(day: LocalPracticeDay): LocalPracticeDay {
  const plan = Array.isArray(day.plan) ? day.plan : [];
  const practiceStart = toMinutes(day.startTime);
  const practiceEnd = toMinutes(day.endTime);

  const setupSlot = plan.find(isSetupUtilitySlot);
  const cleanupSlot = plan.find(isCleanupUtilitySlot);

  // 既存の準備・片付け枠は編集された長さ・位置をそのまま尊重する。
  // 初期値45分は、枠が無いとき（＝練習日を追加した直後の空の計画）だけ最初/最後に補う。
  if (setupSlot && cleanupSlot) {
    return { ...day, plan: sortPlanByTime(plan) };
  }

  if (!Number.isFinite(practiceStart) || !Number.isFinite(practiceEnd) || practiceEnd - practiceStart < SETUP_CLEANUP_MINUTES * 2) {
    return { ...day, plan };
  }

  const nextPlan = [...plan];

  if (!setupSlot) {
    nextPlan.push(
      makeUtilityPlanSlot("setup", day.startTime, toTime(practiceStart + SETUP_CLEANUP_MINUTES))
    );
  }

  if (!cleanupSlot) {
    nextPlan.push(
      makeUtilityPlanSlot("cleanup", toTime(practiceEnd - SETUP_CLEANUP_MINUTES), day.endTime)
    );
  }

  return { ...day, plan: sortPlanByTime(nextPlan) };
}
const SAVE_ERROR_MESSAGE = "保存できていません。ネットワークまたはRedis/KV設定を確認してください。";

function defaultPracticeDay(): LocalPracticeDay {
  return ensureDefaultUtilitySlots({
    id: "d1",
    practiceDate: new Date().toISOString().slice(0, 10),
    location: "",
    startTime: "18:00",
    endTime: "21:00",
    availabilities: [],
    absentMemberIds: [],
    respondedMemberIds: [],
    isPlanPublished: false,
    isPrivate: false,
    plan: [],
    actualAvailabilities: [],
    actualAbsentMemberIds: [],
    actualRespondedMemberIds: [],
    actualAttendanceSnapshotAt: null
  });
}

const defaultDay = defaultPracticeDay();

const defaultState: AppState = {
  members: [
    { id: "m1", name: "奏者1", instrument: "", part: "" },
    { id: "m2", name: "指揮者", instrument: "", part: "指揮" }
  ],
  pieces: [],
  practiceDays: [defaultDay],
  selectedPracticeDayId: defaultDay.id,
  recentMinutes: {}
};

export function makeId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function toMinutes(time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

export function toTime(minutes: number) {
  return `${Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0")}:${(minutes % 60).toString().padStart(2, "0")}`;
}

const DEFAULT_SLOT_RANGE = { startMin: 8 * 60, endMin: 22 * 60 };

// 表示する練習日の和集合（最早start〜最遅end）を返す。妥当な範囲が無ければ既定の8:00-22:00。
export function getAvailabilityRange(days: Array<{ startTime: string; endTime: string }>) {
  let startMin = Number.POSITIVE_INFINITY;
  let endMin = Number.NEGATIVE_INFINITY;

  for (const day of days) {
    const start = toMinutes(day.startTime);
    const end = toMinutes(day.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) continue;
    startMin = Math.min(startMin, start);
    endMin = Math.max(endMin, end);
  }

  if (!Number.isFinite(startMin) || !Number.isFinite(endMin)) return { ...DEFAULT_SLOT_RANGE };
  return { startMin, endMin };
}

// 練習時間帯の前後に余白(既定60分)を取り、時単位にスナップした step 刻みの分配列を返す。
export function buildAvailabilitySlots(startMin: number, endMin: number, padMin = 60, step = 10) {
  if (!Number.isFinite(startMin) || !Number.isFinite(endMin) || startMin >= endMin) {
    startMin = DEFAULT_SLOT_RANGE.startMin;
    endMin = DEFAULT_SLOT_RANGE.endMin;
  }

  const from = Math.max(0, Math.floor((startMin - padMin) / 60) * 60);
  const to = Math.min(24 * 60, Math.ceil((endMin + padMin) / 60) * 60);
  const length = Math.floor((to - from) / step) + 1;

  return Array.from({ length: Math.max(1, length) }, (_, index) => from + index * step);
}

function normalizeMemberSections(value: unknown, memberIds: string[]) {
  if (!value || typeof value !== "object") return {};
  const memberIdSet = new Set(memberIds);
  const sections: Record<string, string> = {};

  for (const [memberId, section] of Object.entries(value as Record<string, unknown>)) {
    if (!memberIdSet.has(memberId) || typeof section !== "string") continue;
    const normalized = normalizeSectionLabel(section);
    if (normalized) sections[memberId] = normalized;
  }

  return sections;
}

function normalizePiece(piece: LegacyPiece): Piece {
  const memberIds = Array.isArray(piece.memberIds) ? piece.memberIds : [];
  return {
    id: piece.id ?? makeId("p"),
    title: piece.title ?? "",
    conductorId: piece.conductorId ?? "",
    memberIds,
    memberSections: normalizeMemberSections(piece.memberSections, memberIds),
    targetMinutes: Number(piece.targetMinutes ?? 60),
    dailyMaxMinutes: Number(piece.dailyMaxMinutes ?? 45),
    targetRangeStartDayId: piece.targetRangeStartDayId ?? null,
    targetRangeEndDayId: piece.targetRangeEndDayId ?? null,
    slackChannelId: typeof piece.slackChannelId === "string" ? piece.slackChannelId : ""
  };
}

function didMigrateState(original: unknown, migrated: AppState) {
  try {
    return JSON.stringify(original) !== JSON.stringify(migrated);
  } catch {
    return true;
  }
}

function migrateState(value: unknown): AppState {
  if (!value || typeof value !== "object") return defaultState;

  const saved = value as LegacyAppState;
  const members = Array.isArray(saved.members)
    ? saved.members.map((member) => {
        // 旧データに残っているパスワードは画面側では持たない
        const { password: _password, ...rest } = member as Member & { password?: unknown };
        return { ...rest, slackUserId: typeof member.slackUserId === "string" ? member.slackUserId : "" };
      })
    : defaultState.members;
  const pieces = Array.isArray(saved.pieces) ? saved.pieces.map(normalizePiece) : defaultState.pieces;
  const recentMinutes = saved.recentMinutes ?? {};

  if (Array.isArray(saved.practiceDays) && saved.practiceDays.length > 0) {
    return {
      members,
      pieces,
      recentMinutes,
      practiceDays: saved.practiceDays.map((day) =>
        ensureDefaultUtilitySlots({
          ...day,
          location: typeof day.location === "string" ? day.location : "",
          absentMemberIds: day.absentMemberIds ?? [],
          respondedMemberIds: day.respondedMemberIds ?? [],
          isPlanPublished: typeof day.isPlanPublished === "boolean" ? day.isPlanPublished : false,
          isPrivate: day.isPrivate === true,
          availabilities: Array.isArray(day.availabilities) ? day.availabilities.map(normalizeAvailability) : [],
          plan: Array.isArray(day.plan) ? day.plan : [],
          actualAvailabilities: Array.isArray(day.actualAvailabilities)
            ? day.actualAvailabilities.map(normalizeAvailability)
            : [],
          actualAbsentMemberIds: Array.isArray(day.actualAbsentMemberIds) ? day.actualAbsentMemberIds : [],
          actualRespondedMemberIds: Array.isArray(day.actualRespondedMemberIds) ? day.actualRespondedMemberIds : [],
          actualAttendanceSnapshotAt:
            typeof day.actualAttendanceSnapshotAt === "string" ? day.actualAttendanceSnapshotAt : null
        })
      ),
      selectedPracticeDayId: saved.selectedPracticeDayId ?? saved.practiceDays[0].id
    };
  }

  const migratedDay: LocalPracticeDay = {
    id: "d1",
    practiceDate: saved.practiceDate ?? defaultDay.practiceDate,
    location: "",
    startTime: saved.startTime ?? defaultDay.startTime,
    endTime: saved.endTime ?? defaultDay.endTime,
    availabilities: Array.isArray(saved.availabilities) ? saved.availabilities.map(normalizeAvailability) : defaultDay.availabilities,
    absentMemberIds: [],
    respondedMemberIds: [],
    isPlanPublished: false,
    isPrivate: false,
    plan: saved.plan ?? [],
    actualAvailabilities: [],
    actualAbsentMemberIds: [],
    actualRespondedMemberIds: [],
    actualAttendanceSnapshotAt: null
  };

  return {
    members,
    pieces,
    recentMinutes,
    practiceDays: [ensureDefaultUtilitySlots(migratedDay)],
    selectedPracticeDayId: migratedDay.id
  };
}

type LocalStatePayload = {
  state: unknown | null;
  updatedAt?: string | null;
  appVersion?: string;
  passwordMemberIds?: string[];
};

// 一度でも新しいバージョンを検知したら、再読み込みするまで全体保存を止める（ページを開き直すとリセットされる）
let isAppOutdated = false;

// サーバーが新しいバージョンのとき、共通のポップアップを出す
function notifyIfAppOutdated(serverAppVersion: string | undefined) {
  if (!serverAppVersion || serverAppVersion === APP_VERSION) return false;
  isAppOutdated = true;
  window.dispatchEvent(new Event(APP_OUTDATED_EVENT));
  return true;
}

class OutdatedClientError extends Error {}

function readLocalSavedState() {
  if (typeof window === "undefined") return null;

  for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
    const saved = localStorage.getItem(key);
    if (!saved) continue;

    try {
      return JSON.parse(saved) as unknown;
    } catch {
      return null;
    }
  }

  return null;
}

const OUTDATED_CLIENT_MESSAGE = "新しいバージョンが公開されています。ページを再読み込みしてください。再読み込みするまで、この画面からの保存は止めています。";
const STALE_STATE_MESSAGE =
  "他の画面でデータが更新されていたため、この画面の変更は保存せず最新のデータを読み込み直しました。必要ならもう一度操作してください。";
const SELECTED_PRACTICE_DAY_STORAGE_KEY = "nagosui:selected-practice-day-id";

// 表示する練習日の選択はブラウザごとの設定として持つ（サーバーには保存しない）
function readLocalSelectedPracticeDayId() {
  try {
    return localStorage.getItem(SELECTED_PRACTICE_DAY_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeLocalSelectedPracticeDayId(practiceDayId: string) {
  try {
    localStorage.setItem(SELECTED_PRACTICE_DAY_STORAGE_KEY, practiceDayId);
  } catch {
    // 選択の記憶は補助的なものなので、保存できなくても動作は続ける
  }
}

function cacheStateLocally(state: AppState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage is a backup cache only. Server persistence remains authoritative.
  }
}

async function fetchServerState(): Promise<LocalStatePayload> {
  const response = await fetch("/api/local-state", { cache: "no-store" });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to load shared state");
  }

  const payload = (await response.json()) as LocalStatePayload;
  notifyIfAppOutdated(payload.appVersion);
  return payload;
}

// 全体保存が、他の画面での更新と衝突したとき（サーバーの版が読み込んだ時点と違う）に投げる
class StaleStateError extends Error {
  constructor(readonly serverState: unknown, readonly serverUpdatedAt: string | null) {
    super(STALE_STATE_MESSAGE);
  }
}

async function putServerState(state: AppState, baseUpdatedAt: string | null) {
  const response = await fetch("/api/local-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json", [APP_VERSION_HEADER]: APP_VERSION },
    body: JSON.stringify({ state, baseUpdatedAt })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    if (response.status === 409 && payload?.outdated) {
      notifyIfAppOutdated(payload.appVersion);
      throw new OutdatedClientError(OUTDATED_CLIENT_MESSAGE);
    }
    if (response.status === 409 && payload?.conflict) {
      throw new StaleStateError(payload.state ?? null, payload.updatedAt ?? null);
    }
    throw new Error(payload?.error ?? SAVE_ERROR_MESSAGE);
  }

  return (await response.json()) as { ok: true; updatedAt?: string | null };
}

async function putAvailabilityPatch(patch: AvailabilityPatch) {
  const response = await fetch("/api/local-state/availability", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? SAVE_ERROR_MESSAGE);
  }

  return (await response.json()) as { ok: true; state: unknown; updatedAt?: string | null };
}

async function putAttendanceRecordPatch(patch: AttendanceRecordPatch) {
  const response = await fetch("/api/local-state/attendance-record", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? SAVE_ERROR_MESSAGE);
  }

  return (await response.json()) as { ok: true; state: unknown; updatedAt?: string | null };
}

async function postAttendanceRecordSnapshot(practiceDayId: string) {
  const response = await fetch("/api/local-state/attendance-record/snapshot", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ practiceDayId })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? SAVE_ERROR_MESSAGE);
  }

  return (await response.json()) as { ok: true; state: unknown; updatedAt?: string | null };
}

async function putPieceMembershipPatches(patches: PieceMembershipPatch[]) {
  const response = await fetch("/api/local-state/piece-membership", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patches })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? SAVE_ERROR_MESSAGE);
  }

  return (await response.json()) as { ok: true; state: unknown; updatedAt?: string | null };
}

async function putPieceMembershipPatch(patch: PieceMembershipPatch) {
  const response = await fetch("/api/local-state/piece-membership", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ patch })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? SAVE_ERROR_MESSAGE);
  }

  return (await response.json()) as { ok: true; state: unknown; updatedAt?: string | null };
}

export function useLocalPracticeState() {
  // rawState はサーバーと同じ内容。画面に返す state は、練習日の選択だけをこのブラウザの選択で上書きしたもの。
  const [rawState, setState] = useState<AppState>(defaultState);
  const [localSelectedPracticeDayId, setLocalSelectedPracticeDayId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);
  // パスワード設定済みの奏者（パスワード自体はブラウザに来ない）
  const [passwordMemberIds, setPasswordMemberIdList] = useState<string[]>([]);
  const [hasLocalMigrationCandidate, setHasLocalMigrationCandidate] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const shouldPersistRef = useRef(false);
  const saveSequenceRef = useRef(0);
  // 全体保存に付けて送る「読み込んだ時点の版」。保存のたびに最新へ更新する。
  const serverUpdatedAtRef = useRef<string | null>(null);
  // 全体保存を1件ずつ順番に送るためのキュー（自分の保存同士で版が衝突しないように）
  const fullSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const state = useMemo(
    () =>
      localSelectedPracticeDayId && rawState.practiceDays.some((day) => day.id === localSelectedPracticeDayId)
        ? { ...rawState, selectedPracticeDayId: localSelectedPracticeDayId }
        : rawState,
    [localSelectedPracticeDayId, rawState]
  );

  function rememberServerUpdatedAt(updatedAt: string | null) {
    serverUpdatedAtRef.current = updatedAt;
    setServerUpdatedAt(updatedAt);
  }

  useEffect(() => {
    setLocalSelectedPracticeDayId(readLocalSelectedPracticeDayId());
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const payload = await fetchServerState();
        if (cancelled) return;

        if (payload.state) {
          const migrated = migrateState(payload.state);
          shouldPersistRef.current = didMigrateState(payload.state, migrated);
          setState(migrated);
          cacheStateLocally(migrated);
          setHasLocalMigrationCandidate(false);
        } else {
          shouldPersistRef.current = false;
          setState(defaultState);
          setHasLocalMigrationCandidate(readLocalSavedState() !== null);
        }
        rememberServerUpdatedAt(payload.updatedAt ?? null);
        setPasswordMemberIdList(payload.passwordMemberIds ?? []);
        setSaveError("");
        setSaveStatus("idle");
      } catch {
        if (cancelled) return;
        shouldPersistRef.current = false;
        setState(defaultState);
        setHasLocalMigrationCandidate(false);
        setSaveStatus("error");
        setSaveError(SAVE_ERROR_MESSAGE);
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    loadState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !shouldPersistRef.current) return;

    const sequence = ++saveSequenceRef.current;
    const stateToSave = rawState;
    const timeout = window.setTimeout(() => {
      if (isAppOutdated) {
        window.dispatchEvent(new Event(APP_OUTDATED_EVENT));
        setSaveStatus("error");
        setSaveError(OUTDATED_CLIENT_MESSAGE);
        return;
      }

      setSaveStatus("saving");
      setSaveError("");

      fullSaveQueueRef.current = fullSaveQueueRef.current.then(() =>
        putServerState(stateToSave, serverUpdatedAtRef.current)
          .then((payload) => {
            serverUpdatedAtRef.current = payload.updatedAt ?? null;
            if (sequence !== saveSequenceRef.current) return;
            // この保存より後の編集がなければ、未保存の変更なしとして扱う（フォーカス時の再読み込みを許可する）
            shouldPersistRef.current = false;
            setSaveStatus("saved");
            rememberServerUpdatedAt(payload.updatedAt ?? null);
            cacheStateLocally(stateToSave);
          })
          .catch((error: unknown) => {
            if (error instanceof StaleStateError) {
              // 古い状態で上書きせず、サーバーの最新を読み込み直す
              const latest = error.serverState ? migrateState(error.serverState) : null;
              shouldPersistRef.current = false;
              saveSequenceRef.current += 1;
              if (latest) {
                setState(latest);
                cacheStateLocally(latest);
              }
              rememberServerUpdatedAt(error.serverUpdatedAt);
              setSaveStatus("error");
              setSaveError(STALE_STATE_MESSAGE);
              return;
            }
            if (sequence !== saveSequenceRef.current) return;
            setSaveStatus("error");
            setSaveError(error instanceof OutdatedClientError ? OUTDATED_CLIENT_MESSAGE : SAVE_ERROR_MESSAGE);
          })
      );
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [ready, rawState]);

  // タブに戻ってきたときにサーバーの最新を読み込み直し、古い状態のまま操作しないようにする。
  // 未保存の変更があるとき（全体保存待ち）は上書きしない。
  useEffect(() => {
    if (!ready) return;

    async function refreshIfStale() {
      if (document.visibilityState !== "visible") return;
      try {
        // 未保存の変更があっても新バージョンの検知はしたいので、取得自体は毎回行う
        const payload = await fetchServerState();
        setPasswordMemberIdList(payload.passwordMemberIds ?? []);
        if (isAppOutdated || shouldPersistRef.current || !payload.state) return;
        if ((payload.updatedAt ?? null) === serverUpdatedAtRef.current) return;
        const migrated = migrateState(payload.state);
        setState(migrated);
        cacheStateLocally(migrated);
        rememberServerUpdatedAt(payload.updatedAt ?? null);
      } catch {
        // 再読み込みに失敗しても、次の保存時の版チェックで古い上書きは防がれる
      }
    }

    window.addEventListener("focus", refreshIfStale);
    document.addEventListener("visibilitychange", refreshIfStale);
    return () => {
      window.removeEventListener("focus", refreshIfStale);
      document.removeEventListener("visibilitychange", refreshIfStale);
    };
  }, [ready]);

  function updateFullState(value: AppState | ((current: AppState) => AppState)) {
    shouldPersistRef.current = true;
    setState(value);
  }

  function updateState(patch: Partial<AppState>) {
    // 練習日の選択はこのブラウザだけの設定にし、サーバーへの全体保存を起こさない
    const { selectedPracticeDayId, ...sharedPatch } = patch;
    if (selectedPracticeDayId !== undefined) {
      setLocalSelectedPracticeDayId(selectedPracticeDayId);
      writeLocalSelectedPracticeDayId(selectedPracticeDayId);
    }
    if (Object.keys(sharedPatch).length === 0) return;

    shouldPersistRef.current = true;
    setState((current) => ({ ...current, ...sharedPatch }));
  }

  async function reloadServerState() {
    setIsReloading(true);
    try {
      const payload = await fetchServerState();
      shouldPersistRef.current = false;

      if (payload.state) {
        const migrated = migrateState(payload.state);
        shouldPersistRef.current = didMigrateState(payload.state, migrated);
        setState(migrated);
        cacheStateLocally(migrated);
        setHasLocalMigrationCandidate(false);
      } else {
        setState(defaultState);
        setHasLocalMigrationCandidate(readLocalSavedState() !== null);
      }

      rememberServerUpdatedAt(payload.updatedAt ?? null);
      setPasswordMemberIdList(payload.passwordMemberIds ?? []);
      setSaveStatus("idle");
      setSaveError("");
    } catch {
      setSaveStatus("error");
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      setIsReloading(false);
    }
  }

  async function migrateLocalStateToServer() {
    const localState = readLocalSavedState();
    if (!localState) {
      setHasLocalMigrationCandidate(false);
      return;
    }

    setSaveStatus("saving");
    setSaveError("");

    try {
      const currentServer = await fetchServerState();
      if (currentServer.state) {
        const migratedServerState = migrateState(currentServer.state);
        shouldPersistRef.current = didMigrateState(currentServer.state, migratedServerState);
        setState(migratedServerState);
        cacheStateLocally(migratedServerState);
        rememberServerUpdatedAt(currentServer.updatedAt ?? null);
        setHasLocalMigrationCandidate(false);
        setSaveStatus("saved");
        return;
      }

      const migratedLocalState = migrateState(localState);
      const payload = await putServerState(migratedLocalState, currentServer.updatedAt ?? null);
      shouldPersistRef.current = false;
      setState(migratedLocalState);
      cacheStateLocally(migratedLocalState);
      rememberServerUpdatedAt(payload.updatedAt ?? null);
      setHasLocalMigrationCandidate(false);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      setSaveError(SAVE_ERROR_MESSAGE);
    }
  }

  async function saveAvailabilityPatch(patch: AvailabilityPatch) {
    setSaveStatus("saving");
    setSaveError("");

    try {
      const saved = await putAvailabilityPatch(patch);
      const nextState = saved.state ? migrateState(saved.state) : rawState;
      shouldPersistRef.current = false;
      setState(nextState);
      cacheStateLocally(nextState);
      rememberServerUpdatedAt(saved.updatedAt ?? null);
      setHasLocalMigrationCandidate(false);
      setSaveStatus("saved");
      return nextState;
    } catch {
      setSaveStatus("error");
      setSaveError(SAVE_ERROR_MESSAGE);
      return null;
    }
  }

  async function savePieceMembership(patch: PieceMembershipPatch) {
    setSaveStatus("saving");
    setSaveError("");

    // pieces[].memberIds drives a controlled checkbox, so update it optimistically
    // here (bypassing the debounced full-state save) — otherwise React snaps the
    // checkbox back to its previous value the instant the click handler returns,
    // before the request round-trips.
    const previousState = rawState;
    const optimisticState: AppState = {
      ...rawState,
      pieces: rawState.pieces.map((piece) => (piece.id === patch.pieceId ? applyPieceMembershipPatch(piece, patch) : piece))
    };
    shouldPersistRef.current = false;
    setState(optimisticState);

    try {
      const saved = await putPieceMembershipPatch(patch);
      const nextState = saved.state ? migrateState(saved.state) : optimisticState;
      shouldPersistRef.current = false;
      setState(nextState);
      cacheStateLocally(nextState);
      rememberServerUpdatedAt(saved.updatedAt ?? null);
      setHasLocalMigrationCandidate(false);
      setSaveStatus("saved");
      return nextState;
    } catch {
      shouldPersistRef.current = false;
      setState(previousState);
      setSaveStatus("error");
      setSaveError(SAVE_ERROR_MESSAGE);
      return null;
    }
  }

  // 乗り番表からの一括保存。サーバーの結果で state を置き換えるので楽観的更新はしない。
  async function savePieceMembershipPatches(patches: PieceMembershipPatch[]) {
    setSaveStatus("saving");
    setSaveError("");

    try {
      const saved = await putPieceMembershipPatches(patches);
      const nextState = saved.state ? migrateState(saved.state) : rawState;
      shouldPersistRef.current = false;
      setState(nextState);
      cacheStateLocally(nextState);
      rememberServerUpdatedAt(saved.updatedAt ?? null);
      setHasLocalMigrationCandidate(false);
      setSaveStatus("saved");
      return nextState;
    } catch {
      setSaveStatus("error");
      setSaveError(SAVE_ERROR_MESSAGE);
      return null;
    }
  }

  async function saveAttendanceRecordPatch(patch: AttendanceRecordPatch) {
    setSaveStatus("saving");
    setSaveError("");

    try {
      const saved = await putAttendanceRecordPatch(patch);
      const nextState = saved.state ? migrateState(saved.state) : rawState;
      shouldPersistRef.current = false;
      setState(nextState);
      cacheStateLocally(nextState);
      rememberServerUpdatedAt(saved.updatedAt ?? null);
      setHasLocalMigrationCandidate(false);
      setSaveStatus("saved");
      return nextState;
    } catch {
      setSaveStatus("error");
      setSaveError(SAVE_ERROR_MESSAGE);
      return null;
    }
  }

  // 練習日当日7:00(JST)以降に初めて開かれたとき、自己申告データを「実際の出欠」の初期値としてコピーする。
  // 既にコピー済み(actualAttendanceSnapshotAt が設定済み)ならサーバー側が何もせず現状態を返す。
  async function ensureAttendanceRecordSnapshot(practiceDayId: string) {
    try {
      const saved = await postAttendanceRecordSnapshot(practiceDayId);
      const nextState = saved.state ? migrateState(saved.state) : rawState;
      shouldPersistRef.current = false;
      setState(nextState);
      cacheStateLocally(nextState);
      rememberServerUpdatedAt(saved.updatedAt ?? null);
      return nextState;
    } catch {
      return null;
    }
  }

  return {
    state,
    setState: updateFullState,
    updateState,
    ready,
    saveStatus,
    saveError,
    serverUpdatedAt,
    hasLocalMigrationCandidate,
    isReloading,
    reloadServerState,
    migrateLocalStateToServer,
    passwordMemberIds,
    setPasswordMemberIds: setPasswordMemberIdList,
    saveAvailabilityPatch,
    savePieceMembership,
    savePieceMembershipPatches,
    saveAttendanceRecordPatch,
    ensureAttendanceRecordSnapshot
  };
}

type LocalStateStatusPanelProps = Pick<
  ReturnType<typeof useLocalPracticeState>,
  | "ready"
  | "saveStatus"
  | "saveError"
  | "serverUpdatedAt"
  | "hasLocalMigrationCandidate"
  | "isReloading"
  | "reloadServerState"
  | "migrateLocalStateToServer"
>;

export function LocalStateStatusPanel({
  ready,
  saveStatus,
  saveError,
  serverUpdatedAt,
  hasLocalMigrationCandidate,
  isReloading,
  reloadServerState,
  migrateLocalStateToServer
}: LocalStateStatusPanelProps) {
  const statusLabel =
    saveStatus === "saving"
      ? "保存中"
      : saveStatus === "saved"
        ? "保存成功"
        : saveStatus === "error"
          ? "保存失敗"
          : "共有データ";

  return (
    <section className={`local-state-panel ${saveStatus === "error" ? "error" : "notice"}`}>
      <div className="row page-section-head">
        <div>
          <strong>{ready ? statusLabel : "共有データを読み込み中"}</strong>
          {serverUpdatedAt ? <p className="muted">最終保存: {new Date(serverUpdatedAt).toLocaleString("ja-JP")}</p> : null}
          {saveStatus === "error" && saveError ? <p>{saveError}</p> : null}
        </div>
        <button className="secondary" type="button" onClick={reloadServerState} disabled={isReloading}>
          {isReloading ? "再読み込み中" : "最新データを再読み込み"}
        </button>
      </div>
      {hasLocalMigrationCandidate ? (
        <div className="local-state-migration">
          <p>この端末に保存されている旧データがあります。これを共有データとしてサーバーへ移行しますか？</p>
          <button type="button" onClick={migrateLocalStateToServer} disabled={saveStatus === "saving"}>
            旧データをサーバーへ移行
          </button>
        </div>
      ) : null}
    </section>
  );
}

export function getSelectedPracticeDay(state: AppState) {
  return state.practiceDays.find((day) => day.id === state.selectedPracticeDayId) ?? state.practiceDays[0];
}

export function formatPracticeDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  const weekdays = ["\u65e5", "\u6708", "\u706b", "\u6c34", "\u6728", "\u91d1", "\u571f"];
  return `${date}\uff08${weekdays[parsed.getDay()]}\uff09`;
}

export function getPracticeDayLabel(day: Pick<LocalPracticeDay, "practiceDate" | "location">) {
  const location = day.location.trim();
  const dateLabel = formatPracticeDateLabel(day.practiceDate);
  return location ? `${dateLabel}\uff20${location}` : dateLabel;
}

export function updatePracticeDay(
  state: AppState,
  dayId: string,
  patch: Partial<LocalPracticeDay>
): LocalPracticeDay[] {
  return state.practiceDays.map((day) => (day.id === dayId ? { ...day, ...patch } : day));
}

// 奏者向け画面（ホーム・奏者ページ・練習表）に出す練習日（非公開の日を除く）
export function getPublicPracticeDays(practiceDays: LocalPracticeDay[]) {
  return practiceDays.filter((day) => !day.isPrivate);
}

// 管理画面の練習日の選択肢などで、非公開の日に付ける印
export function getPrivateDayMark(day: Pick<LocalPracticeDay, "isPrivate">) {
  return day.isPrivate ? "🔒非公開 " : "";
}

export function getSortedPracticeDays(practiceDays: LocalPracticeDay[]) {
  return [...practiceDays].sort(
    (a, b) =>
      new Date(`${a.practiceDate}T00:00:00`).getTime() - new Date(`${b.practiceDate}T00:00:00`).getTime()
  );
}

export function resolvePieceTargetRange(state: AppState, piece: Piece) {
  const sortedDays = getSortedPracticeDays(state.practiceDays);
  if (sortedDays.length === 0) {
    return { days: [], startDay: null, endDay: null, label: "期間なし" };
  }

  const dayMap = new Map(sortedDays.map((day) => [day.id, day]));
  const defaultStartDay = sortedDays[0];
  const defaultEndDay = sortedDays[sortedDays.length - 1];
  const startDay = (piece.targetRangeStartDayId ? dayMap.get(piece.targetRangeStartDayId) : null) ?? defaultStartDay;
  const endDay = (piece.targetRangeEndDayId ? dayMap.get(piece.targetRangeEndDayId) : null) ?? defaultEndDay;
  const startIndex = sortedDays.findIndex((day) => day.id === startDay.id);
  const endIndex = sortedDays.findIndex((day) => day.id === endDay.id);
  const safeStartIndex = Math.min(startIndex, endIndex);
  const safeEndIndex = Math.max(startIndex, endIndex);
  const days = sortedDays.slice(safeStartIndex, safeEndIndex + 1);
  const label =
    days.length === 1
      ? `${days[0].practiceDate} のみ`
      : `${days[0].practiceDate} から ${days[days.length - 1].practiceDate} まで`;

  return {
    days,
    startDay: days[0] ?? null,
    endDay: days[days.length - 1] ?? null,
    label
  };
}

export function isPieceActiveOnPracticeDay(state: AppState, piece: Piece, practiceDayId: string) {
  return resolvePieceTargetRange(state, piece).days.some((day) => day.id === practiceDayId);
}

export function sortPlanByTime(plan: PlanSlot[]) {
  return [...plan].sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(a.end) - toMinutes(b.end));
}

export function findOverlappingPlanSlots(plan: PlanSlot[]) {
  const sortedPlan = sortPlanByTime(plan);
  const overlappingIds = new Set<string>();

  for (let index = 1; index < sortedPlan.length; index += 1) {
    const previous = sortedPlan[index - 1];
    const current = sortedPlan[index];
    if (toMinutes(previous.end) > toMinutes(current.start)) {
      overlappingIds.add(previous.id);
      overlappingIds.add(current.id);
    }
  }

  return overlappingIds;
}

export function getPlanSlotLabel(slot: PlanSlot, pieceTitle?: string) {
  if (typeof slot.customTitle === "string") return slot.customTitle.trim() || "名称未設定";
  if (slot.pieceId) return pieceTitle ?? "曲";
  if (slot.reason?.includes("準備")) return "合奏準備";
  if (slot.reason?.includes("片付け")) return "片付け";
  return "休憩";
}

export function getAvailableSegments(availability: Pick<Availability, "start" | "end" | "breaks">) {
  const start = toMinutes(availability.start);
  const end = toMinutes(availability.end);
  if (start >= end) return [];

  const normalizedBreaks = availability.breaks
    .map((item) => ({ start: Math.max(start, toMinutes(item.start)), end: Math.min(end, toMinutes(item.end)) }))
    .filter((item) => item.start < item.end)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const segments: Array<{ start: number; end: number }> = [];
  let cursor = start;

  for (const breakRange of normalizedBreaks) {
    if (cursor < breakRange.start) segments.push({ start: cursor, end: breakRange.start });
    cursor = Math.max(cursor, breakRange.end);
  }

  if (cursor < end) segments.push({ start: cursor, end });
  return segments;
}

export function isAvailable(availabilities: Availability[], memberId: string, start: number, end: number) {
  return availabilities.some(
    (item) => item.memberId === memberId && getAvailableSegments(item).some((segment) => segment.start <= start && segment.end >= end)
  );
}

const ATTENDANCE_RECORD_UNLOCK_HOUR = 7;

// 練習日当日のこの時刻(JST)を過ぎると、自己申告から「実際の出欠」への自動コピー・編集が解禁される。
export function getAttendanceRecordUnlockAt(practiceDate: string): Date {
  return new Date(`${practiceDate}T${String(ATTENDANCE_RECORD_UNLOCK_HOUR).padStart(2, "0")}:00:00+09:00`);
}

export function isAttendanceRecordUnlocked(practiceDate: string, now: Date = new Date()): boolean {
  const unlockAt = getAttendanceRecordUnlockAt(practiceDate);
  return !Number.isNaN(unlockAt.getTime()) && now.getTime() >= unlockAt.getTime();
}

export type AttendanceStatus = "full" | "partial" | "absent" | "unanswered";

// その練習日について「実際の出欠」がまだ記録されていなければ null（分析からも除外する）。
export function classifyMemberAttendanceForDay(day: LocalPracticeDay, memberId: string): AttendanceStatus | null {
  if (!day.actualAttendanceSnapshotAt) return null;
  if (!day.actualRespondedMemberIds.includes(memberId)) return "unanswered";
  if (day.actualAbsentMemberIds.includes(memberId)) return "absent";

  const availability = day.actualAvailabilities.find((item) => item.memberId === memberId);
  if (!availability) return "partial";

  const practiceStart = toMinutes(day.startTime);
  const practiceEnd = toMinutes(day.endTime);
  const fullyCovered = getAvailableSegments(availability).some(
    (segment) => segment.start <= practiceStart && segment.end >= practiceEnd
  );

  return fullyCovered ? "full" : "partial";
}

export function getActualAttendedMinutesForDay(day: LocalPracticeDay, memberId: string): number {
  const status = classifyMemberAttendanceForDay(day, memberId);
  if (status === null || status === "unanswered" || status === "absent") return 0;

  const availability = day.actualAvailabilities.find((item) => item.memberId === memberId);
  if (!availability) return 0;

  const practiceStart = toMinutes(day.startTime);
  const practiceEnd = toMinutes(day.endTime);

  return getAvailableSegments(availability).reduce((total, segment) => {
    const overlapStart = Math.max(segment.start, practiceStart);
    const overlapEnd = Math.min(segment.end, practiceEnd);
    return overlapEnd > overlapStart ? total + (overlapEnd - overlapStart) : total;
  }, 0);
}

export type MemberAttendanceStats = {
  fullCount: number;
  partialCount: number;
  absentCount: number;
  unansweredCount: number;
  recordedDayCount: number;
  attendedMinutes: number;
  totalMinutes: number;
  attendanceRate: number | null;
};

// 出席率の分母は「実際の出欠が記録済みの練習日」の練習時間の合計のみ（未来日・未記録日は含めない）。
export function computeMemberAttendanceStats(practiceDays: LocalPracticeDay[], memberId: string): MemberAttendanceStats {
  const stats: MemberAttendanceStats = {
    fullCount: 0,
    partialCount: 0,
    absentCount: 0,
    unansweredCount: 0,
    recordedDayCount: 0,
    attendedMinutes: 0,
    totalMinutes: 0,
    attendanceRate: null
  };

  for (const day of practiceDays) {
    const status = classifyMemberAttendanceForDay(day, memberId);
    if (status === null) continue;

    stats.recordedDayCount += 1;
    if (status === "full") stats.fullCount += 1;
    else if (status === "partial") stats.partialCount += 1;
    else if (status === "absent") stats.absentCount += 1;
    else stats.unansweredCount += 1;

    stats.totalMinutes += Math.max(0, toMinutes(day.endTime) - toMinutes(day.startTime));
    stats.attendedMinutes += getActualAttendedMinutesForDay(day, memberId);
  }

  stats.attendanceRate = stats.totalMinutes > 0 ? stats.attendedMinutes / stats.totalMinutes : null;
  return stats;
}

function getEffectiveAvailabilities(day: LocalPracticeDay) {
  const absentMemberIds = new Set(day.absentMemberIds);
  const respondedMemberIds = new Set(day.respondedMemberIds);
  return day.availabilities.filter(
    (availability) =>
      respondedMemberIds.has(availability.memberId) && !absentMemberIds.has(availability.memberId)
  );
}

export function getPlannedMinutesByPiece(
  state: AppState,
  options?: {
    excludePracticeDayId?: string;
    practiceDayIds?: string[];
  }
) {
  const totals = new Map<string, number>();
  const allowedDayIds = options?.practiceDayIds ? new Set(options.practiceDayIds) : null;

  for (const day of state.practiceDays) {
    if (day.id === options?.excludePracticeDayId) continue;
    if (allowedDayIds && !allowedDayIds.has(day.id)) continue;

    for (const slot of day.plan) {
      if (!slot.pieceId) continue;
      totals.set(slot.pieceId, (totals.get(slot.pieceId) ?? 0) + slot.duration);
    }
  }

  return totals;
}

export function generatePracticePlan(state: AppState): PlanSlot[] {
  const day = getSelectedPracticeDay(state);
  const effectiveAvailabilities = getEffectiveAvailabilities(day);
  const dayStart = toMinutes(day.startTime);
  const dayEnd = toMinutes(day.endTime);
  const lockedSlots = sortPlanByTime(day.plan.filter((slot) => slot.isLocked));
  const selected: PlanSlot[] = [...lockedSlots];
  const dailyMinutes = new Map<string, number>();
  const occurrences = new Map<string, number>();

  for (const slot of lockedSlots) {
    if (!slot.pieceId) continue;
    dailyMinutes.set(slot.pieceId, (dailyMinutes.get(slot.pieceId) ?? 0) + slot.duration);
    occurrences.set(slot.pieceId, (occurrences.get(slot.pieceId) ?? 0) + 1);
  }

  while (true) {
    const candidates: Array<PlanSlot & { piece: Piece }> = [];

    for (const piece of state.pieces) {
      if (!piece.conductorId || piece.memberIds.length === 0) continue;
      if (!isPieceActiveOnPracticeDay(state, piece, day.id)) continue;
      if ((occurrences.get(piece.id) ?? 0) >= 2) continue;

      const targetRange = resolvePieceTargetRange(state, piece);
      const rangeDayIds = targetRange.days.map((rangeDay) => rangeDay.id);
      const plannedMinutesInOtherDays = getPlannedMinutesByPiece(state, {
        excludePracticeDayId: day.id,
        practiceDayIds: rangeDayIds
      });

      const alreadyToday = dailyMinutes.get(piece.id) ?? 0;
      const maxDuration = piece.dailyMaxMinutes - alreadyToday;
      if (maxDuration < 15) continue;

      for (let duration = 15; duration <= maxDuration; duration += 5) {
        for (let start = dayStart; start + duration <= dayEnd; start += 5) {
          const end = start + duration;
          if (selected.some((slot) => toMinutes(slot.start) < end && start < toMinutes(slot.end))) continue;
          if (!isAvailable(effectiveAvailabilities, piece.conductorId, start, end)) continue;

          const availableMembers = piece.memberIds.filter((memberId) =>
            isAvailable(effectiveAvailabilities, memberId, start, end)
          );
          const attendanceRate = availableMembers.length / piece.memberIds.length;
          const plannedBeforeToday = plannedMinutesInOtherDays.get(piece.id) ?? 0;
          const projectedTotal = plannedBeforeToday + alreadyToday + duration;
          const target = Math.max(piece.targetMinutes, 1);
          const remainingBeforeThisSlot = Math.max(0, target - (plannedBeforeToday + alreadyToday));
          const progressDelay = remainingBeforeThisSlot / target;
          const overTargetPenalty = Math.max(0, projectedTotal - target) / target;
          const splitPenalty = (occurrences.get(piece.id) ?? 0) > 0 ? 5 : 0;
          const durationScore = (Math.min(duration, 30) / 30) * 10;
          const score = attendanceRate * 50 + progressDelay * 35 + durationScore - splitPenalty - overTargetPenalty * 20;

          candidates.push({
            id: makeId("s"),
            pieceId: piece.id,
            piece,
            start: toTime(start),
            end: toTime(end),
            duration,
            score: Math.round(score * 10) / 10,
            reason:
              `${piece.title}: 目標期間は ${targetRange.label}。` +
              `その期間での目標 ${piece.targetMinutes}分に対して、` +
              `この枠より前に確保済みなのは ${plannedBeforeToday + alreadyToday}分。` +
              `${piece.memberIds.length}人中${availableMembers.length}人がこの時間に参加可能なため選ばれました。`
          });
        }
      }
    }

    const best = candidates.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
    if (!best || (best.score ?? 0) <= 0) break;

    selected.push(best);
    dailyMinutes.set(best.piece.id, (dailyMinutes.get(best.piece.id) ?? 0) + best.duration);
    occurrences.set(best.piece.id, (occurrences.get(best.piece.id) ?? 0) + 1);
  }

  return selected.sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
}

export function usePieceMap(pieces: Piece[]) {
  return useMemo(() => new Map(pieces.map((piece) => [piece.id, piece])), [pieces]);
}
