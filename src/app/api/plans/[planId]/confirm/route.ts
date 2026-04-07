import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ planId: string }> }
) {
  const user = await requireAdmin();
  const { planId } = await context.params;
  const plan = await prisma.plan.findFirstOrThrow({
    where: { id: planId, practiceDay: { workspaceId: user.workspaceId } }
  });

  const confirmed = await prisma.$transaction(async (tx) => {
    await tx.plan.updateMany({
      where: { practiceDayId: plan.practiceDayId, status: "confirmed" },
      data: { status: "proposed" }
    });
    const updated = await tx.plan.update({
      where: { id: planId },
      data: { status: "confirmed", confirmedAt: new Date(), confirmedByUserId: user.id },
      include: { slots: { include: { piece: true }, orderBy: { position: "asc" } } }
    });
    await tx.practiceDay.update({ where: { id: plan.practiceDayId }, data: { status: "confirmed" } });
    return updated;
  });

  return NextResponse.json({ plan: confirmed });
}
