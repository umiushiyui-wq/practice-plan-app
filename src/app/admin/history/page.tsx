import { AdminGate } from "@/components/AdminGate";
import { AdminHistoryApp } from "@/components/AdminHistoryApp";

export default function AdminHistoryPage() {
  return (
    <AdminGate>
      <AdminHistoryApp />
    </AdminGate>
  );
}
