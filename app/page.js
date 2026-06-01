import Link from "next/link";
import Image from "next/image";

const features = [
  {
    title: "Live Tracking",
    text: "GPS location recording with real-time map view, daily distance, and session counts.",
  },
  {
    title: "Mobility Compass",
    text: "24-hour radial chart showing activity patterns — active, transport, and stationary periods.",
  },
  {
    title: "Weekly Analytics",
    text: "Range summaries with distance, tracked time, sessions, and aggregate hotspot maps.",
  },
];

export default function HomePage() {
  return (
    <main className="marketing-page">
      <nav className="marketing-nav">
        <span className="marketing-logo">StrideAI</span>
        <div className="marketing-nav-links">
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/login" className="nav-cta">PI Login</Link>
        </div>
      </nav>

      <section className="marketing-shell">
        <div className="marketing-hero">
          <div className="marketing-copy">
            <p className="marketing-kicker">UC Davis Research</p>
            <h1>Mobility data, simplified.</h1>
            <p className="marketing-summary">
              StrideAI connects patient movement tracking with a PI dashboard —
              GPS sessions, daily metrics, and study oversight in one place.
            </p>
            <div className="hero-actions">
              <Link href="/login" className="primary-cta">
                PI Dashboard
              </Link>
              <Link href="/patient-app" className="secondary-cta">
                Get the App
              </Link>
            </div>
          </div>

          <div className="hero-phones">
            <div className="phone-frame phone-back">
              <Image
                src="/screenshots/analytics-view.png"
                alt="Analytics view showing weekly distance, tracked time, sessions, and aggregate hotspot map"
                width={280}
                height={606}
                priority
              />
            </div>
            <div className="phone-frame phone-front">
              <Image
                src="/screenshots/map-view.png"
                alt="Map view with live GPS tracking, daily stats for distance, time, and sessions"
                width={280}
                height={606}
                priority
              />
            </div>
          </div>
        </div>

        <div className="marketing-grid">
          {features.map((item) => (
            <article key={item.title} className="marketing-card">
              <h3 className="marketing-card-label">{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>

        <section className="marketing-compass-section">
          <div className="compass-text">
            <p className="marketing-kicker">Daily Insights</p>
            <h2>See the full picture of each day.</h2>
            <p className="marketing-summary">
              The Mobility Compass visualizes a patient&apos;s 24-hour activity cycle —
              walking, transport, and rest periods mapped across the clock face.
              Researchers get at-a-glance patterns without digging through raw data.
            </p>
          </div>
          <div className="compass-phone">
            <div className="phone-frame">
              <Image
                src="/screenshots/compass-view.png"
                alt="Daily Mobility Compass showing 24-hour activity breakdown with active, transport, and stationary segments"
                width={280}
                height={606}
              />
            </div>
          </div>
        </section>

        <footer className="marketing-footer">
          <span>StrideAI &middot; UC Davis</span>
          <div>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </footer>
      </section>
    </main>
  );
}
