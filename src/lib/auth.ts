import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@/generated/prisma";
import { config } from "@/lib/config";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "nagosui_session";

type SessionPayload = {
  userId: string;
  workspaceId: string;
  role: UserRole;
  exp: number;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string): string {
  return createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
}

function serializeSession(payload: SessionPayload): string {
  const body = encodeBase64Url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function parseSession(value?: string): SessionPayload | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature) return null;

  const expected = sign(body);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length) return null;
  if (!timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const payload = JSON.parse(decodeBase64Url(body)) as SessionPayload;
    if (payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function getSession() {
  const cookieStore = await cookies();
  return parseSession(cookieStore.get(COOKIE_NAME)?.value);
}

export function getSessionFromRequest(request: NextRequest) {
  return parseSession(request.cookies.get(COOKIE_NAME)?.value);
}

export async function getCurrentUser() {
  const session = await getSession();
  if (!session) return null;

  return prisma.user.findUnique({
    where: { id: session.userId },
    include: { workspace: true }
  });
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/");
  return user;
}

export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

export function setSessionCookie(response: NextResponse, payload: Omit<SessionPayload, "exp">) {
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  response.cookies.set(COOKIE_NAME, serializeSession({ ...payload, exp: Date.now() + oneWeek }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: oneWeek / 1000
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0
  });
}
