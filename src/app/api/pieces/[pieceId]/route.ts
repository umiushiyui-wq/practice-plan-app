import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, toNumber } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ pieceId: string }> }
) {
  const user = await requireUser();
  const { pieceId } = await context.params;
  const piece = await prisma.piece.findFirstOrThrow({
    where: { id: pieceId, workspaceId: user.workspaceId },
    include: { conductor: true, members: { include: { user: true } } }
  });
  return NextResponse.json({ piece });
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ pieceId: string }> }
) {
  const user = await requireAdmin();
  const { pieceId } = await context.params;
  const body = await request.json();
  const title = String(body.title ?? "").trim();
  if (!title) return badRequest("曲名を入力してください。");
  await prisma.piece.findFirstOrThrow({ where: { id: pieceId, workspaceId: user.workspaceId } });

  const piece = await prisma.piece.update({
    where: { id: pieceId },
    data: {
      title,
      conductorUserId: body.conductorUserId ? String(body.conductorUserId) : null,
      targetMinutesInWindow: toNumber(body.targetMinutesInWindow, 60),
      dailyMaxMinutes: toNumber(body.dailyMaxMinutes, 45)
    }
  });

  return NextResponse.json({ piece });
}
