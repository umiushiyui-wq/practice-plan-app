import { NextResponse } from "next/server";
import { readSendHistory } from "@/lib/sendHistory";

export const runtime = "nodejs";

export async function GET() {
  try {
    const entries = await readSendHistory();
    return NextResponse.json({ entries });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "履歴の取得に失敗しました。" },
      { status: 500 }
    );
  }
}
