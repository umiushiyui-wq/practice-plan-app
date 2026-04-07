import { PieceEditorClient } from "@/components/PieceEditorClient";
import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export default async function PiecePage({
  params
}: {
  params: Promise<{ pieceId: string }>;
}) {
  const user = await requireAdmin();
  const { pieceId } = await params;
  const [piece, users] = await Promise.all([
    prisma.piece.findFirstOrThrow({
      where: { id: pieceId, workspaceId: user.workspaceId },
      include: { members: true }
    }),
    prisma.user.findMany({
      where: { workspaceId: user.workspaceId, isActive: true },
      orderBy: { displayName: "asc" }
    })
  ]);

  return (
    <PieceEditorClient
      piece={{
        id: piece.id,
        title: piece.title,
        conductorUserId: piece.conductorUserId,
        targetMinutesInWindow: piece.targetMinutesInWindow,
        dailyMaxMinutes: piece.dailyMaxMinutes,
        memberIds: piece.members.map((member) => member.userId)
      }}
      users={users.map((item) => ({ id: item.id, displayName: item.displayName }))}
    />
  );
}
