import Link from "next/link";

export const metadata = {
  title: "Terms of Service — StrideAI",
  description: "Terms and conditions for using the StrideAI application.",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <div className="legal-shell">
        <div className="legal-card">
          <div className="legal-meta">
            <Link href="/">&larr; Back to home</Link>
            <span>Last updated: May 25, 2026</span>
          </div>

          <h1>Terms of Service</h1>
          <p className="legal-intro">
            These terms govern your use of the StrideAI mobile application and associated
            web services, operated by researchers at the University of California, Davis.
          </p>

          <h2>1. Acceptance of Terms</h2>
          <p>
            By creating an account or using StrideAI, you agree to these Terms of Service
            and our <Link href="/privacy">Privacy Policy</Link>. If you do not agree,
            do not use the application.
          </p>

          <h2>2. Eligibility</h2>
          <p>
            You must be at least 18 years of age to use StrideAI. By using the app, you
            represent that you meet this requirement. Participation in a research study
            through StrideAI may require separate informed consent.
          </p>

          <h2>3. Account Responsibilities</h2>
          <ul>
            <li>You are responsible for maintaining the security of your account credentials.</li>
            <li>You agree to provide accurate information during sign-up and enrollment.</li>
            <li>You must not share your enrollment code with others or use a code assigned to someone else.</li>
            <li>
              Notify the research team immediately if you believe your account has been
              compromised.
            </li>
          </ul>

          <h2>4. Permitted Use</h2>
          <p>
            StrideAI is provided solely for participation in authorized UC Davis research
            studies. You agree not to:
          </p>
          <ul>
            <li>Use the app for any purpose other than research participation.</li>
            <li>Attempt to access data belonging to other participants.</li>
            <li>Reverse-engineer, modify, or redistribute the application.</li>
            <li>Interfere with or disrupt the app&apos;s backend services.</li>
          </ul>

          <h2>5. Data and Privacy</h2>
          <p>
            Your use of StrideAI involves the collection of location, motion, and account
            data as described in our <Link href="/privacy">Privacy Policy</Link>. By using
            the app, you consent to this data collection for research purposes.
          </p>

          <h2>6. Research Tool Disclaimer</h2>
          <p>
            StrideAI is a <strong>research data collection tool</strong>, not a medical
            device. It does not provide medical advice, diagnosis, or treatment. Do not
            rely on StrideAI for any health-related decisions. The app&apos;s activity
            classifications (walking, running, etc.) are estimates and may not be accurate
            in all conditions.
          </p>

          <h2>7. Intellectual Property</h2>
          <p>
            The StrideAI application, its design, code, and documentation are the property
            of the University of California, Davis and its contributors. You are granted a
            limited, non-exclusive, non-transferable license to use the app for its
            intended research purpose.
          </p>

          <h2>8. Service Availability</h2>
          <p>
            We strive to keep StrideAI available but do not guarantee uninterrupted
            service. The app may be temporarily unavailable for maintenance, updates, or
            due to circumstances beyond our control. We are not liable for data loss
            resulting from service interruptions.
          </p>

          <h2>9. Account Termination</h2>
          <ul>
            <li>
              You may delete your account at any time through the app
              (Settings &gt; Delete Account). This removes your profile and associated
              data from backend systems.
            </li>
            <li>
              The research team may deactivate accounts that violate these terms or are
              no longer part of an active study.
            </li>
          </ul>

          <h2>10. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, the University of California, Davis
            and the StrideAI research team shall not be liable for any indirect, incidental,
            or consequential damages arising from your use of the application.
          </p>

          <h2>11. Governing Law</h2>
          <p>
            These terms are governed by the laws of the State of California, United States.
            Any disputes shall be resolved in the courts of Yolo County, California.
          </p>

          <h2>12. Changes to These Terms</h2>
          <p>
            We may update these terms as the research project evolves. Changes will be
            reflected by the &ldquo;Last updated&rdquo; date at the top of this page.
            Continued use after updates constitutes acceptance.
          </p>

          <h2>13. Contact</h2>
          <p>
            For questions about these terms, contact the StrideAI research team:
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
