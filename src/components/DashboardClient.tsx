"use client";

import Link from "next/link";
import { useState } from "react";

type UserOption = {
  id: string;
  displayName: string;
  instrument: string | null;
  part: string | null;
};

type PieceItem = {
  id: string;
  title: string;
  targetMinutesInWindow: number;
  dailyMaxMinutes: number;
  conductorUserId: string | null;
  conductorName: string | null;
};

type PracticeDayItem = {
  id: string;
  practiceDate: string;
  startTime: string;
  endTime: string;
  status: string;
  pieces: string[];
};

type CurrentUser = UserOption & {
  role: "member" | "admin";
};

export function DashboardClient({
  currentUser,
  users,
  pieces,
  practiceDays
}: {
  currentUser: CurrentUser;
  users: UserOption[];
  pieces: PieceItem[];
  practiceDays: PracticeDayItem[];
}) {
  const [message, setMessage] = useState("");

  async function submitJson(path: string, formData: FormData) {
    setMessage("");
    const body: Record<string, unknown> = Object.fromEntries(formData.entries());
    const pieceIds = formData.getAll("pieceIds").map(String);
    if (pieceIds.length > 0) body.pieceIds = pieceIds;
    const practiceDates = formData.getAll("practiceDates").map(String).filter(Boolean);
    if (practiceDates.length > 0) body.practiceDates = practiceDates;

    const response = await fetch(path, {
      method: path === "/api/me" ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({ error: "エラーが発生しました。" }));
      setMessage(payload.error ?? "エラーが発生しました。");
      return;
    }

    location.reload();
  }

  return (
    <main className="stack">
      <section className="panel row">
        <div>
          <h1>ダッシュボード</h1>
          <p className="muted">{currentUser.displayName} / {currentUser.role === "admin" ? "管理者" : "メンバー"}</p>
        </div>
      </section>

      {message ? <div className="error">{message}</div> : null}

      <div className="grid">
        <section className="panel stack">
          <h2>自分の情報</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              submitJson("/api/me", new FormData(event.currentTarget));
            }}
          >
            <label>
              表示名
              <input name="displayName" defaultValue={currentUser.displayName} />
            </label>
            <label>
              楽器
              <input name="instrument" defaultValue={currentUser.instrument ?? ""} placeholder="例: クラリネット" />
            </label>
            <label>
              パート
              <input name="part" defaultValue={currentUser.part ?? ""} placeholder="例: 木管" />
            </label>
            <button type="submit">保存</button>
          </form>
        </section>

        {currentUser.role === "admin" ? (
          <section className="panel stack">
            <h2>曲を追加</h2>
            <form
              className="stack"
              onSubmit={(event) => {
                event.preventDefault();
                submitJson("/api/pieces", new FormData(event.currentTarget));
              }}
            >
              <label>
                曲名
                <input name="title" required />
              </label>
              <label>
                指揮者
                <select name="conductorUserId" defaultValue="">
                  <option value="">未設定</option>
                  {users.map((user) => (
                    <option key={user.id} value={user.id}>{user.displayName}</option>
                  ))}
                </select>
              </label>
              <label>
                直近期間の目標累積分
                <input name="targetMinutesInWindow" type="number" min="0" step="5" defaultValue="60" />
              </label>
              <label>
                1日最大練習分
                <input name="dailyMaxMinutes" type="number" min="15" step="5" defaultValue="45" />
              </label>
              <button type="submit">曲を追加</button>
            </form>
          </section>
        ) : null}
      </div>

      {currentUser.role === "admin" ? (
        <section className="panel stack">
          <h2>練習日を作成</h2>
          <form
            className="grid"
            onSubmit={(event) => {
              event.preventDefault();
              submitJson("/api/practice-days", new FormData(event.currentTarget));
            }}
          >
            <label>
              練習日
              <input name="practiceDates" type="date" required />
              <input name="practiceDates" type="date" />
              <input name="practiceDates" type="date" />
              <input name="practiceDates" type="date" />
            </label>
            <label>
              開始
              <input name="startTime" type="time" step="300" required />
            </label>
            <label>
              終了
              <input name="endTime" type="time" step="300" required />
            </label>
            <label>
              回答締切
              <input name="responseDeadline" type="datetime-local" />
            </label>
            <div className="stack">
              <strong>対象曲</strong>
              {pieces.map((piece) => (
                <label key={piece.id} className="row">
                  <input style={{ width: "auto" }} name="pieceIds" type="checkbox" value={piece.id} />
                  {piece.title}
                </label>
              ))}
            </div>
            <div className="row">
              <button type="submit">練習日を作成</button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="panel stack">
        <h2>練習日</h2>
        <table>
          <thead>
            <tr>
              <th>日付</th>
              <th>時間</th>
              <th>状態</th>
              <th>対象曲</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {practiceDays.map((day) => (
              <tr key={day.id}>
                <td>{day.practiceDate}</td>
                <td>{day.startTime}〜{day.endTime}</td>
                <td>{day.status}</td>
                <td>{day.pieces.join("、") || "未設定"}</td>
                <td><Link href={`/practice-days/${day.id}`}>開く</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="panel stack">
        <h2>曲</h2>
        <table>
          <thead>
            <tr>
              <th>曲名</th>
              <th>指揮者</th>
              <th>目標</th>
              <th>1日上限</th>
            </tr>
          </thead>
          <tbody>
            {pieces.map((piece) => (
              <tr key={piece.id}>
                <td>
                  {currentUser.role === "admin" ? <Link href={`/pieces/${piece.id}`}>{piece.title}</Link> : piece.title}
                </td>
                <td>{piece.conductorName ?? "未設定"}</td>
                <td>{piece.targetMinutesInWindow}分</td>
                <td>{piece.dailyMaxMinutes}分</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
