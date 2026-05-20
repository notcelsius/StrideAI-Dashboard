import Link from "next/link";

const highlights = [
  {
    label: "For PI teams",
    text: "Move from scattered uploads to a single place for subject progress and daily mobility trends."
  },
  {
    label: "For patients",
    text: "A mobile upload path keeps field data simple while the app listing is finalized."
  },
  {
    label: "For studies",
    text: "Project-linked access, subject-level tracking, and export-ready records stay aligned."
  }
];

export default function HomePage() {
  return (
    <main className="marketing-page">
      <section className="marketing-shell">
        <div className="marketing-hero">
          <div className="marketing-copy">
            <p className="marketing-kicker">StrideAI</p>
            <h1>Mobility research data, routed for both PI teams and patients.</h1>
            <p className="marketing-summary">
              StrideAI gives principal investigators a direct path into the dashboard while keeping
              a patient-facing mobile entry point visible as the app rollout continues.
            </p>

            <div className="hero-actions">
              <Link href="/login" className="primary-cta">
                PI Login
              </Link>
              <Link href="/patient-app" className="secondary-cta">
                Patient App Store
              </Link>
            </div>

            <p className="marketing-note">
              The patient App Store route is a placeholder page for now.
            </p>
          </div>

          <aside className="hero-panel">
            <p className="hero-panel-label">What this supports</p>
            <div className="hero-metrics">
              <div>
                <strong>Study oversight</strong>
                <span>Dashboard access for PI and coordinator workflows.</span>
              </div>
              <div>
                <strong>Patient uploads</strong>
                <span>Mobile collection stays separated from the admin sign-in path.</span>
              </div>
              <div>
                <strong>Faster handoff</strong>
                <span>Daily metrics and files remain tied to project and subject records.</span>
              </div>
            </div>
          </aside>
        </div>

        <div className="marketing-grid">
          {highlights.map((item) => (
            <article key={item.label} className="marketing-card">
              <p className="marketing-card-label">{item.label}</p>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
