import { DashboardClient } from "@/components/DashboardClient";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { minutesToTime } from "@/lib/time";

export default async function DashboardPage() {
  const user = await requireUser();
  const [users, pieces, practiceDays] = await Promise.all([
    prisma.user.findMany({
      where: { workspaceId: user.workspaceId, isActive: true },
      orderBy: { displayName: "asc" }
    }),
    prisma.piece.findMany({
      where: { workspaceId: user.workspaceId, isActive: true },
      include: { conductor: true },
      orderBy: { title: "asc" }
    }),
    prisma.practiceDay.findMany({
      where: { workspaceId: user.workspaceId },
      include: { pieces: { include: { piece: true } } },
      orderBy: { practiceDate: "desc" }
    })
  ]);

  return (
    <DashboardClient
      currentUser={{
        id: user.id,
        displayName: user.displayName,
        instrument: user.instrument,
        part: user.part,
        role: user.role
      }}
      users={users.map((item) => ({
        id: item.id,
        displayName: item.displayName,
        instrument: item.instrument,
        part: item.part
      }))}
      pieces={pieces.map((piece) => ({
        id: piece.id,
        title: piece.title,
        targetMinutesInWindow: piece.targetMinutesInWindow,
        dailyMaxMinutes: piece.dailyMaxMinutes,
        conductorUserId: piece.conductorUserId,
        conductorName: piece.conductor?.displayName ?? null
      }))}
      practiceDays={practiceDays.map((day) => ({
        id: day.id,
        practiceDate: day.practiceDate.toISOString().slice(0, 10),
        startTime: minutesToTime(day.startMinutes),
        endTime: minutesToTime(day.endMinutes),
        status: day.status,
        pieces: day.pieces.map((item) => item.piece.title)
      }))}
    />
  );
}
