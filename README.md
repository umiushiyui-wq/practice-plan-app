# 吹奏楽 練習計画アプリ

Slackワークスペース参加者だけがログインできる、吹奏楽団向けの練習計画MVPです。

## セットアップ

```bash
npm install
cp .env.example .env
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

Windows PowerShellでは `.env.example` を `.env` にコピーして値を編集してください。

## 必要な環境変数

```text
DATABASE_URL
APP_URL
SESSION_SECRET
ALLOWED_SLACK_TEAM_ID
SLACK_CLIENT_ID
SLACK_CLIENT_SECRET
SLACK_REDIRECT_URI
SLACK_BOT_TOKEN
SLACK_REMINDER_CHANNEL_ID
```

`ALLOWED_SLACK_TEAM_ID` とSlack OAuthで返る `team.id` が一致するユーザーだけログインできます。

## Slack App

- OAuth Redirect URL: `SLACK_REDIRECT_URI`
- Bot Token Scope: `chat:write`
- User Token Scope: `identity.basic`, `identity.avatar`
- リマインド投稿先チャンネルにはBotを参加させてください。

## MVPのスケジューリング方針

- 5分単位で候補枠を作ります。
- 曲の1枠は最低15分です。
- 同じ曲は1日最大2回までです。
- 1曲の1日最大練習時間は曲ごとに設定できます。初期値は45分です。
- 指揮者が参加できない時間帯はハード制約として除外します。
- 参加率は全体人数ではなく、その曲の出演者集合に対して計算します。
- 直近の確定済み計画から曲ごとの累積練習分を集計し、目標累積時間に対して遅れている曲を優先します。
- 自動提案枠にはスコア内訳と理由を保存し、管理者画面で表示します。

## 初回管理者

対象Slackワークスペースで最初にログインしたユーザーを `admin` にします。

## Vercelで公開URLを作る

ローカル保存版の `/admin`、`/player`、`/availability`、`/sheet` は、`/api/local-state` 経由で共有 state を保存します。

正式な保存先は Upstash Redis または Vercel KV です。Vercel のサーバー内ファイル保存は永続化されないため、本番環境では使いません。

ローカル開発時だけ、Redis / KV が未設定の場合に `.data/local-practice-state.json` へフォールバックします。`NODE_ENV=production` では Redis / KV が未設定だと `/api/local-state` は 500 を返します。

ブラウザの `localStorage` は正式な保存先ではありません。サーバーに state がある場合は必ずサーバー state を優先します。サーバー state が空で、この端末にだけ古い `localStorage` データがある場合は、画面上の「旧データをサーバーへ移行」ボタンを押した時だけ共有 state として保存します。自動移行はしません。

### 必要な環境変数

```text
DATABASE_URL
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
LOCAL_STATE_KEY
```

Vercel KVを使う場合は、Vercel側が作る `KV_REST_API_URL` と `KV_REST_API_TOKEN` でも動きます。

```text
DATABASE_URL
KV_REST_API_URL
KV_REST_API_TOKEN
LOCAL_STATE_KEY
```

ローカル保存版だけをまず公開する場合でも、Prisma client生成のために `DATABASE_URL` は必要です。最初は `file:./dev.db` を入れてください。

`LOCAL_STATE_KEY` は省略できます。複数の団体やテスト環境を分けたいときだけ、例えば `nagosui:2026-spring` のように変えてください。

### デプロイの流れ

1. GitHubにこのプロジェクトを置く
2. VercelでGitHubリポジトリをImportする
3. StorageでVercel KV、またはUpstash Redisを作る
4. VercelのEnvironment Variablesに `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` を入れる
5. Deployする
6. 公開URLの `/player` をLINEで送る

管理者用は `/admin`、奏者用は `/player`、参加可能時間表は `/availability`、練習計画表は `/sheet` です。
