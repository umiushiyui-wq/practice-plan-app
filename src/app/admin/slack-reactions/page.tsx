import { AdminGate } from "@/components/AdminGate";
import { SlackReactionsApp } from "@/components/SlackReactionsApp";

export default function SlackReactionsPage() {
  return (
    <AdminGate>
      <SlackReactionsApp />
    </AdminGate>
  );
}
