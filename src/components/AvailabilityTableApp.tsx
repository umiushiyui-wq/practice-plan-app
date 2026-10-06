"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  buildAvailabilitySlots,
  compareMembersByInstrument,
  compareMembersByInstrumentAndSection,
  formatPracticeDateLabel,
  getAvailabilityRange,
  getInstrumentLabel,
  getPracticeDayLabel,
  getSelectedPracticeDay,
  getSortedPracticeDays,
  getSortedInstrumentOptions,
  isAvailable,
  LocalStateStatusPanel,
  toMinutes,
  toTime,
  useLocalPracticeState,
  getPrivateDayMark
} from "@/components/LocalPracticeApp";
import type { LocalPracticeDay } from "@/components/LocalPracticeApp";
import { AdminAvailabilityEditor } from "@/components/AdminAvailabilityEditor";
import { PartAttendanceSenderPanel } from "@/components/PartAttendanceSenderPanel";

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

type AnswerConfirmationResult = {
  sentCount: number;
  missingSlackUserIdCount: number;
  failedCount: number;
  totalAnsweredCount: number;
};

type LastReminder = {
  sentAt: string;
  summary: string;
};

function formatReminderSentAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatPracticeTimeAndLocation(day: { startTime: string; endTime: string; location: string }) {
  const location = day.location.trim();
  return location ? `${day.startTime}〜${day.endTime} ＠${location}` : `${day.startTime}〜${day.endTime}`;
}

