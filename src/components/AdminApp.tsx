"use client";

import Link from "next/link";
import { useRef, useState } from "react";
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
  if (slotLabel.includes("準備")) return "setup";
  if (slotLabel.includes("片付け")) return "cleanup";
  return "piece";
}

export function AdminApp() {
  const { state, updateState } = useLocalPracticeState();
  const [planMessage, setPlanMessage] = useState("");
  const selectedDay = getSelectedPracticeDay(state);
  const pieceMap = usePieceMap(state.pieces);
  const manualStartTimeRef = useRef<HTMLInputElement>(null);
  const utilityMinutesRef = useRef<HTMLInputElement>(null);
  const manualPieceRef = useRef<HTMLSelectElement>(null);

  const practiceMinutes = toMinutes(selectedDay.endTime) - toMinutes(selectedDay.startTime);
  const sortedPlan = sortPlanByTime(selectedDay.plan);
  const plannedMinutes = sortedPlan.reduce((total, slot) => total + slot.duration, 0);
  const freeMinutes = Math.max(0, practiceMinutes - plannedMinutes);
  const overlappingSlotIds = findOverlappingPlanSlots(selectedDay.plan);
  const pieceSlotCount = sortedPlan.filter((slot) => slot.pieceId).length;
  const utilitySlotCount = sortedPlan.length - pieceSlotCount;
  const coverageRatio = practiceMinutes > 0 ? Math.min(1, plannedMinutes / practiceMinutes) : 0;
  const usedPieceCount = new Set(sortedPlan.map((slot) => slot.pieceId).filter(Boolean)).size;

  function updateSelectedDay(patch: Partial<typeof selectedDay>) {
    updateState({ practiceDays: updatePracticeDay(state, selectedDay.id, patch) });
  }

  function deletePracticeDay(dayId: string) {
    if (state.practiceDays.length <= 1) return;
    const nextDays = state.practiceDays.filter((day) => day.id !== dayId);
    updateState({
      practiceDays: nextDays,
      selectedPracticeDayId: state.selectedPracticeDayId === dayId ? nextDays[0].id : state.selectedPracticeDayId
    });
  }

  function updateSlot(slotId: string, patch: { pieceId?: string | null; start?: string; end?: string }) {
    updateSelectedDay({
      plan: selectedDay.plan.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              ...patch,
              duration:
                patch.start || patch.end
                  ? toMinutes(patch.end ?? slot.end) - toMinutes(patch.start ?? slot.start)
                  : slot.duration,
              reason: patch.pieceId !== undefined ? "管理者が手動で調整した枠です。" : slot.reason
            }
          : slot
      )
    });
  }

  function insertPlanSlot(nextSlot: (typeof selectedDay.plan)[number]) {
    const nextStart = toMinutes(nextSlot.start);
    const nextEnd = toMinutes(nextSlot.end);
    const trimmedPlan = selectedDay.plan.flatMap((slot) => {
      const slotStart = toMinutes(slot.start);
      const slotEnd = toMinutes(slot.end);

      if (slotEnd <= nextStart || nextEnd <= slotStart) {
        return [slot];
      }

      const fragments: typeof selectedDay.plan = [];

      if (slotStart < nextStart) {
        fragments.push({
          ...slot,
          end: toTime(nextStart),
          duration: nextStart - slotStart
        });
      }

      if (nextEnd < slotEnd) {
        fragments.push({
          ...slot,
          id: makeId("s"),
          start: toTime(nextEnd),
          duration: slotEnd - nextEnd
        });
      }

      return fragments.filter((fragment) => fragment.duration > 0);
    });

    updateSelectedDay({
      plan: [...trimmedPlan, nextSlot]
    });
  }

  function addManualSlot({
    label,
    pieceId,
    reason
  }: {
    label: string;
    pieceId: string | null;
    reason: string;
  }) {
    const startTime = manualStartTimeRef.current?.value || selectedDay.startTime;
    const requestedMinutes = Number(utilityMinutesRef.current?.value ?? 5);
    const duration = Number.isFinite(requestedMinutes) ? Math.max(1, Math.floor(requestedMinutes)) : 1;
    const boundedStart = Math.max(toMinutes(selectedDay.startTime), toMinutes(startTime));
    const boundedEnd = Math.min(toMinutes(selectedDay.endTime), boundedStart + duration);

    if (boundedEnd <= boundedStart) {
      setPlanMessage("追加できませんでした。開始時刻と分数を見直してください。");
      return;
    }

    insertPlanSlot({
      id: makeId("s"),
      pieceId,
      start: toTime(boundedStart),
      end: toTime(boundedEnd),
      duration: boundedEnd - boundedStart,
      reason
    });

    setPlanMessage(`${label}を ${toTime(boundedStart)} から ${boundedEnd - boundedStart}分で追加しました。`);
  }

  function handleGeneratePlan() {
    const generatedPlan = generatePracticePlan(state);
    updateSelectedDay({ plan: generatedPlan });

    if (generatedPlan.length > 0) {
      setPlanMessage(`${generatedPlan.length}件の練習枠を自動生成しました。`);
      return;
    }

    const presentMemberIds = new Set(
      selectedDay.respondedMemberIds.filter((id) => !selectedDay.absentMemberIds.includes(id))
    );
    const readyPieceCount = state.pieces.filter((piece) => piece.conductorId && piece.memberIds.length > 0).length;

    if (readyPieceCount === 0) {
      setPlanMessage("計画を作れませんでした。先に指揮者と参加状況の入力を確認してください。");
      return;
    }

    if (presentMemberIds.size === 0) {
      setPlanMessage("計画を作れませんでした。奏者側で参加可能時間を保存した人がまだいません。");
      return;
    }

    setPlanMessage("計画を作れませんでした。対象曲や参加可能時間の条件が厳しすぎる可能性があります。");
  }

  function getSlotLabel(slot: (typeof selectedDay.plan)[number]) {
    return getPlanSlotLabel(slot, slot.pieceId ? pieceMap.get(slot.pieceId)?.title : undefined);
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用URL</p>
        <h1>管理者用 練習計画</h1>
        <p>練習日を選んで、自動生成と手動調整を組み合わせながら当日の流れを整えます。</p>
        <div className="row">
          <Link className="button" href="/admin/setup">
            メンバー・曲・練習日の追加
          </Link>
          <Link className="button secondary" href="/player">
            奏者入力URLへ
          </Link>
          <Link className="button secondary" href="/availability">
            参加可能時間表
          </Link>
          <Link className="button secondary" href="/sheet">
            表で見る
          </Link>
        </div>
        {planMessage ? <div className="notice">{planMessage}</div> : null}
      </section>

      <section className="panel stack">
        <h2>練習日</h2>
        <div className="section-block">
          <label>
            編集する練習日
            <select
              value={selectedDay.id}
              onChange={(event) => updateState({ selectedPracticeDayId: event.target.value })}
            >
              {state.practiceDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.practiceDate} {day.startTime}-{day.endTime}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="section-block stack">
          <h3>選択中の練習日を編集</h3>
          <div className="date-time-grid">
            <label>
              日付
              <input
                type="date"
                value={selectedDay.practiceDate}
                onChange={(event) => updateSelectedDay({ practiceDate: event.target.value })}
              />
            </label>
            <label>
              開始
              <input
                type="time"
                step="300"
                value={selectedDay.startTime}
                onChange={(event) => updateSelectedDay({ startTime: event.target.value })}
              />
            </label>
            <label>
              終了
              <input
                type="time"
                step="300"
                value={selectedDay.endTime}
                onChange={(event) => updateSelectedDay({ endTime: event.target.value })}
              />
            </label>
          </div>
          <p className="muted">
            練習時間 {formatMinutesLabel(practiceMinutes)} / 計画済み {formatMinutesLabel(plannedMinutes)}
          </p>
        </div>

        <div className="section-block row">
          <button className="danger" type="button" onClick={() => deletePracticeDay(selectedDay.id)}>
            選択中の練習日を削除
          </button>
        </div>
      </section>

      <section className="panel stack">
        <div className="row">
          <div>
            <p className="muted">Practice Flow</p>
            <h2>{selectedDay.practiceDate} の練習計画</h2>
          </div>
          <div className="row">
            <span className="muted">
              {selectedDay.startTime} - {selectedDay.endTime}
            </span>
            <button type="button" onClick={handleGeneratePlan}>
              選択中の練習日で自動生成
            </button>
          </div>
        </div>

        <div className="plan-summary-grid">
          <article className="plan-stat-card">
            <span className="plan-stat-label">進行率</span>
            <strong>{Math.round(coverageRatio * 100)}%</strong>
            <span className="muted">
              {formatMinutesLabel(plannedMinutes)} / {formatMinutesLabel(practiceMinutes)}
            </span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">曲の枠</span>
            <strong>{pieceSlotCount}</strong>
            <span className="muted">{usedPieceCount}曲を使用</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">補助枠</span>
            <strong>{utilitySlotCount}</strong>
            <span className="muted">休憩・準備・片付け</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">空き時間</span>
            <strong>{formatMinutesLabel(freeMinutes)}</strong>
            <span className="muted">{overlappingSlotIds.size > 0 ? "要調整" : "まだ追加できます"}</span>
          </article>
        </div>

        <div className="plan-progress-card">
          <div className="plan-progress-header">
            <strong>時間の使い方</strong>
            <span className="muted">{overlappingSlotIds.size > 0 ? "時間重複あり" : "重複なし"}</span>
          </div>
          <div className="plan-progress-track" aria-hidden="true">
            <div className="plan-progress-fill" style={{ width: `${coverageRatio * 100}%` }} />
          </div>
          <div className="plan-progress-meta muted">
            計画済み {formatMinutesLabel(plannedMinutes)} / 空き {formatMinutesLabel(freeMinutes)}
          </div>
        </div>

        {overlappingSlotIds.size > 0 ? <div className="error">時間が重なっている枠があります。開始・終了時刻を見直してください。</div> : null}

        <div className="plan-toolbar">
          <div className="plan-toolbar-head">
            <strong>補助枠や曲を追加</strong>
            <span className="muted">開始時刻を指定して追加すると、その時間帯は既存の枠を上書きします。</span>
          </div>
          <div className="utility-slot-form">
            <label>
              何時から
              <input ref={manualStartTimeRef} name="startTime" type="time" step="60" defaultValue={selectedDay.startTime} />
            </label>
            <label>
              追加する分数
              <input ref={utilityMinutesRef} name="minutes" type="number" min="1" step="1" defaultValue="5" />
            </label>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                addManualSlot({
                  label: "休憩",
                  pieceId: null,
                  reason: "休憩のために追加した枠です。"
                })
              }
            >
              休憩を追加
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                addManualSlot({
                  label: "合奏準備",
                  pieceId: null,
                  reason: "合奏準備のために追加した枠です。"
                })
              }
            >
              合奏準備を追加
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() =>
                addManualSlot({
                  label: "片付け",
                  pieceId: null,
                  reason: "片付けのために追加した枠です。"
                })
              }
            >
              片付けを追加
            </button>
            <label>
              手動で入れる曲
              <select ref={manualPieceRef} defaultValue={state.pieces[0]?.id ?? ""}>
                {state.pieces.length === 0 ? <option value="">曲がありません</option> : null}
                {state.pieces.map((piece) => (
                  <option key={piece.id} value={piece.id}>
                    {piece.title}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => {
                const pieceId = manualPieceRef.current?.value ?? "";
                const pieceTitle = pieceId ? pieceMap.get(pieceId)?.title ?? "曲" : "";

                if (!pieceId) {
                  setPlanMessage("曲を追加するには、先に追加する曲を選んでください。");
                  return;
                }

                addManualSlot({
                  label: pieceTitle,
                  pieceId,
                  reason: `${pieceTitle}を手動で追加した枠です。`
                });
              }}
            >
              曲を追加
            </button>
          </div>
        </div>

        {sortedPlan.length === 0 ? (
          <div className="plan-empty-state">
            <strong>まだ計画がありません。</strong>
            <p className="muted">自動生成を使うか、補助枠や曲を追加してここから流れを組み立ててください。</p>
          </div>
        ) : (
          <div className="plan-timeline">
            {sortedPlan.map((slot, index) => {
              const slotLabel = getSlotLabel(slot);
              const slotVariant = getSlotVariant(slotLabel);

              return (
                <article
                  className={`plan-slot-card plan-slot-${slotVariant}${overlappingSlotIds.has(slot.id) ? " overlap-slot" : ""}`}
                  key={slot.id}
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
                        {slot.score ? <span className="plan-badge accent">スコア {slot.score}</span> : null}
                        {overlappingSlotIds.has(slot.id) ? <span className="plan-badge danger">重複</span> : null}
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
                      <label>
                        開始
                        <input type="time" step="60" value={slot.start} onChange={(event) => updateSlot(slot.id, { start: event.target.value })} />
                      </label>
                      <label>
                        終了
                        <input type="time" step="60" value={slot.end} onChange={(event) => updateSlot(slot.id, { end: event.target.value })} />
                      </label>
                      <button
                        className="danger"
                        type="button"
                        onClick={() => updateSelectedDay({ plan: selectedDay.plan.filter((item) => item.id !== slot.id) })}
                      >
                        削除
                      </button>
                    </div>

                    <div className="plan-slot-footer">
                      <div className="notice">{slot.reason ?? "管理者が手動で調整した枠です。"}</div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
