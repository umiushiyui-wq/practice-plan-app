import { AdminGate } from "@/components/AdminGate";
import { AdminAttendanceRecordApp } from "@/components/AdminAttendanceRecordApp";

export default function AdminAttendanceRecordPage() {
  return (
    <AdminGate>
      <AdminAttendanceRecordApp />
    </AdminGate>
  );
}
