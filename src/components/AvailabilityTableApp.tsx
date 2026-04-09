"use client";

import Link from "next/link";
import { getSelectedPracticeDay, toMinutes, useLocalPracticeState } from "@/components/LocalPracticeApp";

const AVAILABILITY_SLOTS = Array.from({ length: ((22 - 8) * 60) / 10 + 1 }, (_, index) => 8 * 60 + index * 10);

export function AvailabilityTableApp() {
  const { state, updateState } = useLocalPracticeState();
  const selectedDay = getSelectedPracticeDay(state);

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

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用一覧</p>
        <h1>参加可能時間表</h1>
        <label>
          表示する練習日
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
        <p className="muted">奏者ページと同じ見え方で、練習時間は青枠、参加可能時間は緑で確認できます。</p>
        <div className="row">
          <Link className="button secondary" href="/admin">
            管理画面へ
          </Link>
          <Link className="button secondary" href="/player">
            奏者ページへ
          </Link>
          <Link className="button secondary" href="/sheet">
            表で見る
          </Link>
        </div>
      </section>

      <section className="panel stack">
        <h2>{selectedDay.practiceDate} の参加可能時間</h2>
        <div className="availability-wrap">
          <table className="availability-table player-availability-table">
            <thead>
              <tr>
                <th>奏者</th>
                {AVAILABILITY_SLOTS.map((minutes) => (
                  <th key={minutes}>{minutes % 60 === 0 ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00` : ""}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {state.members.map((member) => {
                const availability = selectedDay.availabilities.find((item) => item.memberId === member.id);
                const hasSaved = selectedDay.respondedMemberIds.includes(member.id);
                const isAbsent = !hasSaved || selectedDay.absentMemberIds.includes(member.id);
                const availabilityLabel = isAbsent
                  ? hasSaved
                    ? "欠席"
                    : "未回答"
                  : availability
                    ? `${availability.start}-${availability.end}`
                    : "未入力";

                return (
                  <tr key={member.id}>
                    <th>
                      {member.name}
                      <span className="muted">{availabilityLabel}</span>
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
                        isAvailable ? "available-cell" : ""
                      ]
                        .filter(Boolean)
                        .join(" ");

                      return <td key={`${member.id}-${minutes}`} className={classNames} />;
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
