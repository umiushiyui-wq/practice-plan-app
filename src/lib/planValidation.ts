import { rangeContains, overlaps } from "@/lib/time";

export function validateManualSlot(input: {
  slotIdToIgnore?: string;
  slotType: string;
  pieceId: string | null;
  startMinutes: number;
  endMinutes: number;
  practiceDay: {
    startMinutes: number;
    endMinutes: number;
    availabilities: Array<{ userId: string; startMinutes: number; endMinutes: number }>;
    pieces: Array<{
      pieceId: string;
      piece: {
        id: string;
        title: string;
        conductorUserId: string | null;
        dailyMaxMinutes: number;
      };
    }>;
  };
  existingSlots: Array<{
    id: string;
    slotType: string;
    pieceId: string | null;
    startMinutes: number;
    endMinutes: number;
    durationMinutes: number;
  }>;
}): string | null {
  if (input.startMinutes < input.practiceDay.startMinutes || input.endMinutes > input.practiceDay.endMinutes) {
    return "練習日の時間内に収めてください。";
  }

  const overlapping = input.existingSlots.some((slot) => {
    if (slot.id === input.slotIdToIgnore) return false;
    return overlaps(slot, { startMinutes: input.startMinutes, endMinutes: input.endMinutes });
  });
  if (overlapping) return "他の練習枠と時間が重なっています。";

  if (input.slotType === "break") {
    return input.endMinutes - input.startMinutes === 5 ? null : "休憩は5分で入力してください。";
  }

  if (!input.pieceId) return "曲を選択してください。";
  if (input.endMinutes - input.startMinutes < 15) return "曲の練習枠は最低15分です。";

  const target = input.practiceDay.pieces.find((item) => item.pieceId === input.pieceId)?.piece;
  if (!target) return "この練習日の対象曲から選択してください。";
  if (!target.conductorUserId) return "この曲には指揮者が設定されていません。";

  const conductorAvailable = rangeContains(
    input.practiceDay.availabilities.filter((availability) => availability.userId === target.conductorUserId),
    input.startMinutes,
    input.endMinutes
  );
  if (!conductorAvailable) return "指揮者が参加できない時間帯には配置できません。";

  const samePieceSlots = input.existingSlots.filter(
    (slot) =>
      slot.id !== input.slotIdToIgnore &&
      slot.slotType === "piece" &&
      slot.pieceId === input.pieceId
  );
  if (samePieceSlots.length >= 2) return "同じ曲は1日最大2回までです。";

  const totalMinutes =
    samePieceSlots.reduce((sum, slot) => sum + slot.durationMinutes, 0) +
    (input.endMinutes - input.startMinutes);
  if (totalMinutes > target.dailyMaxMinutes) {
    return `${target.title} の1日最大練習時間 ${target.dailyMaxMinutes}分を超えています。`;
  }

  return null;
}
