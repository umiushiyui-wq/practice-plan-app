import { randomBytes } from "crypto";
import { NextResponse } from "next/server";
import { config } from "@/lib/config";
import { buildSlackAuthorizeUrl } from "@/lib/slack";

export async function GET() {
  if (!config.slackClientId || !config.slackClientSecret || !config.allowedSlackTeamId) {
    return NextResponse.redirect(new URL("/?error=slack_env_missing", config.appUrl));
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(buildSlackAuthorizeUrl(state));

  response.cookies.set("slack_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60
  });

  return response;
}
