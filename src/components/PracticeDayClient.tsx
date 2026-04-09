"use client";

import Link from "next/link";
import { useState } from "react";

type PieceOption = {
  id: string;
  title: string;
  conductorName: string | null;
  memberCount: number;
  isMine: boolean;
};

type AvailabilityItem = {
  startTime: string;
  endTime: string;
};

export function PracticeDayClient({
  practiceDayId,
  title,
  timeLabel,
  role,
  pieces,
  availabilities,
  latestPlanId
}: {
  practiceDayId: string;
  title: string;
  timeLabel: string;
  role: "member" | "admin";
  pieces: PieceOption[];
  availabilities: AvailabilityItem[];
  latestPlanId: string | null;
}) {
  const [message, setMessage] = useState("");
  const [ranges, setRanges] = useState(
    availabilities.length > 0 ? availabilities : [{ startTime: "", endTime: "" }]
  );

  async function saveAvailability(formData: FormData) {
    setMessage("");
    const startTimes = formData.getAll("startTime").map(String).filter(Boolean);
    const endTimes = formData.getAll("endTime").map(String).filter(Boolean);
    const ranges = startTimes.map((startTime, index) => ({ startTime, endTime: endTimes[index] }));
    const response = await fetch(`/api/practice-days/${practiceDayId}/availabilities/me`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ranges })
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "保存に失敗しました。" }));
      setMessage(payload.error ?? "保存に失敗しました。");
      return;
    }
    location.reload();
  }

  async function saveMyPieces(formData: FormData) {
    setMessage("");
    const pieceIds = formData.getAll("pieceIds").map(String);
    const response = await fetch(`/api/practice-days/${practiceDayId}/my-pieces`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pieceIds })
    });
    if (!response.ok) {
      setMessage("参加曲の保存に失敗しました。");
      return;
    }
    location.reload();
  }

  async function adminAction(path: string, success: string) {
    setMessage("");
    const response = await fetch(path, { method: "POST" });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "操作に失敗しました。" }));
      setMessage(payload.error ?? "操作に失敗しました。");
      return;
    }
    setMessage(success);
    location.reload();
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <Link href="/dashboard">← ダッシュボード</Link>
        <h1>{title}</h1>
        <p className="muted">{timeLabel}</p>
        {message ? <div className={message.includes("失敗") ? "error" : "notice"}>{message}</div> : null}
        <div className="row">
          {latestPlanId ? (
            <Link className="button secondary" href={`/plans/${latestPlanId}`}>
              最新の練習計画を見る
            </Link>
          ) : null}
          {role === "admin" ? (
            <>
              <button
                type="button"
                onClick={() =>
                  adminAction(`/api/practice-days/${practiceDayId}/plans/generate`, "練習計画を生成しました。")
                }
              >
                自動生成する
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  adminAction(`/api/practice-days/${practiceDayId}/reminders/slack`, "Slack にリマインドを送信しました。")
                }
              >
                未回答者にSlackリマインド
              </button>
            </>
          ) : null}
        </div>
      </section>

      <div className="grid">
        <section className="panel stack">
          <h2>参加可能時間</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              saveAvailability(new FormData(event.currentTarget));
            }}
          >
            {ranges.map((range, index) => (
              <div className="row" key={index}>
                <label>
                  開始時刻
                  <input name="startTime" type="time" step="300" defaultValue={range.startTime} required />
                </label>
                <label>
                  終了時刻
                  <input name="endTime" type="time" step="300" defaultValue={range.endTime} required />
                </label>
                {ranges.length > 1 ? (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => setRanges((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                  >
                    削除
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="secondary"
              type="button"
              onClick={() => setRanges((current) => [...current, { startTime: "", endTime: "" }])}
            >
              時間帯を追加
            </button>
            <button type="submit">参加可能時間を保存</button>
          </form>
        </section>

        <section className="panel stack">
          <h2>自分の参加曲</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              saveMyPieces(new FormData(event.currentTarget));
            }}
          >
            {pieces.map((piece) => (
              <label key={piece.id} className="row">
                <input style={{ width: "auto" }} name="pieceIds" type="checkbox" value={piece.id} defaultChecked={piece.isMine} />
                {piece.title}
              </label>
            ))}
            <button type="submit">参加曲を保存</button>
          </form>
        </section>
      </div>

      <section className="panel stack">
        <h2>対象曲</h2>
        <table>
          <thead>
            <tr>
              <th>曲名</th>
              <th>指揮者</th>
              <th>参加人数</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((piece) => (
              <tr key={piece.id}>
                <td>{piece.title}</td>
                <td>{piece.conductorName ?? "未設定"}</td>
                <td>{piece.memberCount}人</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
