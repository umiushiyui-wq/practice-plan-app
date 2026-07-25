"use client";

import { useState } from "react";
import {
  INSTRUMENT_OPTIONS,
  compareMembersByInstrument,
  formatPracticeDateLabel,
  getAvailableSegments,
  getInstrumentLabel,
  toMinutes,
  toTime
} from "@/components/LocalPracticeApp";
import type { LocalPracticeDay, Member } from "@/components/LocalPracticeApp";

type PartAttendanceSenderPanelProps = {
  selectedDay: LocalPracticeDay;
  members: Member[];
};

type SendStatus = "idle" | "sending" | "sent" | "error";

function formatDayTimeAndLocation(day: LocalPracticeDay) {
  const location = day.location.trim();
  return location ? `${day.startTime}〜${day.endTime} ＠${location}` : `${day.startTime}〜${day.endTime}`;
}

type AttendanceTone = "absent" | "partial" | "available" | "unanswered";

const TONE_STYLES: Record<AttendanceTone, { chip: string; text: string }> = {
  absent: { chip: "#ffe8e4", text: "#b3261e" },
  partial: { chip: "#fef3c7", text: "#92400e" },
  available: { chip: "#dcf5e3", text: "#1f7a33" },
  unanswered: { chip: "#e2e8f0", text: "#64748b" }
};

function getMemberAttendanceStatus(day: LocalPracticeDay, memberId: string) {
  const availability = day.availabilities.find((item) => item.memberId === memberId);
  const hasSaved = day.respondedMemberIds.includes(memberId);
  const isAbsent = hasSaved && day.absentMemberIds.includes(memberId);
  const segments = availability ? getAvailableSegments(availability) : [];
  const isLate = !!availability && toMinutes(availability.start) > toMinutes(day.startTime);
  const isEarlyLeave = !!availability && toMinutes(availability.end) < toMinutes(day.endTime);
  const hasBreak = segments.length > 1;
  const isPartial = !isAbsent && !!availability && (isLate || isEarlyLeave || hasBreak);

  const tone: AttendanceTone = isAbsent ? "absent" : isPartial ? "partial" : hasSaved ? "available" : "unanswered";
  const label = isAbsent
    ? "欠席"
    : availability
      ? segments.length > 0
        ? segments.map((segment) => `${toTime(segment.start)}〜${toTime(segment.end)}`).join("、")
        : `${availability.start}〜${availability.end}`
      : hasSaved
        ? "未入力"
        : "未回答";

  return { tone, label };
}

function createPartAttendanceImage(day: LocalPracticeDay, part: string, members: Member[]) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) throw new Error("JPEG画像を作成できません。");

  const width = 820;
  const headerHeight = 130;
  const rowHeight = 56;
  const bodyHeight = Math.max(1, members.length) * rowHeight;
  const height = headerHeight + bodyHeight + 40;

  canvas.width = width;
  canvas.height = height;

  context.fillStyle = "#f8fafc";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffffff";
  context.fillRect(32, 24, width - 64, height - 48);
  context.strokeStyle = "#cbd5e1";
  context.lineWidth = 2;
  context.strokeRect(32, 24, width - 64, height - 48);

  context.fillStyle = "#0f172a";
  context.font = "700 30px system-ui, sans-serif";
  context.fillText(`${formatPracticeDateLabel(day.practiceDate)} ${part}の出欠`, 56, 70);
  context.font = "18px system-ui, sans-serif";
  context.fillStyle = "#475569";
  context.fillText(formatDayTimeAndLocation(day), 56, 100);

  if (members.length === 0) {
    context.fillStyle = "#64748b";
    context.font = "20px system-ui, sans-serif";
    context.fillText("対象の奏者がいません。", 56, headerHeight + 40);
  }

  let rowTop = headerHeight;
  members.forEach((member, index) => {
    const { label, tone } = getMemberAttendanceStatus(day, member.id);
    const { chip: chipColor, text: chipTextColor } = TONE_STYLES[tone];

    context.fillStyle = index % 2 === 0 ? "#ffffff" : "#f7fafc";
    context.fillRect(56, rowTop, width - 112, rowHeight);
    context.strokeStyle = "#e2e8f0";
    context.strokeRect(56, rowTop, width - 112, rowHeight);

    context.fillStyle = "#0f172a";
    context.font = "700 22px system-ui, sans-serif";
    context.fillText(member.name, 76, rowTop + 34);

    context.font = "20px system-ui, sans-serif";
    const chipPaddingX = 16;
    const chipWidth = context.measureText(label).width + chipPaddingX * 2;
    const chipLeft = width - 76 - chipWidth;
    context.fillStyle = chipColor;
    context.fillRect(chipLeft, rowTop + 12, chipWidth, rowHeight - 24);
    context.fillStyle = chipTextColor;
    context.fillText(label, chipLeft + chipPaddingX, rowTop + 34);

    rowTop += rowHeight;
  });

  return canvas.toDataURL("image/jpeg", 0.92).replace(/^data:image\/jpeg;base64,/, "");
}

