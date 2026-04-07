import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ pieceId: string }> }
) {
  const user = await requireUser();
  const { pieceId } = await context.params;
  const piece = await prisma.piece.findFirstOrThrow({
    where: { id: pieceId, workspaceId: user.workspaceId },
    include: { members: { include: { user: true } } }
  });
  return NextResponse.json({ members: piece.members });
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ pieceId: string }> }
) {
  const user = await requireAdmin();
  const { pieceId } = await context.params;
  const body = await request.json();
  const userIds = Array.isArray(body.userIds)
    ? Array.from(new Set((body.userIds as unknown[]).map(String)))
    : [];

  await prisma.piece.findFirstOrThrow({ where: { id: pieceId, workspaceId: user.workspaceId } });

  await prisma.$transaction([
    prisma.pieceMember.deleteMany({ where: { pieceId } }),
    prisma.pieceMember.createMany({
      data: userIds.map((memberId) => ({ pieceId, userId: memberId, weight: 1 }))
    })
  ]);

  return NextResponse.json({ ok: true });
}
