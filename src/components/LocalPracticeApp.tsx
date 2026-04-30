"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type Member = {
  id: string;
  name: string;
  instrument: string;
  part: string;
  password?: string;
};

export type Piece = {
  id: string;
  title: string;
  conductorId: string;
  memberIds: string[];
  targetMinutes: number;
  dailyMaxMinutes: number;
  targetRangeStartDayId: string | null;
  targetRangeEndDayId: string | null;
};

export type Availability = {
  memberId: string;
  start: string;
  end: string;
};

export type PlanSlot = {
  id: string;
  pieceId: string | null;
  start: string;
  end: string;
  duration: number;
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
  plan: PlanSlot[];
};

export type AppState = {
  members: Member[];
  pieces: Piece[];
  practiceDays: LocalPracticeDay[];
  selectedPracticeDayId: string;
  recentMinutes: Record<string, number>;
};

export type SaveStatus = "idle" | "saving" | "saved" | "error";

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
  availabilities?: Availability[];
  plan?: PlanSlot[];
};

const STORAGE_KEY = "nagosui-local-practice-app-v3";
const LEGACY_STORAGE_KEY = "nagosui-local-practice-app-v2";
const SAVE_ERROR_MESSAGE = "保存できていません。ネットワークまたはRedis/KV設定を確認してください。";

function defaultPracticeDay(): LocalPracticeDay {
  return {
    id: "d1",
    practiceDate: new Date().toISOString().slice(0, 10),
    location: "",
    startTime: "18:00",
    endTime: "21:00",
    availabilities: [],
    absentMemberIds: [],
    respondedMemberIds: [],
    isPlanPublished: false,
    plan: []
  };
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

function normalizePiece(piece: LegacyPiece): Piece {
  return {
    id: piece.id ?? makeId("p"),
    title: piece.title ?? "",
    conductorId: piece.conductorId ?? "",
    memberIds: Array.isArray(piece.memberIds) ? piece.memberIds : [],
    targetMinutes: Number(piece.targetMinutes ?? 60),
    dailyMaxMinutes: Number(piece.dailyMaxMinutes ?? 45),
    targetRangeStartDayId: piece.targetRangeStartDayId ?? null,
    targetRangeEndDayId: piece.targetRangeEndDayId ?? null
  };
}

function migrateState(value: unknown): AppState {
  if (!value || typeof value !== "object") return defaultState;

  const saved = value as LegacyAppState;
  const members = Array.isArray(saved.members)
    ? saved.members.map((member) => ({
        ...member,
        password: typeof member.password === "string" ? member.password : ""
      }))
    : defaultState.members;
  const pieces = Array.isArray(saved.pieces) ? saved.pieces.map(normalizePiece) : defaultState.pieces;
  const recentMinutes = saved.recentMinutes ?? {};

  if (Array.isArray(saved.practiceDays) && saved.practiceDays.length > 0) {
    return {
      members,
      pieces,
      recentMinutes,
      practiceDays: saved.practiceDays.map((day) => ({
        ...day,
        location: typeof day.location === "string" ? day.location : "",
        absentMemberIds: day.absentMemberIds ?? [],
        respondedMemberIds: day.respondedMemberIds ?? [],
        isPlanPublished: typeof day.isPlanPublished === "boolean" ? day.isPlanPublished : false
      })),
      selectedPracticeDayId: saved.selectedPracticeDayId ?? saved.practiceDays[0].id
    };
  }

  const migratedDay: LocalPracticeDay = {
    id: "d1",
    practiceDate: saved.practiceDate ?? defaultDay.practiceDate,
    location: "",
    startTime: saved.startTime ?? defaultDay.startTime,
    endTime: saved.endTime ?? defaultDay.endTime,
    availabilities: saved.availabilities ?? defaultDay.availabilities,
    absentMemberIds: [],
    respondedMemberIds: [],
    isPlanPublished: false,
    plan: saved.plan ?? []
  };

  return {
    members,
    pieces,
    recentMinutes,
    practiceDays: [migratedDay],
    selectedPracticeDayId: migratedDay.id
  };
}

type LocalStatePayload = {
  state: unknown | null;
  updatedAt?: string | null;
};

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

  return (await response.json()) as LocalStatePayload;
}

