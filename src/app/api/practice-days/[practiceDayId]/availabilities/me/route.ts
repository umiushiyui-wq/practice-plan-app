import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { parseTimeToMinutes, validateTimeRange } from "@/lib/time";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ practiceDayId: string }> }
) {
  const user = await requireUser();
  const { practiceDayId } = await context.params;
  const availabilities = await prisma.availability.findMany({
    where: { practiceDayId, userId: user.id },
    orderBy: { startMinutes: "asc" }
  });
  return NextResponse.json({ availabilities });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ practiceDayId: string }> }
) {
  const user = await requireUser();
  const { practiceDayId } = await context.params;
  const body = await request.json();
  const ranges = Array.isArray(body.ranges) ? (body.ranges as unknown[]) : [];

  const data = ranges.map((range) => {
    const rangeInput = range as { startTime?: unknown; endTime?: unknown };
    const startMinutes = parseTimeToMinutes(String(rangeInput.startTime ?? ""));
    const endMinutes = parseTimeToMinutes(String(rangeInput.endTime ?? ""));
    validateTimeRange(startMinutes, endMinutes);
    return { practiceDayId, userId: user.id, startMinutes, endMinutes };
  });

  await prisma.$transaction([
    prisma.availability.deleteMany({ where: { practiceDayId, userId: user.id } }),
    prisma.availability.createMany({ data })
  ]);

  return NextResponse.json({ ok: true });
}
