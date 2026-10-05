"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { compareMembersByInstrument, getInstrumentLabel, useLocalPracticeState } from "@/components/LocalPracticeApp";
import type { Member } from "@/components/LocalPracticeApp";
import type { ReactionSummary, SlackReactionsInspectResult } from "@/app/api/local-state/slack-reactions/route";

type Row = {
  slackUserId: string;
  name: string;
  part: string;
  member: Member | null;
  isChannelMember: boolean;
  reactionNames: string[];
};

type SendResult = { kind: "notice" | "error"; text: string };

function defaultReminderText(permalink: string) {
  return `こちらの投稿へのリアクションをお願いします！\n${permalink}`;
}

function ReactionIcon({ reaction }: { reaction: ReactionSummary }) {
  if (reaction.emoji) return <span className="reaction-emoji">{reaction.emoji}</span>;
  if (reaction.imageUrl) {
    return <img className="reaction-emoji-image" src={reaction.imageUrl} alt={`:${reaction.name}:`} />;
  }
  return <span className="reaction-emoji-name">:{reaction.name}:</span>;
}

// Slackの投稿URLから、チャンネルメンバーの「誰がどの絵文字を押したか」を一覧にし、選んだ人にDMで催促する
export function SlackReactionsApp() {
  const { state } = useLocalPracticeState();
  const [url, setUrl] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [result, setResult] = useState<SlackReactionsInspectResult | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showOnlyPending, setShowOnlyPending] = useState(false);
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  const rows = useMemo<Row[]>(() => {
    if (!result) return [];
    const membersBySlackId = new Map(
      state.members.filter((member) => member.slackUserId?.trim()).map((member) => [member.slackUserId!.trim(), member])
    );
    const channelMemberIds = new Set(result.memberIds);
    // リアクションした人はチャンネル外（退出済みなど）でも一覧には出す
    const ids = new Set([...result.memberIds, ...result.reactions.flatMap((reaction) => reaction.userIds)]);
    ids.delete(result.posterId ?? "");

    const list = Array.from(ids, (slackUserId) => {
      const member = membersBySlackId.get(slackUserId) ?? null;
      return {
        slackUserId,
        name: member?.name ?? result.slackNames[slackUserId] ?? slackUserId,
        part: member ? getInstrumentLabel(member.instrument) : "未登録",
        member,
        isChannelMember: channelMemberIds.has(slackUserId),
        reactionNames: result.reactions.filter((reaction) => reaction.userIds.includes(slackUserId)).map((reaction) => reaction.name)
      };
    });

    // アプリに登録されている人をパート順に、未登録の人はその下に名前順
    return list.sort((first, second) => {
      if (first.member && second.member) return compareMembersByInstrument(first.member, second.member);
      if (first.member || second.member) return first.member ? -1 : 1;
      return first.name.localeCompare(second.name, "ja");
    });
  }, [result, state.members]);

  const pendingRows = rows.filter((row) => row.isChannelMember && row.reactionNames.length === 0);
  const visibleRows = showOnlyPending ? pendingRows : rows;
  const selectedRows = rows.filter((row) => selectedIds.has(row.slackUserId));

  async function load(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsLoading(true);
    setLoadError("");
    setSendResult(null);

    try {
      const response = await fetch("/api/local-state/slack-reactions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url })
      });
      const payload = (await response.json().catch(() => null)) as (SlackReactionsInspectResult & { error?: string }) | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "リアクションを取得できませんでした。");

      setResult(payload);
      setSelectedIds(new Set());
      setText(defaultReminderText(payload.permalink));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "リアクションを取得できませんでした。");
    } finally {
      setIsLoading(false);
    }
  }

  function toggle(slackUserId: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(slackUserId);
      else next.delete(slackUserId);
      return next;
    });
  }

  function selectRows(targetRows: Row[]) {
    setSelectedIds(new Set(targetRows.filter((row) => row.isChannelMember).map((row) => row.slackUserId)));
  }

  async function send() {
    if (!result || selectedRows.length === 0 || !text.trim()) return;
    if (!confirm(`${selectedRows.length}人にSlackのDMで催促を送りますか？`)) return;

    setIsSending(true);
    setSendResult(null);
    try {
      const response = await fetch("/api/local-state/slack-reactions/remind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          channel: result.channel,
          userIds: selectedRows.map((row) => row.slackUserId),
          names: Object.fromEntries(selectedRows.map((row) => [row.slackUserId, row.name])),
          text
        })
      });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; summary?: string; failures?: Array<{ name: string; error: string }>; error?: string }
        | null;
      if (!response.ok || !payload?.ok) throw new Error(payload?.error ?? "催促メッセージを送信できませんでした。");

      const failureText =
        payload.failures && payload.failures.length > 0
          ? `（失敗: ${payload.failures.map((failure) => `${failure.name} ${failure.error}`).join("、")}）`
          : "";
      setSendResult({ kind: payload.failures?.length ? "error" : "notice", text: `${payload.summary ?? "送信しました。"}${failureText}` });
    } catch (error) {
      setSendResult({ kind: "error", text: error instanceof Error ? error.message : "催促メッセージを送信できませんでした。" });
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="stack setup-page">
      <section className="panel stack">
        <Link href="/admin">← 管理画面へ戻る</Link>
        <p className="muted">管理者用</p>
        <h1>Slackリアクション確認</h1>
        <p className="muted">
          Slackの投稿のリンク（投稿の「…」→「リンクをコピー」）を貼ると、チャンネルのメンバーが誰がどの絵文字を押したかを一覧にします。まだの人を選んでDMで催促できます。
        </p>
        <form className="row" onSubmit={load}>
          <input
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://〜.slack.com/archives/C0123456789/p1712345678123456"
            aria-label="Slackの投稿URL"
          />
          <button type="submit" disabled={isLoading || !url.trim()}>
            {isLoading ? "読み込み中..." : "読み込む"}
          </button>
        </form>
        {loadError ? <p className="error">{loadError}</p> : null}
      </section>

      {result ? (
        <section className="panel stack">
          {result.warnings.map((warning) => (
            <p className="notice" key={warning}>
              {warning}
            </p>
          ))}
          {result.messageText ? <blockquote className="reaction-message-text">{result.messageText}</blockquote> : null}

          <div className="reaction-summary">
            {result.reactions.map((reaction) => (
              <span className="reaction-summary-chip" key={reaction.name} title={`:${reaction.name}:`}>
                <ReactionIcon reaction={reaction} />
                {reaction.userIds.length}人
              </span>
            ))}
            <span className="reaction-summary-chip pending">まだ {pendingRows.length}人</span>
          </div>

          <div className="row">
            <label className="row">
              <input
                style={{ width: "auto" }}
                type="checkbox"
                checked={showOnlyPending}
                onChange={(event) => setShowOnlyPending(event.target.checked)}
              />
              まだの人だけ表示
            </label>
          </div>

          <div className="piece-matrix-wrap">
            <table className="piece-matrix reaction-table">
              <thead>
                <tr>
                  <th>名前</th>
                  <th className="reaction-check-cell">選択</th>
                  <th>パート</th>
                  {result.reactions.map((reaction) => (
                    <th key={reaction.name} className="reaction-cell" title={`:${reaction.name}:`}>
                      <ReactionIcon reaction={reaction} />
                    </th>
                  ))}
                  <th className="reaction-cell">まだ</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => {
                  const isPending = row.isChannelMember && row.reactionNames.length === 0;
                  return (
                    <tr key={row.slackUserId} className={row.reactionNames.length > 1 ? "reaction-multi-row" : ""}>
                      <th>
                        {row.name}
                        {!row.isChannelMember ? <span className="muted">（チャンネル外）</span> : null}
                      </th>
                      <td className="reaction-check-cell">
                        <input
                          type="checkbox"
                          style={{ width: "auto" }}
                          checked={selectedIds.has(row.slackUserId)}
                          disabled={!row.isChannelMember}
                          aria-label={`${row.name} を催促の対象にする`}
                          onChange={(event) => toggle(row.slackUserId, event.target.checked)}
                        />
                      </td>
                      <td className="muted">{row.part}</td>
                      {result.reactions.map((reaction) => (
                        <td key={reaction.name} className={`reaction-cell${row.reactionNames.includes(reaction.name) ? " is-reacted" : ""}`}>
                          {row.reactionNames.includes(reaction.name) ? "●" : ""}
                        </td>
                      ))}
                      <td className={`reaction-cell${isPending ? " is-pending" : ""}`}>{isPending ? "●" : ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="muted">黄色の行は複数の絵文字を押している人です。投稿者本人とボットは一覧から除いています。</p>

          <div className="stack">
            <h2>催促メッセージ</h2>
            <div className="row">
              <button className="secondary" type="button" onClick={() => selectRows(pendingRows)}>
                まだの人を全員選択
              </button>
              {result.reactions.map((reaction) => (
                <button
                  className="secondary"
                  type="button"
                  key={reaction.name}
                  onClick={() => selectRows(rows.filter((row) => row.reactionNames.includes(reaction.name)))}
                >
                  <ReactionIcon reaction={reaction} /> の人を選択
                </button>
              ))}
              <button className="secondary" type="button" onClick={() => setSelectedIds(new Set())}>
                選択を解除
              </button>
            </div>
            <p className="muted">
              選択中 {selectedRows.length}人{selectedRows.length > 0 ? `: ${selectedRows.map((row) => row.name).join("、")}` : ""}
            </p>
            <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} aria-label="催促メッセージ" />
            <div className="row">
              <button type="button" onClick={send} disabled={isSending || selectedRows.length === 0 || !text.trim()}>
                {isSending ? "送信中..." : `${selectedRows.length}人にDMを送る`}
              </button>
            </div>
            {sendResult ? <p className={sendResult.kind}>{sendResult.text}</p> : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
