import { AdminGate } from "@/components/AdminGate";
import { AvailabilityTableApp } from "@/components/AvailabilityTableApp";

export default function AvailabilityPage() {
  return (
    <AdminGate>
      <AvailabilityTableApp />
    </AdminGate>
  );
}
