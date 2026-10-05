import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import {
  getBotUserId,
  getMessageReactions,
  listConversationMembers,
  listCustomEmoji,
  listWorkspaceUsers,
  parseSlackMessageUrl
} from "@/lib/slack";
import slackEmojiMap from "@/lib/slackEmojiMap.json";

export const runtime = "nodejs";

const STANDARD_EMOJI = slackEmojiMap as Record<string, string>;

export type ReactionSummary = {
  name: string;
  emoji: string | null;
  imageUrl: string | null;
  userIds: string[];
};

export type SlackReactionsInspectResult = {
  ok: true;
  channel: string;
  timestamp: string;
  permalink: string;
  posterId: string | null;
  messageText: string;
  reactions: ReactionSummary[];
  // ボット・投稿者を除いたチャンネルメンバー
  memberIds: string[];
  // users:read があるときだけ入る（Slack上の表示名）
  slackNames: Record<string, string>;
  warnings: string[];
};

function describeSlackError(error: string | undefined, needed: string | undefined) {
  switch (error) {
    case "missing_scope":
      return `Slackアプリに権限 ${needed ?? ""} がありません。Slackアプリの設定で追加し、ワークスペースに再インストールしてください。`;
    case "channel_not_found":
    case "not_in_channel":
      return "ボットがこのチャンネルに入っていないため読み取れません。チャンネルにボットを追加してください。";
    case "message_not_found":
    case "no_item_specified":
      return "投稿が見つかりませんでした。URLを確認してください。";
    default:
      return `Slackからの取得に失敗しました（${error ?? "unknown"}）。`;
  }
}

// "+1::skin-tone-2" のような肌色違いは元の絵文字にまとめる
function baseReactionName(name: string) {
  return name.split("::")[0];
}

function resolveCustomEmoji(name: string, customEmoji: Record<string, string>, depth = 0): { emoji: string | null; imageUrl: string | null } {
  const value = customEmoji[name];
  if (!value) return { emoji: STANDARD_EMOJI[name] ?? null, imageUrl: null };
  if (value.startsWith("alias:") && depth < 3) return resolveCustomEmoji(value.slice("alias:".length), customEmoji, depth + 1);
  return { emoji: null, imageUrl: value.startsWith("http") ? value : null };
}

export async function POST(request: Request) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN が未設定です。" }, { status: 500 });
    }
    const botToken = config.slackBotToken;

    const body = (await request.json().catch(() => null)) as { url?: unknown } | null;
    const parsed = typeof body?.url === "string" ? parseSlackMessageUrl(body.url) : null;
    if (!parsed) {
      return NextResponse.json(
        { error: "SlackのメッセージURL（https://〜.slack.com/archives/チャンネルID/p〜）を入力してください。" },
        { status: 400 }
      );
    }

    const reactionsResult = await getMessageReactions({ botToken, ...parsed });
    if (!reactionsResult.ok || !reactionsResult.message) {
      return NextResponse.json({ error: describeSlackError(reactionsResult.error, reactionsResult.needed) }, { status: 400 });
    }

    const membersResult = await listConversationMembers({ botToken, channel: parsed.channel });
    if (!membersResult.ok) {
      return NextResponse.json({ error: describeSlackError(membersResult.error, undefined) }, { status: 400 });
    }

    const warnings: string[] = [];
    const [usersResult, emojiResult, botUserId] = await Promise.all([
      listWorkspaceUsers({ botToken }),
      listCustomEmoji({ botToken }),
      getBotUserId({ botToken })
    ]);

    const slackUsers = new Map(usersResult.users.map((user) => [user.id, user]));
    if (!usersResult.ok) {
      warnings.push("Slackアプリに users:read 権限がないため、アプリ未登録の人は名前が出ず、ボットも除外しきれない場合があります。");
    }
    const customEmoji = emojiResult.ok ? (emojiResult.emoji ?? {}) : {};
    if (!emojiResult.ok) {
      warnings.push("Slackアプリに emoji:read 権限がないため、カスタム絵文字は名前で表示します。");
    }

    const posterId = reactionsResult.message.user ?? null;
    const memberIds = membersResult.members.filter((id) => {
      const user = slackUsers.get(id);
      return id !== botUserId && id !== posterId && !user?.isBot && !user?.deleted;
    });

    const grouped = new Map<string, Set<string>>();
    for (const reaction of reactionsResult.message.reactions ?? []) {
      const name = baseReactionName(reaction.name);
      const users = grouped.get(name) ?? new Set<string>();
      for (const userId of reaction.users) users.add(userId);
      grouped.set(name, users);
    }

    const reactions: ReactionSummary[] = Array.from(grouped, ([name, users]) => ({
      name,
      ...resolveCustomEmoji(name, customEmoji),
      userIds: Array.from(users)
    }));

    const slackNames: Record<string, string> = {};
    for (const id of new Set([...memberIds, ...reactions.flatMap((reaction) => reaction.userIds)])) {
      const user = slackUsers.get(id);
      if (user) slackNames[id] = user.name;
    }

    const result: SlackReactionsInspectResult = {
      ok: true,
      channel: parsed.channel,
      timestamp: parsed.timestamp,
      permalink: reactionsResult.message.permalink ?? body?.url?.toString().trim() ?? "",
      posterId,
      messageText: reactionsResult.message.text ?? "",
      reactions,
      memberIds,
      slackNames,
      warnings
    };
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "リアクションを取得できませんでした。" },
      { status: 500 }
    );
  }
}
