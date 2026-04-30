"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  getPracticeDayLabel,
  getSelectedPracticeDay,
  getSortedPracticeDays,
  LocalStateStatusPanel,
  toMinutes,
  toTime,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

const HEATMAP_SLOTS = Array.from({ length: 15 }, (_, index) => 8 * 60 + index * 60);

type HoveredCell = {
  pieceId: string;
  pieceTitle: string;
  startMinutes: number;
  endMinutes: number;
  count: number;
};

function mixColor(start: [number, number, number], end: [number, number, number], ratio: number) {
  const safeRatio = Math.max(0, Math.min(1, ratio));
  const [r1, g1, b1] = start;
  const [r2, g2, b2] = end;
  const r = Math.round(r1 + (r2 - r1) * safeRatio);
  const g = Math.round(g1 + (g2 - g1) * safeRatio);
  const b = Math.round(b1 + (b2 - b1) * safeRatio);
  return `rgb(${r}, ${g}, ${b})`;
}

function getHeatmapColor(count: number) {
  const blue: [number, number, number] = [53, 117, 214];
  const green: [number, number, number] = [58, 168, 93];
  const redBrown: [number, number, number] = [153, 74, 54];

  if (count <= 20) {
    return mixColor(blue, green, count / 20);
  }

  return mixColor(green, redBrown, Math.min((count - 20) / 20, 1));
}

export function ColorMapApp() {
  const localState = useLocalPracticeState();
  const { state, updateState } = localState;
  const selectedDay = getSelectedPracticeDay(state);
  const sortedPracticeDays = useMemo(() => getSortedPracticeDays(state.practiceDays), [state.practiceDays]);
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);
  const practiceStart = toMinutes(selectedDay.startTime);
  const practiceEnd = toMinutes(selectedDay.endTime);
  const visibleSlots = useMemo(
    () => HEATMAP_SLOTS.filter((minutes) => minutes < practiceEnd && minutes + 60 > practiceStart),
    [practiceEnd, practiceStart]
  );

  const memberAvailabilityMap = useMemo(() => {
    const respondedMemberIds = new Set(selectedDay.respondedMemberIds);
    const absentMemberIds = new Set(selectedDay.absentMemberIds);
    const availabilityMap = new Map<string, Array<{ start: number; end: number }>>();

    for (const availability of selectedDay.availabilities) {
      if (!respondedMemberIds.has(availability.memberId) || absentMemberIds.has(availability.memberId)) continue;

      const windows = availabilityMap.get(availability.memberId) ?? [];
      windows.push({ start: toMinutes(availability.start), end: toMinutes(availability.end) });
      availabilityMap.set(availability.memberId, windows);
    }

    return availabilityMap;
  }, [selectedDay]);

  const heatmapRows = useMemo(() => {
    return state.pieces
      .map((piece) => {
        const participantIds = Array.from(new Set([piece.conductorId, ...piece.memberIds].filter(Boolean)));
        const counts = visibleSlots.map((minutes) => {
          const slotEnd = minutes + 60;
          return participantIds.filter((memberId) =>
            (memberAvailabilityMap.get(memberId) ?? []).some((window) => window.start < slotEnd && minutes < window.end)
          ).length;
        });
        const peakCount = counts.length > 0 ? Math.max(...counts) : 0;
        const averageCount =
          counts.length > 0 ? Math.round((counts.reduce((total, count) => total + count, 0) / counts.length) * 10) / 10 : 0;

        return {
          piece,
          participantTotal: participantIds.length,
          counts,
          peakCount,
          averageCount
        };
      })
      .sort(
        (a, b) =>
          b.peakCount - a.peakCount || b.averageCount - a.averageCount || a.piece.title.localeCompare(b.piece.title, "ja")
      );
  }, [memberAvailabilityMap, state.pieces, visibleSlots]);

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用ヒートマップ</p>
        <h1>カラーマップ</h1>
        <div className="row">
          <Link className="button secondary" href="/admin">
            練習計画へ
          </Link>
          <Link className="button secondary" href="/availability">
            可否一覧へ
          </Link>
        </div>
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">Step 1</p>
            <h2>練習日を選ぶ</h2>
          </div>
          <label className="compact-field">
            練習日
            <select
              value={selectedDay.id}
              onChange={(event) => updateState({ selectedPracticeDayId: event.target.value })}
            >
              {sortedPracticeDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {getPracticeDayLabel(day)} {day.startTime}-{day.endTime}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="color-map-summary-grid">
          <article className="plan-stat-card">
            <span className="plan-stat-label">対象曲数</span>
            <strong>{heatmapRows.length}</strong>
            <span className="muted">登録中の全曲</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">練習時間</span>
            <strong>
              {selectedDay.startTime} - {selectedDay.endTime}
            </strong>
            <span className="muted">{getPracticeDayLabel(selectedDay)}</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">表示幅</span>
            <strong>{visibleSlots.length}マス</strong>
            <span className="muted">1時間ごとの表示</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">色の目安</span>
            <strong>青 → 緑 → 赤茶</strong>
            <span className="muted">0人 / 20人 / 40人以上</span>
          </article>
        </div>

        {hoveredCell ? (
          <div className="notice">
            {hoveredCell.pieceTitle} / {toTime(hoveredCell.startMinutes)} - {toTime(hoveredCell.endMinutes)} で参加可能{" "}
            {hoveredCell.count}人
          </div>
        ) : (
          <p className="muted">各マスは1時間単位です。その1時間に少しでも参加可能時間が重なれば参加として数えます。</p>
        )}

        <div className="color-scale-legend" aria-hidden="true">
          <span>0人</span>
          <div className="color-scale-bar" />
          <span>20人</span>
          <span>40人以上</span>
        </div>
      </section>

      <section className="panel stack">
        {heatmapRows.length === 0 ? (
          <div className="plan-empty-state">
            <strong>まだ曲がありません</strong>
            <p className="muted">準備ページで曲を追加すると、ここに時間帯ごとの色分布が表示されます。</p>
          </div>
        ) : (
          <div className="availability-wrap">
            <table className="availability-table color-map-table">
              <thead>
                <tr>
                  <th>曲</th>
                  {visibleSlots.map((minutes) => (
                    <th key={minutes} className="hour-divider-cell">
                      {`${String(Math.floor(minutes / 60)).padStart(2, "0")}:00`}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapRows.map(({ piece, participantTotal, counts, peakCount, averageCount }) => (
                  <tr key={piece.id}>
                    <th>
                      {piece.title}
                      <span className="muted">対象 {participantTotal}人 / 最大 {peakCount}人 / 平均 {averageCount}人</span>
                    </th>
                    {visibleSlots.map((minutes, index) => {
                      const count = counts[index];
                      const classNames = [
                        "hour-divider-cell",
                        "practice-window-cell",
                        hoveredCell?.pieceId === piece.id && hoveredCell.startMinutes === minutes ? "hovered-slot-cell" : ""
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <td
                          key={`${piece.id}-${minutes}`}
                          className={classNames}
                          style={{ backgroundColor: getHeatmapColor(count) }}
                          title={`${piece.title} / ${toTime(minutes)}-${toTime(minutes + 60)} / ${count}人`}
                          onMouseEnter={() =>
                            setHoveredCell({
                              pieceId: piece.id,
                              pieceTitle: piece.title,
                              startMinutes: minutes,
                              endMinutes: minutes + 60,
                              count
                            })
                          }
                          onMouseLeave={() => setHoveredCell(null)}
                        />
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
