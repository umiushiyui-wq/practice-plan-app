"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import {
  generatePracticePlan,
  findOverlappingPlanSlots,
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

const INSTRUMENT_OPTIONS = [
  "ふるぼえ",
  "クラリネット",
  "サックス",
  "ホルン",
  "トランペット",
  "トロンボーン",
  "低音",
  "パーカス"
];

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

  function addMember(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const member = {
      id: makeId("m"),
      name,
      instrument: String(formData.get("instrument") ?? ""),
      part: ""
    };
    updateState({
      members: [...state.members, member],
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        absentMemberIds: Array.from(new Set([...day.absentMemberIds, member.id]))
      }))
    });
  }

  function addPiece(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;
    updateState({
      pieces: [
        ...state.pieces,
        {
          id: makeId("p"),
          title,
          conductorId: String(formData.get("conductorId") ?? ""),
          memberIds: formData.getAll("memberIds").map(String),
          targetMinutes: Number(formData.get("targetMinutes") ?? 60),
          dailyMaxMinutes: Number(formData.get("dailyMaxMinutes") ?? 45)
        }
      ]
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
              reason: patch.pieceId !== undefined ? "管理者が手動修正した枠です。" : slot.reason
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
          reason: `${label}です。`
        }
      ]
    });
  }

  function handleGeneratePlan() {
    const generatedPlan = generatePracticePlan(state);
    updateSelectedDay({ plan: generatedPlan });

    if (generatedPlan.length > 0) {
      setPlanMessage(`${generatedPlan.length}件の練習枠を生成しました。`);
      return;
    }

    const presentMemberIds = new Set(
      selectedDay.respondedMemberIds.filter((id) => !selectedDay.absentMemberIds.includes(id))
    );
    const readyPieceCount = state.pieces.filter(
      (piece) => piece.conductorId && piece.memberIds.length > 0
    ).length;

    if (readyPieceCount === 0) {
      setPlanMessage("計画を作れませんでした。曲に指揮者と出演者を設定してください。");
      return;
    }

    if (presentMemberIds.size === 0) {
      setPlanMessage("計画を作れませんでした。奏者側で出席として保存された人がまだいません。");
      return;
    }

    setPlanMessage("計画を作れませんでした。指揮者・出演者の参加可能時間が重なる時間帯を確認してください。");
  }

  function getSlotLabel(slot: typeof selectedDay.plan[number]) {
    return getPlanSlotLabel(slot, slot.pieceId ? pieceMap.get(slot.pieceId)?.title : undefined);
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用URL</p>
        <h1>管理者用 練習計画</h1>
        <p>メンバー、曲、練習日、練習計画を管理します。</p>
        <div className="row">
          <Link className="button secondary" href="/player">奏者入力URLへ</Link>
          <Link className="button secondary" href="/availability">参加可能時間表</Link>
          <Link className="button secondary" href="/sheet">表で見る</Link>
          <button type="button" onClick={handleGeneratePlan}>
            選択中の日付で自動計画を生成
          </button>
        </div>
        {planMessage ? <div className="notice">{planMessage}</div> : null}
      </section>

      <section className="panel stack">
        <h2>練習日</h2>
        <div className="section-block">
          <label>
            編集する日付
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
          <h3>編集中の日付設定</h3>
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
            練習時間: {practiceMinutes}分 / 計画に追加済み: {plannedMinutes}分
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
              追加する日付
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
            選択中の日付を削除
          </button>
        </div>
      </section>

      <div className="grid">
        <section className="panel stack">
          <h2>メンバー追加</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); addMember(new FormData(e.currentTarget)); e.currentTarget.reset(); }}>
            <input name="name" placeholder="名前" required />
            <select name="instrument" defaultValue="" required>
              <option value="" disabled>楽器を選択</option>
              {INSTRUMENT_OPTIONS.map((instrument) => (
                <option key={instrument} value={instrument}>{instrument}</option>
              ))}
            </select>
            <button type="submit">追加</button>
          </form>
          {state.members.map((member) => (
            <div className="row" key={member.id}>
              <strong>{member.name}</strong>
              <span className="muted">{member.instrument}</span>
              <button className="danger" type="button" onClick={() => deleteMember(member.id)}>削除</button>
            </div>
          ))}
        </section>

        <section className="panel stack">
          <h2>曲追加</h2>
          <form className="stack" onSubmit={(e) => { e.preventDefault(); addPiece(new FormData(e.currentTarget)); e.currentTarget.reset(); }}>
            <input name="title" placeholder="曲名" required />
            <select name="conductorId" required>
              <option value="">指揮者を選択</option>
              {state.members.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
            <label>
              目標累積練習時間（全練習日で合計したい分）
              <input name="targetMinutes" type="number" min="0" step="5" defaultValue="60" />
            </label>
            <label>
              1日の最大練習時間（この曲を1日に入れる上限分）
              <input name="dailyMaxMinutes" type="number" min="15" step="5" defaultValue="45" />
            </label>
            <div className="stack">
              <strong>出演者</strong>
              {state.members.map((member) => (
                <label className="row" key={member.id}>
                  <input style={{ width: "auto" }} name="memberIds" type="checkbox" value={member.id} />
                  {member.name}
                </label>
              ))}
            </div>
            <button type="submit">曲を追加</button>
          </form>
        </section>
      </div>

      <section className="panel stack">
        <h2>曲一覧</h2>
        <table>
          <thead><tr><th>曲</th><th>指揮者</th><th>出演者</th><th>目標</th><th>上限</th><th></th></tr></thead>
          <tbody>
            {state.pieces.map((piece) => (
              <tr key={piece.id}>
                <td>{piece.title}</td>
                <td>{state.members.find((member) => member.id === piece.conductorId)?.name}</td>
                <td>{piece.memberIds.length}人</td>
                <td>{piece.targetMinutes}分</td>
                <td>{piece.dailyMaxMinutes}分</td>
                <td><button className="danger" type="button" onClick={() => deletePiece(piece.id)}>削除</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel stack">
        <div className="row">
          <h2>{selectedDay.practiceDate} の計画編集</h2>
          <span className="muted">合計 {plannedMinutes}分 / 練習時間 {practiceMinutes}分</span>
        </div>
        {overlappingSlotIds.size > 0 ? <div className="error">時間がかぶってます。</div> : null}
        <div className="utility-slot-form">
          <label>
            追加する時間（分）
            <input ref={utilityMinutesRef} name="minutes" type="number" min="1" step="1" defaultValue="5" />
          </label>
          <button type="button" className="secondary" onClick={() => addUtilitySlot("休憩", Number(utilityMinutesRef.current?.value ?? 5))}>休憩を追加</button>
          <button type="button" className="secondary" onClick={() => addUtilitySlot("準備時間", Number(utilityMinutesRef.current?.value ?? 5))}>準備時間を追加</button>
          <button type="button" className="secondary" onClick={() => addUtilitySlot("片付け時間", Number(utilityMinutesRef.current?.value ?? 5))}>片付け時間を追加</button>
        </div>
        {sortedPlan.map((slot) => (
          <article className={`panel stack${overlappingSlotIds.has(slot.id) ? " overlap-slot" : ""}`} key={slot.id}>
            <div className="grid">
              <select value={slot.pieceId ?? ""} onChange={(e) => updateSlot(slot.id, { pieceId: e.target.value || null })}>
                <option value="">{getSlotLabel(slot)}</option>
                {state.pieces.map((piece) => <option key={piece.id} value={piece.id}>{piece.title}</option>)}
              </select>
              <input type="time" step="60" value={slot.start} onChange={(e) => updateSlot(slot.id, { start: e.target.value })} />
              <input type="time" step="60" value={slot.end} onChange={(e) => updateSlot(slot.id, { end: e.target.value })} />
              <button className="danger" type="button" onClick={() => updateSelectedDay({ plan: selectedDay.plan.filter((item) => item.id !== slot.id) })}>削除</button>
            </div>
            {overlappingSlotIds.has(slot.id) ? <div className="error">この枠の時間が他の枠とかぶっています。</div> : null}
            <p>{getSlotLabel(slot)} / {slot.duration}分{slot.score ? `/ スコア ${slot.score}` : ""}</p>
            <div className="notice">{slot.reason ?? "管理者が手動修正した枠です。"}</div>
          </article>
        ))}
      </section>
    </main>
  );
}
