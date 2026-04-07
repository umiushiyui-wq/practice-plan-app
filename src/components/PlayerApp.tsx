"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  getSelectedPracticeDay,
  sortPlanByTime,
  toMinutes,
  toTime,
  updatePracticeDay,
  useLocalPracticeState,
  usePieceMap
} from "@/components/LocalPracticeApp";

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
            <option key={hour} value={hour}>{hour}時</option>
          ))}
        </select>
        <select
          value={selectedMinute}
          onChange={(event) => onChange(`${selectedHour}:${event.target.value}`)}
          aria-label={`${label} 分`}
          disabled={disabled}
        >
          {minuteOptions.map((minute) => (
            <option key={minute} value={minute}>{minute}分</option>
          ))}
        </select>
      </div>
    </label>
  );
}

export function PlayerApp() {
  const { state, updateState } = useLocalPracticeState();
  const [selectedPart, setSelectedPart] = useState("");
  const [memberId, setMemberId] = useState("m1");
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  const [draftAbsent, setDraftAbsent] = useState(true);
  const [saveMessage, setSaveMessage] = useState("");
  const selectedDay = getSelectedPracticeDay(state);
  const pieceMap = usePieceMap(state.pieces);
  const partOptions = Array.from(new Set(state.members.map((member) => member.instrument || "未設定")));
  const activePart = partOptions.includes(selectedPart) ? selectedPart : partOptions[0] ?? "";
  const filteredMembers = state.members.filter((member) => (member.instrument || "未設定") === activePart);
  const selected = filteredMembers.find((member) => member.id === memberId) ?? filteredMembers[0] ?? state.members[0];
  const availabilityRecord = selectedDay.availabilities.find((item) => item.memberId === selected?.id);
  const sortedPlan = sortPlanByTime(selectedDay.plan);
  const availability =
    availabilityRecord ?? {
      memberId: selected?.id ?? "",
      start: selectedDay.startTime,
      end: selectedDay.endTime
    };
  const hasSaved = selected ? selectedDay.respondedMemberIds.includes(selected.id) : false;
  const savedAsAbsent = selected ? selectedDay.absentMemberIds.includes(selected.id) : false;
  const timeOptions = buildTimeOptions(selectedDay.startTime, selectedDay.endTime);

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
    setDraftStart(availability.start);
    setDraftEnd(availability.end);
    setDraftAbsent(hasSaved ? savedAsAbsent : false);
    setSaveMessage("");
  }, [availability.start, availability.end, hasSaved, savedAsAbsent, selected?.id, selectedDay.id]);

  function updateSelectedDay(patch: Partial<typeof selectedDay>) {
    updateState({ practiceDays: updatePracticeDay(state, selectedDay.id, patch) });
  }

  function saveAvailability() {
    if (!selected) return;
    updateSelectedDay({
      availabilities: draftAbsent
        ? selectedDay.availabilities.filter((item) => item.memberId !== selected.id)
        : [
            ...selectedDay.availabilities.filter((item) => item.memberId !== selected.id),
            { memberId: selected.id, start: draftStart, end: draftEnd }
          ],
      absentMemberIds: draftAbsent
        ? Array.from(new Set([...selectedDay.absentMemberIds, selected.id]))
        : selectedDay.absentMemberIds.filter((id) => id !== selected.id),
      respondedMemberIds: Array.from(new Set([...selectedDay.respondedMemberIds, selected.id]))
    });
    setSaveMessage(draftAbsent ? "欠席で保存しました。" : `${draftStart}-${draftEnd} で保存しました。`);
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

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">奏者入力URL</p>
        <h1>参加可能時間と出演曲の入力</h1>
        <p>練習日を選んで、その日の参加可能時間を入力します。</p>
        <div className="row">
          <Link className="button secondary" href="/admin">管理者用URLへ</Link>
          <a className="button secondary" href="#practice-plan">練習計画表へ</a>
        </div>
      </section>

      <section className="panel stack">
        <h2>練習日と自分を選択</h2>
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
        <select value={activePart} onChange={(event) => setSelectedPart(event.target.value)}>
          {partOptions.map((part) => (
            <option key={part} value={part}>{part}</option>
          ))}
        </select>
        <select value={selected?.id ?? ""} onChange={(e) => setMemberId(e.target.value)}>
          {filteredMembers.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
        <p className="muted">名前がない場合は、管理者にメンバー追加してもらってください。</p>
      </section>

      {selected ? (
        <>
          <section id="practice-plan" className="panel stack">
            <h2>{selectedDay.practiceDate} の参加可能時間</h2>
            <label className="row">
              <input
                style={{ width: "auto" }}
                type="checkbox"
                checked={draftAbsent}
                onChange={(event) => setDraftAbsent(event.target.checked)}
              />
              欠席
            </label>
            <div className="grid">
              <TimePartSelect
                label="開始"
                value={draftStart}
                options={timeOptions}
                disabled={draftAbsent}
                onChange={setDraftStart}
              />
              <TimePartSelect
                label="終了"
                value={draftEnd}
                options={timeOptions}
                disabled={draftAbsent}
                onChange={setDraftEnd}
              />
            </div>
            <div className="notice">
              {saveMessage || (hasSaved ? "保存済みです。" : "まだ保存されていないため、欠席扱いです。")}
            </div>
          </section>

          <section className="panel stack">
            <h2>自分が出演する曲</h2>
            {state.pieces.length === 0 ? <p className="muted">まだ曲が登録されていません。</p> : null}
            {state.pieces.map((piece) => (
              <label className="row" key={piece.id}>
                <input
                  style={{ width: "auto" }}
                  type="checkbox"
                  checked={piece.memberIds.includes(selected.id)}
                  onChange={(e) => togglePiece(piece.id, e.target.checked)}
                />
                {piece.title}
              </label>
            ))}
            <button type="button" onClick={saveAvailability}>保存</button>
          </section>

          <section className="panel stack">
            <h2>{selectedDay.practiceDate} の練習計画表</h2>
            {selectedDay.plan.length === 0 ? (
              <p className="muted">まだこの日の計画がありません。</p>
            ) : (
              <div className="sheet-wrap">
                <table className="player-plan-table">
                  <thead>
                    <tr>
                      <th>開始</th>
                      <th>終了</th>
                      <th>分</th>
                      <th>曲</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedPlan.map((slot) => (
                      <tr key={slot.id}>
                        <td>{slot.start}</td>
                        <td>{slot.end}</td>
                        <td>{slot.duration}</td>
                        <td>{slot.pieceId ? pieceMap.get(slot.pieceId)?.title : "休憩"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </main>
  );
}