async function putServerState(state: AppState) {
  const response = await fetch("/api/local-state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ state })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? SAVE_ERROR_MESSAGE);
  }

  return (await response.json()) as { ok: true; updatedAt?: string | null };
}

export function useLocalPracticeState() {
  const [state, setState] = useState<AppState>(defaultState);
  const [ready, setReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState("");
  const [serverUpdatedAt, setServerUpdatedAt] = useState<string | null>(null);
  const [hasLocalMigrationCandidate, setHasLocalMigrationCandidate] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const shouldPersistRef = useRef(false);
  const saveSequenceRef = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      try {
        const payload = await fetchServerState();
        if (cancelled) return;

        if (payload.state) {
          const migrated = migrateState(payload.state);
          shouldPersistRef.current = false;
          setState(migrated);
          cacheStateLocally(migrated);
          setHasLocalMigrationCandidate(false);
        } else {
          shouldPersistRef.current = false;
          setState(defaultState);
          setHasLocalMigrationCandidate(readLocalSavedState() !== null);
        }
        setServerUpdatedAt(payload.updatedAt ?? null);
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
    const timeout = window.setTimeout(() => {
      setSaveStatus("saving");
      setSaveError("");

      putServerState(state)
        .then((payload) => {
          if (sequence !== saveSequenceRef.current) return;
          setSaveStatus("saved");
          setServerUpdatedAt(payload.updatedAt ?? null);
          cacheStateLocally(state);
        })
        .catch(() => {
          if (sequence !== saveSequenceRef.current) return;
          setSaveStatus("error");
          setSaveError(SAVE_ERROR_MESSAGE);
        });
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [ready, state]);

  function updateFullState(value: AppState | ((current: AppState) => AppState)) {
    shouldPersistRef.current = true;
    setState(value);
  }

  function updateState(patch: Partial<AppState>) {
    shouldPersistRef.current = true;
    setState((current) => ({ ...current, ...patch }));
  }

  async function reloadServerState() {
    setIsReloading(true);
    try {
      const payload = await fetchServerState();
      shouldPersistRef.current = false;

      if (payload.state) {
        const migrated = migrateState(payload.state);
        setState(migrated);
        cacheStateLocally(migrated);
        setHasLocalMigrationCandidate(false);
      } else {
        setState(defaultState);
        setHasLocalMigrationCandidate(readLocalSavedState() !== null);
      }

      setServerUpdatedAt(payload.updatedAt ?? null);
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
        shouldPersistRef.current = false;
        setState(migratedServerState);
        cacheStateLocally(migratedServerState);
        setServerUpdatedAt(currentServer.updatedAt ?? null);
        setHasLocalMigrationCandidate(false);
        setSaveStatus("saved");
        return;
      }

      const migratedLocalState = migrateState(localState);
      const payload = await putServerState(migratedLocalState);
      shouldPersistRef.current = false;
      setState(migratedLocalState);
      cacheStateLocally(migratedLocalState);
      setServerUpdatedAt(payload.updatedAt ?? null);
      setHasLocalMigrationCandidate(false);
      setSaveStatus("saved");
    } catch {
      setSaveStatus("error");
      setSaveError(SAVE_ERROR_MESSAGE);
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
    migrateLocalStateToServer
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

export function getPracticeDayLabel(day: Pick<LocalPracticeDay, "practiceDate" | "location">) {
  const location = day.location.trim();
  return location ? `${day.practiceDate}＠${location}` : day.practiceDate;
}

export function updatePracticeDay(
  state: AppState,
  dayId: string,
  patch: Partial<LocalPracticeDay>
): LocalPracticeDay[] {
  return state.practiceDays.map((day) => (day.id === dayId ? { ...day, ...patch } : day));
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
  if (slot.pieceId) return pieceTitle ?? "曲";
  if (slot.reason?.includes("準備")) return "合奏準備";
  if (slot.reason?.includes("片付け")) return "片付け";
  return "休憩";
}

export function isAvailable(availabilities: Availability[], memberId: string, start: number, end: number) {
  return availabilities.some(
    (item) => item.memberId === memberId && toMinutes(item.start) <= start && toMinutes(item.end) >= end
  );
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
  const selected: PlanSlot[] = [];
  const dailyMinutes = new Map<string, number>();
  const occurrences = new Map<string, number>();

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
