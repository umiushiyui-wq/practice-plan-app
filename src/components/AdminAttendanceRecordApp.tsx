"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildAvailabilitySlots,
  classifyMemberAttendanceForDay,
  compareMembersByInstrument,
  computeMemberAttendanceStats,
  formatPracticeDateLabel,
  getAvailabilityRange,
  getInstrumentLabel,
  getPracticeDayLabel,
  getSelectedPracticeDay,
  getSortedInstrumentOptions,
  getSortedPracticeDays,
  isAttendanceRecordUnlocked,
  isAvailable,
  LocalStateStatusPanel,
  toMinutes,
  toTime,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";
import type { AttendanceStatus, LocalPracticeDay } from "@/components/LocalPracticeApp";

const ALL_PARTS_FILTER = "__all__";

const STATUS_DOT_CLASS: Record<AttendanceStatus, string> = {
  full: "attendance-dot-full",
  partial: "attendance-dot-partial",
  absent: "attendance-dot-absent",
  unanswered: "attendance-dot-unanswered"
};

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  full: "フル出席",
  partial: "遅刻早退・中抜けあり",
  absent: "欠席",
  unanswered: "未回答"
};

type Draft = {
  start: string;
  end: string;
  breaks: Array<{ start: string; end: string }>;
  absent: boolean;
};

function formatPracticeTimeAndLocation(day: { startTime: string; endTime: string; location: string }) {
  const location = day.location.trim();
  return location ? `${day.startTime}〜${day.endTime} ＠${location}` : `${day.startTime}〜${day.endTime}`;
}

function buildTimeOptions(startTime: string, endTime: string) {
  const startMinutes = Math.ceil(toMinutes(startTime) / 10) * 10;
  const endMinutes = toMinutes(endTime);
  const options: string[] = [];

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += 10) {
    options.push(toTime(minutes));
  }

  return options;
}

function AttendanceStatusDot({ status }: { status: AttendanceStatus | null }) {
  const title = status === null ? "未記録（当日7:00以降に記録されます）" : STATUS_LABEL[status];
  const className = status === null ? "attendance-dot attendance-dot-none" : `attendance-dot ${STATUS_DOT_CLASS[status]}`;
  return <span className={className} title={title} />;
}

