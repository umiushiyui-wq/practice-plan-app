import { AdminGate } from "@/components/AdminGate";
import { SendHistoryApp } from "@/components/SendHistoryApp";

export default function SendHistoryPage() {
  return (
    <AdminGate>
      <SendHistoryApp />
    </AdminGate>
  );
}
