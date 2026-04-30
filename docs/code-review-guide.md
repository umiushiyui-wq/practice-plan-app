# Code Review Guide

このドキュメントは、コードレビュー担当者がアプリ全体を把握しやすくするための案内です。
画面表示やアプリの挙動は変更せず、読む順番と主要な責務だけを整理しています。

## まず見る場所

1. `src/app/page.tsx`
   - トップページです。
   - 奏者ページ、管理者ページ、表ビューへの入口を確認できます。

2. `src/components/LocalPracticeApp.tsx`
   - ローカル保存版の中心です。
   - メンバー、曲、練習日、出欠、練習計画の型定義と状態管理があります。
   - 自動計画生成のロジックもここにまとまっています。

3. `src/components/AdminApp.tsx`
   - 管理者が練習計画を編集する画面です。
   - 練習日の選択、公開/非公開、ドラッグ操作による計画編集を扱います。

4. `src/components/MemberPieceManagerApp.tsx`
   - 準備ページです。
   - 奏者、練習日、曲の追加と曲ごとの目標設定を扱います。

5. `src/components/PlayerApp.tsx`
   - 奏者が自分の出欠と参加曲を入力する画面です。
   - パスワード確認、練習日ごとの出欠入力、公開済み計画の表示があります。

6. `src/components/SheetViewApp.tsx`
   - 共有しやすい表形式の練習計画表示です。
   - 練習計画が非公開の場合の表示制御もここで扱います。

## ローカル保存版の画面

このアプリには、ローカル保存版として次の画面があります。

- `/admin`
  - 練習計画の編集画面です。
- `/admin/setup`
  - 奏者、練習日、曲の準備画面です。
- `/player`
  - 奏者向けの入力画面です。
- `/availability`
  - 管理者向けの参加可能時間一覧です。
- `/color-map`
  - 曲ごとの参加可能人数を色で見る画面です。
- `/sheet`
  - 練習計画表の共有用ビューです。

これらは `useLocalPracticeState` を通じて同じ状態を読み書きします。

## 状態保存

ローカル保存版の状態は `src/components/LocalPracticeApp.tsx` の `useLocalPracticeState` が管理します。

主な保存先は次の2つです。

- ブラウザの `localStorage`
- `/api/local-state`

`/api/local-state` は環境によって保存先が変わります。

- ローカルでは `.data/local-practice-state.json`
- Vercelなどでは Upstash Redis または Vercel KV

## 主なデータ型

`LocalPracticeApp.tsx` にある主要型です。

- `Member`
  - 奏者情報です。
- `Piece`
  - 曲、指揮者、出演者、目標練習時間を持ちます。
- `LocalPracticeDay`
  - 練習日、場所、練習時間、出欠、公開状態、計画を持ちます。
- `Availability`
  - 奏者ごとの参加可能時間です。
- `PlanSlot`
  - 練習計画の1枠です。

## 自動計画生成

自動計画生成は `generatePracticePlan` にあります。

見るポイントは次の通りです。

- 練習時間の範囲内だけを候補にする
- 指揮者が参加できない時間は除外する
- 曲ごとの対象期間と目標練習時間を考慮する
- 同じ曲の回数や1日の上限時間を考慮する
- 参加率と進捗遅れをスコア化して枠を選ぶ

## DB/Slack版のコード

`src/app/api`、`src/lib`、`prisma/schema.prisma` には、SlackログインやDB保存を使うMVP側のコードがあります。

ローカル保存版だけを見る場合は、最初は次の範囲を優先すると追いやすいです。

- `src/components/*App.tsx`
- `src/app/*/page.tsx`
- `src/app/api/local-state/route.ts`

## レビュー時の確認コマンド

```bash
npm install
npm.cmd run typecheck
```

Windows PowerShellでは `npm run typecheck` が実行ポリシーで止まる場合があります。
その場合は `npm.cmd run typecheck` を使います。

## 重点レビュー観点

- `LocalPracticeApp.tsx`
  - 状態移行処理で既存データが壊れないか
  - 自動計画生成の制約が期待通りか

- `AdminApp.tsx`
  - ドラッグ操作、時間変更、公開/非公開の状態更新が破綻しないか

- `PlayerApp.tsx`
  - パスワード設定済み/未設定、未入力/入力済み、欠席/出席の分岐が自然か

- `SheetViewApp.tsx`
  - 非公開の練習計画が表ビューに出ないか

- `api/local-state`
  - ローカル、Redis、Vercel KVの保存先切り替えが期待通りか

