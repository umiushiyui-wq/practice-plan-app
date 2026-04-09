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

export function AdminApp() {
  const { state, updateState } = useLocalPracticeState();
  const [planMessage, setPlanMessage] = useState("");
  const selectedDay = getSelectedPracticeDay(state);
  const pieceMap = usePieceMap(state.pieces);
  const utilityMinutesRef = useRef<HTMLInputElement>(null);
  const plannedMinutes = selectedDay.plan.reduce((total, slot) => total + slot.duration, 0);
  const practiceMinutes = toMinutes(selectedDay.endTime) - toMinutes(selectedDay.startTime);
  const sortedPlan = sortPlanByTime(selectedDay.plan);
  const overlappingSlotIds = findOverlappingPlanSlots(selectedDay.plan);

  function updateSelectedDay(patch: Partial<typeof selectedDay>) {
    updateState({ practiceDays: updatePracticeDay(state, selectedDay.id, patch) });
  }

  function addPracticeDay(formData: FormData) {
    const practiceDate = String(formData.get("practiceDate") ?? "").trim();
    if (!practiceDate) return;

    const startTime = String(formData.get("startTime") ?? selectedDay.startTime);
    const endTime = String(formData.get("endTime") ?? selectedDay.endTime);
    const id = makeId("d");
    updateState({
      selectedPracticeDayId: id,
      practiceDays: [
        ...state.practiceDays,
        {
          id,
          practiceDate,
          startTime,
          endTime,
          availabilities: [],
          absentMemberIds: state.members.map((member) => member.id),
          respondedMemberIds: [],
          plan: []
        }
      ]
    });
  }

  function deletePracticeDay(dayId: string) {
    if (state.practiceDays.length <= 1) return;
    const nextDays = state.practiceDays.filter((day) => day.id !== dayId);
    updateState({
      practiceDays: nextDays,
      selectedPracticeDayId: state.selectedPracticeDayId === dayId ? nextDays[0].id : state.selectedPracticeDayId
    });
  }

  function deleteMember(memberId: string) {
    const member = state.members.find((item) => item.id === memberId);
    if (!member || !confirm(`${member.name} を削除しますか？`)) return;

    updateState({
      members: state.members.filter((item) => item.id !== memberId),
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        availabilities: day.availabilities.filter((item) => item.memberId !== memberId),
        absentMemberIds: day.absentMemberIds.filter((id) => id !== memberId),
        respondedMemberIds: day.respondedMemberIds.filter((id) => id !== memberId)
      })),
      pieces: state.pieces.map((piece) => ({
        ...piece,
        conductorId: piece.conductorId === memberId ? "" : piece.conductorId,
        memberIds: piece.memberIds.filter((id) => id !== memberId)
      }))
    });
  }

  function deletePiece(pieceId: string) {
    const piece = state.pieces.find((item) => item.id === pieceId);
    if (!piece || !confirm(`${piece.title} を削除しますか？`)) return;

    updateState({
      pieces: state.pieces.filter((item) => item.id !== pieceId),
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        plan: day.plan.filter((slot) => slot.pieceId !== pieceId)
      })),
      recentMinutes: Object.fromEntries(Object.entries(state.recentMinutes).filter(([id]) => id !== pieceId))
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

  function addUtilitySlot(label: string, minutes: number) {
    const duration = Number.isFinite(minutes) ? Math.max(1, Math.floor(minutes)) : 1;
    updateSelectedDay({
      plan: [
        ...selectedDay.plan,
        {
          id: makeId("s"),
          pieceId: null,
          start: selectedDay.startTime,
          end: toTime(toMinutes(selectedDay.startTime) + duration),
          duration,
          reason: `${label}のために追加した枠です。`
        }
      ]
    });
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
      setPlanMessage("計画を作れませんでした。先に指揮者と参加メンバーを曲に設定してください。");
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
        <p>練習日と練習計画を管理する画面です。</p>
        <div className="row">
          <Link className="button" href="/メンバー・曲の追加">
            メンバー・曲の追加
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
          <button type="button" onClick={handleGeneratePlan}>
            選択中の練習日で自動生成
          </button>
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
            練習時間 {practiceMinutes}分 / 計画に割り当て済み {plannedMinutes}分
          </p>
        </div>

        <form
          className="section-block stack"
          onSubmit={(event) => {
            event.preventDefault();
            addPracticeDay(new FormData(event.currentTarget));
            event.currentTarget.reset();
          }}
        >
          <h3>新しい練習日を追加</h3>
          <div className="date-time-grid">
            <label>
              日付
              <input name="practiceDate" type="date" required />
            </label>
            <label>
              開始
              <input name="startTime" type="time" step="300" defaultValue={selectedDay.startTime} required />
            </label>
            <label>
              終了
              <input name="endTime" type="time" step="300" defaultValue={selectedDay.endTime} required />
            </label>
          </div>
          <button type="submit">練習日を追加</button>
        </form>

        <div className="section-block row">
          <button className="danger" type="button" onClick={() => deletePracticeDay(selectedDay.id)}>
            選択中の練習日を削除
          </button>
        </div>
      </section>

      <div className="grid">
        <section className="panel stack">
          <div className="row">
            <h2>メンバー一覧</h2>
            <Link className="button secondary" href="/メンバー・曲の追加">
              追加ページへ
            </Link>
          </div>
          {state.members.length === 0 ? <p className="muted">まだメンバーがいません。</p> : null}
          {state.members.map((member) => (
            <div className="row" key={member.id}>
              <div>
                <strong>{member.name}</strong>
                <div className="muted">
                  {member.instrument || "楽器未設定"}
                  {member.part ? ` / ${member.part}` : ""}
                </div>
              </div>
              <button className="danger" type="button" onClick={() => deleteMember(member.id)}>
                削除
              </button>
            </div>
          ))}
        </section>

        <section className="panel stack">
          <div className="row">
            <h2>曲一覧</h2>
            <Link className="button secondary" href="/メンバー・曲の追加">
              追加ページへ
            </Link>
          </div>
          {state.pieces.length === 0 ? <p className="muted">まだ曲がありません。</p> : null}
          {state.pieces.map((piece) => (
            <div className="row" key={piece.id}>
              <div>
                <strong>{piece.title}</strong>
                <div className="muted">
                  指揮者: {state.members.find((member) => member.id === piece.conductorId)?.name ?? "未設定"} / 参加者{" "}
                  {piece.memberIds.length}人 / 目標 {piece.targetMinutes}分 / 1日上限 {piece.dailyMaxMinutes}分
                </div>
              </div>
              <button className="danger" type="button" onClick={() => deletePiece(piece.id)}>
                削除
              </button>
            </div>
          ))}
        </section>
      </div>

      <section className="panel stack">
        <div className="row">
          <h2>{selectedDay.practiceDate} の練習計画</h2>
          <span className="muted">
            割り当て {plannedMinutes}分 / 練習時間 {practiceMinutes}分
          </span>
        </div>
        {overlappingSlotIds.size > 0 ? <div className="error">時間が重なっている枠があります。</div> : null}
        <div className="utility-slot-form">
          <label>
            追加する補助枠の分数
            <input ref={utilityMinutesRef} name="minutes" type="number" min="1" step="1" defaultValue="5" />
          </label>
          <button
            type="button"
            className="secondary"
            onClick={() => addUtilitySlot("休憩", Number(utilityMinutesRef.current?.value ?? 5))}
          >
            休憩を追加
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => addUtilitySlot("合奏準備", Number(utilityMinutesRef.current?.value ?? 5))}
          >
            合奏準備を追加
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => addUtilitySlot("片付け", Number(utilityMinutesRef.current?.value ?? 5))}
          >
            片付けを追加
          </button>
        </div>
        {sortedPlan.map((slot) => (
          <article className={`panel stack${overlappingSlotIds.has(slot.id) ? " overlap-slot" : ""}`} key={slot.id}>
            <div className="grid">
              <select value={slot.pieceId ?? ""} onChange={(event) => updateSlot(slot.id, { pieceId: event.target.value || null })}>
                <option value="">{getSlotLabel(slot)}</option>
                {state.pieces.map((piece) => (
                  <option key={piece.id} value={piece.id}>
                    {piece.title}
                  </option>
                ))}
              </select>
              <input type="time" step="60" value={slot.start} onChange={(event) => updateSlot(slot.id, { start: event.target.value })} />
              <input type="time" step="60" value={slot.end} onChange={(event) => updateSlot(slot.id, { end: event.target.value })} />
              <button
                className="danger"
                type="button"
                onClick={() => updateSelectedDay({ plan: selectedDay.plan.filter((item) => item.id !== slot.id) })}
              >
                削除
              </button>
            </div>
            {overlappingSlotIds.has(slot.id) ? <div className="error">この枠は別の枠と時間が重なっています。</div> : null}
            <p>
              {getSlotLabel(slot)} / {slot.duration}分
              {slot.score ? ` / スコア ${slot.score}` : ""}
            </p>
            <div className="notice">{slot.reason ?? "管理者が手動で調整した枠です。"}</div>
          </article>
        ))}
      </section>
    </main>
  );
}
