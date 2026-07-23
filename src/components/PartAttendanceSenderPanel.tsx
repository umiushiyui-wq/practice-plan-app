"use client";

import { useState } from "react";
import {
  INSTRUMENT_OPTIONS,
  compareMembersByInstrument,
  formatPracticeDateLabel,
  getInstrumentLabel
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

function getMemberAttendanceStatus(day: LocalPracticeDay, memberId: string) {
  const availability = day.availabilities.find((item) => item.memberId === memberId);
  const hasSaved = day.respondedMemberIds.includes(memberId);
  const isAbsent = hasSaved && day.absentMemberIds.includes(memberId);
  const label = isAbsent
    ? "欠席"
    : availability
      ? availability.breaks.length > 0
        ? `${availability.start}〜${availability.end} / 中抜け ${availability.breaks.length}件`
        : `${availability.start}〜${availability.end}`
      : hasSaved
        ? "未入力"
        : "未回答";

  return { hasSaved, isAbsent, label };
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
    const { label, isAbsent, hasSaved } = getMemberAttendanceStatus(day, member.id);
    const textColor = isAbsent ? "#b3261e" : hasSaved ? "#0f172a" : "#64748b";
    const chipColor = isAbsent ? "#ffe8e4" : hasSaved ? "#58b86b" : "#e2e8f0";
    const chipTextColor = hasSaved && !isAbsent ? "#ffffff" : textColor;

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

  async function sendPartAttendanceImages() {
    if (!confirm("各パートのSlackチャンネルに出欠画像を送信しますか？")) return;

    setStatus("sending");
    setMessage("");

    const sortedMembers = [...members].sort(compareMembersByInstrument);
    const sentParts: string[] = [];
    const failedParts: string[] = [];

    for (const part of INSTRUMENT_OPTIONS) {
      const partMembers = sortedMembers.filter((member) => getInstrumentLabel(member.instrument) === part);
      if (partMembers.length === 0) continue;

      try {
        const imageBase64 = createPartAttendanceImage(selectedDay, part, partMembers);
        const response = await fetch(`/api/local-state/practice-days/${selectedDay.id}/attendance-images`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ part, imageBase64 })
        });

        if (response.ok) {
          sentParts.push(part);
        } else {
          failedParts.push(part);
        }
      } catch {
        failedParts.push(part);
      }
    }

    if (failedParts.length > 0) {
      setStatus("error");
      setMessage(`送信 ${sentParts.length}パート / 失敗 ${failedParts.length}パート（${failedParts.join("、")}）`);
    } else {
      setStatus("sent");
      setMessage(sentParts.length > 0 ? `送信しました: ${sentParts.join("、")}` : "対象の奏者がいるパートがありません。");
    }
  }

  return (
    <>
      <button className="slack-reminder-button" type="button" onClick={sendPartAttendanceImages} disabled={status === "sending"}>
        {status === "sending" ? "送信中" : "パート別に出欠画像を送る"}
      </button>
      {message ? (
        <div className={status === "error" ? "error" : "notice"} style={{ flexBasis: "100%" }}>
          {message}
        </div>
      ) : null}
    </>
  );
}
