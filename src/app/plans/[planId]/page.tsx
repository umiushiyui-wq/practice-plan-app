import { PlanEditorClient } from "@/components/PlanEditorClient";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { minutesToTime } from "@/lib/time";

type Explanation = {
  reasonText?: string;
};

export default async function PlanPage({
  params
}: {
  params: Promise<{ planId: string }>;
}) {
  const user = await requireUser();
  const { planId } = await params;
  const plan = await prisma.plan.findFirstOrThrow({
    where: { id: planId, practiceDay: { workspaceId: user.workspaceId } },
    include: {
      practiceDay: { include: { pieces: { include: { piece: true } } } },
      slots: { include: { piece: true }, orderBy: [{ startMinutes: "asc" }, { position: "asc" }] }
    }
  });

  return (
    <PlanEditorClient
      planId={plan.id}
      practiceDayId={plan.practiceDayId}
      status={plan.status}
      role={user.role}
      pieces={plan.practiceDay.pieces.map((practiceDayPiece) => ({
        id: practiceDayPiece.piece.id,
        title: practiceDayPiece.piece.title
      }))}
      slots={plan.slots.map((slot) => {
        const explanation = slot.explanationJson as Explanation | null;
        return {
          id: slot.id,
          slotType: slot.slotType,
          pieceId: slot.pieceId,
          pieceTitle: slot.piece?.title ?? null,
          startTime: minutesToTime(slot.startMinutes),
          endTime: minutesToTime(slot.endMinutes),
          durationMinutes: slot.durationMinutes,
          source: slot.source,
          isLocked: slot.isLocked,
          scoreTotal: slot.scoreTotal?.toString() ?? null,
          scoreAttendance: slot.scoreAttendance?.toString() ?? null,
          scoreProgress: slot.scoreProgress?.toString() ?? null,
          scorePenalty: slot.scorePenalty?.toString() ?? null,
          reasonText: explanation?.reasonText ?? null
        };
      })}
    />
  );
}
