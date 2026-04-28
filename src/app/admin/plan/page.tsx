import { AdminGate } from "@/components/AdminGate";
import { AdminApp } from "@/components/AdminApp";

export default function AdminPlanPage() {
  return (
    <AdminGate>
      <AdminApp />
    </AdminGate>
  );
}
