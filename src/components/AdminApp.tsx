"use client";

import Link from "next/link";
import { useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  findOverlappingPlanSlots,
  generatePracticePlan,
  getPlanSlotLabel,
  getPracticeDayLabel,
  getSelectedPracticeDay,
  getSortedPracticeDays,
  isAvailable,
  LocalStateStatusPanel,
  makeId,
  sortPlanByTime,
  toMinutes,
  toTime,
  updatePracticeDay,
  useLocalPracticeState,
  usePieceMap
} from "@/components/LocalPracticeApp";

type UtilitySlotKind = "break" | "setup" | "cleanup";

type PaletteDragPayload =
  | {
      type: "palette";
      slotType: "piece";
      pieceId: string;
    }
  | {
      type: "palette";
      slotType: "utility";
      utilityKind: UtilitySlotKind;
    };

type SlotDragPayload = {
  type: "slot";
  slotId: string;
};

const DRAG_DATA_TYPE = "application/x-practice-plan-slot";
const MINUTES_PER_PIXEL = 0.25;
const RESIZE_STEP_MINUTES = 5;
const MIN_SLOT_MINUTES = 5;

const UTILITY_SLOT_TEMPLATES: Array<{
  kind: UtilitySlotKind;
  label: string;
  defaultMinutes: number;
  reason: string;
}> = [
  { kind: "setup", label: "合奏準備", defaultMinutes: 5, reason: "合奏準備として手動追加した枠です。" },
  { kind: "break", label: "休憩", defaultMinutes: 5, reason: "休憩として手動追加した枠です。" },
  { kind: "cleanup", label: "片付け", defaultMinutes: 5, reason: "片付けとして手動追加した枠です。" }
];

function formatMinutesLabel(minutes: number) {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;

  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}

function getSlotVariant(slot: { pieceId: string | null; reason?: string }) {
  if (slot.pieceId) return "piece";

  const utilityKind = UTILITY_SLOT_TEMPLATES.find((template) => template.reason === slot.reason)?.kind;
  if (utilityKind === "setup") return "setup";
  if (utilityKind === "cleanup") return "cleanup";
  return "break";
}

function getUtilityTemplate(kind: UtilitySlotKind) {
  return UTILITY_SLOT_TEMPLATES.find((template) => template.kind === kind) ?? UTILITY_SLOT_TEMPLATES[0];
}

