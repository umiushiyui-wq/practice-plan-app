import { rangeContains, overlaps } from "@/lib/time";

export type SchedulerUser = {
  id: string;
  displayName: string;
};

export type SchedulerPieceMember = {
  userId: string;
  weight: number;
};

export type SchedulerAvailability = {
  userId: string;
  startMinutes: number;
  endMinutes: number;
};

export type SchedulerPiece = {
  id: string;
  title: string;
  conductorUserId: string | null;
  targetMinutesInWindow: number;
  dailyMaxMinutes: number;
  members: SchedulerPieceMember[];
};

export type RecentPieceMinutes = Record<string, number>;

export type GeneratedPlanSlot = {
  slotType: "piece" | "break";
  pieceId: string | null;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  position: number;
  scoreTotal: number | null;
  scoreAttendance: number | null;
  scoreProgress: number | null;
  scorePenalty: number | null;
  explanationJson: SlotExplanation | null;
};

export type SlotExplanation = {
  conductorAvailable: boolean;
  availableMembers: number;
  totalPieceMembers: number;
  attendanceRate: number;
  targetMinutes: number;
  recentConfirmedMinutes: number;
  progressDelayRate: number;
  dailyPieceMinutesAfterSlot: number;
  pieceOccurrenceAfterSlot: number;
  reasonText: string;
};

type Candidate = {
  piece: SchedulerPiece;
  startMinutes: number;
  endMinutes: number;
  durationMinutes: number;
  scoreTotal: number;
  scoreAttendance: number;
  scoreProgress: number;
  scorePenalty: number;
  explanation: SlotExplanation;
};

const MIN_SLOT_MINUTES = 15;
const STEP_MINUTES = 5;
const MAX_OCCURRENCES_PER_DAY = 2;
const ALGORITHM_WEIGHTS = {
  attendance: 50,
  progress: 35,
  duration: 10,
  splitPenalty: 5,
  overTargetPenalty: 20,
  lowConfidencePenalty: 10
};

export function generatePracticePlan(input: {
  startMinutes: number;
  endMinutes: number;
  pieces: SchedulerPiece[];
  availabilities: SchedulerAvailability[];
  recentPieceMinutes: RecentPieceMinutes;
  allowBreaks: boolean;
}): GeneratedPlanSlot[] {
  const selected: Candidate[] = [];
  const dayMinutesByPiece = new Map<string, number>();
  const occurrencesByPiece = new Map<string, number>();

  while (true) {
    const candidates = buildCandidates(input, selected, dayMinutesByPiece, occurrencesByPiece);
    const best = candidates.sort((a, b) => b.scoreTotal - a.scoreTotal)[0];

    if (!best || best.scoreTotal <= 0) {
      break;
    }

    selected.push(best);
    dayMinutesByPiece.set(
      best.piece.id,
      (dayMinutesByPiece.get(best.piece.id) ?? 0) + best.durationMinutes
    );
    occurrencesByPiece.set(best.piece.id, (occurrencesByPiece.get(best.piece.id) ?? 0) + 1);
  }

  const slots = selected
    .sort((a, b) => a.startMinutes - b.startMinutes)
    .map<GeneratedPlanSlot>((candidate, index) => ({
      slotType: "piece",
      pieceId: candidate.piece.id,
      startMinutes: candidate.startMinutes,
      endMinutes: candidate.endMinutes,
      durationMinutes: candidate.durationMinutes,
      position: index,
      scoreTotal: round(candidate.scoreTotal),
      scoreAttendance: round(candidate.scoreAttendance),
      scoreProgress: round(candidate.scoreProgress),
      scorePenalty: round(candidate.scorePenalty),
      explanationJson: candidate.explanation
    }));

  if (!input.allowBreaks) {
    return slots;
  }

  return withOptionalBreaks(slots);
}

function buildCandidates(
  input: {
    startMinutes: number;
    endMinutes: number;
    pieces: SchedulerPiece[];
    availabilities: SchedulerAvailability[];
    recentPieceMinutes: RecentPieceMinutes;
  },
  selected: Candidate[],
  dayMinutesByPiece: Map<string, number>,
  occurrencesByPiece: Map<string, number>
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const piece of input.pieces) {
    if (!piece.conductorUserId || piece.members.length === 0) {
      continue;
    }

    const alreadyPlannedMinutes = dayMinutesByPiece.get(piece.id) ?? 0;
    const occurrences = occurrencesByPiece.get(piece.id) ?? 0;
    if (alreadyPlannedMinutes >= piece.dailyMaxMinutes || occurrences >= MAX_OCCURRENCES_PER_DAY) {
      continue;
    }

    const maxDuration = Math.min(piece.dailyMaxMinutes - alreadyPlannedMinutes, piece.dailyMaxMinutes);

    for (let duration = MIN_SLOT_MINUTES; duration <= maxDuration; duration += STEP_MINUTES) {
      for (
        let startMinutes = input.startMinutes;
        startMinutes + duration <= input.endMinutes;
        startMinutes += STEP_MINUTES
      ) {
        const endMinutes = startMinutes + duration;

        if (
          selected.some((slot) =>
            overlaps(
              { startMinutes, endMinutes },
              { startMinutes: slot.startMinutes, endMinutes: slot.endMinutes }
            )
          )
        ) {
          continue;
        }

        if (!isUserAvailable(input.availabilities, piece.conductorUserId, startMinutes, endMinutes)) {
          continue;
        }

        const scored = scoreCandidate({
          piece,
          availabilities: input.availabilities,
          recentPieceMinutes: input.recentPieceMinutes,
          startMinutes,
          endMinutes,
          duration,
          alreadyPlannedMinutes,
          occurrences
        });

        candidates.push(scored);
      }
    }
  }

  return candidates;
}

