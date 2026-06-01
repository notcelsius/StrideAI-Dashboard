"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  beginLogin,
  completeLoginFromUrl,
  getCognitoConfig,
  getStoredSession,
} from "@/lib/cognitoAuth";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(true);
  const [session, setSession] = useState(null);
  const config = getCognitoConfig();

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      try {
        const existingSession = getStoredSession();
        if (existingSession) {
          if (isMounted) setSession(existingSession);
          router.replace("/dashboard");
          return; // keep isBusy true — page is navigating away
        }

        const completedSession = await completeLoginFromUrl(window.location.href);
        if (completedSession) {
          if (isMounted) setSession(completedSession);
          router.replace("/dashboard");
          return; // keep isBusy true — page is navigating away
        }
      } catch (authError) {
        if (!isMounted) return;
        window.history.replaceState({}, document.title, "/login");
        setError(authError.message || "Unable to sign in with Cognito.");
      }
      if (isMounted) {
        setIsBusy(false);
      }
    }

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleSignIn() {
    setError("");
    setIsBusy(true);
    try {
      await beginLogin();
    } catch (authError) {
      setError(authError.message || "Unable to start Cognito sign-in.");
      setIsBusy(false);
    }
  }

  if (isBusy) {
    return (
      <main className="auth-page">
        <section className="auth-card">
          <p className="eyebrow">STRIDE-AI Dashboard</p>
          <p className="subtext">Checking session...</p>
        </section>
      </main>
    );
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">STRIDE-AI Dashboard</p>
        <h1>PI Login</h1>
        <p className="subtext">
          Sign in with your Cognito-backed PI account to access the dashboard.
        </p>

        <div className="auth-form">
          {!config.isConfigured ? (
            <p className="error-text">
              Missing Cognito configuration. Add the `NEXT_PUBLIC_COGNITO_*` values to your local
              environment before signing in.
            </p>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}

          <button type="button" onClick={handleSignIn} disabled={isBusy || !config.isConfigured}>
            {isBusy ? "Checking session..." : "Sign In With Cognito"}
          </button>
        </div>
      </section>
    </main>
  );
}
