import { AdminGate } from "@/components/AdminGate";
import { PieceMembersApp } from "@/components/PieceMembersApp";

export default async function PieceMembersPage({
  params
}: {
  params: Promise<{ pieceId: string }>;
}) {
  const { pieceId } = await params;

  return (
    <AdminGate>
      <PieceMembersApp pieceId={pieceId} />
    </AdminGate>
  );
}
