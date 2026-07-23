"use client";

import Link from "next/link";
import { useState, type ChangeEvent } from "react";
import {
  generatePracticePlan,
  getPlanSlotLabel,
  formatPracticeDateLabel,
  getPracticeDayLabel,
  getSelectedPracticeDay,
  getSortedPracticeDays,
  isAvailable,
  LocalStateStatusPanel,
  makeId,
  sortPlanByTime,
  toMinutes,
  toTime,
  updatePracticeDay,
  useLocalPracticeState,
  usePieceMap,
  type PlanSlot
} from "@/components/LocalPracticeApp";

type UtilitySlotKind = "break" | "setup" | "cleanup";

const MIN_SLOT_MINUTES = 1;
const DEFAULT_PIECE_MINUTES = 30;

const UTILITY_SLOT_TEMPLATES: Array<{
  kind: UtilitySlotKind;
  label: string;
  defaultMinutes: number;
  reason: string;
}> = [
  { kind: "setup", label: "合奏準備", defaultMinutes: 45, reason: "合奏準備として手動追加した枠です。" },
  { kind: "break", label: "休憩", defaultMinutes: 10, reason: "休憩として手動追加した枠です。" },
  { kind: "cleanup", label: "片付け", defaultMinutes: 45, reason: "片付けとして手動追加した枠です。" }
];

function formatMinutesLabel(minutes: number) {
  const safeMinutes = Math.max(0, minutes);
  const hours = Math.floor(safeMinutes / 60);
  const rest = safeMinutes % 60;

  if (hours === 0) return `${rest}分`;
  if (rest === 0) return `${hours}時間`;
  return `${hours}時間${rest}分`;
}

function formatDurationClock(minutes: number) {
  const safeMinutes = Math.max(0, Math.floor(minutes));
  return `${Math.floor(safeMinutes / 60)}:${String(safeMinutes % 60).padStart(2, "0")}`;
}

function normalizeDuration(value: number, fallback = MIN_SLOT_MINUTES) {
  return Number.isFinite(value) ? Math.max(MIN_SLOT_MINUTES, Math.floor(value)) : fallback;
}

function formatPracticeTimeAndLocation(day: { startTime: string; endTime: string; location: string }) {
  const location = day.location.trim();
  return location ? `${day.startTime}〜${day.endTime} ＠${location}` : `${day.startTime}〜${day.endTime}`;
}

function getUtilityTemplate(kind: UtilitySlotKind) {
  return UTILITY_SLOT_TEMPLATES.find((template) => template.kind === kind) ?? UTILITY_SLOT_TEMPLATES[0];
}

function isCleanupSlot(slot: PlanSlot) {
  if (slot.pieceId) return false;
  return Boolean(slot.reason?.includes("片付け") || slot.customTitle?.includes("片付け"));
}

function getSlotVariant(slot: Pick<PlanSlot, "pieceId" | "customTitle" | "reason">) {
  if (slot.pieceId) return "piece";
  const text = `${slot.customTitle ?? ""} ${slot.reason ?? ""}`;
  if (text.includes("準備")) return "setup";
  if (text.includes("片付け")) return "cleanup";
  if (text.includes("休憩")) return "break";
  return "custom";
}

function reflowPlanSlots(plan: PlanSlot[], startTime: string) {
  let cursor = toMinutes(startTime);

  return plan.map((slot) => {
    const duration = normalizeDuration(slot.duration);
    const start = cursor;
    const end = start + duration;
    cursor = end;

    return {
      ...slot,
      start: toTime(start),
      end: toTime(end),
      duration
    };
  });
}

