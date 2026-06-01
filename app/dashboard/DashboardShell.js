"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { logout } from "@/lib/cognitoAuth";
import { useStudy } from "@/app/dashboard/StudyProvider";

const TABS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/subjects", label: "Subjects & Groups" },
];

export default function DashboardShell({ children }) {
  const pathname = usePathname();
  const { session, role, projects, selectedProjectId, setSelectedProjectId, isLoading } = useStudy();

  if (isLoading || !session) {
    return (
      <main className="centered-page">
        <p>Loading...</p>
      </main>
    );
  }

  const claims = session.claims || {};
  const displayName = claims.name || claims.email || claims["cognito:username"] || "Dashboard User";
  const isAdmin = role === "admin";

  // Tab links carry the active study so it persists across Overview/Subjects.
  const studyQuery = selectedProjectId ? `?projectId=${encodeURIComponent(selectedProjectId)}` : "";

  return (
    <div className="dashboard-shell">
      <header className="app-bar">
        <div className="app-bar-main">
          <div className="app-bar-brand">
            <span className="app-bar-logo">StrideAI</span>
            <span className="app-bar-area">Study Management</span>
          </div>
          <label className="study-switcher">
            <span className="study-switcher-label">Study</span>
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
              aria-label="Select active study"
            >
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectName} ({project.projectId})
                </option>
              ))}
              <option value="">All studies</option>
            </select>
          </label>
        </div>
        <div className="app-bar-right">
          <div className="app-bar-user">
            <span className="app-bar-username">{displayName}</span>
            <span className="app-bar-role">{role}</span>
          </div>
          {isAdmin ? (
            <Link href="/admin" className="secondary-btn" style={{ textDecoration: "none" }}>
              Admin
            </Link>
          ) : null}
          <button onClick={logout} className="secondary-btn">
            Logout
          </button>
        </div>
      </header>

      <nav className="nav-tabs">
        {TABS.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={`${tab.href}${studyQuery}`}
              className={`nav-tab ${isActive ? "active" : ""}`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
