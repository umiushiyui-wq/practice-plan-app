import { AdminGate } from "@/components/AdminGate";
import { ColorMapApp } from "@/components/ColorMapApp";

export default function ColorMapPage() {
  return (
    <AdminGate>
      <ColorMapApp />
    </AdminGate>
  );
}
