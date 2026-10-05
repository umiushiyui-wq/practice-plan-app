"use client";

import { useEffect, useState } from "react";
import { APP_OUTDATED_EVENT } from "@/lib/appVersion";

// 新しいバージョンが公開されたときに、再読み込みを促すポップアップ。
// 「あとで」で閉じても、全体保存は再読み込みするまで止まったまま（出欠入力などの部分保存は続けられる）。
export function AppUpdateNotice() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    function open() {
      setIsOpen(true);
    }
    window.addEventListener(APP_OUTDATED_EVENT, open);
    return () => window.removeEventListener(APP_OUTDATED_EVENT, open);
  }, []);

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" role="alertdialog" aria-modal="true" aria-labelledby="app-update-title">
      <div className="modal-card app-update-card">
        <h2 id="app-update-title">新しいバージョンが公開されました</h2>
        <p>
          データの食い違いを防ぐため、ページを再読み込みしてください。再読み込みするまで、設定や計画などの保存は止めています（出欠の入力や乗り番のチェックはそのまま保存できます）。
        </p>
        <div className="row">
          <button type="button" onClick={() => window.location.reload()}>
            再読み込み
          </button>
          <button className="secondary" type="button" onClick={() => setIsOpen(false)}>
            あとで
          </button>
        </div>
      </div>
    </div>
  );
}
