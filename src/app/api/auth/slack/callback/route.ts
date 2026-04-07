import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";
import { exchangeSlackCode, fetchSlackUserInfo } from "@/lib/slack";
import { setSessionCookie } from "@/lib/auth";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const expectedState = request.cookies.get("slack_oauth_state")?.value;

  if (!code || !state || !expectedState || state !== expectedState) {
    return NextResponse.redirect(new URL("/?error=slack_state", request.url));
  }

  const token = await exchangeSlackCode(code);
  if (!token.ok || !token.authed_user?.id || !token.authed_user.access_token || !token.team?.id) {
    return NextResponse.redirect(new URL(`/?error=${token.error ?? "slack_oauth"}`, request.url));
  }

  if (token.team.id !== config.allowedSlackTeamId) {
    return NextResponse.redirect(new URL("/?error=workspace_not_allowed", request.url));
  }

  const identity = await fetchSlackUserInfo(token.authed_user.access_token);
  if (!identity.ok || !identity.user?.id) {
    return NextResponse.redirect(new URL(`/?error=${identity.error ?? "slack_identity"}`, request.url));
  }

  const workspace = await prisma.workspace.upsert({
    where: { slackTeamId: token.team.id },
    create: {
      slackTeamId: token.team.id,
      name: token.team.name,
      allowed: true,
      reminderChannelId: config.slackReminderChannelId || null
    },
    update: {
      name: token.team.name,
      allowed: true,
      reminderChannelId: config.slackReminderChannelId || undefined
    }
  });

  const existingUsers = await prisma.user.count({ where: { workspaceId: workspace.id } });
  const displayName =
    identity.user.profile?.display_name ||
    identity.user.profile?.real_name ||
    identity.user.real_name ||
    identity.user.name ||
    identity.user.id;

  const user = await prisma.user.upsert({
    where: {
      workspaceId_slackUserId: {
        workspaceId: workspace.id,
        slackUserId: identity.user.id
      }
    },
    create: {
      workspaceId: workspace.id,
      slackUserId: identity.user.id,
      slackTeamId: token.team.id,
      displayName,
      realName: identity.user.real_name ?? identity.user.profile?.real_name ?? null,
      avatarUrl: identity.user.profile?.image_72 ?? null,
      role: existingUsers === 0 ? "admin" : "member",
      lastLoginAt: new Date()
    },
    update: {
      slackTeamId: token.team.id,
      displayName,
      realName: identity.user.real_name ?? identity.user.profile?.real_name ?? null,
      avatarUrl: identity.user.profile?.image_72 ?? null,
      isActive: true,
      lastLoginAt: new Date()
    }
  });

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  response.cookies.set("slack_oauth_state", "", { path: "/", maxAge: 0 });
  setSessionCookie(response, { userId: user.id, workspaceId: workspace.id, role: user.role });
  return response;
}
