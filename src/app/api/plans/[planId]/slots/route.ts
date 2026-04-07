import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { badRequest } from "@/lib/api";
import { validateManualSlot } from "@/lib/planValidation";
import { prisma } from "@/lib/prisma";
import { parseTimeToMinutes, validateTimeRange } from "@/lib/time";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const user = await requireAdmin();
  const { planId } = await context.params;
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

  const slotType = body.slotType === "break" ? "break" : "piece";
  const startMinutes = parseTimeToMinutes(String(body.startTime ?? ""));
  const endMinutes = parseTimeToMinutes(String(body.endTime ?? ""));
  validateTimeRange(startMinutes, endMinutes);
  const error = validateManualSlot({
    slotType,
    pieceId: slotType === "piece" ? String(body.pieceId) : null,
    startMinutes,
    endMinutes,
    practiceDay: plan.practiceDay,
    existingSlots: plan.slots
  });
  if (error) return badRequest(error);

  const maxPosition = plan.slots.reduce((max, slot) => Math.max(max, slot.position), -1);
  const slot = await prisma.planSlot.create({
    data: {
      planId,
      slotType,
      pieceId: slotType === "piece" ? String(body.pieceId) : null,
      startMinutes,
      endMinutes,
      durationMinutes: endMinutes - startMinutes,
      position: maxPosition + 1,
      source: "manual",
      isLocked: true
    },
    include: { piece: true }
  });

  return NextResponse.json({ slot }, { status: 201 });
}
