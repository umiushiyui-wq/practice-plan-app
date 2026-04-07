import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireUser } from "@/lib/auth";
import { badRequest, toNumber } from "@/lib/api";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await requireUser();
  const pieces = await prisma.piece.findMany({
    where: { workspaceId: user.workspaceId, isActive: true },
    include: {
      conductor: true,
      members: { include: { user: true } }
    },
    orderBy: { title: "asc" }
  });
  return NextResponse.json({ pieces });
}

export async function POST(request: NextRequest) {
  const user = await requireAdmin();
  const body = await request.json();
  const title = String(body.title ?? "").trim();
  if (!title) return badRequest("曲名を入力してください。");

  const piece = await prisma.piece.create({
    data: {
      workspaceId: user.workspaceId,
      title,
      conductorUserId: body.conductorUserId || null,
      targetMinutesInWindow: toNumber(body.targetMinutesInWindow, 60),
      dailyMaxMinutes: toNumber(body.dailyMaxMinutes, 45)
    }
  });

  return NextResponse.json({ piece }, { status: 201 });
}
