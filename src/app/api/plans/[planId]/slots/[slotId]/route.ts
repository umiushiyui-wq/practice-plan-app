import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { badRequest } from "@/lib/api";
import { validateManualSlot } from "@/lib/planValidation";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { parseTimeToMinutes, validateTimeRange } from "@/lib/time";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ planId: string; slotId: string }> }
) {
  const user = await requireAdmin();
  const { planId, slotId } = await context.params;
  const body = await request.json();
  const plan = await prisma.plan.findFirstOrThrow({
    where: { id: planId, practiceDay: { workspaceId: user.workspaceId } },
    include: {
      practiceDay: {
        include: {
          availabilities: true,
          pieces: { include: { piece: true } }
        }
      },
      slots: true
    }
  });
  await prisma.planSlot.findFirstOrThrow({ where: { id: slotId, planId } });

  const startMinutes = parseTimeToMinutes(String(body.startTime ?? ""));
  const endMinutes = parseTimeToMinutes(String(body.endTime ?? ""));
  validateTimeRange(startMinutes, endMinutes);
  const slotType = body.slotType === "break" ? "break" : "piece";
  const error = validateManualSlot({
    slotIdToIgnore: slotId,
    slotType,
    pieceId: slotType === "piece" ? String(body.pieceId) : null,
    startMinutes,
    endMinutes,
    practiceDay: plan.practiceDay,
    existingSlots: plan.slots
  });
  if (error) return badRequest(error);

  const slot = await prisma.planSlot.update({
    where: { id: slotId },
    data: {
      slotType,
      pieceId: slotType === "piece" ? String(body.pieceId) : null,
      startMinutes,
      endMinutes,
      durationMinutes: endMinutes - startMinutes,
      isLocked: Boolean(body.isLocked ?? true),
      source: "manual",
      scoreTotal: null,
      scoreAttendance: null,
      scoreProgress: null,
      scorePenalty: null,
      explanationJson: Prisma.JsonNull
    },
    include: { piece: true }
  });

  return NextResponse.json({ slot });
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ planId: string; slotId: string }> }
) {
  const user = await requireAdmin();
  const { planId, slotId } = await context.params;
  await prisma.plan.findFirstOrThrow({
    where: { id: planId, practiceDay: { workspaceId: user.workspaceId } }
  });
  await prisma.planSlot.findFirstOrThrow({ where: { id: slotId, planId } });
  await prisma.planSlot.delete({ where: { id: slotId } });
  return NextResponse.json({ ok: true });
}
