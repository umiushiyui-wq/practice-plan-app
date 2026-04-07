import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { generatePracticePlan, RecentPieceMinutes } from "@/lib/scheduler";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ practiceDayId: string }> }
) {
  const user = await requireAdmin();
  const { practiceDayId } = await context.params;
  const practiceDay = await prisma.practiceDay.findFirstOrThrow({
    where: { id: practiceDayId, workspaceId: user.workspaceId },
    include: {
      pieces: {
        include: {
          piece: {
            include: {
              members: true
            }
          }
        }
      },
      availabilities: true
    }
  });

  const recentPlans = await prisma.plan.findMany({
    where: {
      status: "confirmed",
      practiceDay: {
        workspaceId: user.workspaceId,
        practiceDate: { lt: practiceDay.practiceDate }
      }
    },
    include: { slots: true, practiceDay: true },
    orderBy: { practiceDay: { practiceDate: "desc" } },
    take: Math.max(practiceDay.scoringWindowSize - 1, 0)
  });

  const recentPieceMinutes: RecentPieceMinutes = {};
  for (const plan of recentPlans) {
    for (const slot of plan.slots) {
      if (!slot.pieceId || slot.slotType !== "piece") continue;
      recentPieceMinutes[slot.pieceId] =
        (recentPieceMinutes[slot.pieceId] ?? 0) + slot.durationMinutes;
    }
  }

  const generatedSlots = generatePracticePlan({
    startMinutes: practiceDay.startMinutes,
    endMinutes: practiceDay.endMinutes,
    pieces: practiceDay.pieces.map((practiceDayPiece) => ({
      id: practiceDayPiece.piece.id,
      title: practiceDayPiece.piece.title,
      conductorUserId: practiceDayPiece.piece.conductorUserId,
      targetMinutesInWindow: practiceDayPiece.piece.targetMinutesInWindow,
      dailyMaxMinutes: practiceDayPiece.piece.dailyMaxMinutes,
      members: practiceDayPiece.piece.members.map((member) => ({
        userId: member.userId,
        weight: Number(member.weight)
      }))
    })),
    availabilities: practiceDay.availabilities,
    recentPieceMinutes,
    allowBreaks: practiceDay.allowBreaks
  });

  const plan = await prisma.$transaction(async (tx) => {
    const created = await tx.plan.create({
      data: {
        practiceDayId,
        status: "proposed",
        generatedAt: new Date(),
        generatedByUserId: user.id,
        algorithmVersion: "heuristic-v1"
      }
    });

    if (generatedSlots.length > 0) {
      await tx.planSlot.createMany({
        data: generatedSlots.map((slot) => ({
          planId: created.id,
          slotType: slot.slotType,
          pieceId: slot.pieceId,
          startMinutes: slot.startMinutes,
          endMinutes: slot.endMinutes,
          durationMinutes: slot.durationMinutes,
          position: slot.position,
          source: "auto",
          scoreTotal: slot.scoreTotal,
          scoreAttendance: slot.scoreAttendance,
          scoreProgress: slot.scoreProgress,
          scorePenalty: slot.scorePenalty,
          explanationJson: slot.explanationJson
            ? (slot.explanationJson as Prisma.InputJsonValue)
            : Prisma.JsonNull
        }))
      });
    }

    await tx.practiceDay.update({
      where: { id: practiceDayId },
      data: { status: "proposed" }
    });

    return tx.plan.findUniqueOrThrow({
      where: { id: created.id },
      include: { slots: { include: { piece: true }, orderBy: { position: "asc" } } }
    });
  });

  return NextResponse.json({ plan });
}
