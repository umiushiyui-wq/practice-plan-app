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
  "????",
  "??????",
  "????",
  "???",
  "??????",
  "??????",
  "???????",
  "???????"
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
    if (!member || !confirm(`${member.name} ????????`)) return;

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
    if (!member || !confirm(`${member.name} ????????????????`)) return;

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
    if (!piece || !confirm(`${piece.title} ??????????????????`)) return;

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
    if (!piece || !confirm(`${piece.title} ?????????????`)) return;

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
        <p className="muted">?????</p>
        <h1>?????????????</h1>
        <p>????????????????????????????????????????????????????</p>
        <div className="row">
          <Link className="button secondary" href="/admin">
            ????????
          </Link>
        </div>
      </section>

      <div className="stack">
        <section id="members" className="panel stack">
          <div className="section-title">
            <p className="muted">Step 1</p>
            <h2>???????</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              addMember(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <input name="name" placeholder="??" required />
            <select name="instrument" defaultValue="" required>
              <option value="" disabled>
                ?????
              </option>
              {INSTRUMENT_OPTIONS.map((instrument) => (
                <option key={instrument} value={instrument}>
                  {instrument}
                </option>
              ))}
            </select>
            <input name="part" placeholder="????" />
            <input type="hidden" name="password" value="__unset__" />
            <button type="submit">???????</button>
          </form>
          <details className="fold-panel" open>
            <summary>
              ???????
              <span className="muted">{state.members.length}?</span>
            </summary>
            <div className="fold-panel-body stack">
              {state.members.length === 0 ? <p className="muted">?????????????????</p> : null}
              {state.members.map((member) => (
                <div className="row" key={member.id}>
                  <div>
                    <strong>{member.name}</strong>
                    <div className="muted">
                      {member.instrument || "?????"}
                      {member.part ? ` / ${member.part}` : ""}
                    </div>
                    <div className="muted">{member.password && member.password !== "__unset__" ? "?????????" : "??????????"}</div>
                  </div>
                  <div className="row">
                    <button className="secondary" type="button" onClick={() => resetMemberPassword(member.id)}>
                      ?????????
                    </button>
                    <button className="danger" type="button" onClick={() => deleteMember(member.id)}>
                      ??
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
            <h2>??????</h2>
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
              ??
              <input name="practiceDate" type="date" required />
            </label>
            <label>
              ????
              <input name="location" placeholder="?: ?????" />
            </label>
            <div className="date-time-grid">
              <label>
                ??
                <input name="startTime" type="time" step="300" defaultValue="18:00" required />
              </label>
              <label>
                ??
                <input name="endTime" type="time" step="300" defaultValue="21:00" required />
              </label>
            </div>
            <button type="submit">??????</button>
          </form>
          <details className="fold-panel" open>
            <summary>
              ????????
              <span className="muted">{sortedPracticeDays.length}?</span>
            </summary>
            <div className="fold-panel-body stack">
              {sortedPracticeDays.length === 0 ? <p className="muted">????????????</p> : null}
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
                      ????????
                    </button>
                  </div>
                  <label>
                    ??
                    <input name="practiceDate" type="date" defaultValue={day.practiceDate} required />
                  </label>
                  <label>
                    ????
                    <input name="location" defaultValue={day.location} placeholder="?: ?????" />
                  </label>
                  <div className="date-time-grid">
                    <label>
                      ??
                      <input name="startTime" type="time" step="300" defaultValue={day.startTime} required />
                    </label>
                    <label>
                      ??
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
            <h2>??????????</h2>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              addPiece(new FormData(event.currentTarget));
              event.currentTarget.reset();
            }}
          >
            <input name="title" placeholder="??" required />
            <select name="conductorId" required defaultValue="">
              <option value="" disabled>
                ??????
              </option>
              {state.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
            <button type="submit">????</button>
          </form>
          <details className="fold-panel" open>
            <summary>
              ??????
              <span className="muted">{state.pieces.length}?</span>
            </summary>
            <div className="fold-panel-body stack">
              {state.pieces.length === 0 ? <p className="muted">??????????</p> : null}
              {state.pieces.map((piece) => (
                <button
                  key={piece.id}
                  type="button"
                  className={`piece-select-button${selectedPiece?.id === piece.id ? " is-active" : ""}`}
                  onClick={() => setSelectedPieceId(piece.id)}
                >
                  <span>{piece.title}</span>
                  <span className="muted">{state.members.find((member) => member.id === piece.conductorId)?.name ?? "??????"}</span>
                </button>
              ))}
            </div>
          </details>

          {selectedPiece ? (
            <section className="panel subtle-panel stack" key={selectedPiece.id}>
              <div className="row">
                <div>
                  <p className="muted">?????</p>
                  <h3>{selectedPiece.title}</h3>
                </div>
                <div className="row">
                  <button className="secondary" type="button" onClick={() => clearPieceSettings(selectedPiece.id)}>
                    ????????????
                  </button>
                  <button className="danger" type="button" onClick={() => deletePiece(selectedPiece.id)}>
                    ????
                  </button>
                </div>
              </div>

              {selectedPieceSummary ? (
                <div className="plan-summary-grid setup-summary-grid">
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">????</span>
                    <strong>{selectedPieceSummary.targetRange.days.length}</strong>
                    <span className="muted">{selectedPieceSummary.targetRange.label}</span>
                  </article>
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">????</span>
                    <strong>{selectedPiece.targetMinutes}?</strong>
                    <span className="muted">????????????</span>
                  </article>
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">??</span>
                    <strong>{selectedPieceSummary.plannedMinutes}?</strong>
                    <span className="muted">??????????</span>
                  </article>
                  <article className="plan-stat-card">
                    <span className="plan-stat-label">??</span>
                    <strong>{selectedPieceSummary.remainingMinutes}?</strong>
                    <span className="muted">???????</span>
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
                  ??
                  <input name="title" defaultValue={selectedPiece.title} required />
                </label>
                <label>
                  ???
                  <select name="conductorId" defaultValue={selectedPiece.conductorId}>
                    <option value="">??????</option>
                    {state.members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="date-time-grid">
                  <label>
                    ??????
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
                    ??????
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
                  ??????????????
                  <input name="targetMinutes" type="number" min="0" step="5" defaultValue={selectedPiece.targetMinutes} />
                </label>
                <label>
                  1????????
                  <input
                    name="dailyMaxMinutes"
                    type="number"
                    min="15"
                    step="5"
                    defaultValue={selectedPiece.dailyMaxMinutes}
                  />
                </label>
                <button type="submit">?????????</button>
              </form>
            </section>
          ) : (
            <div className="plan-empty-state">
              <strong>?????????????????</strong>
              <p className="muted">?????????????? 1 ?????????</p>
            </div>
          )}

          <div className="stack setup-piece-list">
            <strong>????</strong>
            {state.pieces.length === 0 ? <p className="muted">??????????</p> : null}
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
                      ???: {state.members.find((member) => member.id === piece.conductorId)?.name ?? "???"}
                    </div>
                    <div className="muted">????: {targetRange.label}</div>
                    <div className="muted">
                      ???? {piece.targetMinutes}? / ?? {plannedMinutes}? / ?? {remainingMinutes}?
                    </div>
                  </div>
                  <button className="secondary setup-piece-edit-button" type="button" onClick={() => setSelectedPieceId(piece.id)}>
                    ??????
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

