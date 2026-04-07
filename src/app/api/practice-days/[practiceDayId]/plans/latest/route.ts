import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ practiceDayId: string }> }
) {
  const user = await requireUser();
  const { practiceDayId } = await context.params;
  await prisma.practiceDay.findFirstOrThrow({ where: { id: practiceDayId, workspaceId: user.workspaceId } });
  const plan = await prisma.plan.findFirst({
    where: { practiceDayId },
    include: { slots: { include: { piece: true }, orderBy: { position: "asc" } } },
    orderBy: { createdAt: "desc" }
  });
  return NextResponse.json({ plan });
}
