"use client";

import Link from "next/link";
import { getSelectedPracticeDay, toMinutes, useLocalPracticeState } from "@/components/LocalPracticeApp";

const AVAILABILITY_HOURS = Array.from({ length: 15 }, (_, index) => index + 8);

export function AvailabilityTableApp() {
  const { state, updateState } = useLocalPracticeState();
  const selectedDay = getSelectedPracticeDay(state);

  function isMemberAvailableAtHour(memberId: string, hour: number) {
    if (!selectedDay.respondedMemberIds.includes(memberId) || selectedDay.absentMemberIds.includes(memberId)) {
      return false;
    }

    const slotStart = hour * 60;
    const slotEnd = hour === 22 ? slotStart : slotStart + 60;
    return selectedDay.availabilities.some((availability) => {
      if (availability.memberId !== memberId) return false;
      const availabilityStart = toMinutes(availability.start);
      const availabilityEnd = toMinutes(availability.end);
      return hour === 22
        ? availabilityStart <= slotStart && availabilityEnd >= slotStart
        : availabilityStart < slotEnd && slotStart < availabilityEnd;
    });
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者確認用</p>
        <h1>参加可能時間表</h1>
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
        <p className="muted">横軸は 8:00〜22:00、緑が参加可能な時間です。</p>
        <div className="row">
          <Link className="button secondary" href="/admin">管理者用URLへ</Link>
          <Link className="button secondary" href="/player">奏者入力URLへ</Link>
          <Link className="button secondary" href="/sheet">表で見る</Link>
        </div>
      </section>

      <section className="panel stack">
        <h2>{selectedDay.practiceDate} の参加可能時間</h2>
        <div className="availability-wrap">
          <table className="availability-table">
            <thead>
              <tr>
                <th>奏者</th>
                {AVAILABILITY_HOURS.map((hour) => (
                  <th key={hour}>{hour}:00</th>
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
                    : "未保存（欠席）"
                  : availability
                    ? `${availability.start}-${availability.end}`
                    : "未入力";
                return (
                  <tr key={member.id}>
                    <th>
                      {member.name}
                      <span className="muted">{availabilityLabel}</span>
                    </th>
                    {AVAILABILITY_HOURS.map((hour) => {
                      const isAvailable = isMemberAvailableAtHour(member.id, hour);
                      return (
                        <td
                          key={hour}
                          className={isAvailable ? "available-cell" : ""}
                          aria-label={`${member.name} ${hour}:00`}
                          title={
                            isAvailable
                              ? `${member.name} / ${selectedDay.practiceDate} / ${availabilityLabel} / ${hour}:00`
                              : `${member.name} / ${selectedDay.practiceDate} / ${hour}:00`
                          }
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
