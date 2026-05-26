"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  beginLogin,
  completeLoginFromUrl,
  getCognitoConfig,
  getStoredSession,
} from "@/lib/cognitoAuth";
import { createPiRequest } from "@/lib/dashboardApi";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(true);
  const [session, setSession] = useState(null);
  const [requestName, setRequestName] = useState("");
  const [requestEmail, setRequestEmail] = useState("");
  const [requestProjectId, setRequestProjectId] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestStatus, setRequestStatus] = useState("");
  const [isRequestingAccess, setIsRequestingAccess] = useState(false);
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
        const msg = authError.message || "";
        if (msg.includes("invalid_grant") || msg.includes("Token exchange failed")) {
          window.history.replaceState({}, document.title, "/login");
          await beginLogin();
          return;
        }
        setError(msg || "Unable to sign in with Cognito.");
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

  async function handleRequestAccess(e) {
    e.preventDefault();
    setRequestStatus("");
    setIsRequestingAccess(true);

    try {
      await createPiRequest({
        name: requestName,
        email: requestEmail,
        requestedProjectId: requestProjectId,
        note: requestNote,
      });
      setRequestStatus("Request submitted for admin review.");
      setRequestName("");
      setRequestEmail("");
      setRequestProjectId("");
      setRequestNote("");
    } catch (requestError) {
      setRequestStatus(requestError.message || "Unable to submit PI request.");
    } finally {
      setIsRequestingAccess(false);
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

        <div className="auth-divider" />

        <form onSubmit={handleRequestAccess} className="auth-form">
          <h2>Request PI Access</h2>
          <label>
            Name
            <input
              type="text"
              value={requestName}
              onChange={(e) => setRequestName(e.target.value)}
              placeholder="Full name"
              required
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={requestEmail}
              onChange={(e) => setRequestEmail(e.target.value)}
              placeholder="name@ucdavis.edu"
              required
            />
          </label>
          <label>
            Project ID
            <input
              type="text"
              value={requestProjectId}
              onChange={(e) => setRequestProjectId(e.target.value)}
              placeholder="e.g. proj001"
              required
            />
          </label>
          <label>
            Note <span className="subtext">(optional)</span>
            <input
              type="text"
              value={requestNote}
              onChange={(e) => setRequestNote(e.target.value)}
              placeholder="Study/team context"
            />
          </label>
          <button type="submit" disabled={isRequestingAccess}>
            {isRequestingAccess ? "Submitting..." : "Submit Request"}
          </button>
          {requestStatus ? (
            <p className={requestStatus.includes("submitted") ? "success-text" : "error-text"}>
              {requestStatus}
            </p>
          ) : null}
        </form>
      </section>
    </main>
  );
}
