import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { joinConversation, kickFromConversation } from "@/lib/slack";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    if (!config.slackBotToken) {
      return NextResponse.json({ error: "SLACK_BOT_TOKEN が未設定です。" }, { status: 500 });
    }

    const body = (await request.json().catch(() => null)) as { channelId?: unknown; slackUserId?: unknown } | null;
    const channelId = typeof body?.channelId === "string" ? body.channelId.trim() : "";
    const slackUserId = typeof body?.slackUserId === "string" ? body.slackUserId.trim() : "";
    if (!channelId || !slackUserId) {
      return NextResponse.json({ error: "チャンネルIDとSlack IDが必要です。" }, { status: 400 });
    }

    let kicked = await kickFromConversation({ botToken: config.slackBotToken, channel: channelId, userId: slackUserId });

    if (!kicked.ok && kicked.error === "not_in_channel") {
      const joined = await joinConversation({ botToken: config.slackBotToken, channel: channelId });
      if (!joined.ok) {
        return NextResponse.json(
          { error: `Botがチャンネルに参加できませんでした（${joined.error ?? "join_failed"}）。Botをチャンネルに招待するか、channels:join権限を付与してください。` },
          { status: 502 }
        );
      }
      kicked = await kickFromConversation({ botToken: config.slackBotToken, channel: channelId, userId: slackUserId });
    }

    if (!kicked.ok) {
      return NextResponse.json(
        { error: `退出処理に失敗しました（${kicked.error ?? "kick_failed"}）。channels:manage権限が必要です。` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "退出処理に失敗しました。" },
      { status: 500 }
    );
  }
}
