"use client";

import { useEffect, useMemo, useState } from "react";

export type Member = {
  id: string;
  name: string;
  instrument: string;
  part: string;
};

export type Piece = {
  id: string;
  title: string;
  conductorId: string;
  memberIds: string[];
  targetMinutes: number;
  dailyMaxMinutes: number;
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
  startTime: string;
  endTime: string;
  availabilities: Availability[];
  absentMemberIds: string[];
  respondedMemberIds: string[];
  plan: PlanSlot[];
};

export type AppState = {
  members: Member[];
  pieces: Piece[];
  practiceDays: LocalPracticeDay[];
  selectedPracticeDayId: string;
  recentMinutes: Record<string, number>;
};

type LegacyAppState = Partial<AppState> & {
  practiceDate?: string;
  startTime?: string;
  endTime?: string;
  availabilities?: Availability[];
  plan?: PlanSlot[];
};

const STORAGE_KEY = "nagosui-local-practice-app-v3";
const LEGACY_STORAGE_KEY = "nagosui-local-practice-app-v2";

function defaultPracticeDay(): LocalPracticeDay {
  return {
    id: "d1",
    practiceDate: new Date().toISOString().slice(0, 10),
    startTime: "18:00",
    endTime: "21:00",
    availabilities: [],
    absentMemberIds: [],
    respondedMemberIds: [],
    plan: []
  };
}

const defaultDay = defaultPracticeDay();

const defaultState: AppState = {
  members: [
    { id: "m1", name: "奏者", instrument: "", part: "" },
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
  return `${Math.floor(minutes / 60).toString().padStart(2, "0")}:${(minutes % 60)
    .toString()
    .padStart(2, "0")}`;
}

function migrateState(value: unknown): AppState {
  if (!value || typeof value !== "object") return defaultState;

  const saved = value as LegacyAppState;
  const members = Array.isArray(saved.members) ? saved.members : defaultState.members;
  const pieces = Array.isArray(saved.pieces) ? saved.pieces : defaultState.pieces;
  const recentMinutes = saved.recentMinutes ?? {};

  if (Array.isArray(saved.practiceDays) && saved.practiceDays.length > 0) {
    return {
      members,
      pieces,
      recentMinutes,
      practiceDays: saved.practiceDays.map((day) => ({
        ...day,
        absentMemberIds: day.absentMemberIds ?? [],
        respondedMemberIds: day.respondedMemberIds ?? []
      })),
      selectedPracticeDayId: saved.selectedPracticeDayId ?? saved.practiceDays[0].id
    };
  }

  const migratedDay: LocalPracticeDay = {
    id: "d1",
    practiceDate: saved.practiceDate ?? defaultDay.practiceDate,
    startTime: saved.startTime ?? defaultDay.startTime,
    endTime: saved.endTime ?? defaultDay.endTime,
    availabilities: saved.availabilities ?? defaultDay.availabilities,
    absentMemberIds: [],
    respondedMemberIds: [],
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

export function useLocalPracticeState() {
  const [state, setState] = useState<AppState>(defaultState);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      const response = await fetch("/api/local-state").catch(() => null);
      const payload = response?.ok ? await response.json().catch(() => null) : null;

      if (cancelled) return;

      if (payload?.state) {
        setState(migrateState(payload.state));
      } else {
        const saved = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
        if (saved) {
          setState(migrateState(JSON.parse(saved)));
        }
      }
      setReady(true);
    }

    loadState();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (ready) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      fetch("/api/local-state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ state })
      }).catch(() => {});
    }
  }, [ready, state]);

  function updateState(patch: Partial<AppState>) {
    setState((current) => ({ ...current, ...patch }));
  }

  return { state, setState, updateState, ready };
}

export function getSelectedPracticeDay(state: AppState) {
  return state.practiceDays.find((day) => day.id === state.selectedPracticeDayId) ?? state.practiceDays[0];
}

export function updatePracticeDay(
  state: AppState,
  dayId: string,
  patch: Partial<LocalPracticeDay>
): LocalPracticeDay[] {
  return state.practiceDays.map((day) => (day.id === dayId ? { ...day, ...patch } : day));
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
  if (slot.reason?.includes("準備")) return "準備時間";
  if (slot.reason?.includes("片付け")) return "片付け時間";
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
      if ((occurrences.get(piece.id) ?? 0) >= 2) continue;

      const already = dailyMinutes.get(piece.id) ?? 0;
      const maxDuration = piece.dailyMaxMinutes - already;
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
          const recent = state.recentMinutes[piece.id] ?? 0;
          const target = Math.max(piece.targetMinutes, 1);
          const progressDelay = Math.max(0, target - recent) / target;
          const splitPenalty = (occurrences.get(piece.id) ?? 0) > 0 ? 5 : 0;
          const durationScore = (Math.min(duration, 30) / 30) * 10;
          const score = attendanceRate * 50 + progressDelay * 35 + durationScore - splitPenalty;

          candidates.push({
            id: makeId("s"),
            pieceId: piece.id,
            piece,
            start: toTime(start),
            end: toTime(end),
            duration,
            score: Math.round(score * 10) / 10,
            reason: `${piece.title}: ${piece.memberIds.length}人中${availableMembers.length}人が参加可能。目標${piece.targetMinutes}分に対して直近実績${recent}分のため選ばれました。`
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
