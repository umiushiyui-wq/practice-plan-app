import { NextResponse } from "next/server";
import { clearSessionCookie } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.redirect(new URL("/", process.env.APP_URL ?? "http://localhost:3000"));
  clearSessionCookie(response);
  return response;
}
