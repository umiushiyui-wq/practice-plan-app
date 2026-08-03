"use client";

import { useEffect, useState } from "react";
import type { SendHistoryEntry } from "@/lib/sendHistory";

const TYPE_LABELS: Record<SendHistoryEntry["type"], string> = {
  reminder: "出欠催促",
  "attendance-image": "出欠画像送信"
};

function formatSentAt(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

export function SendHistoryApp() {
  const [entries, setEntries] = useState<SendHistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/local-state/send-history", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | { entries?: SendHistoryEntry[]; error?: string }
          | null;

        if (!response.ok) {
          throw new Error(payload?.error ?? `HTTP ${response.status}`);
        }
        if (!cancelled) setEntries(payload?.entries ?? []);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "履歴の取得に失敗しました。");
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用ログ</p>
        <h1>Slack送信履歴</h1>
        <p className="muted">出欠催促・パート別の出欠画像送信を、いつ・成功したかどうかで記録しています。</p>

        {error ? <div className="error">{error}</div> : null}

        {entries === null && !error ? <p className="muted">読み込み中…</p> : null}

        {entries && entries.length === 0 ? <p className="muted">送信履歴はまだありません。</p> : null}

        {entries && entries.length > 0 ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日時</th>
                  <th>種別</th>
                  <th>練習日</th>
                  <th>対象</th>
                  <th>結果</th>
                  <th>詳細</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{formatSentAt(entry.sentAt)}</td>
                    <td>
                      {TYPE_LABELS[entry.type] ?? entry.type}
                      {entry.isTest ? <span className="muted">（テスト）</span> : null}
                    </td>
                    <td>{entry.practiceDateLabel}</td>
                    <td>{entry.part ?? "-"}</td>
                    <td>
                      <span className="status-pill">{entry.success ? "成功" : "失敗"}</span>
                    </td>
                    <td>{entry.detail ?? entry.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </main>
  );
}
