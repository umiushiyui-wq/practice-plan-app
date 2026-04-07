export function parseTimeToMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) {
    throw new Error("時刻は HH:mm 形式で入力してください。");
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);

  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    throw new Error("時刻の範囲が正しくありません。");
  }

  const total = hours * 60 + minutes;
  if (total % 5 !== 0) {
    throw new Error("時刻は5分単位で入力してください。");
  }

  return total;
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${hours.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}`;
}

export function validateTimeRange(startMinutes: number, endMinutes: number): void {
  if (startMinutes >= endMinutes) {
    throw new Error("開始時刻は終了時刻より前にしてください。");
  }

  if (startMinutes % 5 !== 0 || endMinutes % 5 !== 0) {
    throw new Error("時刻は5分単位で入力してください。");
  }
}

export function rangeContains(
  ranges: Array<{ startMinutes: number; endMinutes: number }>,
  startMinutes: number,
  endMinutes: number
): boolean {
  return ranges.some((range) => range.startMinutes <= startMinutes && range.endMinutes >= endMinutes);
}

export function overlaps(
  a: { startMinutes: number; endMinutes: number },
  b: { startMinutes: number; endMinutes: number }
): boolean {
  return a.startMinutes < b.endMinutes && b.startMinutes < a.endMinutes;
}

export function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00+09:00`);
}
