"use client";

import Link from "next/link";
import { useState } from "react";
import {
  compareMembersByInstrument,
  getInstrumentLabel,
  LocalStateStatusPanel,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

type InviteStatus = "idle" | "sending" | "done" | "error";
type OutsidersStatus = "idle" | "checking" | "done" | "error";
type Outsider = { memberId: string; name: string; slackUserId: string };

export function PieceMembersApp({ pieceId }: { pieceId: string }) {
  const localState = useLocalPracticeState();
  const { state, updateState, ready } = localState;
  const piece = state.pieces.find((item) => item.id === pieceId);
  const conductor = piece ? state.members.find((member) => member.id === piece.conductorId) : undefined;
  const sortedMembers = [...state.members].sort(compareMembersByInstrument);

  const [inviteStatus, setInviteStatus] = useState<InviteStatus>("idle");
  const [inviteMessage, setInviteMessage] = useState("");
  const [outsidersStatus, setOutsidersStatus] = useState<OutsidersStatus>("idle");
  const [outsidersMessage, setOutsidersMessage] = useState("");
  const [outsiders, setOutsiders] = useState<Outsider[]>([]);
  const [kickingMemberId, setKickingMemberId] = useState("");

  function updateChannelId(formData: FormData) {
    const slackChannelId = String(formData.get("slackChannelId") ?? "").trim();
    updateState({
      pieces: state.pieces.map((item) => (item.id === pieceId ? { ...item, slackChannelId } : item))
    });
  }

  async function inviteMembersToChannel() {
    const trimmedChannelId = (piece?.slackChannelId ?? "").trim();
    if (!trimmedChannelId) return;
    if (!confirm(`チャンネル（${trimmedChannelId}）にこの曲のメンバーを招待しますか？`)) return;

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

  async function checkOutsiders() {
    const trimmedChannelId = (piece?.slackChannelId ?? "").trim();
    if (!trimmedChannelId) return;

    setOutsidersStatus("checking");
    setOutsidersMessage("");

    try {
      const response = await fetch(`/api/local-state/pieces/${pieceId}/slack-outsiders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: trimmedChannelId })
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setOutsidersStatus("error");
        setOutsidersMessage(payload.error ?? "退出候補の取得に失敗しました。");
        return;
      }

      setOutsiders(payload.outsiders ?? []);
      setOutsidersStatus("done");
      setOutsidersMessage(
        payload.outsiders?.length > 0 ? "" : "この曲のメンバーから外れた参加者はいませんでした。"
      );
    } catch {
      setOutsidersStatus("error");
      setOutsidersMessage("退出候補の取得に失敗しました。");
    }
  }

  async function kickOutsider(outsider: Outsider) {
    const trimmedChannelId = (piece?.slackChannelId ?? "").trim();
    if (!trimmedChannelId) return;
    if (!confirm(`${outsider.name} をチャンネル（${trimmedChannelId}）から退出させますか？`)) return;

    setKickingMemberId(outsider.memberId);
    setOutsidersMessage("");

    try {
      const response = await fetch(`/api/local-state/pieces/${pieceId}/slack-kick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channelId: trimmedChannelId, slackUserId: outsider.slackUserId })
      });
      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setOutsidersMessage(payload.error ?? "退出処理に失敗しました。");
        return;
      }

      setOutsiders((current) => current.filter((item) => item.memberId !== outsider.memberId));
    } catch {
      setOutsidersMessage("退出処理に失敗しました。");
    } finally {
      setKickingMemberId("");
    }
  }

  async function toggleMember(memberId: string, checked: boolean) {
    await localState.savePieceMembership({
      pieceId,
      memberId,
      selected: checked,
      actor: "admin"
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
          <form
            className="row"
            onSubmit={(event) => {
              event.preventDefault();
              updateChannelId(new FormData(event.currentTarget));
            }}
          >
            <input name="slackChannelId" defaultValue={piece.slackChannelId ?? ""} placeholder={"チャンネルID（例: C0123456789）"} />
            <button className="secondary" type="submit">
              チャンネルID保存
            </button>
          </form>
          <div className="row">
            <button
              type="button"
              onClick={inviteMembersToChannel}
              disabled={inviteStatus === "sending" || !(piece.slackChannelId ?? "").trim()}
            >
              {inviteStatus === "sending" ? "招待中..." : "招待する"}
            </button>
          </div>
          {inviteMessage ? <p className={inviteStatus === "error" ? "error" : "notice"}>{inviteMessage}</p> : null}
        </section>
      ) : null}

      {piece ? (
        <section className="panel stack">
          <div className="section-title">
            <h2>チャンネルからの退出</h2>
          </div>
          <p className="muted">
            チャンネルに参加しているが、この曲のメンバーから外れた人を確認して退出させます。
          </p>
          <div className="row">
            <button
              className="secondary"
              type="button"
              onClick={checkOutsiders}
              disabled={outsidersStatus === "checking" || !(piece.slackChannelId ?? "").trim()}
            >
              {outsidersStatus === "checking" ? "確認中..." : "退出候補を確認"}
            </button>
          </div>
          {outsidersMessage ? <p className={outsidersStatus === "error" ? "error" : "notice"}>{outsidersMessage}</p> : null}
          {outsiders.length > 0 ? (
            <div className="stack">
              {outsiders.map((outsider) => (
                <div className="row" key={outsider.memberId}>
                  <div>
                    <strong>{outsider.name}</strong>
                    <div className="muted">Slack ID: {outsider.slackUserId}</div>
                  </div>
                  <button
                    className="danger"
                    type="button"
                    onClick={() => kickOutsider(outsider)}
                    disabled={kickingMemberId === outsider.memberId}
                  >
                    {kickingMemberId === outsider.memberId ? "退出中..." : "退出させる"}
                  </button>
                </div>
              ))}
            </div>
          ) : null}
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
