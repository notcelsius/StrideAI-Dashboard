import Link from "next/link";

export default function PatientAppPage() {
  return (
    <main className="placeholder-page">
      <section className="placeholder-card">
        <p className="eyebrow">Patient Mobile App</p>
        <h1>App Store listing coming soon.</h1>
        <p className="subtext">
          This page is a temporary stand-in for the future patient App Store destination.
        </p>
        <div className="placeholder-actions">
          <Link href="/" className="secondary-cta">
            Back to StrideAI
          </Link>
          <Link href="/login" className="primary-cta">
            PI Login
          </Link>
        </div>
      </section>
    </main>
  );
}
