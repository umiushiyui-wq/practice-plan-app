export const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "local";
export const APP_VERSION_HEADER = "x-app-version";
// 古いバージョンの画面だと分かったときに、共通のポップアップへ知らせるイベント
export const APP_OUTDATED_EVENT = "nagosui:app-outdated";
