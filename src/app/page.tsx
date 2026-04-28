import Link from "next/link";

const actions = [
  {
    href: "/player",
    label: "奏者ページ",
    title: "出欠と参加曲を入力",
    description: "自分の名前を選んで、練習日ごとの参加可能時間と出演する曲を登録します。",
    primary: true
  },
  {
    href: "/admin",
    label: "管理者ページ",
    title: "練習計画を作成",
    description: "メンバー、練習日、曲を登録して、練習計画を自動生成・調整します。",
    primary: false
  },
  {
    href: "/sheet",
    label: "表ビュー",
    title: "計画表を確認",
    description: "作成済みの練習計画を、共有しやすい表形式で確認します。",
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
          <p>
            奏者の出欠入力から、管理者の練習計画作成までをまとめて扱うためのページです。
            まずは自分の役割に近い入口を選んでください。
          </p>
        </div>
        <div className="hero-actions">
          <Link className="button" href="/player">
            奏者として入力
          </Link>
          <Link className="button secondary" href="/admin">
            管理者として開く
          </Link>
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
            <span>{action.description}</span>
          </Link>
        ))}
      </section>
    </main>
  );
}
