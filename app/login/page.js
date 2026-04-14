"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { authenticatePI } from "@/lib/demoAuth";

const SESSION_KEY = "stride_demo_pi_id";

export default function LoginPage() {
  const router = useRouter();
  const [piId, setPiId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const existingSession = window.localStorage.getItem(SESSION_KEY);
    if (existingSession) {
      router.replace("/dashboard");
    }
  }, [router]);

  function handleSubmit(event) {
    event.preventDefault();
    setError("");

    const authenticatedPI = authenticatePI(piId, password);
    if (!authenticatedPI) {
      setError("Invalid PI ID or password.");
      return;
    }

    window.localStorage.setItem(SESSION_KEY, authenticatedPI.piId);
    router.push("/dashboard");
  }

  return (
    <main className="auth-page">
      <section className="auth-card">
        <p className="eyebrow">STRIDE-AI Dashboard</p>
        <h1>PI Login</h1>
        <p className="subtext">
          Sign in using your PI_ID and password to view studies and participants.
        </p>

        <form onSubmit={handleSubmit} className="auth-form">
          <label htmlFor="pi-id">PI_ID</label>
          <input
            id="pi-id"
            type="text"
            value={piId}
            placeholder="PI_1001"
            onChange={(event) => setPiId(event.target.value)}
            autoComplete="username"
          />

          <label htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            value={password}
            placeholder="••••••••"
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
          />

          {error ? <p className="error-text">{error}</p> : null}

          <button type="submit">Sign In</button>
        </form>

        <div className="demo-credentials">
          <p className="subtext"><strong>Demo Credentials</strong></p>
          <p className="credential-item">PI_1001 / stride123</p>
          <p className="credential-item">PI_2001 / stride456</p>
        </div>
      </section>
    </main>
  );
}
