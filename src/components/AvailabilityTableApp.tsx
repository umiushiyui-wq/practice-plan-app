"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  getPracticeDayLabel,
  getSelectedPracticeDay,
  LocalStateStatusPanel,
  toMinutes,
  toTime,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

const AVAILABILITY_SLOTS = Array.from({ length: ((22 - 8) * 60) / 10 + 1 }, (_, index) => 8 * 60 + index * 10);
const ALL_PIECES_FILTER = "__all__";
const OTHER_PIECES_FILTER = "__other__";
const ALL_PARTS_FILTER = "__all__";

export function AvailabilityTableApp() {
  const localState = useLocalPracticeState();
  const { state, updateState } = localState;
  const selectedDay = getSelectedPracticeDay(state);
  const [selectedPieceFilter, setSelectedPieceFilter] = useState(ALL_PIECES_FILTER);
  const [selectedPartFilter, setSelectedPartFilter] = useState(ALL_PARTS_FILTER);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);

  const partOptions = useMemo(
    () => Array.from(new Set(state.members.map((member) => member.instrument || "未設定"))),
    [state.members]
  );

  const visibleMembers = useMemo(() => {
    if (selectedPartFilter === ALL_PARTS_FILTER) return state.members;
    return state.members.filter((member) => (member.instrument || "未設定") === selectedPartFilter);
  }, [selectedPartFilter, state.members]);

  function isPracticeSlot(slotStart: number) {
    const slotEnd = slotStart + 10;
    const practiceStart = toMinutes(selectedDay.startTime);
    const practiceEnd = toMinutes(selectedDay.endTime);
    return practiceStart < slotEnd && slotStart < practiceEnd;
  }

  function isMemberAvailableAtSlot(memberId: string, slotStart: number) {
    if (!selectedDay.respondedMemberIds.includes(memberId) || selectedDay.absentMemberIds.includes(memberId)) {
      return false;
    }

    const slotEnd = slotStart + 10;
    return selectedDay.availabilities.some((availability) => {
      if (availability.memberId !== memberId) return false;
      const availabilityStart = toMinutes(availability.start);
      const availabilityEnd = toMinutes(availability.end);
      return availabilityStart < slotEnd && slotStart < availabilityEnd;
    });
  }

  function isMemberHighlighted(memberId: string) {
    if (selectedPieceFilter === ALL_PIECES_FILTER) return true;

    if (selectedPieceFilter === OTHER_PIECES_FILTER) {
      return !state.pieces.some((piece) => piece.memberIds.includes(memberId));
    }

    return state.pieces.some((piece) => piece.id === selectedPieceFilter && piece.memberIds.includes(memberId));
  }

  const hoveredAvailableCount =
    hoveredSlot === null
      ? null
      : visibleMembers.filter((member) => isMemberHighlighted(member.id) && isMemberAvailableAtSlot(member.id, hoveredSlot)).length;

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用一覧</p>
        <h1>参加可能時間表</h1>
        <div className="grid">
          <label>
            表示する練習日
            <select
              value={selectedDay.id}
              onChange={(event) => updateState({ selectedPracticeDayId: event.target.value })}
            >
              {state.practiceDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {getPracticeDayLabel(day)} {day.startTime}-{day.endTime}
                </option>
              ))}
            </select>
          </label>
          <label>
            曲で見る
            <select value={selectedPieceFilter} onChange={(event) => setSelectedPieceFilter(event.target.value)}>
              <option value={ALL_PIECES_FILTER}>すべて</option>
              {state.pieces.map((piece) => (
                <option key={piece.id} value={piece.id}>
                  {piece.title}
                </option>
              ))}
              <option value={OTHER_PIECES_FILTER}>その他</option>
            </select>
          </label>
          <label>
            パートで絞り込む
            <select value={selectedPartFilter} onChange={(event) => setSelectedPartFilter(event.target.value)}>
              <option value={ALL_PARTS_FILTER}>すべて</option>
              {partOptions.map((part) => (
                <option key={part} value={part}>
                  {part}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted">曲を選ぶとその曲に乗っている人を濃く表示し、パートでは一覧自体を絞り込めます。</p>
        <div className="row">
          <Link className="button secondary" href="/admin/plan">
            練習計画へ
          </Link>
          <Link className="button secondary" href="/player">
            奏者ページへ
          </Link>
          <Link className="button secondary" href="/color-map">
            カラーマップへ
          </Link>
          <Link className="button secondary" href="/sheet">
            表で見る
          </Link>
        </div>
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        <h2>{getPracticeDayLabel(selectedDay)} の参加可能時間</h2>
        {hoveredSlot !== null ? (
          <div className="notice">
            {toTime(hoveredSlot)} 時点で参加可能: {hoveredAvailableCount}人
          </div>
        ) : null}
        <div className="availability-wrap" onMouseLeave={() => setHoveredSlot(null)}>
          <table className="availability-table player-availability-table">
            <thead>
              <tr>
                <th>奏者</th>
                {AVAILABILITY_SLOTS.map((minutes) => (
                  <th
                    key={minutes}
                    className={hoveredSlot === minutes ? "hovered-slot-cell" : ""}
                    onMouseEnter={() => setHoveredSlot(minutes)}
                    onMouseLeave={() => setHoveredSlot(null)}
                    onFocus={() => setHoveredSlot(minutes)}
                    onBlur={() => setHoveredSlot(null)}
                  >
                    {minutes % 60 === 0 ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => {
                const availability = selectedDay.availabilities.find((item) => item.memberId === member.id);
                const hasSaved = selectedDay.respondedMemberIds.includes(member.id);
                const isAbsent = hasSaved && selectedDay.absentMemberIds.includes(member.id);
                const availabilityLabel = isAbsent
                  ? "欠席"
                  : availability
                    ? `${availability.start}-${availability.end}`
                    : hasSaved
                      ? "未入力"
                      : "未回答";
                const isHighlighted = isMemberHighlighted(member.id);

                return (
                  <tr key={member.id} className={isHighlighted ? "" : "member-row-dim"}>
                    <th>
                      {member.name}
                      <span className="muted">
                        {(member.instrument || "未設定") + " / " + availabilityLabel}
                      </span>
                    </th>
                    {AVAILABILITY_SLOTS.map((minutes, index) => {
                      const previousMinutes = AVAILABILITY_SLOTS[index - 1];
                      const nextMinutes = AVAILABILITY_SLOTS[index + 1];
                      const isPractice = isPracticeSlot(minutes);
                      const isAvailable = isMemberAvailableAtSlot(member.id, minutes);
                      const isPreviousPractice = previousMinutes !== undefined && isPracticeSlot(previousMinutes);
                      const isNextPractice = nextMinutes !== undefined && isPracticeSlot(nextMinutes);
                      const classNames = [
                        minutes % 60 === 0 ? "hour-divider-cell" : "",
                        isPractice ? "practice-window-cell" : "",
                        isPractice && !isPreviousPractice ? "practice-start-cell" : "",
                        isPractice && !isNextPractice ? "practice-end-cell" : "",
                        isAbsent ? "absent-cell" : "",
                        isAvailable ? "available-cell" : ""
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return (
                        <td
                          key={`${member.id}-${minutes}`}
                          className={[classNames, hoveredSlot === minutes ? "hovered-slot-cell" : ""].filter(Boolean).join(" ")}
                          onMouseEnter={() => setHoveredSlot(minutes)}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="legend-row">
          <span className="legend-chip practice">青枠: 練習時間</span>
          <span className="legend-chip available">緑: 参加可能時間</span>
        </div>
      </section>
    </main>
  );
}