function normalizeDuration(value: number, fallback = 1) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function snapMinutes(minutes: number) {
  return Math.round(minutes / RESIZE_STEP_MINUTES) * RESIZE_STEP_MINUTES;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatPracticeTimeAndLocation(day: { startTime: string; endTime: string; location: string }) {
  const location = day.location.trim();
  return location ? `${day.startTime}-${day.endTime} ＠${location}` : `${day.startTime}-${day.endTime}`;
}

export function AdminApp() {
  const localState = useLocalPracticeState();
  const { state, updateState } = localState;
  const [planMessage, setPlanMessage] = useState("");
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [activeDropMinutes, setActiveDropMinutes] = useState<number | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const selectedDay = getSelectedPracticeDay(state);
  const sortedPracticeDays = getSortedPracticeDays(state.practiceDays);
  const pieceMap = usePieceMap(state.pieces);

  const practiceMinutes = toMinutes(selectedDay.endTime) - toMinutes(selectedDay.startTime);
  const sortedPlan = sortPlanByTime(selectedDay.plan);
  const selectedSlot = sortedPlan.find((slot) => slot.id === selectedSlotId) ?? null;
  const plannedMinutes = sortedPlan.reduce((total, slot) => total + slot.duration, 0);
  const freeMinutes = Math.max(0, practiceMinutes - plannedMinutes);
  const overlappingSlotIds = findOverlappingPlanSlots(selectedDay.plan);
  const coverageRatio = practiceMinutes > 0 ? Math.min(1, plannedMinutes / practiceMinutes) : 0;
  const practiceStartMinutes = toMinutes(selectedDay.startTime);
  const practiceEndMinutes = toMinutes(selectedDay.endTime);
  const timelineHeight = Math.max(1, practiceMinutes / MINUTES_PER_PIXEL);
  const lastSlotStartMinutes = Math.max(practiceStartMinutes, practiceEndMinutes - MIN_SLOT_MINUTES);
  const timeAxisMarks =
    practiceMinutes > 0
      ? Array.from({ length: Math.floor(practiceMinutes / 30) + 1 }, (_, index) => practiceStartMinutes + index * 30)
      : [practiceStartMinutes];

  if (timeAxisMarks[timeAxisMarks.length - 1] !== practiceEndMinutes) {
    timeAxisMarks.push(practiceEndMinutes);
  }

  function updateSelectedDay(patch: Partial<typeof selectedDay>) {
    updateState({ practiceDays: updatePracticeDay(state, selectedDay.id, patch) });
  }

  function deletePracticeDay(dayId: string) {
    if (state.practiceDays.length <= 1) return;

    const currentDay = state.practiceDays.find((day) => day.id === dayId);
    if (!currentDay || !confirm(`${currentDay.practiceDate} の練習日を削除しますか？`)) return;

    const nextDays = state.practiceDays.filter((day) => day.id !== dayId);
    updateState({
      practiceDays: nextDays,
      selectedPracticeDayId: state.selectedPracticeDayId === dayId ? nextDays[0].id : state.selectedPracticeDayId
    });
  }

  function normalizeSlotTiming(slot: (typeof selectedDay.plan)[number], nextStart: number, nextEnd: number) {
    const dayStart = toMinutes(selectedDay.startTime);
    const dayEnd = toMinutes(selectedDay.endTime);
    const latestStart = Math.max(dayStart, dayEnd - MIN_SLOT_MINUTES);
    const clampedStart = clampNumber(snapMinutes(nextStart), dayStart, latestStart);
    const clampedEnd = clampNumber(snapMinutes(nextEnd), clampedStart + MIN_SLOT_MINUTES, dayEnd);

    return {
      ...slot,
      start: toTime(clampedStart),
      end: toTime(clampedEnd),
      duration: clampedEnd - clampedStart
    };
  }

  function updatePlan(plan: typeof selectedDay.plan) {
    updateSelectedDay({ plan: sortPlanByTime(plan) });
  }

  function updateSlot(
    slotId: string,
    patch: { pieceId?: string | null; customTitle?: string; reason?: string; isLocked?: boolean }
  ) {
    const nextPlan = sortedPlan.map((slot) =>
      slot.id === slotId
        ? {
            ...slot,
            ...patch,
            reason: patch.reason ?? slot.reason
          }
        : slot
    );
    updatePlan(nextPlan);
  }

  function updateSlotTitle(slotId: string, customTitle: string) {
    updateSlot(slotId, { customTitle });
  }

  function toggleSlotLock(slotId: string) {
    const slot = sortedPlan.find((item) => item.id === slotId);
    if (!slot) return;
    updateSlot(slotId, { isLocked: !slot.isLocked });
  }

  function deleteSlot(slotId: string) {
    updatePlan(sortedPlan.filter((item) => item.id !== slotId));
    setSelectedSlotId((currentSlotId) => (currentSlotId === slotId ? null : currentSlotId));
  }

  function getSlotContentValue(slot: (typeof selectedDay.plan)[number]) {
    if (slot.pieceId) return `piece:${slot.pieceId}`;
    if (slot.reason?.includes("準備")) return "utility:setup";
    if (slot.reason?.includes("片付け")) return "utility:cleanup";
    return "utility:break";
  }

  function updateSlotContent(slotId: string, value: string) {
    if (value.startsWith("piece:")) {
      const pieceId = value.replace("piece:", "");
      const piece = pieceMap.get(pieceId);
      updateSlot(slotId, { pieceId, customTitle: piece?.title ?? "" });
      return;
    }

    if (!value.startsWith("utility:")) return;

    const utilityKind = value.replace("utility:", "") as UtilitySlotKind;
    const template = getUtilityTemplate(utilityKind);
    updateSlot(slotId, { pieceId: null, customTitle: template.label, reason: template.reason });
  }

  function updateSlotTimeInput(slotId: string, boundary: "start" | "end", value: string) {
    if (!value) return;
    updateSlotBoundary(slotId, boundary, toMinutes(value));
  }

  function adjustSlotEnd(slotId: string, deltaMinutes: number) {
    const slot = sortedPlan.find((item) => item.id === slotId);
    if (!slot) return;
    updateSlotBoundary(slotId, "end", toMinutes(slot.end) + deltaMinutes);
  }

  function moveSlotToStart(slotId: string, nextStart: number) {
    const nextPlan = sortedPlan.map((slot) => {
      if (slot.id !== slotId) return slot;
      const duration = normalizeDuration(slot.duration, MIN_SLOT_MINUTES);
      return normalizeSlotTiming(slot, nextStart, nextStart + duration);
    });
    updatePlan(nextPlan);
    setSelectedSlotId(slotId);
  }

  function updateSlotBoundary(slotId: string, boundary: "start" | "end", minutes: number) {
    const nextPlan = sortedPlan.map((slot) => {
      if (slot.id !== slotId) return slot;

      const currentStart = toMinutes(slot.start);
      const currentEnd = toMinutes(slot.end);
      return boundary === "start"
        ? normalizeSlotTiming(slot, minutes, currentEnd)
        : normalizeSlotTiming(slot, currentStart, minutes);
    });
    updatePlan(nextPlan);
  }

  function handleResizeStart(
    event: ReactPointerEvent<HTMLButtonElement>,
    slotId: string,
    boundary: "start" | "end"
  ) {
    event.preventDefault();
    event.stopPropagation();
    setSelectedSlotId(slotId);

    const startY = event.clientY;
    const slot = sortedPlan.find((item) => item.id === slotId);
    if (!slot) return;

    const startBoundaryMinutes = boundary === "start" ? toMinutes(slot.start) : toMinutes(slot.end);

    function handlePointerMove(moveEvent: PointerEvent) {
      const deltaMinutes = (moveEvent.clientY - startY) * MINUTES_PER_PIXEL;
      updateSlotBoundary(slotId, boundary, startBoundaryMinutes + deltaMinutes);
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function makeSlotFromPalette(payload: PaletteDragPayload, startMinutes = toMinutes(selectedDay.startTime)): (typeof selectedDay.plan)[number] | null {
    if (payload.slotType === "piece") {
      const piece = pieceMap.get(payload.pieceId);
      if (!piece) return null;

      const defaultDuration = Math.max(MIN_SLOT_MINUTES, Math.min(piece.dailyMaxMinutes || 30, 60, Math.max(practiceMinutes, 1)));
      const start = clampNumber(snapMinutes(startMinutes), practiceStartMinutes, lastSlotStartMinutes);
      const end = Math.min(practiceEndMinutes, start + defaultDuration);

      return {
        id: makeId("s"),
        pieceId: piece.id,
        customTitle: piece.title,
        start: toTime(start),
        end: toTime(end),
        duration: end - start,
        reason: `${piece.title} を手動追加した枠です。`
      };
    }

    const template = getUtilityTemplate(payload.utilityKind);
    const start = clampNumber(snapMinutes(startMinutes), practiceStartMinutes, lastSlotStartMinutes);
    const end = Math.min(practiceEndMinutes, start + template.defaultMinutes);

    return {
      id: makeId("s"),
      pieceId: null,
      customTitle: template.label,
      start: toTime(start),
      end: toTime(end),
      duration: end - start,
      reason: template.reason
    };
  }

  function addSlotFromPalette(payload: PaletteDragPayload, startMinutes = toMinutes(selectedDay.startTime)) {
    const nextSlot = makeSlotFromPalette(payload, startMinutes);
    if (!nextSlot) {
      setPlanMessage("追加できませんでした。曲の設定を確認してください。");
      return;
    }

    updatePlan([...sortedPlan, nextSlot]);
    setSelectedSlotId(nextSlot.id);
    setPlanMessage(`${getSlotLabel(nextSlot)} を ${nextSlot.start} から追加しました。`);
  }

  function insertBreaksIntoOpenTimes() {
    const template = getUtilityTemplate("break");
    const occupiedRanges = sortPlanByTime(sortedPlan)
      .map((slot) => ({
        start: clampNumber(toMinutes(slot.start), practiceStartMinutes, practiceEndMinutes),
        end: clampNumber(toMinutes(slot.end), practiceStartMinutes, practiceEndMinutes)
      }))
      .filter((range) => range.end > range.start);

    const mergedRanges: Array<{ start: number; end: number }> = [];
    for (const range of occupiedRanges) {
      const previousRange = mergedRanges[mergedRanges.length - 1];
      if (!previousRange || range.start > previousRange.end) {
        mergedRanges.push({ ...range });
      } else {
        previousRange.end = Math.max(previousRange.end, range.end);
      }
    }

    const gaps: Array<{ start: number; end: number }> = [];
    for (let index = 1; index < mergedRanges.length; index += 1) {
      const previousRange = mergedRanges[index - 1];
      const currentRange = mergedRanges[index];
      if (currentRange.start - previousRange.end >= MIN_SLOT_MINUTES) {
        gaps.push({ start: previousRange.end, end: currentRange.start });
      }
    }

    if (gaps.length === 0) {
      setPlanMessage("休憩を入れられる空き時間はありません。");
      return;
    }

    const breakSlots = gaps.map((gap) => ({
      id: makeId("s"),
      pieceId: null,
      customTitle: template.label,
      start: toTime(gap.start),
      end: toTime(gap.end),
      duration: gap.end - gap.start,
      reason: template.reason
    }));

    updatePlan([...sortedPlan, ...breakSlots]);
    setSelectedSlotId(breakSlots[0]?.id ?? null);
    setPlanMessage(`休憩を${breakSlots.length}件追加しました。`);
  }

  function writeDragPayload(event: DragEvent, payload: PaletteDragPayload | SlotDragPayload) {
    event.dataTransfer.effectAllowed = payload.type === "slot" ? "move" : "copy";
    event.dataTransfer.setData(DRAG_DATA_TYPE, JSON.stringify(payload));
  }

  function readDragPayload(event: DragEvent): PaletteDragPayload | SlotDragPayload | null {
    const rawPayload = event.dataTransfer.getData(DRAG_DATA_TYPE);
    if (!rawPayload) return null;

    try {
      return JSON.parse(rawPayload) as PaletteDragPayload | SlotDragPayload;
    } catch {
      return null;
    }
  }

  function getTimelineDropMinutes(event: DragEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const rawOffset = (event.clientY - rect.top) * MINUTES_PER_PIXEL;
    return clampNumber(snapMinutes(practiceStartMinutes + rawOffset), practiceStartMinutes, lastSlotStartMinutes);
  }

  function handleTimelineDragOver(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setActiveDropMinutes(getTimelineDropMinutes(event));
  }

  function handleTimelineDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    const payload = readDragPayload(event);
    setDraggedSlotId(null);
    setActiveDropMinutes(null);

    if (!payload) return;
    const dropMinutes = getTimelineDropMinutes(event);

    if (payload.type === "slot") {
      moveSlotToStart(payload.slotId, dropMinutes);
      return;
    }

    addSlotFromPalette(payload, dropMinutes);
  }

  function getPieceToneClass(pieceId: string | null) {
    if (!pieceId) return "";
    const pieceIndex = state.pieces.findIndex((piece) => piece.id === pieceId);
    return `plan-tone-${Math.max(0, pieceIndex) % 6}`;
  }

  function handleGeneratePlan() {
    const generatedPlan = generatePracticePlan(state);
    updateSelectedDay({ plan: generatedPlan });

    if (generatedPlan.length > 0) {
      setPlanMessage(`${generatedPlan.length} 件の枠を自動生成しました。必要ならこの下で手動調整できます。`);
      return;
    }

    setPlanMessage("自動生成できませんでした。曲設定、回答状況、参加可能時間を確認してください。");
  }

  function getSlotLabel(slot: (typeof selectedDay.plan)[number]) {
    return getPlanSlotLabel(slot, slot.pieceId ? pieceMap.get(slot.pieceId)?.title : undefined);
  }

  function getSlotAttendanceCount(slot: (typeof selectedDay.plan)[number]) {
    if (!slot.pieceId) return null;
    const piece = pieceMap.get(slot.pieceId);
    if (!piece) return null;

    const memberIds = Array.from(new Set([piece.conductorId, ...piece.memberIds].filter(Boolean)));
    const absentMemberIds = new Set(selectedDay.absentMemberIds);
    const start = toMinutes(slot.start);
    return memberIds.filter(
      (memberId) => !absentMemberIds.has(memberId) && isAvailable(selectedDay.availabilities, memberId, start, start + 1)
    ).length;
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">練習計画ページ</p>
        <h1>練習計画の編集</h1>
        <p>このページでは、選んだ練習日の計画を作って整えます。準備がまだなら、先に追加ページでメンバー・練習日・曲を登録してください。</p>
        <div className="row">
          <Link className="button" href="/admin/setup">
            準備ページへ
          </Link>
          <Link className="button secondary" href="/admin/setup#practice-days">
            練習日の追加
          </Link>
          <Link className="button secondary" href="/admin/setup#members">
            奏者の追加
          </Link>
          <Link className="button secondary" href="/admin/setup#pieces">
            曲の追加
          </Link>
          <Link className="button secondary" href="/availability">
            可否一覧へ
          </Link>
          <Link className="button secondary" href="/color-map">
            カラーマップへ
          </Link>
          <Link className="button secondary" href="/sheet">
            表で見る
          </Link>
        </div>
        {planMessage ? <div className="notice">{planMessage}</div> : null}
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">Step 1</p>
            <h2>対象の練習日を選ぶ</h2>
          </div>
          <label className="compact-field">
            練習日
            <select
              value={selectedDay.id}
              onChange={(event) => updateState({ selectedPracticeDayId: event.target.value })}
            >
              {sortedPracticeDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.practiceDate} {formatPracticeTimeAndLocation(day)}
                </option>
              ))}
            </select>
          </label>
          <label className="plan-publish-switch">
            <input
              type="checkbox"
              checked={selectedDay.isPlanPublished}
              onChange={(event) => updateSelectedDay({ isPlanPublished: event.target.checked })}
            />
            <span className="plan-publish-switch-control" aria-hidden="true" />
            <span>
              練習スケジュールを{selectedDay.isPlanPublished ? "公開中" : "非公開"}
            </span>
          </label>
        </div>
      </section>

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">Step 2</p>
            <h2>{getPracticeDayLabel(selectedDay)} の練習計画を作る</h2>
          </div>
          <div className="row">
            <span className="muted">
              {selectedDay.startTime} - {selectedDay.endTime}
            </span>
            <button type="button" onClick={handleGeneratePlan}>
              この練習日で自動生成
            </button>
          </div>
        </div>

        <div className="plan-progress-card">
          <div className="plan-progress-header">
            <strong>練習時間の配分</strong>
            <span className="muted">{overlappingSlotIds.size > 0 ? "重なっている枠があります" : "重なりはありません"}</span>
          </div>
          <div className="plan-progress-track" aria-hidden="true">
            <div className="plan-progress-fill" style={{ width: `${coverageRatio * 100}%` }} />
          </div>
          <div className="plan-progress-meta muted">
            入っている時間 {formatMinutesLabel(plannedMinutes)} / 空き {formatMinutesLabel(freeMinutes)}
          </div>
        </div>

        {overlappingSlotIds.size > 0 ? (
          <div className="error">時間が重なっている枠があります。開始時刻と終了時刻を調整してください。</div>
        ) : null}

        <div className="plan-builder">
          <aside className="plan-palette">
            <div className="plan-toolbar-head">
              <strong>追加するボックス</strong>
              <span className="muted">左のボックスを下の計画エリアへドラッグ、またはクリックで開始時刻へ追加できます。</span>
            </div>

            <div className="plan-palette-section">
              <span className="plan-stat-label">曲</span>
              {state.pieces.length === 0 ? (
                <div className="notice">曲がありません。準備ページで曲を追加してください。</div>
              ) : (
                <div className="plan-palette-grid">
                  {state.pieces.map((piece) => (
                    <button
                      className={`plan-palette-card plan-slot-piece ${getPieceToneClass(piece.id)}`}
                      draggable
                      key={piece.id}
                      type="button"
                      onClick={() => addSlotFromPalette({ type: "palette", slotType: "piece", pieceId: piece.id })}
                      onDragStart={(event) => writeDragPayload(event, { type: "palette", slotType: "piece", pieceId: piece.id })}
                    >
                      <strong>{piece.title}</strong>
                      <span>{piece.dailyMaxMinutes}分まで</span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="plan-palette-section">
              <span className="plan-stat-label">休憩・準備</span>
              <div className="plan-palette-grid">
                {UTILITY_SLOT_TEMPLATES.map((template) => (
                  <button
                    className={`plan-palette-card plan-slot-${template.kind}`}
                    draggable
                    key={template.kind}
                    type="button"
                    onClick={() => addSlotFromPalette({ type: "palette", slotType: "utility", utilityKind: template.kind })}
                    onDragStart={(event) =>
                      writeDragPayload(event, { type: "palette", slotType: "utility", utilityKind: template.kind })
                    }
                  >
                    <strong>{template.label}</strong>
                    <span>{template.defaultMinutes}分</span>
                  </button>
                ))}
              </div>
              <button className="secondary plan-bulk-break-button" type="button" onClick={insertBreaksIntoOpenTimes}>
                間に休憩を一括挿入
              </button>
            </div>
          </aside>

          <div className="plan-canvas">
            <div className="plan-canvas-head">
              <strong>練習計画</strong>
              <span className="muted">箱を上下にドラッグして時刻を移動できます。上下の端をドラッグすると開始・終了を変更できます。</span>
            </div>

            <div className="plan-timeline-shell" style={{ height: `${timelineHeight}px` }}>
              <div className="plan-time-axis" aria-hidden="true">
                {timeAxisMarks.map((minutes) => (
                  <span
                    className="plan-time-mark"
                    key={minutes}
                    style={{ top: `${Math.max(0, (minutes - practiceStartMinutes) / MINUTES_PER_PIXEL)}px` }}
                  >
                    {toTime(minutes)}
                  </span>
                ))}
              </div>

              <div
                className="plan-timeline-track"
                onDragLeave={() => setActiveDropMinutes(null)}
                onDragOver={handleTimelineDragOver}
                onDrop={handleTimelineDrop}
              >
            {activeDropMinutes !== null ? (
              <div
                className="plan-drop-time-guide"
                style={{ top: `${(activeDropMinutes - practiceStartMinutes) / MINUTES_PER_PIXEL}px` }}
              >
                {toTime(activeDropMinutes)}
              </div>
            ) : null}

            {sortedPlan.length === 0 ? (
              <div className="plan-empty-state">
                <strong>まだ計画がありません。</strong>
                <p className="muted">左のボックスをここに入れるか、自動生成してください。</p>
              </div>
            ) : (
              <div className="plan-timeline">
                {sortedPlan.map((slot) => {
                  const slotLabel = getSlotLabel(slot);
                  const slotVariant = getSlotVariant(slot);
                  const attendanceCount = getSlotAttendanceCount(slot);

                  return (
                    <div className="plan-slot-row" key={slot.id}>
                      <article
                        className={`plan-slot-card plan-slot-${slotVariant} ${getPieceToneClass(slot.pieceId)}${
                          overlappingSlotIds.has(slot.id) ? " overlap-slot" : ""
                        }${draggedSlotId === slot.id ? " is-dragging" : ""}${
                          selectedSlotId === slot.id ? " is-selected" : ""
                        }`}
                        draggable
                        style={{
                          height: `${Math.max(1, slot.duration / MINUTES_PER_PIXEL)}px`,
                          top: `${(toMinutes(slot.start) - practiceStartMinutes) / MINUTES_PER_PIXEL}px`
                        }}
                        onClick={() => setSelectedSlotId(slot.id)}
                        onDragEnd={() => {
                          setDraggedSlotId(null);
                          setActiveDropMinutes(null);
                        }}
                        onDragStart={(event) => {
                          setDraggedSlotId(slot.id);
                          setSelectedSlotId(slot.id);
                          writeDragPayload(event, { type: "slot", slotId: slot.id });
                        }}
                      >
                        <div className="plan-slot-main">
                          <button
                            className="plan-resize-handle plan-resize-handle-top"
                            type="button"
                            aria-label={`${slotLabel}の開始時刻を変更`}
                            onPointerDown={(event) => handleResizeStart(event, slot.id, "start")}
                          >
                            ↕
                          </button>
                          <div className="plan-slot-top">
                            <div className="plan-slot-heading">
                              <span className="plan-slot-time">
                                {slot.start} - {slot.end}
                              </span>
                              <div
                                className="plan-slot-content-controls"
                                onPointerDown={(event) => event.stopPropagation()}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setSelectedSlotId(slot.id);
                                }}
                              >
                                <textarea
                                  className="plan-slot-title-input"
                                  aria-label="表示文字を編集"
                                  title="表示文字を編集"
                                  rows={2}
                                  value={slot.customTitle ?? slotLabel}
                                  onChange={(event) => updateSlotTitle(slot.id, event.target.value)}
                                  onFocus={() => setSelectedSlotId(slot.id)}
                                />
                                <select
                                  className="plan-slot-content-select"
                                  aria-label="曲・内容を選択"
                                  title="曲・内容を選択"
                                  value={getSlotContentValue(slot)}
                                  onChange={(event) => {
                                    updateSlotContent(slot.id, event.target.value);
                                    setSelectedSlotId(slot.id);
                                  }}
                                >
                                  {UTILITY_SLOT_TEMPLATES.map((template) => (
                                    <option key={template.kind} value={`utility:${template.kind}`}>
                                      {template.label}
                                    </option>
                                  ))}
                                  {state.pieces.map((piece) => (
                                    <option key={piece.id} value={`piece:${piece.id}`}>
                                      {piece.title}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {attendanceCount !== null ? <span className="plan-slot-attendance">{attendanceCount}人</span> : null}
                            </div>
                            <div className="plan-slot-badges">
                              <span className="plan-badge">{formatMinutesLabel(slot.duration)}</span>
                              {slot.isLocked ? <span className="plan-badge accent">固定</span> : null}
                              {overlappingSlotIds.has(slot.id) ? <span className="plan-badge danger">重なり</span> : null}
                            </div>
                          </div>
                          <label
                            className="plan-slot-lock-switch"
                            title="固定"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={!!slot.isLocked}
                              aria-label={`${slotLabel}を固定`}
                              onChange={() => toggleSlotLock(slot.id)}
                            />
                            <span aria-hidden="true" />
                          </label>
                          <button
                            className="plan-slot-delete-button"
                            type="button"
                            aria-label={`${slotLabel}を削除`}
                            title="削除"
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteSlot(slot.id);
                            }}
                          >
                            ×
                          </button>
                          <button
                            className="plan-resize-handle plan-resize-handle-bottom"
                            type="button"
                            aria-label={`${slotLabel}の終了時刻を変更`}
                            onPointerDown={(event) => handleResizeStart(event, slot.id, "end")}
                          >
                            ↕
                          </button>
                        </div>
                      </article>
                    </div>
                  );
                })}
              </div>
            )}
              </div>
            </div>
            <div className="plan-detail-panel">
              {selectedSlot ? (
                <>
                  <div className="plan-detail-head">
                    <div>
                      <span className="plan-stat-label">選択中のボックス</span>
                      <strong>{getSlotLabel(selectedSlot)}</strong>
                    </div>
                    <span className="plan-detail-chip">
                      {selectedSlot.start} - {selectedSlot.end} / {formatMinutesLabel(selectedSlot.duration)}
                    </span>
                  </div>
                  <div className="plan-detail-grid">
                    <label>
                      表示文字
                      <textarea
                        rows={3}
                        value={selectedSlot.customTitle ?? getSlotLabel(selectedSlot)}
                        onChange={(event) => updateSlotTitle(selectedSlot.id, event.target.value)}
                      />
                    </label>
                    <label>
                      内容・曲
                      <select
                        value={getSlotContentValue(selectedSlot)}
                        onChange={(event) => updateSlotContent(selectedSlot.id, event.target.value)}
                      >
                        {UTILITY_SLOT_TEMPLATES.map((template) => (
                          <option key={template.kind} value={`utility:${template.kind}`}>
                            {template.label}
                          </option>
                        ))}
                        {state.pieces.map((piece) => (
                          <option key={piece.id} value={`piece:${piece.id}`}>
                            {piece.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      開始
                      <input
                        type="time"
                        step="300"
                        value={selectedSlot.start}
                        onChange={(event) => updateSlotTimeInput(selectedSlot.id, "start", event.target.value)}
                      />
                    </label>
                    <label>
                      終了
                      <input
                        type="time"
                        step="300"
                        value={selectedSlot.end}
                        onChange={(event) => updateSlotTimeInput(selectedSlot.id, "end", event.target.value)}
                      />
                    </label>
                  </div>
                  <div className="plan-detail-actions">
                    <button type="button" className="secondary" onClick={() => adjustSlotEnd(selectedSlot.id, -5)}>
                      -5分
                    </button>
                    <button type="button" className="secondary" onClick={() => adjustSlotEnd(selectedSlot.id, 5)}>
                      +5分
                    </button>
                    <button type="button" className="secondary" onClick={() => setSelectedSlotId(null)}>
                      選択解除
                    </button>
                    <button type="button" className="secondary" onClick={() => toggleSlotLock(selectedSlot.id)}>
                      {selectedSlot.isLocked ? "固定解除" : "固定"}
                    </button>
                    <button type="button" className="danger" onClick={() => deleteSlot(selectedSlot.id)}>
                      削除
                    </button>
                  </div>
                </>
              ) : (
                <div className="plan-detail-empty">
                  <strong>編集するボックスを選択</strong>
                  <span className="muted">5分の短い枠も、選択後にここで曲・内容・時刻を変更できます。削除はボックス内からも操作できます。</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
