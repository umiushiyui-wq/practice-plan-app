import { NextResponse } from "next/server";
import {
  hasMemberPassword,
  listPasswordMemberIds,
  resetMemberPassword,
  setMemberPasswordIfUnset,
  verifyMemberPassword
} from "@/lib/memberPasswords";

export const runtime = "nodejs";

const MAX_PASSWORD_LENGTH = 100;

// 奏者パスワードの設定・照合・リセット。パスワードはサーバー側でハッシュ化して保存し、ブラウザには返さない。
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as {
      action?: unknown;
      memberId?: unknown;
      password?: unknown;
    } | null;
    const action = body?.action;
    const memberId = typeof body?.memberId === "string" ? body.memberId : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!memberId) return NextResponse.json({ error: "奏者が指定されていません。" }, { status: 400 });

    if (action === "reset") {
      await resetMemberPassword(memberId);
      return NextResponse.json({ ok: true, passwordMemberIds: await listPasswordMemberIds() });
    }

    if (!password.trim() || password.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json({ error: "パスワードを入力してください。" }, { status: 400 });
    }

    if (action === "set") {
      const didSet = await setMemberPasswordIfUnset(memberId, password);
      if (!didSet) {
        return NextResponse.json({ error: "すでにパスワードが設定されています。ページを再読み込みしてください。" }, { status: 409 });
      }
      return NextResponse.json({ ok: true, passwordMemberIds: await listPasswordMemberIds() });
    }

    if (action === "verify") {
      if (!(await hasMemberPassword(memberId))) {
        return NextResponse.json({ error: "まだパスワードが設定されていません。ページを再読み込みしてください。" }, { status: 409 });
      }
      if (!(await verifyMemberPassword(memberId, password))) {
        return NextResponse.json({ error: "パスワードが違います。" }, { status: 401 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ error: "不正な操作です。" }, { status: 400 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "パスワードを処理できませんでした。" },
      { status: 500 }
    );
  }
}
