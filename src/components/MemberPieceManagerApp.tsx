"use client";

import Link from "next/link";
import { makeId, useLocalPracticeState } from "@/components/LocalPracticeApp";

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

  function addPiece(formData: FormData) {
    const title = String(formData.get("title") ?? "").trim();
    if (!title) return;

    updateState({
      pieces: [
        ...state.pieces,
        {
          id: makeId("p"),
          title,
          conductorId: String(formData.get("conductorId") ?? ""),
          memberIds: formData.getAll("memberIds").map(String),
          targetMinutes: Number(formData.get("targetMinutes") ?? 60),
          dailyMaxMinutes: Number(formData.get("dailyMaxMinutes") ?? 45)
        }
      ]
    });
  }

  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">管理者用URL</p>
        <h1>メンバー・曲の追加</h1>
        <p>メンバー登録と曲登録をまとめて行うページです。</p>
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
          <div className="stack">
            <strong>現在のメンバー</strong>
            {state.members.map((member) => (
              <div className="row" key={member.id}>
                <span>{member.name}</span>
                <span className="muted">
                  {member.instrument || "未設定"}
                  {member.part ? ` / ${member.part}` : ""}
                </span>
              </div>
            ))}
          </div>
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
            <input name="title" placeholder="曲名" required />
            <select name="conductorId" required>
              <option value="">指揮者を選択</option>
              {state.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <label>
              期間内の目標練習時間
              <input name="targetMinutes" type="number" min="0" step="5" defaultValue="60" />
            </label>
            <label>
              1日の最大練習時間
              <input name="dailyMaxMinutes" type="number" min="15" step="5" defaultValue="45" />
            </label>
            <div className="stack">
              <strong>参加メンバー</strong>
              {state.members.map((member) => (
                <label className="row" key={member.id}>
                  <input style={{ width: "auto" }} name="memberIds" type="checkbox" value={member.id} />
                  {member.name}
                </label>
              ))}
            </div>
            <button type="submit">曲を追加</button>
          </form>
          <div className="stack">
            <strong>現在の曲</strong>
            {state.pieces.map((piece) => (
              <div className="row" key={piece.id}>
                <span>{piece.title}</span>
                <span className="muted">
                  指揮者: {state.members.find((member) => member.id === piece.conductorId)?.name ?? "未設定"} / 参加者{" "}
                  {piece.memberIds.length}人
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
