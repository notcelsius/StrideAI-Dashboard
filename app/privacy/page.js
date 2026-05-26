import Link from "next/link";

export const metadata = {
  title: "Privacy Policy — StrideAI",
  description: "How StrideAI collects, stores, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <div className="legal-shell">
        <div className="legal-card">
          <div className="legal-meta">
            <Link href="/">&larr; Back to home</Link>
            <span>Last updated: May 25, 2026</span>
          </div>

          <h1>Privacy Policy</h1>
          <p className="legal-intro">
            StrideAI is a research application developed at the University of California,
            Davis. This policy explains what data we collect, why we collect it, and how
            it is handled.
          </p>

          <h2>1. What Data We Collect</h2>
          <p>When you use the StrideAI mobile app, we may collect the following:</p>
          <ul>
            <li>
              <strong>GPS location data</strong> — coordinates, altitude, speed, and timestamps
              recorded during active tracking sessions and, if enabled, in the background.
            </li>
            <li>
              <strong>Motion and activity classification</strong> — walking, running, cycling,
              and driving states detected by device sensors (accelerometer, gyroscope).
            </li>
            <li>
              <strong>Account information</strong> — username and email address provided during
              sign-up.
            </li>
            <li>
              <strong>Study enrollment metadata</strong> — project ID, subject ID, and
              participant name associated with your research enrollment.
            </li>
          </ul>

          <h2>2. Why We Collect It</h2>
          <p>
            StrideAI is part of a university research initiative at UC Davis studying
            human movement and mobility patterns. All data collected through this app
            is used for <strong>academic research purposes only</strong>.
          </p>
          <p>
            Location and motion data help researchers analyze daily mobility trends,
            walking patterns, and activity levels across study participants.
          </p>

          <h2>3. How Data Is Stored</h2>
          <ul>
            <li>
              <strong>On your device</strong> — GPS tracks are saved locally as GPX files and
              in a local database. You can view and delete local data at any time.
            </li>
            <li>
              <strong>In the cloud</strong> — when you upload data, GPS files are stored in
              Amazon S3 and profile/metric records are stored in Amazon DynamoDB. All
              cloud infrastructure is hosted in the United States (AWS us-east-2).
            </li>
            <li>
              <strong>Anonymized identifiers</strong> — your data is associated with an
              anonymized subject ID rather than your real name. Researchers access data
              through subject IDs, not personal identifiers.
            </li>
          </ul>

          <h2>4. Data Sharing</h2>
          <ul>
            <li>
              Your data is shared only with authorized research team members (principal
              investigators, coordinators) assigned to your study.
            </li>
            <li>Your data is <strong>never sold</strong> to third parties.</li>
            <li>Your data is <strong>not used for advertising</strong> or commercial purposes.</li>
            <li>
              Aggregated, de-identified findings may be published in academic papers or
              presented at research conferences.
            </li>
          </ul>

          <h2>5. Your Rights</h2>
          <ul>
            <li>
              <strong>Delete your account</strong> — you can delete your account at any time
              from the app (Settings &gt; Delete Account). This removes your profile,
              uploaded data, and subject link from all backend systems.
            </li>
            <li>
              <strong>Stop tracking</strong> — you can pause or stop location tracking at any
              time. No data is collected while tracking is off.
            </li>
            <li>
              <strong>Access your data</strong> — contact the research team to request a copy
              of the data associated with your account.
            </li>
          </ul>

          <h2>6. Third-Party Services</h2>
          <p>
            StrideAI uses the following third-party services to operate:
          </p>
          <ul>
            <li><strong>Amazon Web Services (AWS)</strong> — cloud hosting, storage, and authentication (Cognito).</li>
            <li><strong>Apple HealthKit</strong> — accessed only if you grant permission; data is read on-device and not sent to our servers.</li>
          </ul>

          <h2>7. Children</h2>
          <p>
            StrideAI is not intended for use by individuals under 18. We do not knowingly
            collect data from minors. If you believe a minor has enrolled, please contact
            the research team.
          </p>

          <h2>8. Changes to This Policy</h2>
          <p>
            We may update this policy as the study evolves. Changes will be reflected by
            the &ldquo;Last updated&rdquo; date at the top of this page. Continued use of the app
            after updates constitutes acceptance.
          </p>

          <h2>9. Contact</h2>
          <p>
            For questions about this privacy policy or your data, contact the StrideAI
            research team:
          </p>
          <p>
            <strong>Email:</strong>{" "}
            <a href="mailto:strideai-research@ucdavis.edu">strideai-research@ucdavis.edu</a>
          </p>
          <p>
            University of California, Davis<br />
            Department of Computer Science<br />
            Davis, CA 95616
          </p>
        </div>
      </div>
    </main>
  );
}