function scoreCandidate(input: {
  piece: SchedulerPiece;
  availabilities: SchedulerAvailability[];
  recentPieceMinutes: RecentPieceMinutes;
  startMinutes: number;
  endMinutes: number;
  duration: number;
  alreadyPlannedMinutes: number;
  occurrences: number;
}): Candidate {
  const totalWeight = input.piece.members.reduce((sum, member) => sum + member.weight, 0);
  const availableMembers = input.piece.members.filter((member) =>
    isUserAvailable(input.availabilities, member.userId, input.startMinutes, input.endMinutes)
  );
  const availableWeight = availableMembers.reduce((sum, member) => sum + member.weight, 0);
  const attendanceRate = totalWeight > 0 ? availableWeight / totalWeight : 0;

  const targetMinutes = Math.max(input.piece.targetMinutesInWindow, 1);
  const recentConfirmedMinutes = input.recentPieceMinutes[input.piece.id] ?? 0;
  const progressDelayRate = Math.max(0, targetMinutes - recentConfirmedMinutes) / targetMinutes;
  const durationScore = Math.min(input.duration, 30) / 30;
  const projectedMinutes =
    recentConfirmedMinutes + input.alreadyPlannedMinutes + input.duration;
  const overTargetPenalty = Math.max(0, projectedMinutes - targetMinutes) / targetMinutes;
  const splitPenalty = input.occurrences > 0 ? 1 : 0;

  const scoreAttendance = attendanceRate * ALGORITHM_WEIGHTS.attendance;
  const scoreProgress = progressDelayRate * ALGORITHM_WEIGHTS.progress;
  const scoreDuration = durationScore * ALGORITHM_WEIGHTS.duration;
  const scorePenalty =
    splitPenalty * ALGORITHM_WEIGHTS.splitPenalty +
    overTargetPenalty * ALGORITHM_WEIGHTS.overTargetPenalty;
  const scoreTotal = scoreAttendance + scoreProgress + scoreDuration - scorePenalty;

  const explanation: SlotExplanation = {
    conductorAvailable: true,
    availableMembers: availableMembers.length,
    totalPieceMembers: input.piece.members.length,
    attendanceRate: round(attendanceRate),
    targetMinutes: input.piece.targetMinutesInWindow,
    recentConfirmedMinutes,
    progressDelayRate: round(progressDelayRate),
    dailyPieceMinutesAfterSlot: input.alreadyPlannedMinutes + input.duration,
    pieceOccurrenceAfterSlot: input.occurrences + 1,
    reasonText: `${input.piece.title}は出演者${input.piece.members.length}人中${availableMembers.length}人が参加可能で、直近期間の目標${input.piece.targetMinutesInWindow}分に対して実績${recentConfirmedMinutes}分のため選ばれました。`
  };

  return {
    piece: input.piece,
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    durationMinutes: input.duration,
    scoreTotal,
    scoreAttendance,
    scoreProgress,
    scorePenalty,
    explanation
  };
}

function isUserAvailable(
  availabilities: SchedulerAvailability[],
  userId: string,
  startMinutes: number,
  endMinutes: number
): boolean {
  return rangeContains(
    availabilities.filter((availability) => availability.userId === userId),
    startMinutes,
    endMinutes
  );
}

function withOptionalBreaks(slots: GeneratedPlanSlot[]): GeneratedPlanSlot[] {
  if (slots.length < 2) return slots;

  const withBreaks: GeneratedPlanSlot[] = [];
  let continuousMinutes = 0;

  slots.forEach((slot, index) => {
    if (index > 0 && continuousMinutes >= 60 && slot.startMinutes - slots[index - 1].endMinutes >= 5) {
      withBreaks.push({
        slotType: "break",
        pieceId: null,
        startMinutes: slots[index - 1].endMinutes,
        endMinutes: slots[index - 1].endMinutes + 5,
        durationMinutes: 5,
        position: withBreaks.length,
        scoreTotal: null,
        scoreAttendance: null,
        scoreProgress: null,
        scorePenalty: null,
        explanationJson: null
      });
      continuousMinutes = 0;
    }

    withBreaks.push({ ...slot, position: withBreaks.length });
    continuousMinutes += slot.durationMinutes;
  });

  return withBreaks.map((slot, position) => ({ ...slot, position }));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