export function AvailabilityTableApp() {
  const localState = useLocalPracticeState();
  const { state, updateState } = localState;
  const selectedDay = getSelectedPracticeDay(state);
  const sortedPracticeDays = useMemo(() => getSortedPracticeDays(state.practiceDays), [state.practiceDays]);
  const AVAILABILITY_SLOTS = useMemo(
    () => buildAvailabilitySlots(toMinutes(selectedDay.startTime), toMinutes(selectedDay.endTime)),
    [selectedDay.startTime, selectedDay.endTime]
  );
  const [selectedPieceFilter, setSelectedPieceFilter] = useState(ALL_PIECES_FILTER);
  const [selectedPartFilter, setSelectedPartFilter] = useState(ALL_PARTS_FILTER);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);
  const [slackReminderStatus, setSlackReminderStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [slackReminderResult, setSlackReminderResult] = useState<SlackReminderResult | null>(null);
  const [slackReminderMessage, setSlackReminderMessage] = useState("");
  const [lastReminder, setLastReminder] = useState<{ practiceDayId: string; value: LastReminder | null } | null>(null);
  const [answerConfirmationStatus, setAnswerConfirmationStatus] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [answerConfirmationMessage, setAnswerConfirmationMessage] = useState("");

  useEffect(() => {
    const practiceDayId = selectedDay.id;
    let cancelled = false;
    fetch(`/api/local-state/practice-days/${practiceDayId}/slack-reminders`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { lastReminder?: LastReminder | null } | null) => {
        if (!cancelled && payload) setLastReminder({ practiceDayId, value: payload.lastReminder ?? null });
      })
      .catch(() => null);
    return () => {
      cancelled = true;
    };
  }, [selectedDay.id]);

  const selectedDayLastReminder = lastReminder?.practiceDayId === selectedDay.id ? lastReminder : null;

  const partOptions = useMemo(
    () => getSortedInstrumentOptions(state.members.map((member) => member.instrument)),
    [state.members]
  );

  // 曲を選んでいるときだけ、その曲のセクションを表示・並び順に使う
  const selectedPiece = useMemo(
    () => state.pieces.find((piece) => piece.id === selectedPieceFilter) ?? null,
    [selectedPieceFilter, state.pieces]
  );
  const selectedPieceSections = selectedPiece?.memberSections ?? null;

  const visibleMembers = useMemo(() => {
    // 曲で絞っているときは、濃く表示する人（乗っている人 / 「その他」なら曲に乗っていない人）を
    // パートに関係なく全員上にまとめ、薄く表示する人をその下に回す
    const isOnPiece = (memberId: string) => state.pieces.some((piece) => piece.memberIds.includes(memberId));
    const isHighlighted = (memberId: string) =>
      selectedPieceFilter === ALL_PIECES_FILTER
        ? true
        : selectedPieceFilter === OTHER_PIECES_FILTER
          ? !isOnPiece(memberId)
          : Boolean(selectedPiece?.memberIds.includes(memberId));

    const sortedMembers = [...state.members].sort((first, second) => {
      const highlightOrder = Number(!isHighlighted(first.id)) - Number(!isHighlighted(second.id));
      if (highlightOrder) return highlightOrder;
      return selectedPiece && isHighlighted(first.id)
        ? compareMembersByInstrumentAndSection(first, second, selectedPiece.memberSections)
        : compareMembersByInstrument(first, second);
    });
    if (selectedPartFilter === ALL_PARTS_FILTER) return sortedMembers;
    return sortedMembers.filter((member) => getInstrumentLabel(member.instrument) === selectedPartFilter);
  }, [selectedPartFilter, selectedPiece, selectedPieceFilter, state.members, state.pieces]);

  // 管理画面だけに見せる出欠サマリー（奏者ページ・ホームには出さない）
  const attendanceSummary = useMemo(() => {
    const memberIds = new Set(state.members.map((member) => member.id));
    const respondedSet = new Set(selectedDay.respondedMemberIds.filter((id) => memberIds.has(id)));
    const absent = selectedDay.absentMemberIds.filter((id) => respondedSet.has(id)).length;
    const total = state.members.length;
    const responded = respondedSet.size;
    return {
      total,
      responded,
      attending: Math.max(0, responded - absent),
      unanswered: Math.max(0, total - responded)
    };
  }, [state.members, selectedDay.respondedMemberIds, selectedDay.absentMemberIds]);

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

  // 奏者名クリックで開く「その奏者の参加可能時間表」（全練習日 × 時間帯）用
  const detailMember = state.members.find((member) => member.id === detailMemberId) ?? null;
  const detailSlots = useMemo(() => {
    const range = getAvailabilityRange(sortedPracticeDays);
    return buildAvailabilitySlots(range.startMin, range.endMin);
  }, [sortedPracticeDays]);

  function isPracticeSlotForDay(day: LocalPracticeDay, slotStart: number) {
    const slotEnd = slotStart + 10;
    return toMinutes(day.startTime) < slotEnd && slotStart < toMinutes(day.endTime);
  }

  function isMemberAvailableAtSlotForDay(day: LocalPracticeDay, memberId: string, slotStart: number) {
    if (!day.respondedMemberIds.includes(memberId) || day.absentMemberIds.includes(memberId)) {
      return false;
    }

    return isAvailable(day.availabilities, memberId, slotStart, slotStart + 10);
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
      const payload = (await response.json().catch(() => null)) as
        | (SlackReminderResult & { error?: string; lastReminder?: LastReminder })
        | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "Slack\u901a\u77e5\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
      }

      setSlackReminderResult(payload);
      if (payload?.lastReminder) setLastReminder({ practiceDayId: selectedDay.id, value: payload.lastReminder });
      setSlackReminderStatus("sent");
      setSlackReminderMessage(
        `Slack\u901a\u77e5: \u9001\u4fe1 ${payload?.sentCount ?? 0}\u4eba / Slack ID\u672a\u767b\u9332 ${payload?.missingSlackUserIdCount ?? 0}\u4eba / \u5931\u6557 ${payload?.failedCount ?? 0}\u4eba`
      );
    } catch (error) {
      setSlackReminderStatus("error");
      setSlackReminderMessage(error instanceof Error ? error.message : "Slack\u901a\u77e5\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
    }
  }

  // \u5165\u529b\u6e08\u307f\u306e\u4eba\u306b\u3001\u53d7\u3051\u4ed8\u3051\u305f\u5185\u5bb9\u3092\u306a\u3054\u307e\u308b\u304b\u3089DM\u3067\u9001\u308a\u8fd4\u3059\uff08\u9593\u9055\u3063\u3066\u3044\u305f\u3089\u5165\u529b\u3057\u76f4\u3057\u3066\u3082\u3089\u3046\uff09
  async function sendAnswerConfirmations() {
    if (!confirm("\u5165\u529b\u6e08\u307f\u306e\u4eba\u306b\u3001\u5165\u529b\u5185\u5bb9\u306e\u78ba\u8a8d\u30e1\u30c3\u30bb\u30fc\u30b8\u3092Slack DM\u3067\u9001\u4fe1\u3057\u307e\u3059\u304b\uff1f")) return;

    setAnswerConfirmationStatus("sending");
    setAnswerConfirmationMessage("");

    try {
      const response = await fetch(`/api/local-state/practice-days/${selectedDay.id}/answer-confirmations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetMemberIds: reminderTargetMemberIds })
      });
      const payload = (await response.json().catch(() => null)) as (AnswerConfirmationResult & { error?: string }) | null;

      if (!response.ok) {
        throw new Error(payload?.error ?? "\u78ba\u8a8d\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
      }

      setAnswerConfirmationStatus("sent");
      setAnswerConfirmationMessage(
        `\u78ba\u8a8d\u30e1\u30c3\u30bb\u30fc\u30b8: \u9001\u4fe1 ${payload?.sentCount ?? 0}\u4eba / Slack ID\u672a\u767b\u9332 ${payload?.missingSlackUserIdCount ?? 0}\u4eba / \u5931\u6557 ${payload?.failedCount ?? 0}\u4eba\uff08\u5165\u529b\u6e08\u307f ${payload?.totalAnsweredCount ?? 0}\u4eba\uff09`
      );
    } catch (error) {
      setAnswerConfirmationStatus("error");
      setAnswerConfirmationMessage(error instanceof Error ? error.message : "\u78ba\u8a8d\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u4fe1\u3067\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002");
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
                setAnswerConfirmationStatus("idle");
                setAnswerConfirmationMessage("");
              }}
            >
              {sortedPracticeDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {getPrivateDayMark(day)}
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
        <p className="muted">曲を選ぶとその曲に乗っている人を濃く表示し、セクション（例: Tb 1st）とセクション順の並びも表示します。パートでは一覧自体を絞り込めます。奏者名を押すと、その人の出欠を代わりに入力できます。</p>
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
          <button
            className="slack-reminder-button"
            type="button"
            onClick={sendSlackReminders}
            disabled={slackReminderStatus === "sending" || selectedDay.isPrivate}
            title={selectedDay.isPrivate ? "非公開の練習日には送信できません" : undefined}
          >
            {slackReminderStatus === "sending" ? "\u9001\u4fe1\u4e2d" : "\u672a\u5165\u529b\u8005\u306b\u30e1\u30c3\u30bb\u30fc\u30b8\u3092\u9001\u308b"}
          </button>
          <button
            className="slack-reminder-button"
            type="button"
            onClick={sendAnswerConfirmations}
            disabled={answerConfirmationStatus === "sending" || selectedDay.isPrivate}
            title={selectedDay.isPrivate ? "非公開の練習日には送信できません" : undefined}
          >
            {answerConfirmationStatus === "sending" ? "送信中" : "入力済みの人に確認メッセージを送る"}
          </button>
          <PartAttendanceSenderPanel selectedDay={selectedDay} members={state.members} />
        </div>
        {selectedDayLastReminder ? (
          <p className="muted">
            {selectedDayLastReminder.value
              ? `この練習日の最終催促: ${formatReminderSentAt(selectedDayLastReminder.value.sentAt)}（${selectedDayLastReminder.value.summary}）`
              : "この練習日はまだ催促していません"}
          </p>
        ) : null}
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        <h2>{getPracticeDayLabel(selectedDay)} の参加可能時間</h2>
        <div className="summary-strip">
          <div className="metric-card">
            <span className="metric-label">回答</span>
            <strong>
              {attendanceSummary.responded}
              <span className="metric-sub"> / {attendanceSummary.total}</span>
            </strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">出席予定</span>
            <strong>{attendanceSummary.attending}</strong>
          </div>
          <div className="metric-card">
            <span className="metric-label">未回答</span>
            <strong>{attendanceSummary.unanswered}</strong>
          </div>
        </div>
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
        {answerConfirmationMessage ? (
          <div className={answerConfirmationStatus === "error" ? "error" : "notice"}>{answerConfirmationMessage}</div>
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
                      ? `${availability.start}\u301c${availability.end} / ${"\u4e2d\u629c\u3051"} ${availability.breaks.length}${"\u4ef6"}`
                      : `${availability.start}\u301c${availability.end}`
                    : hasSaved
                      ? "未入力"
                      : "未回答";
                const isHighlighted = isMemberHighlighted(member.id);
                const section = selectedPieceSections?.[member.id] ?? "";

                return (
                  <tr key={member.id} className={isHighlighted ? "" : "member-row-dim"}>
                    <th>
                      <button
                        type="button"
                        className="availability-day-button"
                        onClick={() => setDetailMemberId(member.id)}
                        title={`${member.name} の参加可能時間表を見る・出欠を編集する`}
                      >
                        <span>{member.name}</span>
                        <span className="muted">
                          {[getInstrumentLabel(member.instrument), section, availabilityLabel].filter(Boolean).join(" / ")}
                        </span>
                      </button>
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

      {detailMember ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${detailMember.name} の参加可能時間表`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setDetailMemberId(null);
          }}
        >
          <div className="modal-card">
            <div className="row page-section-head">
              <div>
                <p className="muted">奏者の参加可能時間表</p>
                <h2>{detailMember.name}</h2>
                <p className="muted">{getInstrumentLabel(detailMember.instrument)}</p>
              </div>
              <button type="button" className="secondary" onClick={() => setDetailMemberId(null)}>
                閉じる
              </button>
            </div>

            <AdminAvailabilityEditor
              key={`${selectedDay.id}-${detailMember.id}`}
              day={selectedDay}
              member={detailMember}
              onSave={localState.saveAvailabilityPatch}
            />

            <div className="availability-wrap">
              <table className="availability-table player-availability-table">
                <thead>
                  <tr>
                    <th>練習日</th>
                    {detailSlots.map((minutes) => (
                      <th key={minutes}>{minutes % 60 === 0 ? toTime(minutes) : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedPracticeDays.map((day) => {
                    const savedAvailability = day.availabilities.find((item) => item.memberId === detailMember.id);
                    const hasSaved = day.respondedMemberIds.includes(detailMember.id);
                    const isAbsent = hasSaved && day.absentMemberIds.includes(detailMember.id);
                    const label = hasSaved
                      ? isAbsent
                        ? "欠席"
                        : savedAvailability
                          ? savedAvailability.breaks.length > 0
                            ? `${savedAvailability.start}〜${savedAvailability.end} / 中抜け ${savedAvailability.breaks.length}件`
                            : `${savedAvailability.start}〜${savedAvailability.end}`
                          : "未入力"
                      : "未回答";

                    return (
                      <tr key={day.id}>
                        <th>
                          {formatPracticeDateLabel(day.practiceDate)}
                          <span className="muted">入力状況 {label}</span>
                        </th>
                        {detailSlots.map((minutes, index) => {
                          const previousMinutes = detailSlots[index - 1];
                          const nextMinutes = detailSlots[index + 1];
                          const isPractice = isPracticeSlotForDay(day, minutes);
                          const isAvailableSlot = isMemberAvailableAtSlotForDay(day, detailMember.id, minutes);
                          const isPreviousPractice = previousMinutes !== undefined && isPracticeSlotForDay(day, previousMinutes);
                          const isNextPractice = nextMinutes !== undefined && isPracticeSlotForDay(day, nextMinutes);
                          const classNames = [
                            minutes % 60 === 0 ? "hour-divider-cell" : "",
                            isPractice ? "practice-window-cell" : "",
                            isPractice && !isPreviousPractice ? "practice-start-cell" : "",
                            isPractice && !isNextPractice ? "practice-end-cell" : "",
                            isPractice && isAbsent ? "absent-cell" : "",
                            isAvailableSlot ? "available-cell" : ""
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
              <span className="legend-chip available">緑: 参加可能時間</span>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
