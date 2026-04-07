import { PracticeDayClient } from "@/components/PracticeDayClient";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { minutesToTime } from "@/lib/time";

export default async function PracticeDayPage({
  params
}: {
  params: Promise<{ practiceDayId: string }>;
}) {
  const user = await requireUser();
  const { practiceDayId } = await params;
  const [practiceDay, latestPlan] = await Promise.all([
    prisma.practiceDay.findFirstOrThrow({
      where: { id: practiceDayId, workspaceId: user.workspaceId },
      include: {
        pieces: {
          include: {
            piece: {
              include: {
                conductor: true,
                members: true
              }
            }
          }
        },
        availabilities: { where: { userId: user.id }, orderBy: { startMinutes: "asc" } }
      }
    }),
    prisma.plan.findFirst({
      where: { practiceDayId },
      orderBy: { createdAt: "desc" }
    })
  ]);

  return (
    <PracticeDayClient
      practiceDayId={practiceDay.id}
      title={`${practiceDay.practiceDate.toISOString().slice(0, 10)} の練習`}
      timeLabel={`${minutesToTime(practiceDay.startMinutes)}〜${minutesToTime(practiceDay.endMinutes)}`}
      role={user.role}
      pieces={practiceDay.pieces.map((practiceDayPiece) => ({
        id: practiceDayPiece.piece.id,
        title: practiceDayPiece.piece.title,
        conductorName: practiceDayPiece.piece.conductor?.displayName ?? null,
        memberCount: practiceDayPiece.piece.members.length,
        isMine: practiceDayPiece.piece.members.some((member) => member.userId === user.id)
      }))}
      availabilities={practiceDay.availabilities.map((availability) => ({
        startTime: minutesToTime(availability.startMinutes),
        endTime: minutesToTime(availability.endMinutes)
      }))}
      latestPlanId={latestPlan?.id ?? null}
    />
  );
}
