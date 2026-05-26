import Link from "next/link";

const actions = [
  {
    href: "/player",
    label: "奏者ページ",
    title: "出欠と参加曲を入力",
    primary: true
  },
  {
    href: "/sheet",
    label: "表",
    title: "計画表を確認",
    primary: false
  }
];

export default function HomePage() {
  return (
    <main className="stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <p className="eyebrow">2027 OB演奏会</p>
          <h1>練習出欠・計画管理</h1>
        </div>
      </section>

      <section className="quick-actions">
        {actions.map((action) => (
          <Link
            key={action.href}
            className={`action-card${action.primary ? " is-primary" : ""}`}
            href={action.href}
          >
            <span className="action-label">{action.label}</span>
            <strong>{action.title}</strong>
          </Link>
        ))}
      </section>
    </main>
  );
}