export function AdminApp() {
  const localState = useLocalPracticeState();
  const { state, updateState } = localState;
  const [planMessage, setPlanMessage] = useState("");
  const [isSendingAnnouncement, setIsSendingAnnouncement] = useState(false);
  const selectedDay = getSelectedPracticeDay(state);
  const sortedPracticeDays = getSortedPracticeDays(state.practiceDays);
  const pieceMap = usePieceMap(state.pieces);

  const practiceStartMinutes = toMinutes(selectedDay.startTime);
  const practiceEndMinutes = toMinutes(selectedDay.endTime);
  const practiceMinutes = Math.max(0, practiceEndMinutes - practiceStartMinutes);
  const tablePlan = reflowPlanSlots(sortPlanByTime(selectedDay.plan), selectedDay.startTime);
  const plannedMinutes = tablePlan.reduce((total, slot) => total + slot.duration, 0);
  const remainingMinutes = Math.max(0, practiceMinutes - plannedMinutes);
  const overflowMinutes = Math.max(0, plannedMinutes - practiceMinutes);
  const calculatedEndMinutes = practiceStartMinutes + plannedMinutes;
  const coverageRatio = practiceMinutes > 0 ? Math.min(1, plannedMinutes / practiceMinutes) : 0;

  function updateSelectedDay(patch: Partial<typeof selectedDay>) {
    updateState({ practiceDays: updatePracticeDay(state, selectedDay.id, patch) });
  }

  function updatePlan(plan: PlanSlot[]) {
    updateSelectedDay({ plan: reflowPlanSlots(plan, selectedDay.startTime) });
  }

  function updateSlot(
    slotId: string,
    patch: Partial<Pick<PlanSlot, "pieceId" | "customTitle" | "reason" | "isLocked" | "duration">>
  ) {
    updatePlan(
      tablePlan.map((slot) =>
        slot.id === slotId
          ? {
              ...slot,
              ...patch,
              reason: patch.reason ?? slot.reason
            }
          : slot
      )
    );
  }

  function getSlotLabel(slot: PlanSlot) {
    return getPlanSlotLabel(slot, slot.pieceId ? pieceMap.get(slot.pieceId)?.title : undefined);
  }

  function getSlotContentValue(slot: PlanSlot) {
    if (slot.pieceId) return `piece:${slot.pieceId}`;
    const text = `${slot.customTitle ?? ""} ${slot.reason ?? ""}`;
    if (text.includes("準備")) return "utility:setup";
    if (text.includes("片付け")) return "utility:cleanup";
    if (text.includes("休憩")) return "utility:break";
    return "custom";
  }

  function updateSlotContent(slotId: string, value: string) {
    if (value.startsWith("piece:")) {
      const pieceId = value.replace("piece:", "");
      const piece = pieceMap.get(pieceId);
      updateSlot(slotId, {
        pieceId,
        customTitle: piece?.title ?? "",
        reason: piece ? `${piece.title} を手動選択した行です。` : ""
      });
      return;
    }

    if (value.startsWith("utility:")) {
      const utilityKind = value.replace("utility:", "") as UtilitySlotKind;
      const template = getUtilityTemplate(utilityKind);
      updateSlot(slotId, {
        pieceId: null,
        customTitle: template.label,
        reason: template.reason,
        duration: template.defaultMinutes
      });
      return;
    }

    updateSlot(slotId, {
      pieceId: null,
      reason: "自由入力した練習内容です。"
    });
  }

  function updateSlotDuration(slotId: string, rawValue: string) {
    if (!rawValue.trim()) return;
    const nextDuration = Number(rawValue);
    if (!Number.isFinite(nextDuration) || nextDuration < MIN_SLOT_MINUTES) return;
    updateSlot(slotId, { duration: normalizeDuration(nextDuration) });
  }

  function deleteSlot(slotId: string) {
    updatePlan(tablePlan.filter((slot) => slot.id !== slotId));
  }

  function moveSlot(slotId: string, direction: -1 | 1) {
    const currentIndex = tablePlan.findIndex((slot) => slot.id === slotId);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= tablePlan.length) return;

    const nextPlan = [...tablePlan];
    [nextPlan[currentIndex], nextPlan[nextIndex]] = [nextPlan[nextIndex], nextPlan[currentIndex]];
    updatePlan(nextPlan);
  }

  function insertBeforeCleanup(slot: PlanSlot) {
    const nextPlan = [...tablePlan];
    const cleanupIndex = nextPlan.findIndex(isCleanupSlot);
    nextPlan.splice(cleanupIndex >= 0 ? cleanupIndex : nextPlan.length, 0, slot);
    updatePlan(nextPlan);
  }

  function addPieceRow() {
    const firstPiece = state.pieces[0] ?? null;
    const availableMinutes = Math.max(MIN_SLOT_MINUTES, practiceMinutes - plannedMinutes);
    const duration = Math.min(DEFAULT_PIECE_MINUTES, availableMinutes);
    const nextSlot: PlanSlot = {
      id: makeId("s"),
      pieceId: firstPiece?.id ?? null,
      customTitle: firstPiece?.title ?? "",
      start: selectedDay.startTime,
      end: selectedDay.startTime,
      duration,
      reason: firstPiece ? `${firstPiece.title} を手動追加した行です。` : "自由入力した練習内容です。"
    };

    insertBeforeCleanup(nextSlot);
    setPlanMessage("練習内容の行を追加しました。曲名は選択または自由入力できます。");
  }

  function addBreakRow() {
    const template = getUtilityTemplate("break");
    insertBeforeCleanup({
      id: makeId("s"),
      pieceId: null,
      customTitle: template.label,
      start: selectedDay.startTime,
      end: selectedDay.startTime,
      duration: template.defaultMinutes,
      reason: template.reason
    });
    setPlanMessage("休憩の行を追加しました。");
  }

  function handleGeneratePlan() {
    const generatedPlan = generatePracticePlan(state);
    updateSelectedDay({ plan: reflowPlanSlots(generatedPlan, selectedDay.startTime) });

    if (generatedPlan.length > 0) {
      setPlanMessage(`${generatedPlan.length} 行の計画を自動生成しました。表の練習時間から調整できます。`);
      return;
    }

    setPlanMessage("自動生成できませんでした。曲設定、回答状況、参加可能時間を確認してください。");
  }

  function createPlanAnnouncementImage(day: typeof selectedDay) {
    const canvas = document.createElement("canvas");
    const rows = reflowPlanSlots(sortPlanByTime(day.plan), day.startTime);
    const width = 1200;
    const headerHeight = 170;
    const tableHeaderHeight = 52;
    const minRowHeight = 72;
    const lineHeight = 30;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("JPEG画像を作成できません。");
    const measureContext = context;

    const tableLeft = 82;
    const tableTop = headerHeight;
    const tableWidth = width - 164;
    const startColumnWidth = 180;
    const durationColumnWidth = 160;
    const contentLeft = tableLeft + startColumnWidth;
    const durationLeft = tableLeft + tableWidth - durationColumnWidth;
    const contentWidth = durationLeft - contentLeft - 48;

    function wrapText(value: string, maxWidth: number) {
      measureContext.font = "24px system-ui, sans-serif";
      const paragraphs = value.split(/\r?\n/);
      const lines: string[] = [];

      for (const paragraph of paragraphs) {
        let line = "";
        for (const character of Array.from(paragraph || " ")) {
          const nextLine = line + character;
          if (line && measureContext.measureText(nextLine).width > maxWidth) {
            lines.push(line);
            line = character;
          } else {
            line = nextLine;
          }
        }
        lines.push(line);
      }

      return lines;
    }

    const printableRows = rows.map((slot) => {
      const piece = slot.pieceId ? pieceMap.get(slot.pieceId) : null;
      const label = getPlanSlotLabel(slot, piece?.title).trim();
      const wrappedLines = wrapText(label, contentWidth);
      return {
        slot,
        wrappedLines,
        rowHeight: Math.max(minRowHeight, 30 + wrappedLines.length * lineHeight)
      };
    });
    const bodyHeight = printableRows.reduce((total, row) => total + row.rowHeight, rows.length === 0 ? minRowHeight : 0);
    const height = Math.max(360, tableTop + tableHeaderHeight + bodyHeight + 56);

    canvas.width = width;
    canvas.height = height;
    context.fillStyle = "#f8fafc";
    context.fillRect(0, 0, width, height);
    context.fillStyle = "#ffffff";
    context.fillRect(48, 40, width - 96, height - 80);
    context.strokeStyle = "#cbd5e1";
    context.lineWidth = 2;
    context.strokeRect(48, 40, width - 96, height - 80);

    context.fillStyle = "#0f172a";
    context.font = "700 40px system-ui, sans-serif";
    context.fillText(`${formatPracticeDateLabel(day.practiceDate)} の練習内容`, 82, 98);
    context.font = "24px system-ui, sans-serif";
    context.fillStyle = "#475569";
    context.fillText(formatPracticeTimeAndLocation(day), 82, 138);

    context.fillStyle = "#dfe8ef";
    context.fillRect(tableLeft, tableTop, tableWidth, tableHeaderHeight);
    context.strokeStyle = "#aebdca";
    context.strokeRect(tableLeft, tableTop, tableWidth, tableHeaderHeight);
    context.fillStyle = "#334155";
    context.font = "700 22px system-ui, sans-serif";
    context.fillText("開始時刻", tableLeft + 24, tableTop + 34);
    context.fillText("曲・内容", contentLeft + 24, tableTop + 34);
    context.fillText("練習時間", durationLeft + 24, tableTop + 34);

    context.strokeStyle = "#aebdca";
    context.beginPath();
    context.moveTo(contentLeft, tableTop);
    context.lineTo(contentLeft, height - 56);
    context.moveTo(durationLeft, tableTop);
    context.lineTo(durationLeft, height - 56);
    context.stroke();

    if (rows.length === 0) {
      context.fillStyle = "#64748b";
      context.font = "24px system-ui, sans-serif";
      context.fillText("まだ練習計画がありません。", tableLeft + 24, tableTop + tableHeaderHeight + 46);
    }

    let rowTop = tableTop + tableHeaderHeight;
    printableRows.forEach(({ slot, wrappedLines, rowHeight }, index) => {
      context.fillStyle = index % 2 === 0 ? "#ffffff" : "#f7fafc";
      context.fillRect(tableLeft, rowTop, tableWidth, rowHeight);
      context.strokeStyle = "#c5d0da";
      context.strokeRect(tableLeft, rowTop, tableWidth, rowHeight);
      context.beginPath();
      context.moveTo(contentLeft, rowTop);
      context.lineTo(contentLeft, rowTop + rowHeight);
      context.moveTo(durationLeft, rowTop);
      context.lineTo(durationLeft, rowTop + rowHeight);
      context.stroke();

      context.fillStyle = "#0f172a";
      context.font = "700 24px system-ui, sans-serif";
      context.fillText(slot.start, tableLeft + 24, rowTop + 44);
      context.font = "24px system-ui, sans-serif";
      wrappedLines.forEach((line, lineIndex) => {
        context.fillText(line, contentLeft + 24, rowTop + 38 + lineIndex * lineHeight);
      });
      context.font = "700 24px system-ui, sans-serif";
      context.fillText(formatDurationClock(slot.duration), durationLeft + 24, rowTop + 44);
      rowTop += rowHeight;
    });

    return canvas.toDataURL("image/jpeg", 0.92).replace(/^data:image\/jpeg;base64,/, "");
  }

  async function sendPublishAnnouncement(day: typeof selectedDay) {
    setIsSendingAnnouncement(true);
    setPlanMessage("送信中です。");

    try {
      const imageBase64 = createPlanAnnouncementImage(day);
      const response = await fetch(`/api/local-state/practice-days/${day.id}/plan-announcement`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageBase64 })
      });
      const payload = (await response.json().catch(() => null)) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error ?? "Slackアナウンスを送信できませんでした。");
      setPlanMessage("Slackに練習内容を送信しました。");
    } catch (error) {
      setPlanMessage(error instanceof Error ? error.message : "Slackアナウンスを送信できませんでした。");
    } finally {
      setIsSendingAnnouncement(false);
    }
  }

  function handlePublishToggle(event: ChangeEvent<HTMLInputElement>) {
    const nextPublished = event.target.checked;
    const normalizedDay = { ...selectedDay, plan: tablePlan, isPlanPublished: nextPublished };
    updateSelectedDay({ isPlanPublished: nextPublished, plan: tablePlan });

    if (!nextPublished) return;

    setPlanMessage("");
    if (confirm("スケジュール公開をアナウンスしますか？")) {
      void sendPublishAnnouncement(normalizedDay);
    } else {
      setPlanMessage("公開のみ行いました。");
    }
  }

  function handleSavePlanImage() {
    if (tablePlan.length === 0) {
      setPlanMessage("保存できる練習計画がありません。先に行を追加してください。");
      return;
    }

    const imageBase64 = createPlanAnnouncementImage({ ...selectedDay, plan: tablePlan });
    const link = document.createElement("a");
    link.href = `data:image/jpeg;base64,${imageBase64}`;
    link.download = `練習計画_${selectedDay.practiceDate}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setPlanMessage("Slackに公開される練習計画の画像を保存しました。");
  }

  function getPieceToneClass(pieceId: string | null) {
    if (!pieceId) return "";
    const pieceIndex = state.pieces.findIndex((piece) => piece.id === pieceId);
    return `plan-tone-${Math.max(0, pieceIndex) % 6}`;
  }

  function getSlotAttendanceCount(slot: PlanSlot) {
    if (!slot.pieceId) return null;
    const piece = pieceMap.get(slot.pieceId);
    if (!piece) return null;

    const memberIds = Array.from(new Set([piece.conductorId, ...piece.memberIds].filter(Boolean)));
    const absentMemberIds = new Set(selectedDay.absentMemberIds);
    const start = toMinutes(slot.start);
    return memberIds.filter(
      (memberId) => !absentMemberIds.has(memberId) && isAvailable(selectedDay.availabilities, memberId, start, start + 1)
    ).length;
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">練習計画ページ</p>
        <h1>練習計画の編集</h1>
        <p>開始時刻は練習時間から自動計算されます。右側の分数を入力し、上から順番に計画を組み立ててください。</p>
        <div className="row">
          <Link className="button" href="/admin/setup">
            準備ページへ
          </Link>
          <Link className="button secondary" href="/admin/setup#practice-days">
            練習日の追加
          </Link>
          <Link className="button secondary" href="/admin/setup#members">
            奏者の追加
          </Link>
          <Link className="button secondary" href="/admin/setup#pieces">
            曲の追加
          </Link>
          <Link className="button secondary" href="/availability">
            可否一覧へ
          </Link>
          <Link className="button secondary" href="/color-map">
            カラーマップへ
          </Link>
          <Link className="button secondary" href="/sheet">
            表で見る
          </Link>
        </div>
        {planMessage ? <div className="notice">{planMessage}</div> : null}
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">Step 1</p>
            <h2>対象の練習日を選ぶ</h2>
          </div>
          <label className="compact-field">
            練習日
            <select
              value={selectedDay.id}
              onChange={(event) => updateState({ selectedPracticeDayId: event.target.value })}
            >
              {sortedPracticeDays.map((day) => (
                <option key={day.id} value={day.id}>
                  {formatPracticeDateLabel(day.practiceDate)} {formatPracticeTimeAndLocation(day)}
                </option>
              ))}
            </select>
          </label>
          <label className="plan-publish-switch">
            <input
              type="checkbox"
              checked={selectedDay.isPlanPublished}
              disabled={isSendingAnnouncement}
              onChange={handlePublishToggle}
            />
            <span className="plan-publish-switch-control" aria-hidden="true" />
            <span>練習スケジュールを{selectedDay.isPlanPublished ? "公開中" : "非公開"}</span>
            {isSendingAnnouncement ? <span className="muted">送信中</span> : null}
          </label>
        </div>
      </section>

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">Step 2</p>
            <h2>{getPracticeDayLabel(selectedDay)} の練習計画を作る</h2>
          </div>
          <div className="row">
            <span className="plan-day-range">
              {selectedDay.startTime} - {selectedDay.endTime}
            </span>
            <button type="button" onClick={handleGeneratePlan}>
              この練習日で自動生成
            </button>
            <button type="button" className="secondary" onClick={handleSavePlanImage}>
              スクショ保存
            </button>
          </div>
        </div>

        <div className={`plan-progress-card${overflowMinutes > 0 ? " is-overflow" : ""}`}>
          <div className="plan-progress-header">
            <strong>練習時間の配分</strong>
            <span className={overflowMinutes > 0 ? "plan-overflow-text" : "muted"}>
              {overflowMinutes > 0
                ? `${formatMinutesLabel(overflowMinutes)}オーバー`
                : remainingMinutes > 0
                  ? `あと${formatMinutesLabel(remainingMinutes)}`
                  : "終了時刻にぴったりです"}
            </span>
          </div>
          <div className="plan-progress-track" aria-hidden="true">
            <div className="plan-progress-fill" style={{ width: `${coverageRatio * 100}%` }} />
          </div>
          <div className="plan-progress-meta muted">
            計画 {formatMinutesLabel(plannedMinutes)} / 練習可能 {formatMinutesLabel(practiceMinutes)} / 終了予定{" "}
            {toTime(calculatedEndMinutes)}
          </div>
        </div>

        {overflowMinutes > 0 ? (
          <div className="plan-time-warning" role="alert">
            <strong>練習時間を超えています。</strong>
            <span>
              終了予定は {toTime(calculatedEndMinutes)} です。設定された終了時刻 {selectedDay.endTime} より{" "}
              {formatMinutesLabel(overflowMinutes)}短くなるよう、右側の練習時間を調整してください。
            </span>
          </div>
        ) : null}

        <div className="plan-schedule-card">
          <div className="plan-schedule-head">
            <div>
              <strong>時刻表</strong>
              <p className="muted">曲名欄はリストから選択でき、そのまま自由な文字にも書き換えられます。</p>
            </div>
            <div className="row plan-row-add-actions">
              <button type="button" onClick={addPieceRow}>
                ＋ 練習内容を追加
              </button>
              <button type="button" className="secondary" onClick={addBreakRow}>
                ＋ 休憩を追加
              </button>
            </div>
          </div>

          <div className="plan-schedule-table-shell">
            <table className="plan-schedule-table">
              <thead>
                <tr>
                  <th scope="col">開始時刻</th>
                  <th scope="col">曲・内容</th>
                  <th scope="col">練習時間</th>
                  <th scope="col" aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {tablePlan.length === 0 ? (
                  <tr>
                    <td className="plan-table-empty" colSpan={4}>
                      まだ計画がありません。「練習内容を追加」または「自動生成」から始めてください。
                    </td>
                  </tr>
                ) : (
                  tablePlan.map((slot, index) => {
                    const slotLabel = getSlotLabel(slot);
                    const slotVariant = getSlotVariant(slot);
                    const attendanceCount = getSlotAttendanceCount(slot);
                    const rowOverflows = toMinutes(slot.end) > practiceEndMinutes;

                    return (
                      <tr className={rowOverflows ? "plan-row-overflow" : ""} key={slot.id}>
                        <td className="plan-start-time-cell">
                          <strong>{slot.start}</strong>
                          <span>{rowOverflows ? "時間外" : `〜 ${slot.end}`}</span>
                        </td>
                        <td>
                          <div
                            className={`plan-entry-field plan-slot-${slotVariant} ${getPieceToneClass(slot.pieceId)}`}
                          >
                            <input
                              type="text"
                              aria-label={`${slot.start}の曲名・内容`}
                              placeholder="曲名・内容を入力"
                              value={slot.customTitle ?? slotLabel}
                              onChange={(event) => updateSlot(slot.id, { customTitle: event.target.value })}
                            />
                            <select
                              aria-label={`${slot.start}の曲・内容をリストから選択`}
                              title="曲・内容を選択"
                              value={getSlotContentValue(slot)}
                              onChange={(event) => updateSlotContent(slot.id, event.target.value)}
                            >
                              <option value="custom">自由入力</option>
                              {UTILITY_SLOT_TEMPLATES.map((template) => (
                                <option key={template.kind} value={`utility:${template.kind}`}>
                                  {template.label}
                                </option>
                              ))}
                              {state.pieces.map((piece) => (
                                <option key={piece.id} value={`piece:${piece.id}`}>
                                  {piece.title}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="plan-row-meta">
                            {attendanceCount !== null ? <span>参加可能 {attendanceCount}人</span> : <span>自由入力・休憩</span>}
                            <label>
                              <input
                                type="checkbox"
                                checked={!!slot.isLocked}
                                onChange={() => updateSlot(slot.id, { isLocked: !slot.isLocked })}
                              />
                              固定
                            </label>
                          </div>
                        </td>
                        <td>
                          <div className="plan-duration-control">
                            <input
                              type="number"
                              min={MIN_SLOT_MINUTES}
                              step={5}
                              inputMode="numeric"
                              aria-label={`${slotLabel}の練習時間（分）`}
                              value={slot.duration}
                              onChange={(event) => updateSlotDuration(slot.id, event.target.value)}
                            />
                            <span>分</span>
                            <small>{formatDurationClock(slot.duration)}</small>
                          </div>
                        </td>
                        <td>
                          <div className="plan-row-actions">
                            <button
                              type="button"
                              className="secondary"
                              aria-label={`${slotLabel}を上へ移動`}
                              title="上へ"
                              disabled={index === 0}
                              onClick={() => moveSlot(slot.id, -1)}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="secondary"
                              aria-label={`${slotLabel}を下へ移動`}
                              title="下へ"
                              disabled={index === tablePlan.length - 1}
                              onClick={() => moveSlot(slot.id, 1)}
                            >
                              ↓
                            </button>
                            <button
                              type="button"
                              className="danger"
                              aria-label={`${slotLabel}を削除`}
                              title="削除"
                              onClick={() => deleteSlot(slot.id)}
                            >
                              ×
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
              <tfoot>
                <tr className={overflowMinutes > 0 ? "plan-row-overflow" : ""}>
                  <th scope="row">{toTime(calculatedEndMinutes)}</th>
                  <td>
                    <strong>終了予定</strong>
                    <span className="muted">設定上の終了 {selectedDay.endTime}</span>
                  </td>
                  <td>
                    <strong>{formatDurationClock(plannedMinutes)}</strong>
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </section>
    </main>
  );
}
