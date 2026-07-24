"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  compareMembersByInstrument,
  getInstrumentLabel,
  LocalStateStatusPanel,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

type InviteStatus = "idle" | "sending" | "done" | "error";
type ChannelSaveStatus = "idle" | "saving" | "saved" | "error";

export function PieceMembersApp({ pieceId }: { pieceId: string }) {
  const localState = useLocalPracticeState();
  const { state, updateState, savePieceSlackChannelId, ready } = localState;
  const piece = state.pieces.find((item) => item.id === pieceId);
  const conductor = piece ? state.members.find((member) => member.id === piece.conductorId) : undefined;
  const sortedMembers = [...state.members].sort(compareMembersByInstrument);

  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [channelIdDraft, setChannelIdDraft] = useState("");
  const [channelSaveStatus, setChannelSaveStatus] = useState<ChannelSaveStatus>("idle");

  useEffect(() => {
    if (piece) setChannelIdDraft(piece.slackChannelId ?? "");
  }, [piece?.slackChannelId]);

  async function saveChannelIdNow() {
    setChannelSaveStatus("saving");
    const saved = await savePieceSlackChannelId(pieceId, channelIdDraft.trim());
    setChannelSaveStatus(saved ? "saved" : "error");
  }

  async function inviteMembersToChannel() {
    const trimmedChannelId = channelIdDraft.trim();
    if (!trimmedChannelId) return;

    setInviteStatus("sending");
    setInviteMessage("");

    try {
      const response = await fetch(`/api/local-state/pieces/${pieceId}/slack-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: trimmedChannelId })
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setInviteStatus("error");
        setInviteMessage(payload.error ?? "招待に失敗しました。");
        return;
      }

      setInviteStatus("done");
      const parts = [`招待 ${payload.invitedCount}人`, `既に参加済み ${payload.alreadyMemberCount}人`];
      if (payload.missingSlackUserIdCount > 0) parts.push(`Slack ID未登録 ${payload.missingSlackUserIdCount}人`);
      if (payload.failures?.length > 0) {
        parts.push(`失敗 ${payload.failures.length}人（${payload.failures.map((item: { name: string }) => item.name).join("、")}）`);
      }
      setInviteMessage(parts.join(" / "));
    } catch {
      setInviteStatus("error");
      setInviteMessage("招待に失敗しました。");
    }
  }

  function toggleMember(memberId: string, checked: boolean) {
    updateState({
      pieces: state.pieces.map((item) =>
        item.id === pieceId
          ? {
              ...item,
              memberIds: checked
                ? Array.from(new Set([...item.memberIds, memberId]))
                : item.memberIds.filter((id) => id !== memberId)
            }
          : item
      )
    });
  }

  if (ready && !piece) {
    return (
      <main className="stack setup-page">
        <section className="panel stack">
          <Link href="/admin/setup#pieces">← 曲の設定へ戻る</Link>
          <p>この曲が見つかりませんでした。削除された可能性があります。</p>
        </section>
      </main>
    );
  }

  return (
    <main className="stack setup-page">
      <section className="panel stack">
        <Link href="/admin/setup#pieces">← 曲の設定へ戻る</Link>
        <p className="muted">参加メンバー選択</p>
        <h1>{piece ? piece.title : "読み込み中..."}</h1>
        {piece ? <p className="muted">指揮者: {conductor?.name ?? "未設定"}</p> : null}
      </section>

      <LocalStateStatusPanel {...localState} />

      {piece ? (
        <section className="panel stack">
          <div className="section-title">
            <h2>Slackチャンネルに招待</h2>
          </div>
          <p className="muted">
            この曲に乗るメンバーのうち、まだ参加していない人をパブリックチャンネルに招待します。
          </p>
          <div className="row">
            <input
              value={channelIdDraft}
              onChange={(event) => {
                setChannelIdDraft(event.target.value);
                setChannelSaveStatus("idle");
              }}
              placeholder={"チャンネルID（例: C0123456789）"}
            />
            <button className="secondary" type="button" onClick={saveChannelIdNow} disabled={channelSaveStatus === "saving"}>
              {channelSaveStatus === "saving" ? "保存中..." : "チャンネルIDを保存"}
            </button>
            <button
              type="button"
              onClick={inviteMembersToChannel}
              disabled={inviteStatus === "sending" || !channelIdDraft.trim()}
            >
              {inviteStatus === "sending" ? "招待中..." : "招待する"}
            </button>
          </div>
          {channelSaveStatus === "saved" ? <p className="notice">チャンネルIDを保存しました。リロードしても消えません。</p> : null}
          {channelSaveStatus === "error" ? <p className="error">チャンネルIDの保存に失敗しました。もう一度お試しください。</p> : null}
          {inviteMessage ? <p className={inviteStatus === "error" ? "error" : "notice"}>{inviteMessage}</p> : null}
        </section>
      ) : null}

      {piece ? (
        <section className="panel stack">
          <div className="section-title">
            <h2>この曲に乗るメンバー</h2>
            <span className="muted">{piece.memberIds.length}人</span>
          </div>
          <p className="muted">
            ここでのチェックは奏者本人が奏者ページで行うチェックと同じ項目です。どちらで操作しても同じ参加メンバーとして扱われます。
          </p>
          <div className="stack">
            {sortedMembers.length === 0 ? <p className="muted">まだ奏者が登録されていません。</p> : null}
            {sortedMembers.map((member) => (
              <label className="row" key={member.id}>
                <input
                  style={{ width: "auto" }}
                  type="checkbox"
                  checked={piece.memberIds.includes(member.id)}
                  onChange={(event) => toggleMember(member.id, event.target.checked)}
                />
                <div>
                  <strong>{member.name}</strong>
                  <div className="muted">{getInstrumentLabel(member.instrument)}</div>
                </div>
              </label>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
