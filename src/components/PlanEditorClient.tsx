"use client";

import Link from "next/link";
import { useState } from "react";

type PieceOption = {
  id: string;
  title: string;
};

type PlanSlotItem = {
  id: string;
  slotType: "piece" | "break";
  pieceId: string | null;
  pieceTitle: string | null;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  source: "auto" | "manual";
  isLocked: boolean;
  scoreTotal: string | null;
  scoreAttendance: string | null;
  scoreProgress: string | null;
  scorePenalty: string | null;
  reasonText: string | null;
};

export function PlanEditorClient({
  planId,
  practiceDayId,
  status,
  role,
  pieces,
  slots
}: {
  planId: string;
  practiceDayId: string;
  status: "proposed" | "confirmed";
  role: "member" | "admin";
  pieces: PieceOption[];
  slots: PlanSlotItem[];
}) {
  const [message, setMessage] = useState("");

  async function submitSlot(path: string, method: "POST" | "PATCH", formData: FormData) {
    setMessage("");
    const body = Object.fromEntries(formData.entries());
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "保存に失敗しました。" }));
      setMessage(payload.error ?? "保存に失敗しました。");
      return;
    }
    location.reload();
  }

  async function deleteSlot(slotId: string) {
    setMessage("");
    const response = await fetch(`/api/plans/${planId}/slots/${slotId}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("削除に失敗しました。");
      return;
    }
    location.reload();
  }

  async function confirmPlan() {
    setMessage("");
    const response = await fetch(`/api/plans/${planId}/confirm`, { method: "POST" });
    if (!response.ok) {
      setMessage("確定に失敗しました。");
      return;
    }
    location.reload();
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <Link href={`/practice-days/${practiceDayId}`}>← 練習日に戻る</Link>
        <h1>練習計画</h1>
        <p className="muted">状態: {status === "confirmed" ? "確定済み" : "提案中"}</p>
        {message ? <div className="error">{message}</div> : null}
        {role === "admin" ? (
          <div className="row">
            <button type="button" onClick={confirmPlan}>この計画を確定</button>
          </div>
        ) : null}
      </section>

      {role === "admin" ? (
        <section className="panel stack">
          <h2>枠を追加</h2>
          <form
            className="grid"
            onSubmit={(event) => {
              event.preventDefault();
              submitSlot(`/api/plans/${planId}/slots`, "POST", new FormData(event.currentTarget));
            }}
          >
            <label>
              種別
              <select name="slotType" defaultValue="piece">
                <option value="piece">曲</option>
                <option value="break">休憩</option>
              </select>
            </label>
            <label>
              曲
              <select name="pieceId">
                {pieces.map((piece) => (
                  <option key={piece.id} value={piece.id}>{piece.title}</option>
                ))}
              </select>
            </label>
            <label>
              開始
              <input name="startTime" type="time" step="300" required />
            </label>
            <label>
              終了
              <input name="endTime" type="time" step="300" required />
            </label>
            <button type="submit">追加</button>
          </form>
        </section>
      ) : null}

      <section className="panel stack">
        <h2>枠一覧</h2>
        <div className="stack">
          {slots.map((slot) => (
            <article className="panel stack" key={slot.id}>
              <div className="row">
                <strong>{slot.startTime}〜{slot.endTime}</strong>
                <span>{slot.slotType === "break" ? "休憩" : slot.pieceTitle}</span>
                <span className="muted">{slot.durationMinutes}分 / {slot.source === "auto" ? "自動提案" : "手動"}</span>
              </div>
              {slot.reasonText ? (
                <div className="notice">
                  <strong>選ばれた理由</strong>
                  <p>{slot.reasonText}</p>
                  <p className="muted">
                    総合 {slot.scoreTotal} / 参加 {slot.scoreAttendance} / 進捗 {slot.scoreProgress} / ペナルティ {slot.scorePenalty}
                  </p>
                </div>
              ) : (
                <p className="muted">手修正された枠、または休憩枠です。</p>
              )}

              {role === "admin" ? (
                <form
                  className="grid"
                  onSubmit={(event) => {
                    event.preventDefault();
                    submitSlot(`/api/plans/${planId}/slots/${slot.id}`, "PATCH", new FormData(event.currentTarget));
                  }}
                >
                  <label>
                    種別
                    <select name="slotType" defaultValue={slot.slotType}>
                      <option value="piece">曲</option>
                      <option value="break">休憩</option>
                    </select>
                  </label>
                  <label>
                    曲
                    <select name="pieceId" defaultValue={slot.pieceId ?? pieces[0]?.id}>
                      {pieces.map((piece) => (
                        <option key={piece.id} value={piece.id}>{piece.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    開始
                    <input name="startTime" type="time" step="300" defaultValue={slot.startTime} required />
                  </label>
                  <label>
                    終了
                    <input name="endTime" type="time" step="300" defaultValue={slot.endTime} required />
                  </label>
                  <div className="row">
                    <button type="submit">更新</button>
                    <button className="danger" type="button" onClick={() => deleteSlot(slot.id)}>削除</button>
                  </div>
                </form>
              ) : null}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
