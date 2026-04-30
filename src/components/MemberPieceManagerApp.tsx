"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  getPlannedMinutesByPiece,
  getPracticeDayLabel,
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

  const selectedPieceSummary = useMemo(() => {
    if (!selectedPiece) return null;
    const targetRange = resolvePieceTargetRange(state, selectedPiece);
    const plannedMinutes =
      getPlannedMinutesByPiece(state, {
        practiceDayIds: targetRange.days.map((day) => day.id)
      }).get(selectedPiece.id) ?? 0;

    return {
      targetRange,
      plannedMinutes,
      remainingMinutes: Math.max(0, selectedPiece.targetMinutes - plannedMinutes)
    };
  }, [selectedPiece, state]);

  function addMember(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;
    const password = String(formData.get("password") ?? "").trim();

    const member = {
      id: makeId("m"),
      name,
      instrument: String(formData.get("instrument") ?? ""),
      part: String(formData.get("part") ?? "").trim(),
      password
    };

    updateState({
      members: [...state.members, member],
      practiceDays: state.practiceDays.map((day) => ({
        ...day
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

  function resetMemberPassword(memberId: string) {
    const member = state.members.find((item) => item.id === memberId);
    if (!member || !confirm(`${member.name} のパスワードをリセットしますか？`)) return;

    updateState({
      members: state.members.map((item) =>
        item.id === memberId
          ? {
              ...item,
              password: "__unset__"
            }
          : item
      )
    });
  }

  function addPracticeDay(formData: FormData) {
    const practiceDate = String(formData.get("practiceDate") ?? "").trim();
    if (!practiceDate) return;

    const startTime = String(formData.get("startTime") ?? "18:00");
    const endTime = String(formData.get("endTime") ?? "21:00");
    const location = String(formData.get("location") ?? "").trim();
    const id = makeId("d");

    updateState({
      selectedPracticeDayId: id,
      practiceDays: [
        ...state.practiceDays,
        {
          id,
          practiceDate,
          location,
          startTime,
          endTime,
          availabilities: [],
          absentMemberIds: [],
          respondedMemberIds: [],
          isPlanPublished: false,
          plan: []
        }
      ]
    });
  }

  function updatePracticeDayDetails(dayId: string, formData: FormData) {
    const practiceDate = String(formData.get("practiceDate") ?? "").trim();
    if (!practiceDate) return;

    updateState({
      practiceDays: state.practiceDays.map((day) =>
        day.id === dayId
          ? {
              ...day,
              practiceDate,
              location: String(formData.get("location") ?? "").trim(),
              startTime: String(formData.get("startTime") ?? day.startTime),
              endTime: String(formData.get("endTime") ?? day.endTime)
            }
          : day
      )
    });
  }

  function addPiece(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;

    const conductorId = String(formData.get("conductorId") ?? "").trim();
    const pieceId = makeId("p");

    updateState({
      pieces: [
        ...state.pieces,
        {
          id: pieceId,
          title,
          conductorId,
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
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;

    updateState({
      pieces: state.pieces.map((piece) =>
        piece.id === selectedPiece.id
          ? {
              ...piece,
              title,
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

  function clearPieceSettings(pieceId: string) {
    const piece = state.pieces.find((item) => item.id === pieceId);
    if (!piece || !confirm(`${piece.title} の練習時間と期間設定を消去しますか？`)) return;

    updateState({
      pieces: state.pieces.map((item) =>
        item.id === pieceId
          ? {
              ...item,
              conductorId: "",
              memberIds: [],
              targetMinutes: 60,
              dailyMaxMinutes: 45,
              targetRangeStartDayId: sortedPracticeDays[0]?.id ?? null,
              targetRangeEndDayId: sortedPracticeDays[sortedPracticeDays.length - 1]?.id ?? null
            }
          : item
      ),
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        plan: day.plan.filter((slot) => slot.pieceId !== pieceId)
      })),
      recentMinutes: Object.fromEntries(Object.entries(state.recentMinutes).filter(([id]) => id !== pieceId))
    });
  }

  function deletePiece(pieceId: string) {
    const piece = state.pieces.find((item) => item.id === pieceId);
    if (!piece || !confirm(`${piece.title} を曲一覧から削除しますか？`)) return;

    const nextPieces = state.pieces.filter((item) => item.id !== piece.id);
    updateState({
      pieces: nextPieces,
      practiceDays: state.practiceDays.map((day) => ({
        ...day,
        plan: day.plan.filter((slot) => slot.pieceId !== piece.id)
      })),
      recentMinutes: Object.fromEntries(Object.entries(state.recentMinutes).filter(([id]) => id !== piece.id))
    });

    if (selectedPieceId === piece.id) {
      setSelectedPieceId(nextPieces[0]?.id ?? "");
    }
  }

  const defaultStartDayId = sortedPracticeDays[0]?.id ?? "";
  const defaultEndDayId = sortedPracticeDays[sortedPracticeDays.length - 1]?.id ?? "";

  return (
    <main className="stack setup-page">
      <section className="panel stack">
        <p className="muted">準備ページ</p>
        <h1>メンバー・練習日・曲の追加</h1>
        <p>このページでは、計画を作る前の準備だけをまとめて進めます。上から順番に埋めれば迷わない流れにしています。</p>
        <div className="row">
          <Link className="button secondary" href="/admin">
            練習計画の画面へ
          </Link>
        </div>
      </section>

      <div className="stack">
        <section id="members" className="panel stack">
          <div className="section-title">
            <p className="muted">Step 1</p>
            <h2>メンバーを追加</h2>
          </div>
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
            <input name="part" placeholder="パート名" />
            <input type="hidden" name="password" value="__unset__" />
            <button type="submit">メンバーを追加</button>
          </form>
          <details className="fold-panel" open>
            <summary>
              現在のメンバー
              <span className="muted">{state.members.length}人</span>
            </summary>
            <div className="fold-panel-body stack">
              {state.members.length === 0 ? <p className="muted">まだメンバーは登録されていません。</p> : null}
              {state.members.map((member) => (
                <div className="row" key={member.id}>
                  <div>
                    <strong>{member.name}</strong>
                    <div className="muted">
                      {member.instrument || "楽器未設定"}
                      {member.part ? ` / ${member.part}` : ""}
                    </div>
                    <div className="muted">{member.password && member.password !== "__unset__" ? "パスワード設定済み" : "初回ログイン時に設定"}</div>
                  </div>
                  <div className="row">
                    <button className="secondary" type="button" onClick={() => resetMemberPassword(member.id)}>
                      パスワードリセット
                    </button>
                    <button className="danger" type="button" onClick={() => deleteMember(member.id)}>
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </details>
        </section>

        <section id="practice-days" className="panel stack">
          <div className="section-title">
            <p className="muted">Step 2</p>
            <h2>練習日を追加</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              addPracticeDay(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <label>
              日付
              <input name="practiceDate" type="date" required />
            </label>
            <label>
              練習場所
              <input name="location" placeholder="例: 市民ホール" />
            </label>
            <div className="date-time-grid">
              <label>
                開始
                <input name="startTime" type="time" step="300" defaultValue="18:00" required />
              </label>
              <label>
                終了
                <input name="endTime" type="time" step="300" defaultValue="21:00" required />
              </label>
            </div>
            <button type="submit">練習日を追加</button>
          </form>
          <details className="fold-panel" open>
            <summary>
              入力済みの練習日
              <span className="muted">{sortedPracticeDays.length}日</span>
            </summary>
            <div className="fold-panel-body stack">
              {sortedPracticeDays.length === 0 ? <p className="muted">まだ練習日はありません。</p> : null}
              {sortedPracticeDays.map((day) => (
                <form
                  className="stack setup-edit-form"
                  key={day.id}
                  onSubmit={(event) => {
                    event.preventDefault();
                    updatePracticeDayDetails(day.id, new FormData(event.currentTarget));
                  }}
                >
                  <div className="row">
                    <div>
                      <strong>{getPracticeDayLabel(day)}</strong>
                      <div className="muted">
                        {day.startTime} - {day.endTime}
                      </div>
                    </div>
                    <button className="secondary" type="submit">
                      この練習日を保存
                    </button>
                  </div>
                  <label>
                    日付
                    <input name="practiceDate" type="date" defaultValue={day.practiceDate} required />
                  </label>
                  <label>
                    練習場所
                    <input name="location" defaultValue={day.location} placeholder="例: 市民ホール" />
                  </label>
                  <div className="date-time-grid">
                    <label>
                      開始
                      <input name="startTime" type="time" step="300" defaultValue={day.startTime} required />
                    </label>
                    <label>
                      終了
                      <input name="endTime" type="time" step="300" defaultValue={day.endTime} required />
                    </label>
                  </div>
                </form>
              ))}
            </div>
          </details>
        </section>

        <section id="pieces" className="panel stack">
          <div className="section-title">
            <p className="muted">Step 3</p>
            <h2>曲を追加して設定する</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              addPiece(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <input name="title" placeholder="曲名" required />
            <select name="conductorId" required defaultValue="">
              <option value="" disabled>
                指揮者を選択
              </option>
              {state.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <button type="submit">曲を追加</button>
          </form>
          <details className="fold-panel" open>
            <summary>
              追加済みの曲
              <span className="muted">{state.pieces.length}曲</span>
            </summary>
            <div className="fold-panel-body stack">
              {state.pieces.length === 0 ? <p className="muted">まだ曲はありません。</p> : null}
              {state.pieces.map((piece) => (
                <button
                  key={piece.id}
                  type="button"
                  className={`piece-select-button${selectedPiece?.id === piece.id ? " is-active" : ""}`}
                  onClick={() => setSelectedPieceId(piece.id)}
                >
                  <span>{piece.title}</span>
                  <span className="muted">{state.members.find((member) => member.id === piece.conductorId)?.name ?? "指揮者未設定"}</span>
                </button>
              ))}
            </div>
          </details>

          {selectedPiece ? (
            <section className="panel subtle-panel stack" key={selectedPiece.id}>
              <div className="row">
                <div>
                  <p className="muted">選択中の曲</p>
                  <h3>{selectedPiece.title}</h3>
                </div>
                <div className="row">
                  <button className="secondary" type="button" onClick={() => clearPieceSettings(selectedPiece.id)}>
                    練習時間などの項目を消去
                  </button>
                  <button className="danger" type="button" onClick={() => deletePiece(selectedPiece.id)}>
                    曲を削除
                  </button>
                </div>
              </div>

              {selectedPieceSummary ? (
                <div className="plan-summary-grid setup-summary-grid">
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">対象期間</span>
                    <strong>{selectedPieceSummary.targetRange.days.length}</strong>
                    <span className="muted">{selectedPieceSummary.targetRange.label}</span>
                  </article>
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">期間目標</span>
                    <strong>{selectedPiece.targetMinutes}分</strong>
                    <span className="muted">期間全体で確保したい時間</span>
                  </article>
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">現在</span>
                    <strong>{selectedPieceSummary.plannedMinutes}分</strong>
                    <span className="muted">計画に入っている時間</span>
                  </article>
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">残り</span>
                    <strong>{selectedPieceSummary.remainingMinutes}分</strong>
                    <span className="muted">まだ必要な時間</span>
                  </article>
                </div>
              ) : null}

              <form
                className="stack"
                onSubmit={(event) => {
                  event.preventDefault();
                  updateSelectedPiece(new FormData(event.currentTarget));
                }}
              >
                <label>
                  曲名
                  <input name="title" defaultValue={selectedPiece.title} required />
                </label>
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
                          {getPracticeDayLabel(day)}
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
                          {getPracticeDayLabel(day)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
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
                <button type="submit">この曲の設定を保存</button>
              </form>
            </section>
          ) : (
            <div className="plan-empty-state">
              <strong>曲を選ぶと、ここに設定欄が出ます。</strong>
              <p className="muted">まず上の「追加済みの曲」から 1 曲選んでください。</p>
            </div>
          )}

          <div className="stack setup-piece-list">
            <strong>現在の曲</strong>
            {state.pieces.length === 0 ? <p className="muted">まだ曲はありません。</p> : null}
            {state.pieces.map((piece) => {
              const targetRange = resolvePieceTargetRange(state, piece);
              const plannedMinutes =
                getPlannedMinutesByPiece(state, {
                  practiceDayIds: targetRange.days.map((day) => day.id)
                }).get(piece.id) ?? 0;
              const remainingMinutes = Math.max(0, piece.targetMinutes - plannedMinutes);

              return (
                <div className="row setup-piece-row" key={piece.id}>
                  <div>
                    <strong>{piece.title}</strong>
                    <div className="muted">
                      指揮者: {state.members.find((member) => member.id === piece.conductorId)?.name ?? "未設定"}
                    </div>
                    <div className="muted">対象期間: {targetRange.label}</div>
                    <div className="muted">
                      期間目標 {piece.targetMinutes}分 / 現在 {plannedMinutes}分 / 残り {remainingMinutes}分
                    </div>
                  </div>
                  <button className="secondary setup-piece-edit-button" type="button" onClick={() => setSelectedPieceId(piece.id)}>
                    この曲を編集
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

