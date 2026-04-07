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

ローカル保存版の `/admin`、`/player`、`/availability`、`/sheet` は、`/api/local-state` に状態を保存します。

ローカルでは `.data/local-practice-state.json` に保存します。Vercelではサーバー内ファイルが永続化されないため、Upstash Redis か Vercel KV のREST API環境変数を設定してください。

### 必要な環境変数

```text
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
LOCAL_STATE_KEY
```

Vercel KVを使う場合は、Vercel側が作る `KV_REST_API_URL` と `KV_REST_API_TOKEN` でも動きます。

`LOCAL_STATE_KEY` は省略できます。複数の団体やテスト環境を分けたいときだけ、例えば `nagosui:2026-spring` のように変えてください。

### デプロイの流れ

1. GitHubにこのプロジェクトを置く
2. VercelでGitHubリポジトリをImportする
3. StorageでVercel KV、またはUpstash Redisを作る
4. VercelのEnvironment Variablesに `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` を入れる
5. Deployする
6. 公開URLの `/player` をLINEで送る

管理者用は `/admin`、奏者用は `/player`、参加可能時間表は `/availability`、練習計画表は `/sheet` です。
