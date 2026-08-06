"use client";

import { useEffect, useState } from "react";
import type {
  AvailabilityHistoryEntry,
  HistoryEntry,
  PieceSelectionHistoryEntry,
  SlackHistoryEntry
} from "@/lib/history";

const SLACK_KIND_LABELS: Record<SlackHistoryEntry["kind"], string> = {
  reminder: "出欠催促",
  "attendance-image": "出欠画像送信"
};

function formatRecordedAt(iso: string) {
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

function SlackHistoryTable({ entries }: { entries: SlackHistoryEntry[] }) {
  if (entries.length === 0) return <p className="muted">送信履歴はまだありません。</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日時</th>
            <th>種別</th>
            <th>練習日</th>
            <th>パート</th>
            <th>結果</th>
            <th>詳細</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{formatRecordedAt(entry.recordedAt)}</td>
              <td>
                {SLACK_KIND_LABELS[entry.kind] ?? entry.kind}
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
  );
}

function AvailabilityHistoryTable({ entries }: { entries: AvailabilityHistoryEntry[] }) {
  if (entries.length === 0) return <p className="muted">出欠の保存履歴はまだありません。</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日時</th>
            <th>奏者</th>
            <th>練習日</th>
            <th>内容</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{formatRecordedAt(entry.recordedAt)}</td>
              <td>{entry.memberName}</td>
              <td>{entry.practiceDateLabel}</td>
              <td>{entry.summary}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PieceSelectionHistoryTable({ entries }: { entries: PieceSelectionHistoryEntry[] }) {
  if (entries.length === 0) return <p className="muted">出演曲選択の変更履歴はまだありません。</p>;

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>日時</th>
            <th>操作者</th>
            <th>奏者</th>
            <th>曲</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.id}>
              <td>{formatRecordedAt(entry.recordedAt)}</td>
              <td>
                <span className="status-pill">{entry.actor === "self" ? "本人" : "管理者"}</span>
              </td>
              <td>{entry.memberName}</td>
              <td>{entry.pieceTitle}</td>
              <td>{entry.selected ? "選択" : "解除"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AdminHistoryApp() {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch("/api/local-state/history", { cache: "no-store" });
        const payload = (await response.json().catch(() => null)) as
          | { entries?: HistoryEntry[]; error?: string }
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

  const slackEntries = entries?.filter((entry): entry is SlackHistoryEntry => entry.category === "slack") ?? [];
  const availabilityEntries =
    entries?.filter((entry): entry is AvailabilityHistoryEntry => entry.category === "availability") ?? [];
  const pieceSelectionEntries =
    entries?.filter((entry): entry is PieceSelectionHistoryEntry => entry.category === "piece-selection") ?? [];

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用ログ</p>
        <h1>操作履歴</h1>
        <p className="muted">Slack送信・出欠回答・出演曲選択の変更を、いつ・誰が・何をしたかで記録しています。</p>
        {error ? <div className="error">{error}</div> : null}
        {entries === null && !error ? <p className="muted">読み込み中…</p> : null}
      </section>

      {entries !== null ? (
        <>
          <section className="panel stack">
            <h2>Slack送信履歴</h2>
            <SlackHistoryTable entries={slackEntries} />
          </section>

          <section className="panel stack">
            <h2>出欠変更履歴</h2>
            <AvailabilityHistoryTable entries={availabilityEntries} />
          </section>

          <section className="panel stack">
            <h2>出演曲変更履歴</h2>
            <PieceSelectionHistoryTable entries={pieceSelectionEntries} />
          </section>
        </>
      ) : null}
    </main>
  );
}
