"use client";

import Link from "next/link";
import { getSelectedPracticeDay, useLocalPracticeState, usePieceMap } from "@/components/LocalPracticeApp";

export function SheetViewApp() {
  const { state, updateState } = useLocalPracticeState();
  const selectedDay = getSelectedPracticeDay(state);
  const pieceMap = usePieceMap(state.pieces);

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">表ビュー</p>
        <h1>練習計画表</h1>
        <label>
          表示する日付
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
        <p>
          {selectedDay.practiceDate} / {selectedDay.startTime}〜{selectedDay.endTime}
        </p>
        <div className="row">
          <Link className="button secondary" href="/admin">管理者用URLへ</Link>
          <Link className="button secondary" href="/player">奏者入力URLへ</Link>
        </div>
      </section>

      <section className="panel stack">
        <h2>Excel風の表</h2>
        {selectedDay.plan.length === 0 ? (
          <p className="muted">まだこの日の計画がありません。管理者用URLで自動計画を生成してください。</p>
        ) : (
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>順番</th>
                  <th>開始</th>
                  <th>終了</th>
                  <th>分</th>
                  <th>曲 / 休憩</th>
                  <th>指揮者</th>
                  <th>出演者数</th>
                  <th>スコア</th>
                  <th>理由</th>
                </tr>
              </thead>
              <tbody>
                {selectedDay.plan.map((slot, index) => {
                  const piece = slot.pieceId ? pieceMap.get(slot.pieceId) : null;
                  const conductor = piece
                    ? state.members.find((member) => member.id === piece.conductorId)
                    : null;
                  return (
                    <tr key={slot.id}>
                      <td>{index + 1}</td>
                      <td>{slot.start}</td>
                      <td>{slot.end}</td>
                      <td>{slot.duration}</td>
                      <td>{piece?.title ?? "休憩"}</td>
                      <td>{conductor?.name ?? ""}</td>
                      <td>{piece ? `${piece.memberIds.length}人` : ""}</td>
                      <td>{slot.score ?? ""}</td>
                      <td>{slot.reason ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
