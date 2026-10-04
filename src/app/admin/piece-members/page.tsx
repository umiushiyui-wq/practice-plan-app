import { AdminGate } from "@/components/AdminGate";
import { PieceMemberMatrixApp } from "@/components/PieceMemberMatrixApp";

export default function PieceMemberMatrixPage() {
  return (
    <AdminGate>
      <PieceMemberMatrixApp />
    </AdminGate>
  );
}
