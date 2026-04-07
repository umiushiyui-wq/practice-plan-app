import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { badRequest } from "@/lib/api";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { postSlackMessage } from "@/lib/slack";

export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ practiceDayId: string }> }
) {
  const user = await requireAdmin();
  const { practiceDayId } = await context.params;
  if (!config.slackBotToken) return badRequest("SLACK_BOT_TOKEN が未設定です。");

  const practiceDay = await prisma.practiceDay.findFirstOrThrow({
    where: { id: practiceDayId, workspaceId: user.workspaceId },
    include: {
      workspace: true,
      pieces: { include: { piece: { include: { conductor: true, members: { include: { user: true } } } } } },
      availabilities: true
    }
  });

  const targetUsers = new Map<string, { id: string; slackUserId: string; displayName: string }>();
  for (const practiceDayPiece of practiceDay.pieces) {
    const conductor = practiceDayPiece.piece.conductor;
    if (conductor) {
      targetUsers.set(conductor.id, conductor);
    }
    for (const member of practiceDayPiece.piece.members) {
      targetUsers.set(member.user.id, member.user);
    }
  }

  const answeredUserIds = new Set(practiceDay.availabilities.map((availability) => availability.userId));
  const unanswered = Array.from(targetUsers.values()).filter((targetUser) => !answeredUserIds.has(targetUser.id));

  if (unanswered.length === 0) {
    return NextResponse.json({ ok: true, message: "未回答者はいません。" });
  }

  const channel = practiceDay.workspace.reminderChannelId || config.slackReminderChannelId;
  if (!channel) return badRequest("Slack投稿先チャンネルが未設定です。");

  const dateLabel = practiceDay.practiceDate.toISOString().slice(0, 10);
  const appUrl = `${config.appUrl}/practice-days/${practiceDay.id}`;
  const message = [
    `${dateLabel} 練習計画の回答が未提出の方:`,
    ...unanswered.map((targetUser) => `- <@${targetUser.slackUserId}>`),
    "",
    `以下のURLから参加可能時間と出演曲を入力してください。`,
    appUrl
  ].join("\n");

  const result = await postSlackMessage({
    botToken: config.slackBotToken,
    channel,
    text: message
  });

  if (!result.ok) {
    return badRequest(`Slack投稿に失敗しました: ${result.error ?? "unknown"}`, 502);
  }

  await prisma.reminderLog.create({
    data: {
      practiceDayId,
      slackChannelId: channel,
      sentByUserId: user.id,
      slackTs: result.ts ?? null,
      unansweredUserCount: unanswered.length,
      messageSnapshot: message
    }
  });

  return NextResponse.json({ ok: true, unansweredUserCount: unanswered.length });
}
