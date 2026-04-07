import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, uniqueStrings } from "@/lib/api";
import { prisma } from "@/lib/prisma";
import { parseTimeToMinutes, toDateOnly, validateTimeRange } from "@/lib/time";

export async function GET() {
  const user = await requireUser();
  const practiceDays = await prisma.practiceDay.findMany({
    where: { workspaceId: user.workspaceId },
    include: { pieces: { include: { piece: true } } },
    orderBy: { practiceDate: "desc" }
  });
  return NextResponse.json({ practiceDays });
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  const body = await request.json();
  const practiceDates = uniqueStrings(
    Array.isArray(body.practiceDates)
      ? body.practiceDates
      : body.practiceDate
        ? [body.practiceDate]
        : []
  );
  const startMinutes = parseTimeToMinutes(String(body.startTime ?? ""));
  const endMinutes = parseTimeToMinutes(String(body.endTime ?? ""));
  validateTimeRange(startMinutes, endMinutes);

  if (practiceDates.length === 0) return badRequest("練習日を1日以上入力してください。");

  const pieceIds = uniqueStrings(body.pieceIds);
  const responseDeadline = body.responseDeadline ? new Date(String(body.responseDeadline)) : null;
  const practiceDays = await prisma.$transaction(
    practiceDates.map((practiceDate) =>
      prisma.practiceDay.create({
        data: {
          workspaceId: user.workspaceId,
          practiceDate: toDateOnly(practiceDate),
          startMinutes,
          endMinutes,
          responseDeadline,
          status: "collecting",
          pieces: {
            create: pieceIds.map((pieceId) => ({ pieceId }))
          }
        },
        include: { pieces: true }
      })
    )
  );

  return NextResponse.json({ practiceDay: practiceDays[0], practiceDays }, { status: 201 });
}
