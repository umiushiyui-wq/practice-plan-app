import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { appendHistoryEntry } from "@/lib/history";
import { listConversationMembers, openSlackConversation, postSlackMessage } from "@/lib/slack";

export const runtime = "nodejs";

const MAX_TEXT_LENGTH = 2000;

// 選んだ人に一人ずつDMで催促する。送り先は、そのチャンネルのメンバーに限る。
export async function POST(request: Request) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN が未設定です。" }, { status: 500 });
    }
    const botToken = config.slackBotToken;

    const body = (await request.json().catch(() => null)) as {
      channel?: unknown;
      userIds?: unknown;
      text?: unknown;
      names?: unknown;
    } | null;
    const channel = typeof body?.channel === "string" ? body.channel : "";
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const userIds = Array.isArray(body?.userIds)
      ? Array.from(new Set(body.userIds.filter((id): id is string => typeof id === "string")))
      : [];
    const names = body?.names && typeof body.names === "object" ? (body.names as Record<string, unknown>) : {};

    if (!channel || userIds.length === 0 || !text) {
      return NextResponse.json({ error: "送信先とメッセージを入力してください。" }, { status: 400 });
    }
    if (text.length > MAX_TEXT_LENGTH) {
      return NextResponse.json({ error: `メッセージは${MAX_TEXT_LENGTH}文字以内にしてください。` }, { status: 400 });
    }

    const membersResult = await listConversationMembers({ botToken, channel });
    if (!membersResult.ok) {
      return NextResponse.json({ error: `チャンネルのメンバーを取得できませんでした（${membersResult.error}）。` }, { status: 400 });
    }
    const channelMembers = new Set(membersResult.members);
    const targets = userIds.filter((id) => channelMembers.has(id));
    const skippedCount = userIds.length - targets.length;

    const failures: Array<{ userId: string; name: string; error: string }> = [];
    let sentCount = 0;
    for (const userId of targets) {
      const name = typeof names[userId] === "string" ? (names[userId] as string) : userId;
      const conversation = await openSlackConversation({ botToken, userId });
      const dmChannel = conversation.channel?.id;
      if (!conversation.ok || !dmChannel) {
        failures.push({ userId, name, error: conversation.error ?? "dm_open_failed" });
        continue;
      }

      const posted = await postSlackMessage({ botToken, channel: dmChannel, text });
      if (posted.ok) sentCount += 1;
      else failures.push({ userId, name, error: posted.error ?? "post_failed" });
    }

    const summary = `送信 ${sentCount}人 / 失敗 ${failures.length}人${skippedCount > 0 ? ` / チャンネル外のため除外 ${skippedCount}人` : ""}`;
    await appendHistoryEntry({
      category: "slack",
      kind: "reaction-reminder",
      practiceDayId: "",
      practiceDateLabel: "-",
      success: failures.length === 0,
      summary,
      detail: failures.length > 0 ? failures.map((failure) => `${failure.name}: ${failure.error}`).join("、") : undefined
    }).catch(() => null);

    return NextResponse.json({ ok: true, sentCount, failures, skippedCount, summary });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "催促メッセージを送信できませんでした。" },
      { status: 500 }
    );
  }
}
