"use client";

import Link from "next/link";
import { useState } from "react";

type UserOption = {
  id: string;
  displayName: string;
};

type PieceEditorProps = {
  piece: {
    id: string;
    title: string;
    conductorUserId: string | null;
    targetMinutesInWindow: number;
    dailyMaxMinutes: number;
    memberIds: string[];
  };
  users: UserOption[];
};

export function PieceEditorClient({ piece, users }: PieceEditorProps) {
  const [message, setMessage] = useState("");

  async function savePiece(formData: FormData) {
    setMessage("");
    const body = Object.fromEntries(formData.entries());
    const response = await fetch(`/api/pieces/${piece.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      setMessage("曲情報の保存に失敗しました。");
      return;
    }
    location.reload();
  }

  async function saveMembers(formData: FormData) {
    setMessage("");
    const userIds = formData.getAll("userIds").map(String);
    const response = await fetch(`/api/pieces/${piece.id}/members`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userIds })
    });
    if (!response.ok) {
      setMessage("参加メンバーの保存に失敗しました。");
      return;
    }
    location.reload();
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <Link href="/dashboard">← ダッシュボード</Link>
        <h1>{piece.title}</h1>
        {message ? <div className="error">{message}</div> : null}
      </section>

      <div className="grid">
        <section className="panel stack">
          <h2>曲情報</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              savePiece(new FormData(event.currentTarget));
            }}
          >
            <label>
              曲名
              <input name="title" defaultValue={piece.title} required />
            </label>
            <label>
              指揮者
              <select name="conductorUserId" defaultValue={piece.conductorUserId ?? ""}>
                <option value="">未設定</option>
                {users.map((user) => (
                  <option key={user.id} value={user.id}>
                    {user.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              期間内の目標練習時間
              <input name="targetMinutesInWindow" type="number" min="0" step="5" defaultValue={piece.targetMinutesInWindow} />
            </label>
            <label>
              1日あたりの最大練習時間
              <input name="dailyMaxMinutes" type="number" min="15" step="5" defaultValue={piece.dailyMaxMinutes} />
            </label>
            <button type="submit">曲情報を保存</button>
          </form>
        </section>

        <section className="panel stack">
          <h2>参加メンバー</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              saveMembers(new FormData(event.currentTarget));
            }}
          >
            {users.map((user) => (
              <label key={user.id} className="row">
                <input
                  style={{ width: "auto" }}
                  name="userIds"
                  type="checkbox"
                  value={user.id}
                  defaultChecked={piece.memberIds.includes(user.id)}
                />
                {user.displayName}
              </label>
            ))}
            <button type="submit">参加メンバーを保存</button>
          </form>
        </section>
      </div>
    </main>
  );
}
