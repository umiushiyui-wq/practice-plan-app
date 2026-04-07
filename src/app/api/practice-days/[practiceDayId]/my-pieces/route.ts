import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ practiceDayId: string }> }
) {
  const user = await requireUser();
  const { practiceDayId } = await context.params;
  const practiceDay = await prisma.practiceDay.findFirstOrThrow({
    where: { id: practiceDayId, workspaceId: user.workspaceId },
    include: { pieces: { include: { piece: { include: { members: true } } } } }
  });

  const pieceIds = practiceDay.pieces
    .filter((practiceDayPiece) =>
      practiceDayPiece.piece.members.some((member) => member.userId === user.id)
    )
    .map((practiceDayPiece) => practiceDayPiece.pieceId);

  return NextResponse.json({ pieceIds });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ practiceDayId: string }> }
) {
  const user = await requireUser();
  const { practiceDayId } = await context.params;
  const body = await request.json();
  const pieceIds = Array.isArray(body.pieceIds)
    ? Array.from(new Set((body.pieceIds as unknown[]).map(String)))
    : [];

  const practiceDay = await prisma.practiceDay.findFirstOrThrow({
    where: { id: practiceDayId, workspaceId: user.workspaceId },
    include: { pieces: true }
  });
  const allowedPieceIds = new Set(practiceDay.pieces.map((piece) => piece.pieceId));

  await prisma.$transaction([
    prisma.pieceMember.deleteMany({
      where: { userId: user.id, pieceId: { in: Array.from(allowedPieceIds) } }
    }),
    prisma.pieceMember.createMany({
      data: pieceIds
        .filter((pieceId) => allowedPieceIds.has(pieceId))
        .map((pieceId) => ({ pieceId, userId: user.id, weight: 1 }))
    })
  ]);

  return NextResponse.json({ ok: true });
}
