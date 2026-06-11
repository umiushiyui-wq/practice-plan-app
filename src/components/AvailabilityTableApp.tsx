"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  compareMembersByInstrument,
  formatPracticeDateLabel,
  getInstrumentLabel,
  getPracticeDayLabel,
  getSelectedPracticeDay,
  getSortedPracticeDays,
  getSortedInstrumentOptions,
  isAvailable,
  LocalStateStatusPanel,
  toMinutes,
  toTime,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

const AVAILABILITY_SLOTS = Array.from({ length: ((22 - 8) * 60) / 10 + 1 }, (_, index) => 8 * 60 + index * 10);
const ALL_PIECES_FILTER = "__all__";
const OTHER_PIECES_FILTER = "__other__";
const ALL_PARTS_FILTER = "__all__";

type SlackReminderResult = {
  sentCount: number;
  missingSlackUserIdCount: number;
  failedCount: number;
  skippedAnsweredCount: number;
  totalUnansweredCount: number;
};

function formatPracticeTimeAndLocation(day: { startTime: string; endTime: string; location: string }) {
  const location = day.location.trim();
  return location ? `${day.startTime}-${day.endTime} ＠${location}` : `${day.startTime}-${day.endTime}`;
}

export function AvailabilityTableApp() {
  const localState = useLocalPracticeState();
  const { state, updateState } = localState;
  const selectedDay = getSelectedPracticeDay(state);
  const sortedPracticeDays = useMemo(() => getSortedPracticeDays(state.practiceDays), [state.practiceDays]);
  const [selectedPieceFilter, setSelectedPieceFilter] = useState(ALL_PIECES_FILTER);
  const [selectedPartFilter, setSelectedPartFilter] = useState(ALL_PARTS_FILTER);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [slackReminderStatus, setSlackReminderStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [slackReminderResult, setSlackReminderResult] = useState<SlackReminderResult | null>(null);
  const [slackReminderMessage, setSlackReminderMessage] = useState("");

  const partOptions = useMemo(
    () => getSortedInstrumentOptions(state.members.map((member) => member.instrument)),
    [state.members]
  );

  const visibleMembers = useMemo(() => {
    const sortedMembers = [...state.members].sort(compareMembersByInstrument);
    if (selectedPartFilter === ALL_PARTS_FILTER) return sortedMembers;
    return sortedMembers.filter((member) => getInstrumentLabel(member.instrument) === selectedPartFilter);
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

    return isAvailable(selectedDay.availabilities, memberId, slotStart, slotStart + 10);
  }

  function isMemberHighlighted(memberId: string) {
    if (selectedPieceFilter === ALL_PIECES_FILTER) return true;

    if (selectedPieceFilter === OTHER_PIECES_FILTER) {
      return !state.pieces.some((piece) => piece.memberIds.includes(memberId));
    }

    return state.pieces.some((piece) => piece.id === selectedPieceFilter && piece.memberIds.includes(memberId));
  }

  const reminderTargetMemberIds = visibleMembers.filter((member) => isMemberHighlighted(member.id)).map((member) => member.id);

  const hoveredAvailableCount =
    hoveredSlot === null
      ? null
      : visibleMembers.filter((member) => isMemberHighlighted(member.id) && isMemberAvailableAtSlot(member.id, hoveredSlot)).length;

  async function sendSlackReminders() {
    if (!confirm("\u672a\u5165\u529b\u8005\u306bSlack DM\u3092\u9001\u4fe1\u3057\u307e\u3059\u304b\uff1f")) return;

    setSlackReminderStatus("sending");
    setSlackReminderResult(null);
    setSlackReminderMessage("");

    try {
      const response = await fetch(`/api/local-state/practice-days/${selectedDay.id}/slack-reminders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMemberIds: reminderTargetMemberIds })
      });
      const payload = (await response.json().catch(() => null)) as (SlackReminderResult & { error?: string }) | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Slack\u901a\u77e5\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
      }

      setSlackReminderResult(payload);
      setSlackReminderStatus("sent");
      setSlackReminderMessage(
        `Slack\u901a\u77e5: \u9001\u4fe1 ${payload?.sentCount ?? 0}\u4eba / Slack ID\u672a\u767b\u9332 ${payload?.missingSlackUserIdCount ?? 0}\u4eba / \u5931\u6557 ${payload?.failedCount ?? 0}\u4eba`
      );
    } catch (error) {
      setSlackReminderStatus("error");
      setSlackReminderMessage(error instanceof Error ? error.message : "Slack\u901a\u77e5\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
    }
  }

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
              onChange={(event) => {
                updateState({ selectedPracticeDayId: event.target.value });
                setSlackReminderStatus("idle");
                setSlackReminderResult(null);
                setSlackReminderMessage("");
              }}
            >
              {sortedPracticeDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {formatPracticeDateLabel(day.practiceDate)} {formatPracticeTimeAndLocation(day)}
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
            {"\u8868\u3067\u898b\u308b"}
          </Link>
          <button className="slack-reminder-button" type="button" onClick={sendSlackReminders} disabled={slackReminderStatus === "sending"}>
            {slackReminderStatus === "sending" ? "\u9001\u4fe1\u4e2d" : "\u672a\u5165\u529b\u8005\u306b\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u308b"}
          </button>
        </div>
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        <h2>{getPracticeDayLabel(selectedDay)} の参加可能時間</h2>
        {slackReminderMessage ? (
          <div className={slackReminderStatus === "error" ? "error" : "notice"}>
            {slackReminderMessage}
            {slackReminderResult ? (
              <span className="muted">
                {` \u672a\u5165\u529b\u8005 ${slackReminderResult.totalUnansweredCount}\u4eba\u3001\u5165\u529b\u6e08\u307f\u9664\u5916 ${slackReminderResult.skippedAnsweredCount}\u4eba`}
              </span>
            ) : null}
          </div>
        ) : null}
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
                    ? availability.breaks.length > 0
                      ? `${availability.start}-${availability.end} / ${"\u4e2d\u629c\u3051"} ${availability.breaks.length}${"\u4ef6"}`
                      : `${availability.start}-${availability.end}`
                    : hasSaved
                      ? "未入力"
                      : "未回答";
                const isHighlighted = isMemberHighlighted(member.id);

                return (
                  <tr key={member.id} className={isHighlighted ? "" : "member-row-dim"}>
                    <th>
                      {member.name}
                      <span className="muted">
                        {getInstrumentLabel(member.instrument) + " / " + availabilityLabel}
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
                        isPractice && isAbsent ? "absent-cell" : "",
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
