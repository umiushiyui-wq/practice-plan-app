"use client";

import Link from "next/link";
import {
  formatPracticeDateLabel,
  getPracticeDayLabel,
  getPlanSlotLabel,
  getSelectedPracticeDay,
  getSortedPracticeDays,
  sortPlanByTime,
  useLocalPracticeState,
  usePieceMap
} from "@/components/LocalPracticeApp";

function formatPracticeTimeAndLocation(day: { startTime: string; endTime: string; location: string }) {
  const location = day.location.trim();
  return location ? `${day.startTime}〜${day.endTime} ＠${location}` : `${day.startTime}〜${day.endTime}`;
}

export function SheetViewApp() {
  const localState = useLocalPracticeState();
  const { state, updateState } = localState;
  const selectedDay = getSelectedPracticeDay(state);
  const sortedPracticeDays = getSortedPracticeDays(state.practiceDays);
  const pieceMap = usePieceMap(state.pieces);
  const sortedPlan = sortPlanByTime(selectedDay.plan);

  return (
    <main className="stack">
      <section className="panel stack">
        <h1>練習計画表</h1>
        <label>
          表示する日付
          <select
            value={selectedDay.id}
            onChange={(event) => updateState({ selectedPracticeDayId: event.target.value })}
          >
            {sortedPracticeDays.map((day) => (
              <option key={day.id} value={day.id}>
                {formatPracticeDateLabel(day.practiceDate)} {formatPracticeTimeAndLocation(day)}
              </option>
            ))}
          </select>
        </label>
        <p>
          {formatPracticeDateLabel(selectedDay.practiceDate)} / {formatPracticeTimeAndLocation(selectedDay)}
        </p>
        <div className="row">
          <Link className="button secondary" href="/admin">管理者用URLへ</Link>
          <Link className="button secondary" href="/player">奏者入力URLへ</Link>
        </div>
      </section>

      <section className="panel stack">
        <h2>{getPracticeDayLabel(selectedDay)} {"\u7df4\u7fd2\u5185\u5bb9"}</h2>
        {!selectedDay.isPlanPublished ? (
          <p className="muted">まだ非公開です。</p>
        ) : selectedDay.plan.length === 0 ? (
          <p className="muted">まだ非公開です。</p>
        ) : (
          <div className="sheet-wrap">
            <table className="sheet-table">
              <thead>
                <tr>
                  <th>開始</th>
                  <th>分</th>
                  <th>曲 / 休憩</th>
                </tr>
              </thead>
              <tbody>
                {sortedPlan.map((slot) => {
                  const piece = slot.pieceId ? pieceMap.get(slot.pieceId) : null;
                  return (
                    <tr key={slot.id}>
                      <td>{slot.start}</td>
                      <td>{slot.duration}</td>
                      <td>{getPlanSlotLabel(slot, piece?.title)}</td>
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