export function PartAttendanceSenderPanel({ selectedDay, members }: PartAttendanceSenderPanelProps) {
  const [status, setStatus] = useState<SendStatus>("idle");
  const [message, setMessage] = useState("");
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  async function runSend(isTest: boolean) {
    setIsConfirmOpen(false);
    setStatus("sending");
    setMessage("");

    const sortedMembers = [...members].sort(compareMembersByInstrument);
    const sentParts: string[] = [];
    const failedParts: Array<{ part: string; error: string }> = [];

    for (const part of INSTRUMENT_OPTIONS) {
      const partMembers = sortedMembers.filter((member) => getInstrumentLabel(member.instrument) === part);
      if (partMembers.length === 0) continue;

      try {
        const imageBase64 = createPartAttendanceImage(selectedDay, part, partMembers);
        const response = await fetch(`/api/local-state/practice-days/${selectedDay.id}/attendance-images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ part, imageBase64, isTest })
        });

        if (response.ok) {
          sentParts.push(part);
        } else {
          const payload = (await response.json().catch(() => null)) as { error?: string } | null;
          failedParts.push({ part, error: payload?.error ?? `HTTP ${response.status}` });
        }
      } catch (error) {
        failedParts.push({ part, error: error instanceof Error ? error.message : "network_error" });
      }
    }

    const prefix = isTest ? "テスト送信: " : "";

    if (failedParts.length > 0) {
      setStatus("error");
      const details = failedParts.map(({ part, error }) => `${part}(${error})`).join("、");
      setMessage(`${prefix}送信 ${sentParts.length}パート / 失敗 ${failedParts.length}パート: ${details}`);
    } else {
      setStatus("sent");
      setMessage(
        sentParts.length > 0 ? `${prefix}送信しました: ${sentParts.join("、")}` : "対象の奏者がいるパートがありません。"
      );
    }
  }

  return (
    <>
      <button
        className="slack-reminder-button"
        type="button"
        onClick={() => setIsConfirmOpen(true)}
        disabled={status === "sending"}
      >
        {status === "sending" ? "送信中" : "パート別に出欠画像を送る"}
      </button>
      {message ? (
        <div className={status === "error" ? "error" : "notice"} style={{ flexBasis: "100%" }}>
          {message}
        </div>
      ) : null}

      {isConfirmOpen ? (
        <div
          className="modal-overlay"
          role="dialog"
          aria-modal="true"
          aria-label="出欠画像の送信確認"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsConfirmOpen(false);
          }}
        >
          <div className="modal-card stack">
            <h2>出欠画像を送信しますか？</h2>
            <p className="muted">
              各パートのSlackチャンネルに出欠画像を送信します。テスト送信を選ぶと、全パートの画像をテスト用チャンネルにまとめて送ります。
            </p>
            <div className="row">
              <button type="button" onClick={() => runSend(false)}>
                OK（各パートに送信）
              </button>
              <button type="button" className="secondary" onClick={() => runSend(true)}>
                テスト送信
              </button>
              <button type="button" className="secondary" onClick={() => setIsConfirmOpen(false)}>
                キャンセル
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
