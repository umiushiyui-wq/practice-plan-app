"use client";

import Link from "next/link";
import { useState, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  findOverlappingPlanSlots,
  generatePracticePlan,
  getPlanSlotLabel,
  getSelectedPracticeDay,
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

function getSlotVariant(slotLabel: string) {
  if (slotLabel.includes("休憩")) return "break";
  if (slotLabel.includes("合奏準備")) return "setup";
  if (slotLabel.includes("片付け")) return "cleanup";
  return "piece";
}

function getUtilityTemplate(kind: UtilitySlotKind) {
  return UTILITY_SLOT_TEMPLATES.find((template) => template.kind === kind) ?? UTILITY_SLOT_TEMPLATES[0];
}

function normalizeDuration(value: number, fallback = 1) {
  return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : fallback;
}

function snapDuration(minutes: number, fallback = RESIZE_STEP_MINUTES) {
  const normalized = normalizeDuration(minutes, fallback);
  return Math.max(RESIZE_STEP_MINUTES, Math.round(normalized / RESIZE_STEP_MINUTES) * RESIZE_STEP_MINUTES);
}

export function AdminApp() {
  const { state, updateState } = useLocalPracticeState();
  const [planMessage, setPlanMessage] = useState("");
  const [draggedSlotId, setDraggedSlotId] = useState<string | null>(null);
  const [activeDropIndex, setActiveDropIndex] = useState<number | null>(null);
  const selectedDay = getSelectedPracticeDay(state);
  const pieceMap = usePieceMap(state.pieces);

  const practiceMinutes = toMinutes(selectedDay.endTime) - toMinutes(selectedDay.startTime);
  const sortedPlan = sortPlanByTime(selectedDay.plan);
  const plannedMinutes = sortedPlan.reduce((total, slot) => total + slot.duration, 0);
  const freeMinutes = Math.max(0, practiceMinutes - plannedMinutes);
  const overlappingSlotIds = findOverlappingPlanSlots(selectedDay.plan);
  const pieceSlotCount = sortedPlan.filter((slot) => slot.pieceId).length;
  const utilitySlotCount = sortedPlan.length - pieceSlotCount;
  const coverageRatio = practiceMinutes > 0 ? Math.min(1, plannedMinutes / practiceMinutes) : 0;
  const usedPieceCount = new Set(sortedPlan.map((slot) => slot.pieceId).filter(Boolean)).size;
  const practiceStartMinutes = toMinutes(selectedDay.startTime);
  const practiceEndMinutes = toMinutes(selectedDay.endTime);
  const timelineHeight = Math.max(1, practiceMinutes / MINUTES_PER_PIXEL);
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

  function rebuildPlanTimes(plan: typeof selectedDay.plan) {
    const practiceStart = toMinutes(selectedDay.startTime);
    const practiceEnd = toMinutes(selectedDay.endTime);
    let cursor = practiceStart;

    return plan.flatMap((slot) => {
      const requestedDuration = normalizeDuration(slot.duration);
      const nextEnd = Math.min(practiceEnd, cursor + requestedDuration);

      if (nextEnd <= cursor) return [];

      const nextSlot = {
        ...slot,
        start: toTime(cursor),
        end: toTime(nextEnd),
        duration: nextEnd - cursor
      };
      cursor = nextEnd;
      return [nextSlot];
    });
  }

  function updatePlanFromOrderedSlots(plan: typeof selectedDay.plan) {
    updateSelectedDay({ plan: rebuildPlanTimes(plan) });
  }

  function updateSlot(slotId: string, patch: { pieceId?: string | null; duration?: number }) {
    const nextPlan = sortedPlan.map((slot) =>
      slot.id === slotId
        ? {
            ...slot,
            ...patch,
            duration: patch.duration === undefined ? slot.duration : normalizeDuration(patch.duration, slot.duration),
            reason: patch.pieceId !== undefined ? "管理者が手動で調整した枠です。" : slot.reason
          }
        : slot
    );
    updatePlanFromOrderedSlots(nextPlan);
  }

  function handleResizeStart(event: ReactPointerEvent<HTMLButtonElement>, slotId: string, currentDuration: number) {
    event.preventDefault();
    event.stopPropagation();

    const startY = event.clientY;
    const startDuration = currentDuration;

    function handlePointerMove(moveEvent: PointerEvent) {
      const deltaMinutes = (moveEvent.clientY - startY) * MINUTES_PER_PIXEL;
      updateSlot(slotId, { duration: snapDuration(startDuration + deltaMinutes, startDuration) });
    }

    function handlePointerUp() {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }

  function makeSlotFromPalette(payload: PaletteDragPayload): (typeof selectedDay.plan)[number] | null {
    if (payload.slotType === "piece") {
      const piece = pieceMap.get(payload.pieceId);
      if (!piece) return null;

      const defaultDuration = Math.max(5, Math.min(piece.dailyMaxMinutes || 30, 60, Math.max(practiceMinutes, 1)));

      return {
        id: makeId("s"),
        pieceId: piece.id,
        start: selectedDay.startTime,
        end: toTime(toMinutes(selectedDay.startTime) + defaultDuration),
        duration: defaultDuration,
        reason: `${piece.title} を手動追加した枠です。`
      };
    }

    const template = getUtilityTemplate(payload.utilityKind);

    return {
      id: makeId("s"),
      pieceId: null,
      start: selectedDay.startTime,
      end: toTime(toMinutes(selectedDay.startTime) + template.defaultMinutes),
      duration: template.defaultMinutes,
      reason: template.reason
    };
  }

  function addSlotFromPalette(payload: PaletteDragPayload, targetIndex = sortedPlan.length) {
    const nextSlot = makeSlotFromPalette(payload);
    if (!nextSlot) {
      setPlanMessage("追加できませんでした。曲の設定を確認してください。");
      return;
    }

    const nextPlan = [...sortedPlan];
    nextPlan.splice(targetIndex, 0, nextSlot);
    updatePlanFromOrderedSlots(nextPlan);
    setPlanMessage(`${getSlotLabel(nextSlot)} を追加しました。ドラッグして順番を調整できます。`);
  }

  function moveSlot(slotId: string, targetIndex: number) {
    const currentIndex = sortedPlan.findIndex((slot) => slot.id === slotId);
    if (currentIndex < 0) return;

    const nextPlan = [...sortedPlan];
    const [movedSlot] = nextPlan.splice(currentIndex, 1);
    const adjustedIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
    nextPlan.splice(Math.max(0, Math.min(adjustedIndex, nextPlan.length)), 0, movedSlot);
    updatePlanFromOrderedSlots(nextPlan);
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

  function handleDrop(event: DragEvent, targetIndex: number) {
    event.preventDefault();
    const payload = readDragPayload(event);
    setDraggedSlotId(null);
    setActiveDropIndex(null);

    if (!payload) return;
    if (payload.type === "slot") {
      moveSlot(payload.slotId, targetIndex);
      return;
    }

    addSlotFromPalette(payload, targetIndex);
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
          <Link className="button secondary" href="/player">
            奏者ページへ
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

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">Step 1</p>
            <h2>対象の練習日を選ぶ</h2>
          </div>
          <label className="compact-field">
            練習日
            <select value={selectedDay.id} onChange={(event) => updateState({ selectedPracticeDayId: event.target.value })}>
              {state.practiceDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.practiceDate} {day.startTime}-{day.endTime}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="date-time-grid">
          <label>
            日付
            <input type="date" value={selectedDay.practiceDate} onChange={(event) => updateSelectedDay({ practiceDate: event.target.value })} />
          </label>
          <label>
            開始
            <input type="time" step="300" value={selectedDay.startTime} onChange={(event) => updateSelectedDay({ startTime: event.target.value })} />
          </label>
          <label>
            終了
            <input type="time" step="300" value={selectedDay.endTime} onChange={(event) => updateSelectedDay({ endTime: event.target.value })} />
          </label>
        </div>

        <div className="row">
          <span className="muted">練習時間: {formatMinutesLabel(practiceMinutes)}</span>
          <button className="danger" type="button" onClick={() => deletePracticeDay(selectedDay.id)}>
            この練習日を削除
          </button>
        </div>
      </section>

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">Step 2</p>
            <h2>{selectedDay.practiceDate} の練習計画を作る</h2>
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

        <div className="plan-summary-grid">
          <article className="plan-stat-card">
            <span className="plan-stat-label">埋まり具合</span>
            <strong>{Math.round(coverageRatio * 100)}%</strong>
            <span className="muted">
              {formatMinutesLabel(plannedMinutes)} / {formatMinutesLabel(practiceMinutes)}
            </span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">曲の枠</span>
            <strong>{pieceSlotCount}</strong>
            <span className="muted">{usedPieceCount}曲を使用中</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">補助の枠</span>
            <strong>{utilitySlotCount}</strong>
            <span className="muted">休憩・合奏準備・片付け</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">空き時間</span>
            <strong>{formatMinutesLabel(freeMinutes)}</strong>
            <span className="muted">{overlappingSlotIds.size > 0 ? "時間重なりあり" : "まだ追加できます"}</span>
          </article>
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
              <span className="muted">左のボックスを下の計画エリアへドラッグ、またはクリックで末尾へ追加できます。</span>
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
            </div>
          </aside>

          <div className="plan-canvas">
            <div className="plan-canvas-head">
              <strong>練習計画</strong>
              <span className="muted">箱の高さが時間です。下端をドラッグすると分数を変更できます。</span>
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

              <div className="plan-timeline-track">
                <div
                  className={`plan-drop-zone ${activeDropIndex === 0 ? "is-active" : ""}`}
                  onDragEnter={() => setActiveDropIndex(0)}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={() => setActiveDropIndex(null)}
                  onDrop={(event) => handleDrop(event, 0)}
                />

                {sortedPlan.length === 0 ? (
                  <div className="plan-empty-state">
                    <strong>まだ計画がありません。</strong>
                    <p className="muted">左のボックスをここに入れるか、自動生成してください。</p>
                  </div>
                ) : (
                  <div className="plan-timeline">
                    {sortedPlan.map((slot, index) => {
                      const slotLabel = getSlotLabel(slot);
                      const slotVariant = getSlotVariant(slotLabel);

                      return (
                        <div className="plan-slot-row" key={slot.id}>
                          <article
                            className={`plan-slot-card plan-slot-${slotVariant} ${getPieceToneClass(slot.pieceId)}${
                              overlappingSlotIds.has(slot.id) ? " overlap-slot" : ""
                            }${draggedSlotId === slot.id ? " is-dragging" : ""}`}
                            draggable
                            style={{ height: `${Math.max(1, slot.duration / MINUTES_PER_PIXEL)}px` }}
                            onDragEnd={() => {
                              setDraggedSlotId(null);
                              setActiveDropIndex(null);
                            }}
                            onDragStart={(event) => {
                              setDraggedSlotId(slot.id);
                              writeDragPayload(event, { type: "slot", slotId: slot.id });
                            }}
                          >
                            <div className="plan-slot-rail">
                              <span className="plan-slot-index">{String(index + 1).padStart(2, "0")}</span>
                            </div>
                            <div className="plan-slot-main">
                              <div className="plan-slot-top">
                                <div className="plan-slot-heading">
                                  <span className="plan-slot-time">
                                    {slot.start} - {slot.end}
                                  </span>
                                  <h3>{slotLabel}</h3>
                                </div>
                                <div className="plan-slot-badges">
                                  <span className="plan-badge">{formatMinutesLabel(slot.duration)}</span>
                                  {overlappingSlotIds.has(slot.id) ? <span className="plan-badge danger">重なり</span> : null}
                                </div>
                              </div>
                              <div className="plan-slot-editor">
                                <label>
                                  内容
                                  <select value={slot.pieceId ?? ""} onChange={(event) => updateSlot(slot.id, { pieceId: event.target.value || null })}>
                                    <option value="">{slotLabel}</option>
                                    {state.pieces.map((piece) => (
                                      <option key={piece.id} value={piece.id}>
                                        {piece.title}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <div className="plan-slot-move-buttons">
                                  <button
                                    className="secondary"
                                    disabled={index === 0}
                                    type="button"
                                    onClick={() => moveSlot(slot.id, index - 1)}
                                  >
                                    上へ
                                  </button>
                                  <button
                                    className="secondary"
                                    disabled={index === sortedPlan.length - 1}
                                    type="button"
                                    onClick={() => moveSlot(slot.id, index + 2)}
                                  >
                                    下へ
                                  </button>
                                </div>
                                <button
                                  className="danger"
                                  type="button"
                                  onClick={() => updatePlanFromOrderedSlots(sortedPlan.filter((item) => item.id !== slot.id))}
                                >
                                  削除
                                </button>
                              </div>
                              <button
                                className="plan-resize-handle"
                                type="button"
                                aria-label={`${slotLabel}の時間を変更`}
                                onPointerDown={(event) => handleResizeStart(event, slot.id, slot.duration)}
                              >
                                ↕
                              </button>
                            </div>
                          </article>
                          <div
                            className={`plan-drop-zone ${activeDropIndex === index + 1 ? "is-active" : ""}`}
                            onDragEnter={() => setActiveDropIndex(index + 1)}
                            onDragOver={(event) => event.preventDefault()}
                            onDragLeave={() => setActiveDropIndex(null)}
                            onDrop={(event) => handleDrop(event, index + 1)}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
