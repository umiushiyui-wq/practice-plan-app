"use client";

import { FormEvent, useEffect, useState } from "react";
import { AdminApp } from "@/components/AdminApp";

const ADMIN_PASSWORD = "0084";
const ADMIN_UNLOCK_KEY = "nagosui-admin-unlocked";

export function AdminGate() {
  const [password, setPassword] = useState("");
  const [unlocked, setUnlocked] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setUnlocked(window.sessionStorage.getItem(ADMIN_UNLOCK_KEY) === "true");
  }, []);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (password === ADMIN_PASSWORD) {
      window.sessionStorage.setItem(ADMIN_UNLOCK_KEY, "true");
      setUnlocked(true);
      setError("");
      return;
    }

    setError("パスワードが違います。");
  }

  if (unlocked) {
    return <AdminApp />;
  }

  return (
    <main className="auth-page">
      <section className="panel auth-card stack">
        <div className="stack">
          <p className="muted">管理者用URL</p>
          <h1>パスワードを入力してください</h1>
          <p className="muted">管理者画面を開くにはパスワードが必要です。</p>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <label>
            パスワード
            <input
              autoFocus
              inputMode="numeric"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="パスワード"
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button type="submit">管理者画面を開く</button>
        </form>
      </section>
    </main>
  );
}
