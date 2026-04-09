"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getPlannedMinutesByPiece,
  getSortedPracticeDays,
  makeId,
  resolvePieceTargetRange,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

const INSTRUMENT_OPTIONS = [
  "フルート",
  "クラリネット",
  "サックス",
  "ホルン",
  "トランペット",
  "トロンボーン",
  "ユーフォニアム",
  "パーカッション"
];

export function MemberPieceManagerApp() {
  const { state, updateState } = useLocalPracticeState();
  const sortedPracticeDays = getSortedPracticeDays(state.practiceDays);
  const [selectedPieceId, setSelectedPieceId] = useState("");

  const selectedPiece =
    state.pieces.find((piece) => piece.id === selectedPieceId) ?? state.pieces[0] ?? null;

  useEffect(() => {
    if (selectedPiece && selectedPiece.id !== selectedPieceId) {
      setSelectedPieceId(selectedPiece.id);
    }
    if (!selectedPiece && selectedPieceId) {
      setSelectedPieceId("");
    }
  }, [selectedPiece, selectedPieceId]);

  function addMember(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;

    const member = {
      id: makeId("m"),
      name,
      instrument: String(formData.get("instrument") ?? ""),
      part: String(formData.get("part") ?? "").trim()
    };

    updateState({
      members: [...state.members, member],
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        absentMemberIds: Array.from(new Set([...day.absentMemberIds, member.id]))
      }))
    });
  }

  function deleteMember(memberId: string) {
    const member = state.members.find((item) => item.id === memberId);
    if (!member || !confirm(`${member.name} を削除しますか？`)) return;

    updateState({
      members: state.members.filter((item) => item.id !== memberId),
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        availabilities: day.availabilities.filter((item) => item.memberId !== memberId),
        absentMemberIds: day.absentMemberIds.filter((id) => id !== memberId),
        respondedMemberIds: day.respondedMemberIds.filter((id) => id !== memberId)
      })),
      pieces: state.pieces.map((piece) => ({
        ...piece,
        conductorId: piece.conductorId === memberId ? "" : piece.conductorId,
        memberIds: piece.memberIds.filter((id) => id !== memberId)
      }))
    });
  }

  function addPiece(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;

    const pieceId = makeId("p");
    updateState({
      pieces: [
        ...state.pieces,
        {
          id: pieceId,
          title,
          conductorId: "",
          memberIds: [],
          targetMinutes: 60,
          dailyMaxMinutes: 45,
          targetRangeStartDayId: sortedPracticeDays[0]?.id ?? null,
          targetRangeEndDayId: sortedPracticeDays[sortedPracticeDays.length - 1]?.id ?? null
        }
      ]
    });
    setSelectedPieceId(pieceId);
  }

  function updateSelectedPiece(formData: FormData) {
    if (!selectedPiece) return;

    updateState({
      pieces: state.pieces.map((piece) =>
        piece.id === selectedPiece.id
          ? {
              ...piece,
              conductorId: String(formData.get("conductorId") ?? ""),
              targetMinutes: Number(formData.get("targetMinutes") ?? 60),
              dailyMaxMinutes: Number(formData.get("dailyMaxMinutes") ?? 45),
              targetRangeStartDayId: String(formData.get("targetRangeStartDayId") ?? "") || null,
              targetRangeEndDayId: String(formData.get("targetRangeEndDayId") ?? "") || null
            }
          : piece
      )
    });
  }

  function deleteSelectedPiece() {
    if (!selectedPiece || !confirm(`${selectedPiece.title} を削除しますか？`)) return;

    const nextPieces = state.pieces.filter((piece) => piece.id !== selectedPiece.id);
    updateState({
      pieces: nextPieces,
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        plan: day.plan.filter((slot) => slot.pieceId !== selectedPiece.id)
      })),
      recentMinutes: Object.fromEntries(Object.entries(state.recentMinutes).filter(([id]) => id !== selectedPiece.id))
    });
    setSelectedPieceId(nextPieces[0]?.id ?? "");
  }

  const defaultStartDayId = sortedPracticeDays[0]?.id ?? "";
  const defaultEndDayId = sortedPracticeDays[sortedPracticeDays.length - 1]?.id ?? "";

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用URL</p>
        <h1>メンバー・曲の追加</h1>
        <p>まず曲名だけ追加して、そのあと詳細を設定する流れにしています。</p>
        <div className="row">
          <Link className="button secondary" href="/admin">
            管理画面へ戻る
          </Link>
        </div>
      </section>

      <div className="grid">
        <section className="panel stack">
          <h2>メンバーを追加</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              addMember(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <input name="name" placeholder="名前" required />
            <select name="instrument" defaultValue="" required>
              <option value="" disabled>
                楽器を選択
              </option>
              {INSTRUMENT_OPTIONS.map((instrument) => (
                <option key={instrument} value={instrument}>
                  {instrument}
                </option>
              ))}
            </select>
            <input name="part" placeholder="パート名（任意）" />
            <button type="submit">メンバーを追加</button>
          </form>

          <details className="fold-panel" open>
            <summary>
              現在のメンバー
              <span className="muted">{state.members.length}人</span>
            </summary>
            <div className="fold-panel-body stack">
              {state.members.length === 0 ? <p className="muted">まだメンバーがいません。</p> : null}
              {state.members.map((member) => (
                <div className="row" key={member.id}>
                  <div>
                    <strong>{member.name}</strong>
                    <div className="muted">
                      {member.instrument || "未設定"}
                      {member.part ? ` / ${member.part}` : ""}
                    </div>
                  </div>
                  <button className="danger" type="button" onClick={() => deleteMember(member.id)}>
                    削除
                  </button>
                </div>
              ))}
            </div>
          </details>
        </section>

        <section className="panel stack">
          <h2>曲を追加</h2>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              addPiece(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <input name="title" placeholder="まずは曲名だけ追加" required />
            <button type="submit">曲を追加</button>
          </form>

          <details className="fold-panel" open>
            <summary>
              追加済みの曲
              <span className="muted">{state.pieces.length}曲</span>
            </summary>
            <div className="fold-panel-body stack">
              {state.pieces.length === 0 ? <p className="muted">まだ曲がありません。</p> : null}
              {state.pieces.map((piece) => (
                <button
                  key={piece.id}
                  type="button"
                  className={`piece-select-button${selectedPiece?.id === piece.id ? " is-active" : ""}`}
                  onClick={() => setSelectedPieceId(piece.id)}
                >
                  <span>{piece.title}</span>
                </button>
              ))}
            </div>
          </details>

          {selectedPiece ? (
            <section className="panel subtle-panel stack">
              <div className="row">
                <div>
                  <p className="muted">選択中の曲</p>
                  <h3>{selectedPiece.title}</h3>
                </div>
                <button className="danger" type="button" onClick={deleteSelectedPiece}>
                  この曲を削除
                </button>
              </div>

              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateSelectedPiece(new FormData(event.currentTarget));
                }}
              >
                <label>
                  指揮者
                  <select name="conductorId" defaultValue={selectedPiece.conductorId}>
                    <option value="">指揮者を選択</option>
                    {state.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="date-time-grid">
                  <label>
                    期間の開始日
                    <select
                      name="targetRangeStartDayId"
                      defaultValue={selectedPiece.targetRangeStartDayId ?? defaultStartDayId}
                      disabled={sortedPracticeDays.length === 0}
                    >
                      {sortedPracticeDays.map((day) => (
                        <option key={day.id} value={day.id}>
                          {day.practiceDate}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    期間の終了日
                    <select
                      name="targetRangeEndDayId"
                      defaultValue={selectedPiece.targetRangeEndDayId ?? defaultEndDayId}
                      disabled={sortedPracticeDays.length === 0}
                    >
                      {sortedPracticeDays.map((day) => (
                        <option key={day.id} value={day.id}>
                          {day.practiceDate}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <p className="muted">この曲の目標時間をどの練習日範囲で見るかを選びます。</p>

                <label>
                  その期間で確保したい練習時間
                  <input name="targetMinutes" type="number" min="0" step="5" defaultValue={selectedPiece.targetMinutes} />
                </label>
                <label>
                  1日の最大練習時間
                  <input
                    name="dailyMaxMinutes"
                    type="number"
                    min="15"
                    step="5"
                    defaultValue={selectedPiece.dailyMaxMinutes}
                  />
                </label>
                <div className="notice">
                  参加メンバーはここでは指定しません。奏者側で入力された参加曲をそのまま使います。
                </div>

                <button type="submit">この曲の設定を保存</button>
              </form>
            </section>
          ) : null}

          <div className="stack">
            <strong>現在の曲</strong>
            {state.pieces.length === 0 ? <p className="muted">まだ曲がありません。</p> : null}
            {state.pieces.map((piece) => {
              const targetRange = resolvePieceTargetRange(state, piece);
              const plannedMinutes =
                getPlannedMinutesByPiece(state, {
                  practiceDayIds: targetRange.days.map((day) => day.id)
                }).get(piece.id) ?? 0;
              const remainingMinutes = Math.max(0, piece.targetMinutes - plannedMinutes);

              return (
                <div className="row" key={piece.id}>
                  <div>
                    <strong>{piece.title}</strong>
                    <div className="muted">
                      指揮者: {state.members.find((member) => member.id === piece.conductorId)?.name ?? "未設定"} / 参加者{" "}
                      {piece.memberIds.length}人
                    </div>
                    <div className="muted">対象期間: {targetRange.label}</div>
                    <div className="muted">
                      期間目標 {piece.targetMinutes}分 / 現在 {plannedMinutes}分 / 残り {remainingMinutes}分
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}
