"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

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

function formatPracticeDateLabel(date: string) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;

  const weekdays = ["\u65e5", "\u6708", "\u706b", "\u6c34", "\u6728", "\u91d1", "\u571f"];
  return `${date}\uff08${weekdays[parsed.getDay()]}\uff09`;
}

function statusLabel(status: string) {
  const labels: Record<string, string> = {
    draft: "下書き",
    collecting: "回答受付中",
    planned: "計画作成済み",
    confirmed: "確定済み"
  };
  return labels[status] ?? status;
}

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

  const nextPracticeDay = useMemo(() => practiceDays[0] ?? null, [practiceDays]);

  async function submitJson(path: string, formData: FormData) {
    setMessage("");

    const body: Record<string, unknown> = Object.fromEntries(formData.entries());
    const pieceIds = formData.getAll("pieceIds").map(String);
    const practiceDates = formData.getAll("practiceDates").map(String).filter(Boolean);

    if (pieceIds.length > 0) body.pieceIds = pieceIds;
    if (practiceDates.length > 0) body.practiceDates = practiceDates;

    const response = await fetch(path, {
      method: path === "/api/me" ? "PATCH" : "POST",
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

  return (
    <main className="stack">
      <section className="hero-panel dashboard-hero">
        <div className="hero-copy">
          <p className="eyebrow">ダッシュボード</p>
          <h1>練習準備の状況</h1>
          <p>
            {currentUser.displayName} / {currentUser.role === "admin" ? "管理者" : "メンバー"}
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button secondary" href="/player">
            奏者ページ
          </Link>
          {currentUser.role === "admin" ? (
            <Link className="button" href="/admin">
              管理画面
            </Link>
          ) : null}
        </div>
      </section>

      {message ? <div className="error">{message}</div> : null}

      <section className="summary-strip">
        <article className="metric-card">
          <span className="metric-label">練習日</span>
          <strong>{practiceDays.length}</strong>
          <span className="muted">{nextPracticeDay ? `${formatPracticeDateLabel(nextPracticeDay.practiceDate)} が最新` : "未登録"}</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">曲</span>
          <strong>{pieces.length}</strong>
          <span className="muted">登録済み</span>
        </article>
        <article className="metric-card">
          <span className="metric-label">メンバー</span>
          <strong>{users.length}</strong>
          <span className="muted">有効ユーザー</span>
        </article>
      </section>

      <div className="grid">
        <section className="panel stack">
          <div className="section-title">
            <p className="muted">プロフィール</p>
            <h2>自分の情報</h2>
          </div>
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
              <input name="part" defaultValue={currentUser.part ?? ""} placeholder="例: 1st" />
            </label>
            <button type="submit">保存</button>
          </form>
        </section>

        {currentUser.role === "admin" ? (
          <section className="panel stack">
            <div className="section-title">
              <p className="muted">曲登録</p>
              <h2>曲を追加</h2>
            </div>
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
                    <option key={user.id} value={user.id}>
                      {user.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <div className="date-time-grid two-col">
                <label>
                  期間内の目標練習時間
                  <input name="targetMinutesInWindow" type="number" min="0" step="5" defaultValue="60" />
                </label>
                <label>
                  1日あたりの最大練習時間
                  <input name="dailyMaxMinutes" type="number" min="15" step="5" defaultValue="45" />
                </label>
              </div>
              <button type="submit">曲を追加</button>
            </form>
          </section>
        ) : null}
      </div>

      {currentUser.role === "admin" ? (
        <section className="panel stack">
          <div className="section-title">
            <p className="muted">練習日</p>
            <h2>練習日を作成</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              submitJson("/api/practice-days", new FormData(event.currentTarget));
            }}
          >
            <div className="date-time-grid">
              <label>
                練習日
                <input name="practiceDates" type="date" required />
              </label>
              <label>
                開始時刻
                <input name="startTime" type="time" step="300" required />
              </label>
              <label>
                終了時刻
                <input name="endTime" type="time" step="300" required />
              </label>
            </div>
            <details className="fold-panel">
              <summary>
                追加の日付と対象曲
                <span className="muted">任意</span>
              </summary>
              <div className="fold-panel-body stack">
                <div className="date-time-grid">
                  <input name="practiceDates" type="date" aria-label="追加の練習日 1" />
                  <input name="practiceDates" type="date" aria-label="追加の練習日 2" />
                  <input name="practiceDates" type="date" aria-label="追加の練習日 3" />
                </div>
                <label>
                  回答締切
                  <input name="responseDeadline" type="datetime-local" />
                </label>
                <div className="checkbox-list">
                  {pieces.map((piece) => (
                    <label key={piece.id} className="checkbox-row">
                      <input name="pieceIds" type="checkbox" value={piece.id} />
                      <span>{piece.title}</span>
                    </label>
                  ))}
                </div>
              </div>
            </details>
            <button type="submit">練習日を作成</button>
          </form>
        </section>
      ) : null}

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">一覧</p>
            <h2>練習日</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>日付</th>
                <th>時間</th>
                <th>状態</th>
                <th>対象曲</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {practiceDays.map((day) => (
                <tr key={day.id}>
                  <td>{formatPracticeDateLabel(day.practiceDate)}</td>
                  <td>
                    {day.startTime} - {day.endTime}
                  </td>
                  <td>
                    <span className="status-pill">{statusLabel(day.status)}</span>
                  </td>
                  <td>{day.pieces.join(", ") || "未設定"}</td>
                  <td>
                    <Link className="text-link" href={`/practice-days/${day.id}`}>
                      開く
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel stack">
        <div className="row page-section-head">
          <div>
            <p className="muted">一覧</p>
            <h2>曲</h2>
          </div>
        </div>
        <div className="table-wrap">
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
                    {currentUser.role === "admin" ? (
                      <Link className="text-link" href={`/pieces/${piece.id}`}>
                        {piece.title}
                      </Link>
                    ) : (
                      piece.title
                    )}
                  </td>
                  <td>{piece.conductorName ?? "未設定"}</td>
                  <td>{piece.targetMinutesInWindow}分</td>
                  <td>{piece.dailyMaxMinutes}分</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
