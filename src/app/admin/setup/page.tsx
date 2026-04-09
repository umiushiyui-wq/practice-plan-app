import { AdminGate } from "@/components/AdminGate";
import { MemberPieceManagerApp } from "@/components/MemberPieceManagerApp";

export default function MemberPieceManagerPage() {
  return (
    <AdminGate>
      <MemberPieceManagerApp />
    </AdminGate>
  );
}