export function AdminAttendanceRecordApp() {
  const localState = useLocalPracticeState();
  const { state } = localState;
  const selectedDay = getSelectedPracticeDay(state);
  const sortedPracticeDays = useMemo(() => getSortedPracticeDays(state.practiceDays), [state.practiceDays]);
  const AVAILABILITY_SLOTS = useMemo(
    () => buildAvailabilitySlots(toMinutes(selectedDay.startTime), toMinutes(selectedDay.endTime)),
    [selectedDay.startTime, selectedDay.endTime]
  );
  const [selectedPartFilter, setSelectedPartFilter] = useState(ALL_PARTS_FILTER);
  const [hoveredSlot, setHoveredSlot] = useState<number | null>(null);
  const [detailMemberId, setDetailMemberId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [editMessage, setEditMessage] = useState("");
  const snapshotRequestedRef = useRef<Set<string>>(new Set());

  const partOptions = useMemo(
    () => getSortedInstrumentOptions(state.members.map((member) => member.instrument)),
    [state.members]
  );

  const visibleMembers = useMemo(() => {
    const sortedMembers = [...state.members].sort(compareMembersByInstrument);
    if (selectedPartFilter === ALL_PARTS_FILTER) return sortedMembers;
    return sortedMembers.filter((member) => getInstrumentLabel(member.instrument) === selectedPartFilter);
  }, [selectedPartFilter, state.members]);

  const isUnlocked = isAttendanceRecordUnlocked(selectedDay.practiceDate);
  const isSnapshotted = !!selectedDay.actualAttendanceSnapshotAt;

  // 当日7:00(JST)を過ぎた練習日を開いたら、まだコピーされていなければ自己申告を「実際の出欠」の初期値として自動コピーする。
  useEffect(() => {
    if (!localState.ready) return;
    if (selectedDay.actualAttendanceSnapshotAt) return;
    if (!isAttendanceRecordUnlocked(selectedDay.practiceDate)) return;
    if (snapshotRequestedRef.current.has(selectedDay.id)) return;

    snapshotRequestedRef.current.add(selectedDay.id);
    localState.ensureAttendanceRecordSnapshot(selectedDay.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localState.ready, selectedDay.id, selectedDay.actualAttendanceSnapshotAt, selectedDay.practiceDate]);

  function isPracticeSlot(slotStart: number) {
    const slotEnd = slotStart + 10;
    const practiceStart = toMinutes(selectedDay.startTime);
    const practiceEnd = toMinutes(selectedDay.endTime);
    return practiceStart < slotEnd && slotStart < practiceEnd;
  }

  // スナップショット前は「実際の出欠」がまだ存在しないため、自己申告を参考として読み取り専用表示する。
  function isMemberActualAvailableAtSlot(day: LocalPracticeDay, memberId: string, slotStart: number) {
    if (day.actualAttendanceSnapshotAt) {
      if (!day.actualRespondedMemberIds.includes(memberId) || day.actualAbsentMemberIds.includes(memberId)) return false;
      return isAvailable(day.actualAvailabilities, memberId, slotStart, slotStart + 10);
    }

    if (!day.respondedMemberIds.includes(memberId) || day.absentMemberIds.includes(memberId)) return false;
    return isAvailable(day.availabilities, memberId, slotStart, slotStart + 10);
  }

  function isMemberActualAbsent(day: LocalPracticeDay, memberId: string) {
    if (day.actualAttendanceSnapshotAt) {
      return day.actualRespondedMemberIds.includes(memberId) && day.actualAbsentMemberIds.includes(memberId);
    }
    return day.respondedMemberIds.includes(memberId) && day.absentMemberIds.includes(memberId);
  }

  const dayStatusCounts = useMemo(() => {
    const counts: Record<AttendanceStatus, number> = { full: 0, partial: 0, absent: 0, unanswered: 0 };
    for (const member of visibleMembers) {
      const status = classifyMemberAttendanceForDay(selectedDay, member.id);
      if (status) counts[status] += 1;
    }
    return counts;
  }, [visibleMembers, selectedDay]);

  const hoveredAvailableCount =
    hoveredSlot === null ? null : visibleMembers.filter((member) => isMemberActualAvailableAtSlot(selectedDay, member.id, hoveredSlot)).length;

  // 奏者クリックで開く詳細モーダル（全練習日横断の記録＋分析）用
  const detailMember = state.members.find((member) => member.id === detailMemberId) ?? null;
  const detailSlots = useMemo(() => {
    const range = getAvailabilityRange(sortedPracticeDays);
    return buildAvailabilitySlots(range.startMin, range.endMin);
  }, [sortedPracticeDays]);

  const detailStats = useMemo(
    () => (detailMember ? computeMemberAttendanceStats(sortedPracticeDays, detailMember.id) : null),
    [detailMember, sortedPracticeDays]
  );

  function isPracticeSlotForDay(day: LocalPracticeDay, slotStart: number) {
    const slotEnd = slotStart + 10;
    return toMinutes(day.startTime) < slotEnd && slotStart < toMinutes(day.endTime);
  }

  useEffect(() => {
    if (!detailMember) {
      setDraft(null);
      setEditMessage("");
      return;
    }

    const savedActual = selectedDay.actualAvailabilities.find((item) => item.memberId === detailMember.id);
    const hasActualRecord = selectedDay.actualRespondedMemberIds.includes(detailMember.id);
    const isActualAbsent = hasActualRecord && selectedDay.actualAbsentMemberIds.includes(detailMember.id);

    setDraft({
      start: savedActual?.start ?? selectedDay.startTime,
      end: savedActual?.end ?? selectedDay.endTime,
      breaks: savedActual?.breaks ?? [],
      absent: hasActualRecord ? isActualAbsent : false
    });
    setEditMessage("");
  }, [detailMember, selectedDay]);

  const timeOptions = buildTimeOptions(selectedDay.startTime, selectedDay.endTime);

  function updateDraft(patch: Partial<Draft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
  }

  function addBreak() {
    if (!draft) return;
    const startMinutes = toMinutes(draft.start);
    const endMinutes = toMinutes(draft.end);
    const breakStart = Math.min(startMinutes + 10, Math.max(startMinutes, endMinutes - 10));
    const breakEnd = Math.min(endMinutes, breakStart + 10);
    updateDraft({ breaks: [...draft.breaks, { start: toTime(breakStart), end: toTime(breakEnd) }] });
  }

  function updateBreak(index: number, patch: Partial<{ start: string; end: string }>) {
    if (!draft) return;
    updateDraft({ breaks: draft.breaks.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)) });
  }

  function removeBreak(index: number) {
    if (!draft) return;
    updateDraft({ breaks: draft.breaks.filter((_, itemIndex) => itemIndex !== index) });
  }

  function getBreakValidationError(value: Draft) {
    const attendanceStart = toMinutes(value.start);
    const attendanceEnd = toMinutes(value.end);
    if (!value.absent && attendanceStart >= attendanceEnd) return "開始時間は終了時間より前にしてください。";

    for (const breakRange of value.breaks) {
      const breakStart = toMinutes(breakRange.start);
      const breakEnd = toMinutes(breakRange.end);
      if (breakStart >= breakEnd) return "中抜けの開始時間は終了時間より前にしてください。";
      if (breakStart < attendanceStart || breakEnd > attendanceEnd) return "中抜けは出席時間の中に収めてください。";
    }

    return "";
  }

  async function saveActualAttendance() {
    if (!detailMember || !draft) return;

    const validationError = getBreakValidationError(draft);
    if (validationError) {
      setEditMessage(validationError);
      return;
    }

    const savedState = await localState.saveAttendanceRecordPatch({
      practiceDayId: selectedDay.id,
      memberId: detailMember.id,
      start: draft.start,
      end: draft.end,
      breaks: draft.breaks,
      absent: draft.absent
    });

    if (!savedState) {
      setEditMessage("保存できていません。ネットワークまたはRedis/KV設定を確認してください。");
      return;
    }

    setEditMessage(draft.absent ? "欠席として保存しました。" : `${draft.start}〜${draft.end}で保存しました。`);
  }

  async function clearActualAttendance() {
    if (!detailMember) return;
    if (!confirm(`${getPracticeDayLabel(selectedDay)} の記録を取り消して未回答に戻しますか？`)) return;

    const savedState = await localState.saveAttendanceRecordPatch({
      practiceDayId: selectedDay.id,
      memberId: detailMember.id,
      start: "",
      end: "",
      breaks: [],
      absent: false,
      clear: true
    });

    if (!savedState) {
      setEditMessage("取り消せませんでした。ネットワークまたはRedis/KV設定を確認してください。");
      return;
    }

    setEditMessage("記録を取り消し、未回答に戻しました。");
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者専用・非公開ページ</p>
        <h1>実際の出欠記録</h1>
        <p className="muted">
          自己申告の「参加可能時間表」とは別に、練習日当日7:00（JST）以降に実際の出欠を記録できます。一般ユーザーやこの記録内容はどこからも公開されません。
        </p>
        <div className="grid">
          <label>
            表示する練習日
            <select value={selectedDay.id} onChange={(event) => localState.updateState({ selectedPracticeDayId: event.target.value })}>
              {sortedPracticeDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {formatPracticeDateLabel(day.practiceDate)} {formatPracticeTimeAndLocation(day)}
                </option>
              ))}
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
        <div className="row">
          <Link className="button secondary" href="/admin">
            管理トップへ
          </Link>
        </div>
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        <h2>{getPracticeDayLabel(selectedDay)} の実際の出欠</h2>

        {!isUnlocked ? (
          <div className="notice">
            この練習日はまだ当日7:00になっていないため、実際の出欠は記録できません。下表は参考として自己申告データを表示しています。
          </div>
        ) : !isSnapshotted ? (
          <div className="notice">記録を準備しています…（自己申告を初期値としてコピー中）</div>
        ) : (
          <div className="attendance-stat-row">
            <span className="attendance-stat-badge">
              <span className="attendance-dot attendance-dot-full" />
              {dayStatusCounts.full}
            </span>
            <span className="attendance-stat-badge">
              <span className="attendance-dot attendance-dot-partial" />
              {dayStatusCounts.partial}
            </span>
            <span className="attendance-stat-badge">
              <span className="attendance-dot attendance-dot-absent" />
              {dayStatusCounts.absent}
            </span>
            <span className="attendance-stat-badge">
              <span className="attendance-dot attendance-dot-unanswered" />
              {dayStatusCounts.unanswered}
            </span>
          </div>
        )}

        {hoveredSlot !== null ? (
          <div className="notice">
            {toTime(hoveredSlot)} 時点で実際に在席: {hoveredAvailableCount}人
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
                  >
                    {minutes % 60 === 0 ? `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00` : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => {
                const status = classifyMemberAttendanceForDay(selectedDay, member.id);
                const isAbsent = isMemberActualAbsent(selectedDay, member.id);

                return (
                  <tr key={member.id}>
                    <th>
                      <button
                        type="button"
                        className="availability-day-button"
                        onClick={() => setDetailMemberId(member.id)}
                        title={`${member.name} の実際の出欠を見る・記録する`}
                      >
                        <AttendanceStatusDot status={status} />
                        <span>{member.name}</span>
                        <span className="muted">{getInstrumentLabel(member.instrument)}</span>
                      </button>
                    </th>
                    {AVAILABILITY_SLOTS.map((minutes, index) => {
                      const previousMinutes = AVAILABILITY_SLOTS[index - 1];
                      const nextMinutes = AVAILABILITY_SLOTS[index + 1];
                      const isPractice = isPracticeSlot(minutes);
                      const isMemberAvailable = isMemberActualAvailableAtSlot(selectedDay, member.id, minutes);
                      const isPreviousPractice = previousMinutes !== undefined && isPracticeSlot(previousMinutes);
                      const isNextPractice = nextMinutes !== undefined && isPracticeSlot(nextMinutes);
                      const classNames = [
                        minutes % 60 === 0 ? "hour-divider-cell" : "",
                        isPractice ? "practice-window-cell" : "",
                        isPractice && !isPreviousPractice ? "practice-start-cell" : "",
                        isPractice && !isNextPractice ? "practice-end-cell" : "",
                        isPractice && isAbsent ? "absent-cell" : "",
                        isMemberAvailable ? "available-cell" : ""
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
          <span className="legend-chip available">緑: 実際に在席していた時間</span>
        </div>
      </section>

      {detailMember && draft ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label={`${detailMember.name} の実際の出欠`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setDetailMemberId(null);
          }}
        >
          <div className="modal-card">
            <div className="row page-section-head">
              <div>
                <p className="muted">奏者の実際の出欠・分析</p>
                <h2>{detailMember.name}</h2>
                <p className="muted">{getInstrumentLabel(detailMember.instrument)}</p>
              </div>
              <button type="button" className="secondary" onClick={() => setDetailMemberId(null)}>
                閉じる
              </button>
            </div>

            {detailStats ? (
              <section className="stack">
                <div className="grid">
                  <div className="attendance-rate-card">
                    <span className="metric-label">出席率（記録済みの日のみ）</span>
                    <strong>{detailStats.attendanceRate === null ? "―" : `${Math.round(detailStats.attendanceRate * 100)}%`}</strong>
                    <span className="metric-sub">記録済み {detailStats.recordedDayCount}日</span>
                  </div>
                  <div className="attendance-stat-row">
                    <span className="attendance-stat-badge" title={STATUS_LABEL.full}>
                      <span className="attendance-dot attendance-dot-full" />
                      {detailStats.fullCount}
                    </span>
                    <span className="attendance-stat-badge" title={STATUS_LABEL.partial}>
                      <span className="attendance-dot attendance-dot-partial" />
                      {detailStats.partialCount}
                    </span>
                    <span className="attendance-stat-badge" title={STATUS_LABEL.absent}>
                      <span className="attendance-dot attendance-dot-absent" />
                      {detailStats.absentCount}
                    </span>
                    <span className="attendance-stat-badge" title={STATUS_LABEL.unanswered}>
                      <span className="attendance-dot attendance-dot-unanswered" />
                      {detailStats.unansweredCount}
                    </span>
                  </div>
                </div>
                <p className="muted">
                  🟢{STATUS_LABEL.full} ／ 🟡{STATUS_LABEL.partial} ／ 🔴{STATUS_LABEL.absent} ／ ⚪{STATUS_LABEL.unanswered}
                </p>
              </section>
            ) : null}

            <section className="panel subtle-panel stack">
              <h3>{formatPracticeDateLabel(selectedDay.practiceDate)} の記録</h3>
              <p className="muted">練習時間 {formatPracticeTimeAndLocation(selectedDay)}</p>

              {!isUnlocked ? (
                <p className="muted">この練習日はまだ当日7:00になっていないため編集できません。</p>
              ) : (
                <>
                  {editMessage ? <div className="notice">{editMessage}</div> : null}
                  <label className="row">
                    <input
                      style={{ width: "auto" }}
                      type="checkbox"
                      checked={draft.absent}
                      onChange={(event) => updateDraft({ absent: event.target.checked })}
                    />
                    欠席
                  </label>

                  <div className="grid">
                    <label>
                      開始
                      <select value={draft.start} disabled={draft.absent} onChange={(event) => updateDraft({ start: event.target.value })}>
                        {timeOptions.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      終了
                      <select value={draft.end} disabled={draft.absent} onChange={(event) => updateDraft({ end: event.target.value })}>
                        {timeOptions.map((time) => (
                          <option key={time} value={time}>
                            {time}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <div className="break-list stack">
                    {draft.breaks.map((breakRange, index) => (
                      <div className="break-row" key={`break-${index}`}>
                        <label>
                          中抜け開始
                          <select
                            value={breakRange.start}
                            disabled={draft.absent}
                            onChange={(event) => updateBreak(index, { start: event.target.value })}
                          >
                            {timeOptions.map((time) => (
                              <option key={time} value={time}>
                                {time}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          中抜け終了
                          <select
                            value={breakRange.end}
                            disabled={draft.absent}
                            onChange={(event) => updateBreak(index, { end: event.target.value })}
                          >
                            {timeOptions.map((time) => (
                              <option key={time} value={time}>
                                {time}
                              </option>
                            ))}
                          </select>
                        </label>
                        <button type="button" className="secondary" onClick={() => removeBreak(index)} disabled={draft.absent}>
                          削除
                        </button>
                      </div>
                    ))}
                    <button type="button" className="secondary" onClick={addBreak} disabled={draft.absent}>
                      中抜けを追加
                    </button>
                  </div>

                  <div className="row">
                    <button type="button" onClick={saveActualAttendance} disabled={localState.saveStatus === "saving"}>
                      {localState.saveStatus === "saving" ? "保存中" : "この日の記録を保存"}
                    </button>
                    <button type="button" className="secondary" onClick={clearActualAttendance} disabled={localState.saveStatus === "saving"}>
                      記録を取り消す（未回答に戻す）
                    </button>
                  </div>
                </>
              )}
            </section>

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
                    const status = classifyMemberAttendanceForDay(day, detailMember.id);
                    const isAbsent = isMemberActualAbsent(day, detailMember.id);

                    return (
                      <tr key={day.id}>
                        <th>
                          <span className="row" style={{ gap: 8 }}>
                            <AttendanceStatusDot status={status} />
                            {formatPracticeDateLabel(day.practiceDate)}
                          </span>
                          <span className="muted">{status === null ? "未記録" : STATUS_LABEL[status]}</span>
                        </th>
                        {detailSlots.map((minutes, index) => {
                          const previousMinutes = detailSlots[index - 1];
                          const nextMinutes = detailSlots[index + 1];
                          const isPractice = isPracticeSlotForDay(day, minutes);
                          const isMemberAvailable = isMemberActualAvailableAtSlot(day, detailMember.id, minutes);
                          const isPreviousPractice = previousMinutes !== undefined && isPracticeSlotForDay(day, previousMinutes);
                          const isNextPractice = nextMinutes !== undefined && isPracticeSlotForDay(day, nextMinutes);
                          const classNames = [
                            minutes % 60 === 0 ? "hour-divider-cell" : "",
                            isPractice ? "practice-window-cell" : "",
                            isPractice && !isPreviousPractice ? "practice-start-cell" : "",
                            isPractice && !isNextPractice ? "practice-end-cell" : "",
                            isPractice && isAbsent ? "absent-cell" : "",
                            isMemberAvailable ? "available-cell" : ""
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
              <span className="legend-chip available">緑: 実際に在席していた時間</span>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
