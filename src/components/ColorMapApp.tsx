"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { getSelectedPracticeDay, toMinutes, toTime, useLocalPracticeState } from "@/components/LocalPracticeApp";

const HEATMAP_SLOTS = Array.from({ length: ((22 - 8) * 60) / 10 + 1 }, (_, index) => 8 * 60 + index * 10);

type HoveredCell = {
  pieceId: string;
  pieceTitle: string;
  minutes: number;
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
  const { state, updateState } = useLocalPracticeState();
  const selectedDay = getSelectedPracticeDay(state);
  const [hoveredCell, setHoveredCell] = useState<HoveredCell | null>(null);

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
    return state.pieces.map((piece) => {
      const participantIds = Array.from(new Set([piece.conductorId, ...piece.memberIds].filter(Boolean)));
      const counts = HEATMAP_SLOTS.map((minutes) => {
        const slotEnd = minutes + 10;
        return participantIds.filter((memberId) =>
          (memberAvailabilityMap.get(memberId) ?? []).some((window) => window.start < slotEnd && minutes < window.end)
        ).length;
      });

      return {
        piece,
        participantTotal: participantIds.length,
        counts
      };
    });
  }, [memberAvailabilityMap, state.pieces]);

  const practiceStart = toMinutes(selectedDay.startTime);
  const practiceEnd = toMinutes(selectedDay.endTime);

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
              {state.practiceDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {day.practiceDate} {day.startTime}-{day.endTime}
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
            <span className="muted">{selectedDay.practiceDate}</span>
          </article>
          <article className="plan-stat-card">
            <span className="plan-stat-label">色の目安</span>
            <strong>青 → 緑 → 赤茶</strong>
            <span className="muted">0人 / 20人 / 40人以上</span>
          </article>
        </div>

        {hoveredCell ? (
          <div className="notice">
            {hoveredCell.pieceTitle} / {toTime(hoveredCell.minutes)} 時点で参加可能 {hoveredCell.count}人
          </div>
        ) : (
          <p className="muted">マスにカーソルを置くと、その時間の参加可能人数が見られます。</p>
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
                  {HEATMAP_SLOTS.map((minutes) => (
                    <th key={minutes} className={minutes % 60 === 0 ? "hour-divider-cell" : ""}>
                      {minutes % 60 === 0 ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmapRows.map(({ piece, participantTotal, counts }) => (
                  <tr key={piece.id}>
                    <th>
                      {piece.title}
                      <span className="muted">対象 {participantTotal}人</span>
                    </th>
                    {HEATMAP_SLOTS.map((minutes, index) => {
                      const count = counts[index];
                      const inPractice = practiceStart <= minutes && minutes < practiceEnd;
                      const classNames = [
                        minutes % 60 === 0 ? "hour-divider-cell" : "",
                        inPractice ? "practice-window-cell" : "",
                        hoveredCell?.pieceId === piece.id && hoveredCell.minutes === minutes ? "hovered-slot-cell" : ""
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <td
                          key={`${piece.id}-${minutes}`}
                          className={classNames}
                          style={{ backgroundColor: getHeatmapColor(count) }}
                          title={`${piece.title} / ${toTime(minutes)} / ${count}人`}
                          onMouseEnter={() =>
                            setHoveredCell({
                              pieceId: piece.id,
                              pieceTitle: piece.title,
                              minutes,
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
