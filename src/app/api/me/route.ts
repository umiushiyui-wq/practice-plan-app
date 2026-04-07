import { NextResponse } from "next/server";
import { NextRequest } from "next/server";
import { getCurrentUser, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const user = await getCurrentUser();
  return NextResponse.json({ user });
}

export async function PATCH(request: NextRequest) {
  const user = await requireUser();
  const body = await request.json();
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      displayName: String(body.displayName ?? user.displayName).trim() || user.displayName,
      instrument: body.instrument ? String(body.instrument).trim() : null,
      part: body.part ? String(body.part).trim() : null
    }
  });
  return NextResponse.json({ user: updated });
}
