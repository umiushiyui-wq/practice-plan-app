"use client";

import { useMemo } from "react";
import {
  formatPracticeDateLabel,
  getSortedPracticeDays,
  useLocalPracticeState
} from "@/components/LocalPracticeApp";

// ホームは奏者も最初に見る公開画面のため、人数・出欠などの集計は出さない。
// 公開して問題ない「次の練習日」の予定だけを表示する。
export function HomeSummary() {
  const { state, ready } = useLocalPracticeState();

  const nextDay = useMemo(() => {
    const sorted = getSortedPracticeDays(state.practiceDays);
    if (sorted.length === 0) return null;
    const today = new Date().toISOString().slice(0, 10);
    return sorted.find((day) => day.practiceDate >= today) ?? sorted[sorted.length - 1];
  }, [state.practiceDays]);

  if (!ready || !nextDay) return null;

  const location = nextDay.location.trim();

  return (
    <aside className="home-next" aria-label="次の練習">
      <span className="home-next-label">次の練習</span>
      <strong className="home-next-date">{formatPracticeDateLabel(nextDay.practiceDate)}</strong>
      <span className="home-next-time">
        {nextDay.startTime}〜{nextDay.endTime}
      </span>
      {location ? <span className="home-next-place">＠{location}</span> : null}
    </aside>
  );
}
