"use client";

import { useState } from "react";
import { formatPracticeDateLabel, toMinutes } from "@/components/LocalPracticeApp";
import type { AvailabilityBreak, AvailabilityPatch, LocalPracticeDay, Member } from "@/components/LocalPracticeApp";

type AttendanceMode = "present" | "absent" | "unanswered";

type Props = {
  day: LocalPracticeDay;
  member: Member;
  onSave: (patch: AvailabilityPatch) => Promise<unknown>;
};

function getInitialMode(day: LocalPracticeDay, memberId: string): AttendanceMode {
  if (!day.respondedMemberIds.includes(memberId)) return "unanswered";
  return day.absentMemberIds.includes(memberId) ? "absent" : "present";
}

function validate(start: string, end: string, breaks: AvailabilityBreak[]) {
  if (!start || !end || toMinutes(start) >= toMinutes(end)) return "参加時間の終了は開始より後にしてください。";
  const sorted = [...breaks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  let previousEnd = toMinutes(start);
  for (const item of sorted) {
    if (!item.start || !item.end || toMinutes(item.start) >= toMinutes(item.end)) return "中抜けの終了は開始より後にしてください。";
    if (toMinutes(item.start) < previousEnd || toMinutes(item.end) > toMinutes(end)) {
      return "中抜けは参加時間の中に、重ならないように入れてください。";
    }
    previousEnd = toMinutes(item.end);
  }
  return "";
}

// 管理者が奏者の代わりに出欠を入力する（非公開の練習日や、アプリを使えない人の代理入力用）。
// 奏者ページと同じ出欠APIで保存するので、変更履歴にも残る。
export function AdminAvailabilityEditor({ day, member, onSave }: Props) {
  const saved = day.availabilities.find((item) => item.memberId === member.id);
  const [mode, setMode] = useState<AttendanceMode>(() => getInitialMode(day, member.id));
  const [start, setStart] = useState(saved?.start ?? day.startTime);
  const [end, setEnd] = useState(saved?.end ?? day.endTime);
  const [breaks, setBreaks] = useState<AvailabilityBreak[]>(saved?.breaks ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "notice" | "error"; text: string } | null>(null);

  async function save() {
    if (mode === "present") {
      const error = validate(start, end, breaks);
      if (error) {
        setMessage({ kind: "error", text: error });
        return;
      }
    }

    setIsSaving(true);
    setMessage(null);
    const patch: AvailabilityPatch =
      mode === "unanswered"
        ? { practiceDayId: day.id, memberId: member.id, start: "", end: "", breaks: [], absent: false, clear: true }
        : mode === "absent"
          ? { practiceDayId: day.id, memberId: member.id, start: "", end: "", breaks: [], absent: true }
          : { practiceDayId: day.id, memberId: member.id, start, end, breaks, absent: false };
    const result = await onSave(patch);
    setIsSaving(false);
    setMessage(result ? { kind: "notice", text: "保存しました。" } : { kind: "error", text: "保存できませんでした。" });
  }

  return (
    <section className="stack admin-availability-editor">
      <h3>
        {formatPracticeDateLabel(day.practiceDate)}（{day.startTime}〜{day.endTime}）の出欠を編集
      </h3>
      <div className="row" role="radiogroup" aria-label="出欠">
        {(
          [
            ["present", "出席"],
            ["absent", "欠席"],
            ["unanswered", "未回答に戻す"]
          ] as const
        ).map(([value, label]) => (
          <label className="row" key={value}>
            <input
              type="radio"
              style={{ width: "auto" }}
              name={`admin-attendance-${member.id}`}
              checked={mode === value}
              onChange={() => setMode(value)}
            />
            {label}
          </label>
        ))}
      </div>

      {mode === "present" ? (
        <>
          <div className="date-time-grid">
            <label>
              参加開始
              <input type="time" step="300" value={start} onChange={(event) => setStart(event.target.value)} />
            </label>
            <label>
              参加終了
              <input type="time" step="300" value={end} onChange={(event) => setEnd(event.target.value)} />
            </label>
          </div>
          {breaks.map((item, index) => (
            <div className="row" key={index}>
              <span className="muted">中抜け</span>
              <input
                type="time"
                step="300"
                style={{ width: "auto" }}
                value={item.start}
                aria-label="中抜けの開始"
                onChange={(event) =>
                  setBreaks((current) => current.map((entry, i) => (i === index ? { ...entry, start: event.target.value } : entry)))
                }
              />
              〜
              <input
                type="time"
                step="300"
                style={{ width: "auto" }}
                value={item.end}
                aria-label="中抜けの終了"
                onChange={(event) =>
                  setBreaks((current) => current.map((entry, i) => (i === index ? { ...entry, end: event.target.value } : entry)))
                }
              />
              <button
                className="secondary"
                type="button"
                onClick={() => setBreaks((current) => current.filter((_, i) => i !== index))}
              >
                削除
              </button>
            </div>
          ))}
          <div className="row">
            <button className="secondary" type="button" onClick={() => setBreaks((current) => [...current, { start, end: start }])}>
              中抜けを追加
            </button>
          </div>
        </>
      ) : null}

      <div className="row">
        <button type="button" onClick={save} disabled={isSaving}>
          {isSaving ? "保存中..." : "この日の出欠を保存"}
        </button>
      </div>
      {message ? <p className={message.kind}>{message.text}</p> : null}
    </section>
  );
}
