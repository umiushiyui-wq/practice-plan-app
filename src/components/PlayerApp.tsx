"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  formatPracticeDateLabel,
  compareMembersByInstrument,
  getAvailableSegments,
  getInstrumentLabel,
  getPracticeDayLabel,
  getSortedInstrumentOptions,
  getSortedPracticeDays,
  toMinutes,
  toTime,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";
import type { LocalPracticeDay } from "@/components/LocalPracticeApp";

const AVAILABILITY_SLOTS = Array.from({ length: ((22 - 8) * 60) / 10 + 1 }, (_, index) => 8 * 60 + index * 10);
const PLAYER_SELECTION_STORAGE_KEY = "nagosui-player-selection-v1";
const PLAYER_AUTH_STORAGE_KEY = "nagosui-player-auth-v1";

type DraftByDay = Record<
  string,
  {
    start: string;
    end: string;
    breaks: Array<{ start: string; end: string }>;
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

function formatPracticeTimeAndLocation(day: { startTime: string; endTime: string; location: string }) {
  const location = day.location.trim();
  return location ? `${day.startTime}-${day.endTime} ＠${location}` : `${day.startTime}-${day.endTime}`;
}

function escapeCalendarText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function formatCalendarDateTime(date: string, time: string) {
  return `${date.replace(/-/g, "")}T${time.replace(":", "")}00`;
}

function formatCalendarStamp(date: Date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function downloadCalendarEvent(day: LocalPracticeDay) {
  const title = "OB\u6f14\u594f\u4f1a\u3000\u7df4\u7fd2";
  const createdAt = new Date();
  const uid = `practice-${day.id}-${day.startTime}-${day.endTime}@practice-plan-app`;
  const description = `${day.practiceDate} ${day.startTime}-${day.endTime}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Practice Plan App//JA",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeCalendarText(uid)}`,
    `DTSTAMP:${formatCalendarStamp(createdAt)}`,
    `SUMMARY:${escapeCalendarText(title)}`,
    `DTSTART:${formatCalendarDateTime(day.practiceDate, day.startTime)}`,
    `DTEND:${formatCalendarDateTime(day.practiceDate, day.endTime)}`,
    `DESCRIPTION:${escapeCalendarText(description)}`,
    day.location.trim() ? `LOCATION:${escapeCalendarText(day.location.trim())}` : null,
    "END:VEVENT",
    "END:VCALENDAR"
  ].filter((line): line is string => Boolean(line));
  const blob = new Blob([`${lines.join("\r\n")}\r\n`], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = `OB\u6f14\u594f\u4f1a_\u7df4\u7fd2_${day.practiceDate}.ics`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function openGoogleCalendarEvent(day: LocalPracticeDay) {
  const title = "OB\u6f14\u594f\u4f1a\u3000\u7df4\u7fd2";
  const description = `${day.practiceDate} ${day.startTime}-${day.endTime}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    dates: `${formatCalendarDateTime(day.practiceDate, day.startTime)}/${formatCalendarDateTime(day.practiceDate, day.endTime)}`,
    details: description
  });

  if (day.location.trim()) {
    params.set("location", day.location.trim());
  }

  window.open(`https://calendar.google.com/calendar/render?${params.toString()}`, "_blank", "noopener,noreferrer");
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
  const localState = useLocalPracticeState();
  const { state, updateState, ready } = localState;
  const sortedPracticeDays = useMemo(() => getSortedPracticeDays(state.practiceDays), [state.practiceDays]);
  const [selectedPart, setSelectedPart] = useState("");
  const [memberId, setMemberId] = useState("");
  const [memberPassword, setMemberPassword] = useState("");
  const [memberPasswordConfirmation, setMemberPasswordConfirmation] = useState("");
  const [authenticatedMemberId, setAuthenticatedMemberId] = useState("");
  const [selectedInputDayId, setSelectedInputDayId] = useState("");
  const [draftsByDay, setDraftsByDay] = useState<DraftByDay>({});
  const [saveMessage, setSaveMessage] = useState("");
  const [authError, setAuthError] = useState("");
  const restoredSelectionRef = useRef(false);
  const skipNextSelectionPersistRef = useRef(false);
  const skipNextMemberAuthResetRef = useRef(false);

  const partOptions = getSortedInstrumentOptions(state.members.map((member) => member.instrument));
  const activePart = partOptions.includes(selectedPart) ? selectedPart : partOptions[0] ?? "";
  const filteredMembers = [...state.members]
    .sort(compareMembersByInstrument)
    .filter((member) => getInstrumentLabel(member.instrument) === activePart);
  const selected = filteredMembers.find((member) => member.id === memberId) ?? null;
  const selectedInputDay = selected
    ? sortedPracticeDays.find((day) => day.id === selectedInputDayId) ?? sortedPracticeDays[0] ?? null
    : null;
  const hasUsablePassword = !!selected && !!selected.password && selected.password !== "__unset__";
  const selectedIsReady = !!selected && authenticatedMemberId === selected.id;
  const passwordInputsMatch = memberPassword === memberPasswordConfirmation;
  const canContinueWithPassword = hasUsablePassword
    ? !!selected && !!memberPassword.trim()
    : !!selected && !!memberPassword.trim() && !!memberPasswordConfirmation.trim() && passwordInputsMatch;
  const selectedDayHasSavedInput =
    !!selectedInputDay && !!selected && selectedInputDay.respondedMemberIds.includes(selected.id);
  const selectedInputDayNeedsResponse = !!selectedInputDay && !!selected && !selectedInputDay.respondedMemberIds.includes(selected.id);
  const canEditSelectedDay = !!selected && (!selectedDayHasSavedInput || selectedIsReady);
  const hasUnsubmittedPracticeDays =
    !!selected && sortedPracticeDays.some((day) => !day.respondedMemberIds.includes(selected.id));

  useEffect(() => {
    if (activePart && selectedPart !== activePart) {
      setSelectedPart(activePart);
    }
  }, [activePart, selectedPart]);

  useEffect(() => {
    if (!ready || restoredSelectionRef.current || state.members.length === 0) return;
    restoredSelectionRef.current = true;

    try {
      const saved = window.localStorage.getItem(PLAYER_SELECTION_STORAGE_KEY);
      if (!saved) return;

      const parsed = JSON.parse(saved) as { memberId?: unknown; selectedPart?: unknown; selectedInputDayId?: unknown };
      const savedAuthMemberId = window.localStorage.getItem(PLAYER_AUTH_STORAGE_KEY);
      const savedMemberId = typeof parsed.memberId === "string" ? parsed.memberId : "";
      const savedMember = state.members.find((member) => member.id === savedMemberId);
      if (!savedMember) return;

      skipNextSelectionPersistRef.current = true;
      const savedPart = typeof parsed.selectedPart === "string" ? parsed.selectedPart : "";
      const memberPart = getInstrumentLabel(savedMember.instrument);
      setSelectedPart(partOptions.includes(savedPart) ? savedPart : memberPart);
      if (savedAuthMemberId === savedMember.id) {
        skipNextMemberAuthResetRef.current = true;
        setAuthenticatedMemberId(savedMember.id);
      }
      setMemberId(savedMember.id);

      if (typeof parsed.selectedInputDayId === "string" && sortedPracticeDays.some((day) => day.id === parsed.selectedInputDayId)) {
        setSelectedInputDayId(parsed.selectedInputDayId);
      }
    } catch {
      window.localStorage.removeItem(PLAYER_SELECTION_STORAGE_KEY);
    }
  }, [partOptions, ready, sortedPracticeDays, state.members]);

  useEffect(() => {
    if (!restoredSelectionRef.current) return;
    if (skipNextSelectionPersistRef.current) {
      skipNextSelectionPersistRef.current = false;
      return;
    }

    try {
      window.localStorage.setItem(
        PLAYER_SELECTION_STORAGE_KEY,
        JSON.stringify({
          memberId,
          selectedPart: activePart,
          selectedInputDayId
        })
      );
    } catch {
      // Selection persistence is only a browser convenience.
    }
  }, [activePart, memberId, selectedInputDayId]);


  useEffect(() => {
    setMemberPassword("");
    setMemberPasswordConfirmation("");
    setAuthError("");

    if (skipNextMemberAuthResetRef.current) {
      skipNextMemberAuthResetRef.current = false;
      return;
    }

    setAuthenticatedMemberId("");
    try {
      window.localStorage.removeItem(PLAYER_AUTH_STORAGE_KEY);
    } catch {
      // Authentication persistence is only a browser convenience.
    }
  }, [memberId]);

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
            breaks: savedAvailability?.breaks ?? [],
            absent: hasSaved ? isAbsent : false
          }
        ];
      })
    ) as DraftByDay;

    setDraftsByDay(nextDrafts);
    setSaveMessage("");
  }, [selected, sortedPracticeDays]);

  useEffect(() => {
    if (!selected) {
      if (selectedInputDayId) {
        setSelectedInputDayId("");
      }
      return;
    }

    if (selectedInputDay && selectedInputDay.id !== selectedInputDayId) {
      setSelectedInputDayId(selectedInputDay.id);
    }
    if (!selectedInputDay && selectedInputDayId) {
      setSelectedInputDayId("");
    }
  }, [selected, selectedInputDay, selectedInputDayId]);

  function updateDayDraft(dayId: string, patch: Partial<DraftByDay[string]>) {
    setDraftsByDay((current) => ({
      ...current,
      [dayId]: {
        ...current[dayId],
        ...patch
      }
    }));
  }

  function addBreak(dayId: string) {
    const draft = draftsByDay[dayId];
    if (!draft) return;

    const startMinutes = toMinutes(draft.start);
    const endMinutes = toMinutes(draft.end);
    const breakStart = Math.min(startMinutes + 10, Math.max(startMinutes, endMinutes - 10));
    const breakEnd = Math.min(endMinutes, breakStart + 10);

    updateDayDraft(dayId, {
      breaks: [...draft.breaks, { start: toTime(breakStart), end: toTime(breakEnd) }]
    });
  }

  function updateBreak(dayId: string, index: number, patch: Partial<{ start: string; end: string }>) {
    const draft = draftsByDay[dayId];
    if (!draft) return;

    updateDayDraft(dayId, {
      breaks: draft.breaks.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
    });
  }

  function removeBreak(dayId: string, index: number) {
    const draft = draftsByDay[dayId];
    if (!draft) return;

    updateDayDraft(dayId, {
      breaks: draft.breaks.filter((_, itemIndex) => itemIndex !== index)
    });
  }

  function getBreakValidationError(draft: DraftByDay[string]) {
    const attendanceStart = toMinutes(draft.start);
    const attendanceEnd = toMinutes(draft.end);
    if (!draft.absent && attendanceStart >= attendanceEnd) return "\u958b\u59cb\u6642\u9593\u306f\u7d42\u4e86\u6642\u9593\u3088\u308a\u524d\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002";

    for (const breakRange of draft.breaks) {
      const breakStart = toMinutes(breakRange.start);
      const breakEnd = toMinutes(breakRange.end);
      if (breakStart >= breakEnd) return "\u4e2d\u629c\u3051\u306e\u958b\u59cb\u6642\u9593\u306f\u7d42\u4e86\u6642\u9593\u3088\u308a\u524d\u306b\u3057\u3066\u304f\u3060\u3055\u3044\u3002";
      if (breakStart < attendanceStart || breakEnd > attendanceEnd) return "\u4e2d\u629c\u3051\u306f\u51fa\u5e2d\u6642\u9593\u306e\u4e2d\u306b\u53ce\u3081\u3066\u304f\u3060\u3055\u3044\u3002";
    }

    return "";
  }

  async function saveAvailability(dayId: string) {
    if (!selected) return;

    const day = state.practiceDays.find((item) => item.id === dayId);
    const draft = draftsByDay[dayId];
    if (!day || !draft) return;

    const validationError = getBreakValidationError(draft);
    if (validationError) {
      setSaveMessage(validationError);
      return;
    }

    const savedState = await localState.saveAvailabilityPatch({
      practiceDayId: dayId,
      memberId: selected.id,
      start: draft.start,
      end: draft.end,
      breaks: draft.breaks,
      absent: draft.absent
    });

    if (!savedState) {
      setSaveMessage("保存できていません。ネットワークまたはRedis/KV設定を確認してください。");
      return;
    }

    const savedDay = savedState.practiceDays.find((item) => item.id === dayId) ?? day;
    setSaveMessage(
      draft.absent
        ? `${getPracticeDayLabel(savedDay)} を欠席で保存しました。`
        : `${getPracticeDayLabel(savedDay)} を ${draft.start}-${draft.end} で保存しました。`
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

  function handlePasswordContinue() {
    if (!selected) return;

    if (!memberPassword.trim()) {
      setAuthError("パスワードを入力してください。");
      return;
    }

    if (!hasUsablePassword) {
      if (!memberPasswordConfirmation.trim()) {
        setAuthError("パスワードを2回入力してください。");
        return;
      }

      if (!passwordInputsMatch) {
        setAuthError("パスワードが一致していません。");
        return;
      }

      updateState({
        members: state.members.map((member) =>
          member.id === selected.id
            ? {
                ...member,
                password: memberPassword
              }
            : member
        )
      });
    } else if (selected.password !== memberPassword) {
      setAuthError("パスワードが違います。");
      return;
    }

    setAuthenticatedMemberId(selected.id);
    try {
      window.localStorage.setItem(PLAYER_AUTH_STORAGE_KEY, selected.id);
    } catch {
      // Authentication persistence is only a browser convenience.
    }
    setAuthError("");
    setSaveMessage("");
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

    const day = sortedPracticeDays.find((item) => item.id === dayId);
    if (!day || !day.respondedMemberIds.includes(selected.id)) return false;

    if (day.absentMemberIds.includes(selected.id)) return false;
    const savedAvailability = day.availabilities.find((item) => item.memberId === selected.id);
    if (!savedAvailability) return false;

    const slotEnd = slotStart + 10;
    return getAvailableSegments(savedAvailability).some((segment) => segment.start < slotEnd && slotStart < segment.end);
  }

  function normalizeBreaksForCompare(breaks: Array<{ start: string; end: string }>) {
    return [...breaks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || toMinutes(a.end) - toMinutes(b.end));
  }

  function hasUnsavedAvailabilityChanges(day: LocalPracticeDay, draft: DraftByDay[string]) {
    const hasSaved = !!selected && day.respondedMemberIds.includes(selected.id);
    const savedIsAbsent = !!selected && hasSaved && day.absentMemberIds.includes(selected.id);
    if (draft.absent !== savedIsAbsent) return true;
    if (draft.absent) return false;

    const savedAvailability = selected ? day.availabilities.find((item) => item.memberId === selected.id) : null;
    if (!savedAvailability) return hasSaved;
    if (draft.start !== savedAvailability.start || draft.end !== savedAvailability.end) return true;

    const draftBreaks = normalizeBreaksForCompare(draft.breaks);
    const savedBreaks = normalizeBreaksForCompare(savedAvailability.breaks);
    if (draftBreaks.length !== savedBreaks.length) return true;

    return draftBreaks.some((item, index) => item.start !== savedBreaks[index].start || item.end !== savedBreaks[index].end);
  }

  function renderCalendarButtons(day: LocalPracticeDay) {
    const hasValidPracticeTime = toMinutes(day.startTime) < toMinutes(day.endTime);
    return (
      <div className="calendar-add-row">
        <button
          type="button"
          className="secondary"
          onClick={() => {
            downloadCalendarEvent(day);
          }}
          disabled={!hasValidPracticeTime}
        >
          {"\u30ab\u30ec\u30f3\u30c0\u30fc\u306b\u8ffd\u52a0"}
        </button>
        <button
          type="button"
          className="secondary"
          onClick={() => {
            openGoogleCalendarEvent(day);
          }}
          disabled={!hasValidPracticeTime}
        >
          {"Google\u30ab\u30ec\u30f3\u30c0\u30fc\u306b\u8ffd\u52a0"}
        </button>
      </div>
    );
  }

  function selectPracticeDayForInput(dayId: string) {
    setSelectedInputDayId(dayId);
    window.setTimeout(() => {
      document.getElementById("daily-practice-input")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 0);
  }

  const currentDraft = selectedInputDay ? draftsByDay[selectedInputDay.id] : null;
  const hasCurrentUnsavedChanges = !!selectedInputDay && !!currentDraft && hasUnsavedAvailabilityChanges(selectedInputDay, currentDraft);
  const currentTimeOptions = selectedInputDay ? buildTimeOptions(selectedInputDay.startTime, selectedInputDay.endTime) : [];

  return (
    <main className="stack player-page">
      <section className="panel stack player-hero">
        <p className="muted">奏者ページ</p>
        <h1>参加可能時間と参加曲の入力</h1>
        <div className="row">
          <Link className="button secondary" href="/admin">
            管理画面へ
          </Link>
          <a className="button secondary" href="#my-availability">
            出欠を入力する
          </a>
        </div>
      </section>

      <section className="panel stack player-selector-panel">
        <h2>自分を選ぶ</h2>
        <select value={activePart} onChange={(event) => setSelectedPart(event.target.value)}>
          {partOptions.map((part) => (
            <option key={part} value={part}>
              {part}
            </option>
          ))}
        </select>
        <select value={selected?.id ?? ""} onChange={(event) => setMemberId(event.target.value)}>
          <option value="">自分を選んでください</option>
          {filteredMembers.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
            </option>
          ))}
        </select>
        <p className="muted">名前がなければ、管理者側でメンバーを追加してもらってください。</p>
        {hasUnsubmittedPracticeDays ? <p style={{ color: "var(--danger)", fontWeight: 800 }}>未入力の練習日があります</p> : null}
      </section>

      {selected ? (
        <>
          {hasUsablePassword || selectedIsReady ? (
            <>
          <section id="daily-practice-input" className="panel stack player-input-panel">
            <div className="row page-section-head">
              <div>
                <h2>練習日ごとの入力</h2>
                <p className="muted">編集したい練習日だけ選んで入力できます。</p>
              </div>
              {selectedInputDay ? (
                <label className="compact-field">
                  練習日
                  <select value={selectedInputDay.id} onChange={(event) => setSelectedInputDayId(event.target.value)}>
                    {sortedPracticeDays.map((day) => {
                      const needsResponse = !!selected && !day.respondedMemberIds.includes(selected.id);

                      return (
                        <option key={day.id} value={day.id}>
                          {needsResponse ? "未入力: " : ""}
                          {formatPracticeDateLabel(day.practiceDate)} {formatPracticeTimeAndLocation(day)}
                        </option>
                      );
                    })}
                  </select>
                </label>
              ) : null}
            </div>

            {selectedInputDayNeedsResponse ? <p className="error">この練習日はまだ入力していません。</p> : null}

            {saveMessage ? <div className="notice">{saveMessage}</div> : null}
            {hasCurrentUnsavedChanges ? <div className="notice">{"\u307e\u3060\u4fdd\u5b58\u3055\u308c\u3066\u3044\u307e\u305b\u3093"}</div> : null}

            {selectedInputDay && currentDraft ? (
              <section className="panel subtle-panel stack">
                <div className="row page-section-head">
                  <div>
                    <h3>{formatPracticeDateLabel(selectedInputDay.practiceDate)}</h3>
                    <p className="muted">
                      練習時間 {formatPracticeTimeAndLocation(selectedInputDay)}
                    </p>
                  </div>
                  {canEditSelectedDay ? (
                    <button
                      type="button"
                      onClick={() => saveAvailability(selectedInputDay.id)}
                      disabled={localState.saveStatus === "saving"}
                    >
                      {localState.saveStatus === "saving" ? "保存中" : "この日の入力を保存"}
                    </button>
                  ) : null}
                </div>

                {renderCalendarButtons(selectedInputDay)}

                {canEditSelectedDay ? (
                  <>
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
                    <div className="break-list stack">
                      {currentDraft.breaks.map((breakRange, index) => (
                        <div className="break-row" key={`${selectedInputDay.id}-break-${index}`}>
                          <TimePartSelect
                            label={"\u4e2d\u629c\u3051\u958b\u59cb"}
                            value={breakRange.start}
                            options={currentTimeOptions}
                            disabled={currentDraft.absent}
                            onChange={(value) => updateBreak(selectedInputDay.id, index, { start: value })}
                          />
                          <TimePartSelect
                            label={"\u4e2d\u629c\u3051\u7d42\u4e86"}
                            value={breakRange.end}
                            options={currentTimeOptions}
                            disabled={currentDraft.absent}
                            onChange={(value) => updateBreak(selectedInputDay.id, index, { end: value })}
                          />
                          <button type="button" className="secondary" onClick={() => removeBreak(selectedInputDay.id, index)} disabled={currentDraft.absent}>
                            {"\u524a\u9664"}
                          </button>
                        </div>
                      ))}
                      <button type="button" className="secondary" onClick={() => addBreak(selectedInputDay.id)} disabled={currentDraft.absent}>
                        {"\u4e2d\u629c\u3051\u3092\u8ffd\u52a0"}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted">この日はすでに入力済みです。内容を確認・編集するにはパスワードが必要です。</p>
                )}

              </section>
            ) : (
              <p className="muted">まだ練習日がありません。</p>
            )}
          </section>

            </>
          ) : null}

          <section className="panel stack">
            <h2>{hasUsablePassword ? "パスワードを入力" : "パスワードを設定"}</h2>
            <p className="muted">{hasUsablePassword ? "入力済みの日を確認・修正するときはパスワードを入力してください。" : "初回のみ、確認のため同じパスワードを2回入力してください。"}</p>
            {!selectedIsReady ? (
              <>
                <input
                  type="password"
                  value={memberPassword}
                  onChange={(event) => {
                    setMemberPassword(event.target.value);
                    setAuthError("");
                  }}
                  placeholder="パスワード"
                />
                {!hasUsablePassword ? (
                  <input
                    type="password"
                    value={memberPasswordConfirmation}
                    onChange={(event) => {
                      setMemberPasswordConfirmation(event.target.value);
                      setAuthError("");
                    }}
                    placeholder="パスワードをもう一度"
                  />
                ) : null}
                {!hasUsablePassword && memberPassword && memberPasswordConfirmation && !passwordInputsMatch ? (
                  <p className="error">パスワードが一致していません。</p>
                ) : null}
                {authError ? <p className="error">{authError}</p> : null}
                <button type="button" onClick={handlePasswordContinue} disabled={!canContinueWithPassword}>
                  {hasUsablePassword ? "確認する" : "保存する"}
                </button>
              </>
            ) : (
              <>
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
                        const savedAvailability = day.availabilities.find((item) => item.memberId === selected.id);
                        const hasSaved = day.respondedMemberIds.includes(selected.id);
                        const isAbsent = hasSaved && day.absentMemberIds.includes(selected.id);
                        const label = hasSaved
                          ? isAbsent
                            ? "??"
                            : savedAvailability
                              ? savedAvailability.breaks.length > 0
                                ? `${savedAvailability.start}-${savedAvailability.end} / ${"\u4e2d\u629c\u3051"} ${savedAvailability.breaks.length}${"\u4ef6"}`
                                : `${savedAvailability.start}-${savedAvailability.end}`
                              : "\u672a\u5165\u529b"
                          : "\u672a\u5165\u529b";

                        return (
                          <tr key={day.id}>
                            <th>
                              <button
                                type="button"
                                className="availability-day-button"
                                onClick={() => selectPracticeDayForInput(day.id)}
                              >
                                <span>{formatPracticeDateLabel(day.practiceDate)}</span>
                                <span className="muted">
                                  {"\u7df4\u7fd2"} {formatPracticeTimeAndLocation(day)} / {"\u5165\u529b\u72b6\u6cc1"} {label}
                                </span>
                              </button>
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
                                isPractice && isAbsent ? "absent-cell" : "",
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
              </>
            )}
          </section>

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
        </>
      ) : (
        <section className="panel stack">
          <p className="muted">上で自分を選ぶと、その下に参加曲と出欠入力が表示されます。</p>
        </section>
      )}
    </main>
  );
}

