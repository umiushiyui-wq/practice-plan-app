import Link from "next/link";

export default function HomePage() {
  return (
    <main className="stack">
      <section className="panel stack">
        <h1>2027OB演奏会出欠</h1>
        <div className="row">
          <Link className="button" href="/admin">管理者用URL</Link>
          <Link className="button secondary" href="/player">奏者入力URL</Link>
        </div>
      </section>
    </main>
  );
}
