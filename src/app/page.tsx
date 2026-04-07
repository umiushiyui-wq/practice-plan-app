import Link from "next/link";

export default function HomePage() {
  return (
    <main className="stack">
      <section className="panel stack">
        <p className="muted">Slack連携なし / ローカル保存版</p>
        <h1>吹奏楽 練習計画</h1>
        <p>使う入口を選んでください。データはこのブラウザに保存されます。</p>
        <div className="row">
          <Link className="button" href="/admin">管理者用URL</Link>
          <Link className="button secondary" href="/player">奏者入力URL</Link>
        </div>
      </section>
    </main>
  );
}
