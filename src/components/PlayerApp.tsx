"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getPlanSlotLabel,
  getSortedPracticeDays,
  sortPlanByTime,
  toMinutes,
  toTime,
  updatePracticeDay,
  useLocalPracticeState,
  usePieceMap
} from "@/components/LocalPracticeApp";

const AVAILABILITY_SLOTS = Array.from({ length: ((22 - 8) * 60) / 10 + 1 }, (_, index) => 8 * 60 + index * 10);

type DraftByDay = Record<
  string,
  {
    start: string;
    end: string;
    absent: boolean;
  }
>;

function buildTimeOptions(startTime: string, endTime: string) {
  const startMinutes = Math.ceil(toMinutes(startTime) / 10) * 10;
  const endMinutes = toMinutes(endTime);
  const options: string[] = [];

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 10) {
    options.push(toTime(minutes));
  }

  return options;
}

function getClosestTime(value: string, options: string[]) {
  if (options.length === 0 || options.includes(value)) return value;

  return options.reduce((closest, option) =>
    Math.abs(toMinutes(option) - toMinutes(value)) < Math.abs(toMinutes(closest) - toMinutes(value))
      ? option
      : closest
  );
}

function TimePartSelect({
  label,
  value,
  options,
  disabled = false,
  onChange
}: {
  label: string;
  value: string;
  options: string[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  const selectedValue = getClosestTime(value, options);
  const [selectedHour, selectedMinute] = selectedValue.split(":");
  const hourOptions = Array.from(new Set(options.map((time) => time.slice(0, 2))));
  const minuteOptions = options
    .filter((time) => time.startsWith(`${selectedHour}:`))
    .map((time) => time.slice(3, 5));

  function updateHour(hour: string) {
    const availableMinutes = options
      .filter((time) => time.startsWith(`${hour}:`))
      .map((time) => time.slice(3, 5));
    const minute = availableMinutes.includes(selectedMinute) ? selectedMinute : availableMinutes[0];
    onChange(`${hour}:${minute}`);
  }

  return (
    <label>
      {label}
      <div className="time-parts">
        <select
          value={selectedHour}
          onChange={(event) => updateHour(event.target.value)}
          aria-label={`${label} 時`}
          disabled={disabled}
        >
          {hourOptions.map((hour) => (
            <option key={hour} value={hour}>
              {hour}時
            </option>
          ))}
        </select>
        <select
          value={selectedMinute}
          onChange={(event) => onChange(`${selectedHour}:${event.target.value}`)}
          aria-label={`${label} 分`}
          disabled={disabled}
        >
          {minuteOptions.map((minute) => (
            <option key={minute} value={minute}>
              {minute}分
            </option>
          ))}
        </select>
      </div>
    </label>
  );
}

export function PlayerApp() {
  const { state, updateState } = useLocalPracticeState();
  const pieceMap = usePieceMap(state.pieces);
  const sortedPracticeDays = useMemo(() => getSortedPracticeDays(state.practiceDays), [state.practiceDays]);
  const [selectedPart, setSelectedPart] = useState("");
  const [memberId, setMemberId] = useState("m1");
  const [selectedInputDayId, setSelectedInputDayId] = useState("");
  const [draftsByDay, setDraftsByDay] = useState<DraftByDay>({});
  const [saveMessage, setSaveMessage] = useState("");

  const partOptions = Array.from(new Set(state.members.map((member) => member.instrument || "未設定")));
  const activePart = partOptions.includes(selectedPart) ? selectedPart : partOptions[0] ?? "";
  const filteredMembers = state.members.filter((member) => (member.instrument || "未設定") === activePart);
  const selected = filteredMembers.find((member) => member.id === memberId) ?? filteredMembers[0] ?? state.members[0] ?? null;
  const selectedInputDay =
    sortedPracticeDays.find((day) => day.id === selectedInputDayId) ?? sortedPracticeDays[0] ?? null;

  useEffect(() => {
    if (activePart && selectedPart !== activePart) {
      setSelectedPart(activePart);
    }
  }, [activePart, selectedPart]);

  useEffect(() => {
    if (selected && selected.id !== memberId) {
      setMemberId(selected.id);
    }
  }, [memberId, selected]);

  useEffect(() => {
    if (!selected) return;

    const nextDrafts = Object.fromEntries(
      sortedPracticeDays.map((day) => {
        const savedAvailability = day.availabilities.find((item) => item.memberId === selected.id);
        const hasSaved = day.respondedMemberIds.includes(selected.id);
        const isAbsent = !hasSaved || day.absentMemberIds.includes(selected.id);

        return [
          day.id,
          {
            start: savedAvailability?.start ?? day.startTime,
            end: savedAvailability?.end ?? day.endTime,
            absent: isAbsent
          }
        ];
      })
    ) as DraftByDay;

    setDraftsByDay(nextDrafts);
    setSaveMessage("");
  }, [selected, sortedPracticeDays]);

  useEffect(() => {
    if (selectedInputDay && selectedInputDay.id !== selectedInputDayId) {
      setSelectedInputDayId(selectedInputDay.id);
    }
    if (!selectedInputDay && selectedInputDayId) {
      setSelectedInputDayId("");
    }
  }, [selectedInputDay, selectedInputDayId]);

  function updateDayDraft(dayId: string, patch: Partial<DraftByDay[string]>) {
    setDraftsByDay((current) => ({
      ...current,
      [dayId]: {
        ...current[dayId],
        ...patch
      }
    }));
  }

  function saveAvailability(dayId: string) {
    if (!selected) return;

    const day = state.practiceDays.find((item) => item.id === dayId);
    const draft = draftsByDay[dayId];
    if (!day || !draft) return;

    const nextPracticeDays = updatePracticeDay(state, dayId, {
      availabilities: draft.absent
        ? day.availabilities.filter((item) => item.memberId !== selected.id)
        : [
            ...day.availabilities.filter((item) => item.memberId !== selected.id),
            { memberId: selected.id, start: draft.start, end: draft.end }
          ],
      absentMemberIds: draft.absent
        ? Array.from(new Set([...day.absentMemberIds, selected.id]))
        : day.absentMemberIds.filter((id) => id !== selected.id),
      respondedMemberIds: Array.from(new Set([...day.respondedMemberIds, selected.id]))
    });

    updateState({ practiceDays: nextPracticeDays });
    setSaveMessage(
      draft.absent
        ? `${day.practiceDate} を欠席で保存しました。`
        : `${day.practiceDate} を ${draft.start}-${draft.end} で保存しました。`
    );
  }

  function togglePiece(pieceId: string, checked: boolean) {
    if (!selected) return;

    updateState({
      pieces: state.pieces.map((piece) =>
        piece.id === pieceId
          ? {
              ...piece,
              memberIds: checked
                ? Array.from(new Set([...piece.memberIds, selected.id]))
                : piece.memberIds.filter((id) => id !== selected.id)
            }
          : piece
      )
    });
  }

  function isPracticeSlot(dayId: string, slotStart: number) {
    const day = sortedPracticeDays.find((item) => item.id === dayId);
    if (!day) return false;

    const slotEnd = slotStart + 10;
    const practiceStart = toMinutes(day.startTime);
    const practiceEnd = toMinutes(day.endTime);

    return practiceStart < slotEnd && slotStart < practiceEnd;
  }

  function isMemberAvailableAtSlot(dayId: string, slotStart: number) {
    if (!selected) return false;

    const draft = draftsByDay[dayId];
    if (!draft || draft.absent) return false;

    const slotEnd = slotStart + 10;
    const availabilityStart = toMinutes(draft.start);
    const availabilityEnd = toMinutes(draft.end);

    return availabilityStart < slotEnd && slotStart < availabilityEnd;
  }

  const visiblePlans = useMemo(
    () =>
      Object.fromEntries(
        sortedPracticeDays.map((day) => [day.id, sortPlanByTime(day.plan)])
      ) as Record<string, ReturnType<typeof sortPlanByTime>>,
    [sortedPracticeDays]
  );

  const currentDraft = selectedInputDay ? draftsByDay[selectedInputDay.id] : null;
  const currentTimeOptions = selectedInputDay ? buildTimeOptions(selectedInputDay.startTime, selectedInputDay.endTime) : [];
  const currentPlan = selectedInputDay ? visiblePlans[selectedInputDay.id] ?? [] : [];

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">奏者ページ</p>
        <h1>参加可能時間と参加曲の入力</h1>
        <p>自分の名前を選ぶと、登録済みのすべての練習日について入力できます。青い枠が練習時間、緑が自分が出席する時間です。</p>
        <div className="row">
          <Link className="button secondary" href="/admin">
            管理画面へ
          </Link>
          <a className="button secondary" href="#my-availability">
            参加可能時間表へ
          </a>
        </div>
      </section>

      <section className="panel stack">
        <h2>自分を選ぶ</h2>
        <select value={activePart} onChange={(event) => setSelectedPart(event.target.value)}>
          {partOptions.map((part) => (
            <option key={part} value={part}>
              {part}
            </option>
          ))}
        </select>
        <select value={selected?.id ?? ""} onChange={(event) => setMemberId(event.target.value)}>
          {filteredMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <p className="muted">名前がなければ、管理者側でメンバーを追加してもらってください。</p>
      </section>

      {selected ? (
        <>
          <section className="panel stack">
            <h2>自分が出る曲</h2>
            {state.pieces.length === 0 ? <p className="muted">まだ曲が登録されていません。</p> : null}
            {state.pieces.map((piece) => (
              <label className="row" key={piece.id}>
                <input
                  style={{ width: "auto" }}
                  type="checkbox"
                  checked={piece.memberIds.includes(selected.id)}
                  onChange={(event) => togglePiece(piece.id, event.target.checked)}
                />
                {piece.title}
              </label>
            ))}
          </section>

          <section id="my-availability" className="panel stack">
            <h2>{selected.name} の参加可能時間表</h2>
            <div className="availability-wrap">
              <table className="availability-table player-availability-table">
                <thead>
                  <tr>
                    <th>練習日</th>
                    {AVAILABILITY_SLOTS.map((minutes) => (
                      <th key={minutes}>{minutes % 60 === 0 ? toTime(minutes) : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPracticeDays.map((day) => {
                    const draft = draftsByDay[day.id];
                    const label = draft
                      ? draft.absent
                        ? "欠席"
                        : `${draft.start}-${draft.end}`
                      : "未入力";

                    return (
                      <tr key={day.id}>
                        <th>
                          {day.practiceDate}
                          <span className="muted">
                            練習 {day.startTime}-{day.endTime} / 自分 {label}
                          </span>
                        </th>
                        {AVAILABILITY_SLOTS.map((minutes, index) => {
                          const previousMinutes = AVAILABILITY_SLOTS[index - 1];
                          const nextMinutes = AVAILABILITY_SLOTS[index + 1];
                          const isPractice = isPracticeSlot(day.id, minutes);
                          const isAvailable = isMemberAvailableAtSlot(day.id, minutes);
                          const isPreviousPractice = previousMinutes !== undefined && isPracticeSlot(day.id, previousMinutes);
                          const isNextPractice = nextMinutes !== undefined && isPracticeSlot(day.id, nextMinutes);
                          const classNames = [
                            minutes % 60 === 0 ? "hour-divider-cell" : "",
                            isPractice ? "practice-window-cell" : "",
                            isPractice && !isPreviousPractice ? "practice-start-cell" : "",
                            isPractice && !isNextPractice ? "practice-end-cell" : "",
                            isAvailable ? "available-cell" : ""
                          ]
                            .filter(Boolean)
                            .join(" ");

                          return <td key={`${day.id}-${minutes}`} className={classNames} />;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="legend-row">
              <span className="legend-chip practice">青枠: 練習時間</span>
              <span className="legend-chip available">緑: 出席する時間</span>
            </div>
          </section>

          <section className="panel stack">
            <div className="row page-section-head">
              <div>
                <h2>練習日ごとの入力</h2>
                <p className="muted">編集したい練習日だけ選んで入力できます。</p>
              </div>
              {selectedInputDay ? (
                <label className="compact-field">
                  練習日
                  <select value={selectedInputDay.id} onChange={(event) => setSelectedInputDayId(event.target.value)}>
                    {sortedPracticeDays.map((day) => (
                      <option key={day.id} value={day.id}>
                        {day.practiceDate} {day.startTime}-{day.endTime}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            {saveMessage ? <div className="notice">{saveMessage}</div> : null}

            {selectedInputDay && currentDraft ? (
              <section className="panel subtle-panel stack">
                <div className="row page-section-head">
                  <div>
                    <h3>{selectedInputDay.practiceDate}</h3>
                    <p className="muted">
                      練習時間 {selectedInputDay.startTime}-{selectedInputDay.endTime}
                    </p>
                  </div>
                  <button type="button" onClick={() => saveAvailability(selectedInputDay.id)}>
                    この日の入力を保存
                  </button>
                </div>

                <label className="row">
                  <input
                    style={{ width: "auto" }}
                    type="checkbox"
                    checked={currentDraft.absent}
                    onChange={(event) => updateDayDraft(selectedInputDay.id, { absent: event.target.checked })}
                  />
                  欠席
                </label>

                <div className="grid">
                  <TimePartSelect
                    label="開始"
                    value={currentDraft.start}
                    options={currentTimeOptions}
                    disabled={currentDraft.absent}
                    onChange={(value) => updateDayDraft(selectedInputDay.id, { start: value })}
                  />
                  <TimePartSelect
                    label="終了"
                    value={currentDraft.end}
                    options={currentTimeOptions}
                    disabled={currentDraft.absent}
                    onChange={(value) => updateDayDraft(selectedInputDay.id, { end: value })}
                  />
                </div>

                {currentPlan.length > 0 ? (
                  <div className="sheet-wrap">
                    <table className="player-plan-table">
                      <thead>
                        <tr>
                          <th>開始</th>
                          <th>終了</th>
                          <th>分</th>
                          <th>内容</th>
                        </tr>
                      </thead>
                      <tbody>
                        {currentPlan.map((slot) => (
                          <tr key={slot.id}>
                            <td>{slot.start}</td>
                            <td>{slot.end}</td>
                            <td>{slot.duration}</td>
                            <td>{getPlanSlotLabel(slot, slot.pieceId ? pieceMap.get(slot.pieceId)?.title : undefined)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="muted">まだこの日の練習計画はありません。</p>
                )}
              </section>
            ) : (
              <p className="muted">まだ練習日がありません。</p>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
