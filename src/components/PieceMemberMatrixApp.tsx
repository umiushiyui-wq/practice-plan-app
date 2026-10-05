"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, MouseEvent } from "react";
import {
  compareMembersByInstrument,
  getInstrumentLabel,
  getSortedInstrumentOptions,
  LocalStateStatusPanel,
  normalizeSectionLabel,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";
import type { Member, Piece, PieceMembershipPatch } from "@/components/LocalPracticeApp";
import type { HistoryEntry } from "@/lib/history";

const ALL_PARTS_FILTER = "__all__";
const UNSAVED_CONFIRM_MESSAGE = "保存していない変更があります。破棄して移動しますか？";

type Cell = {
  selected: boolean;
  section: string;
};

function cellKey(pieceId: string, memberId: string) {
  return `${pieceId}:${memberId}`;
}

function getSavedCell(piece: Piece, memberId: string): Cell {
  const selected = piece.memberIds.includes(memberId);
  return { selected, section: selected ? (piece.memberSections[memberId] ?? "") : "" };
}

function isSameCell(draft: Cell, saved: Cell) {
  if (draft.selected !== saved.selected) return false;
  return !draft.selected || normalizeSectionLabel(draft.section) === saved.section;
}

// 縦: メンバー × 横: 曲 の乗り番表。手元で下書きとして編集し、「保存」で変更したマスだけをまとめて送る。
export function PieceMemberMatrixApp() {
  const localState = useLocalPracticeState();
  const { state, ready, savePieceMembershipPatches } = localState;
  const [drafts, setDrafts] = useState<Record<string, Cell>>({});
  const [partFilter, setPartFilter] = useState(ALL_PARTS_FILTER);
  const [isSaving, setIsSaving] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [message, setMessage] = useState<{ kind: "notice" | "error"; text: string } | null>(null);
  const inputRefs = useRef(new Map<string, HTMLInputElement>());

  const pieces = state.pieces;
  const partOptions = useMemo(
    () => getSortedInstrumentOptions(state.members.map((member) => member.instrument)),
    [state.members]
  );
  const visibleMembers = useMemo(() => {
    const sorted = [...state.members].sort(compareMembersByInstrument);
    if (partFilter === ALL_PARTS_FILTER) return sorted;
    return sorted.filter((member) => getInstrumentLabel(member.instrument) === partFilter);
  }, [partFilter, state.members]);

  const pendingPatches = useMemo(() => {
    const patches: PieceMembershipPatch[] = [];

    for (const piece of pieces) {
      for (const member of state.members) {
        const draft = drafts[cellKey(piece.id, member.id)];
        if (!draft || isSameCell(draft, getSavedCell(piece, member.id))) continue;
        patches.push({
          pieceId: piece.id,
          memberId: member.id,
          selected: draft.selected,
          actor: "admin",
          ...(draft.selected ? { section: normalizeSectionLabel(draft.section) } : {})
        });
      }
    }

    return patches;
  }, [drafts, pieces, state.members]);
  const isDirty = pendingPatches.length > 0;

  useEffect(() => {
    if (!isDirty) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  function getCell(piece: Piece, memberId: string) {
    return drafts[cellKey(piece.id, memberId)] ?? getSavedCell(piece, memberId);
  }

  function setCell(piece: Piece, memberId: string, next: Cell) {
    const key = cellKey(piece.id, memberId);
    setDrafts((current) => {
      if (isSameCell(next, getSavedCell(piece, memberId))) {
        const { [key]: _removed, ...rest } = current;
        return rest;
      }
      return { ...current, [key]: next };
    });
    setMessage(null);
  }

  function revertCell(piece: Piece, memberId: string) {
    const key = cellKey(piece.id, memberId);
    setDrafts((current) => {
      const { [key]: _removed, ...rest } = current;
      return rest;
    });
  }

  function focusCell(rowIndex: number, columnIndex: number) {
    const member = visibleMembers[rowIndex];
    const piece = pieces[columnIndex];
    if (!member || !piece) return;
    const input = inputRefs.current.get(cellKey(piece.id, member.id));
    input?.focus();
    input?.select();
  }

  function handleCellKeyDown(event: KeyboardEvent<HTMLInputElement>, rowIndex: number, columnIndex: number, piece: Piece, member: Member) {
    if (event.nativeEvent.isComposing) return;
    const input = event.currentTarget;
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length && input.selectionEnd === input.value.length;

    switch (event.key) {
      case "ArrowUp":
        event.preventDefault();
        focusCell(rowIndex - 1, columnIndex);
        break;
      case "ArrowDown":
        event.preventDefault();
        focusCell(rowIndex + 1, columnIndex);
        break;
      case "Enter":
        event.preventDefault();
        focusCell(rowIndex + (event.shiftKey ? -1 : 1), columnIndex);
        break;
      case "ArrowLeft":
        if (!atStart) return;
        event.preventDefault();
        focusCell(rowIndex, columnIndex - 1);
        break;
      case "ArrowRight":
        if (!atEnd) return;
        event.preventDefault();
        focusCell(rowIndex, columnIndex + 1);
        break;
      case " ": {
        // 空欄でのスペースは「乗る/降りる」の切り替え（セクション未定のまま乗せるため）
        if (input.value !== "") return;
        event.preventDefault();
        const cell = getCell(piece, member.id);
        setCell(piece, member.id, { selected: !cell.selected, section: "" });
        break;
      }
      case "Escape":
        event.preventDefault();
        revertCell(piece, member.id);
        break;
    }
  }

  // 変更履歴から「曲 × 奏者」ごとの最新のセクションを探し、今も乗っていてセクションが空のマスを下書きに埋める。
  // 保存はしないので、確認してから「保存」を押してもらう。
  async function restoreSectionsFromHistory() {
    setIsRestoring(true);
    setMessage(null);

    try {
      const response = await fetch("/api/local-state/history", { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as { entries?: HistoryEntry[]; error?: string } | null;
      if (!response.ok || !payload?.entries) throw new Error(payload?.error ?? "履歴を取得できませんでした。");

      // 履歴には奏者名しかないので、同名の奏者がいる場合は判別できず対象外にする
      const membersByName = new Map<string, Member[]>();
      for (const member of state.members) {
        membersByName.set(member.name, [...(membersByName.get(member.name) ?? []), member]);
      }

      // entries は新しい順。曲 × 奏者名ごとに最初に出てきたもの（最新）だけを見る
      const seen = new Set<string>();
      const restored: Record<string, Cell> = {};
      let ambiguousCount = 0;

      for (const entry of payload.entries) {
        if (entry.category !== "piece-selection") continue;
        const key = `${entry.pieceId}:${entry.memberName}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const section = entry.selected && entry.section ? normalizeSectionLabel(entry.section) : "";
        if (!section) continue;

        const piece = pieces.find((item) => item.id === entry.pieceId);
        const candidates = membersByName.get(entry.memberName) ?? [];
        if (!piece || candidates.length === 0) continue;
        if (candidates.length > 1) {
          ambiguousCount += 1;
          continue;
        }

        const member = candidates[0];
        const saved = getSavedCell(piece, member.id);
        if (!saved.selected || saved.section || drafts[cellKey(piece.id, member.id)]) continue;
        restored[cellKey(piece.id, member.id)] = { selected: true, section };
      }

      const count = Object.keys(restored).length;
      setDrafts((current) => ({ ...current, ...restored }));
      setMessage({
        kind: "notice",
        text:
          (count > 0
            ? `履歴から ${count}マスのセクションを下書きに読み込みました。オレンジ枠のマスを確認して「保存」を押してください。`
            : "履歴から復元できるセクションはありませんでした。") +
          (ambiguousCount > 0 ? `（同じ名前の奏者がいて判別できない ${ambiguousCount}件は対象外）` : "")
      });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "履歴を取得できませんでした。" });
    } finally {
      setIsRestoring(false);
    }
  }

  async function save() {
    if (!isDirty || isSaving) return;
    setIsSaving(true);
    setMessage(null);
    const count = pendingPatches.length;
    const saved = await savePieceMembershipPatches(pendingPatches);
    setIsSaving(false);

    if (saved) {
      setDrafts({});
      setMessage({ kind: "notice", text: `${count}マスの変更を保存しました。` });
    } else {
      setMessage({ kind: "error", text: "保存できませんでした。変更は残っているので、もう一度保存してください。" });
    }
  }

  function discard() {
    if (!isDirty || !confirm("保存していない変更をすべて破棄しますか？")) return;
    setDrafts({});
    setMessage(null);
  }

  function confirmLeave(event: MouseEvent<HTMLAnchorElement>) {
    if (isDirty && !confirm(UNSAVED_CONFIRM_MESSAGE)) event.preventDefault();
  }

  const memberGroups = useMemo(() => {
    const groups: { part: string; members: { member: Member; rowIndex: number }[] }[] = [];
    visibleMembers.forEach((member, rowIndex) => {
      const part = getInstrumentLabel(member.instrument);
      const last = groups[groups.length - 1];
      if (last?.part === part) last.members.push({ member, rowIndex });
      else groups.push({ part, members: [{ member, rowIndex }] });
    });
    return groups;
  }, [visibleMembers]);

  return (
    <main className="stack setup-page">
      <section className="panel stack">
        <Link href="/admin/setup#pieces" onClick={confirmLeave}>
          ← 曲の設定へ戻る
        </Link>
        <p className="muted">管理者用</p>
        <h1>乗り番表</h1>
        <p className="muted">
          縦がメンバー、横が曲です。セクション（例: Fl 2nd, Tb1, Cond）を入力すると、その曲に乗る扱いになります。編集は「保存」を押すまで反映されません。
        </p>
        <p className="muted">
          操作: ↑↓ / Enter で上下に移動、←→ で左右に移動（文字の端で）。空欄でスペースを押すと「セクション未定のまま乗る / 降りる」を切り替え。Esc でそのマスを保存済みの状態に戻します。
        </p>
        <div className="row">
          <button className="secondary" type="button" onClick={restoreSectionsFromHistory} disabled={!ready || isRestoring || isSaving}>
            {isRestoring ? "読み込み中..." : "履歴からセクションを下書きに読み込む"}
          </button>
          <span className="muted">今も乗っていてセクションが空のマスだけを、変更履歴の最新のセクションで埋めます（保存はしません）。</span>
        </div>
        <label>
          パートで絞り込む
          <select value={partFilter} onChange={(event) => setPartFilter(event.target.value)}>
            <option value={ALL_PARTS_FILTER}>すべて</option>
            {partOptions.map((part) => (
              <option key={part} value={part}>
                {part}
              </option>
            ))}
          </select>
        </label>
      </section>

      <LocalStateStatusPanel {...localState} />

      <section className="panel stack">
        {!ready ? <p className="muted">読み込み中...</p> : null}
        {ready && pieces.length === 0 ? <p className="muted">まだ曲が登録されていません。</p> : null}
        {ready && pieces.length > 0 ? (
          <>
            {pieces.map((piece) => (
              <datalist id={`piece-matrix-sections-${piece.id}`} key={piece.id}>
                {Array.from(new Set(Object.values(piece.memberSections)))
                  .sort((a, b) => a.localeCompare(b, "ja", { numeric: true }))
                  .map((section) => (
                    <option key={section} value={section} />
                  ))}
              </datalist>
            ))}
            <div className="piece-matrix-wrap">
              <table className="piece-matrix">
                <thead>
                  <tr>
                    <th>メンバー</th>
                    {pieces.map((piece) => (
                      <th key={piece.id}>
                        <Link href={`/admin/pieces/${piece.id}`} onClick={confirmLeave}>
                          {piece.title || "(無題)"}
                        </Link>
                        <span className="muted">
                          {state.members.filter((member) => getCell(piece, member.id).selected).length}人
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {memberGroups.map((group) => [
                    <tr className="piece-matrix-part-row" key={`part-${group.part}`}>
                      <th>{group.part}</th>
                      <td colSpan={pieces.length} />
                    </tr>,
                    ...group.members.map(({ member, rowIndex }) => (
                      <tr key={member.id}>
                        <th>{member.name}</th>
                        {pieces.map((piece, columnIndex) => {
                          const cell = getCell(piece, member.id);
                          const draft = drafts[cellKey(piece.id, member.id)];
                          const isChanged = Boolean(draft) && !isSameCell(draft, getSavedCell(piece, member.id));
                          const key = cellKey(piece.id, member.id);

                          return (
                            <td
                              key={key}
                              className={[cell.selected ? "is-selected" : "", isChanged ? "is-changed" : ""].filter(Boolean).join(" ")}
                            >
                              <div className="piece-matrix-cell">
                                <input
                                  type="checkbox"
                                  tabIndex={-1}
                                  checked={cell.selected}
                                  aria-label={`${member.name} が ${piece.title} に乗る`}
                                  onChange={(event) =>
                                    setCell(piece, member.id, {
                                      selected: event.target.checked,
                                      section: event.target.checked ? cell.section : ""
                                    })
                                  }
                                />
                                <input
                                  type="text"
                                  ref={(element) => {
                                    if (element) inputRefs.current.set(key, element);
                                    else inputRefs.current.delete(key);
                                  }}
                                  value={cell.section}
                                  list={`piece-matrix-sections-${piece.id}`}
                                  aria-label={`${member.name} の ${piece.title} のセクション`}
                                  onChange={(event) =>
                                    setCell(piece, member.id, {
                                      selected: event.target.value.trim() ? true : cell.selected,
                                      section: event.target.value
                                    })
                                  }
                                  onKeyDown={(event) => handleCellKeyDown(event, rowIndex, columnIndex, piece, member)}
                                />
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  ])}
                </tbody>
              </table>
            </div>
            <div className="legend-row">
              <span className="legend-chip piece-matrix-selected-chip">緑: 乗る</span>
              <span className="legend-chip piece-matrix-changed-chip">オレンジ枠: 未保存の変更</span>
            </div>
          </>
        ) : null}
      </section>

      <div className="piece-matrix-savebar">
        {message ? <span className={message.kind}>{message.text}</span> : null}
        <span className="muted">{isDirty ? `未保存の変更 ${pendingPatches.length}マス` : "未保存の変更はありません"}</span>
        <button className="secondary" type="button" onClick={discard} disabled={!isDirty || isSaving}>
          変更を破棄
        </button>
        <button type="button" onClick={save} disabled={!isDirty || isSaving}>
          {isSaving ? "保存中..." : "保存"}
        </button>
      </div>
    </main>
  );
}
