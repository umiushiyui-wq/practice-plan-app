"use client";

import Link from "next/link";
import {
  compareMembersByInstrument,
  getInstrumentLabel,
  LocalStateStatusPanel,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

export function PieceMembersApp({ pieceId }: { pieceId: string }) {
  const localState = useLocalPracticeState();
  const { state, updateState, ready } = localState;
  const piece = state.pieces.find((item) => item.id === pieceId);
  const conductor = piece ? state.members.find((member) => member.id === piece.conductorId) : undefined;
  const sortedMembers = [...state.members].sort(compareMembersByInstrument);

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
