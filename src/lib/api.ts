import { NextResponse } from "next/server";

export function badRequest(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export function toNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(values.map(String).map((value) => value.trim()).filter(Boolean)));
}
