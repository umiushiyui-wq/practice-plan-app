import { AdminGate } from "@/components/AdminGate";
import { AvailabilityTableApp } from "@/components/AvailabilityTableApp";

export default function AdminPage() {
  return (
    <AdminGate>
      <AvailabilityTableApp />
    </AdminGate>
  );
}
