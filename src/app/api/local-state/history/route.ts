import { NextResponse } from "next/server";
import { readHistory } from "@/lib/history";

export const runtime = "nodejs";

export async function GET() {
  try {
    const entries = await readHistory();
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "履歴の取得に失敗しました。" },
      { status: 500 }
    );
  }
}
