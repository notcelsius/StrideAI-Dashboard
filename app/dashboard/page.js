"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getValidSession, getUserRole, logout } from "@/lib/cognitoAuth";
import { getProjectSubjects, getProjects } from "@/lib/dashboardApi";

export default function DashboardPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [projects, setProjects] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubjectsLoading, setIsSubjectsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      const storedSession = await getValidSession();
      if (!storedSession) {
        router.replace("/login");
        return;
      }

      try {
        const payload = await getProjects(storedSession);
        if (!isMounted) return;
        setSession(storedSession);
        setProjects(payload.projects || []);
        setSelectedProjectId((payload.projects || [])[0]?.projectId || "");
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError.message || "Unable to load projects.");
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    bootstrap();

    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    let isMounted = true;

    async function loadSubjects() {
      if (!session || !selectedProjectId) {
        setSubjects([]);
        return;
      }

      setIsSubjectsLoading(true);
      try {
        const payload = await getProjectSubjects(session, selectedProjectId);
        if (!isMounted) return;
        setSubjects(payload.subjects || []);
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError.message || "Unable to load subjects.");
      } finally {
        if (isMounted) {
          setIsSubjectsLoading(false);
        }
      }
    }

    loadSubjects();

    return () => {
      isMounted = false;
    };
  }, [selectedProjectId, session]);

  const project = useMemo(
    () => projects.find((candidate) => candidate.projectId === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  if (isLoading) {
    return (
      <main className="centered-page">
        <p>Loading dashboard...</p>
      </main>
    );
  }

  const role = getUserRole(session);
  const claims = session?.claims || {};
  const displayName = claims.name || claims.email || claims["cognito:username"] || "Dashboard User";
  const displayId = claims.email || claims["cognito:username"] || claims.sub || "unknown-user";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Signed in as</p>
          <h1>{displayName}</h1>
          <p className="subtext">{displayId}</p>
          <p className="subtext" style={{ marginTop: "0.35rem" }}>
            Role: <strong>{role}</strong>
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {role === "admin" && (
            <Link href="/dashboard/admin" className="secondary-btn" style={{ textDecoration: "none" }}>
              Admin
            </Link>
          )}
          <button onClick={logout} className="secondary-btn">
            Logout
          </button>
        </div>
      </header>

      <section className="kpi-row">
        <div className="kpi-card">
          <p className="subtext">Study</p>
          <p className="kpi-value" style={{ fontSize: "1.2rem" }}>{project?.projectName ?? "—"}</p>
        </div>
        <div className="kpi-card">
          <p className="subtext">Subjects (Participants)</p>
          <p className="kpi-value">{subjects.length}</p>
        </div>
      </section>

      {projects.length > 1 ? (
        <section className="panel">
          <h2>Projects</h2>
          <div className="project-list">
            {projects.map((candidate) => (
              <button
                key={candidate.projectId}
                type="button"
                className={`project-btn ${candidate.projectId === selectedProjectId ? "selected" : ""}`}
                onClick={() => setSelectedProjectId(candidate.projectId)}
              >
                <strong>{candidate.projectName}</strong>
                <small>{candidate.projectId}</small>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="panel">
        <h2>Subjects</h2>
        <p className="subtext">Roster is loaded from the project subjects API when configured.</p>
        {error ? <p className="error-text">{error}</p> : null}
        {project ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject ID</th>
                  <th>Participant</th>
                  <th>Status</th>
                  <th>Last Upload</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((subject) => (
                  <tr key={subject.subjectId} className="subject-row">
                    <td>
                      <Link
                        href={`/dashboard/subject/${subject.subjectId}`}
                        className="subject-link"
                      >
                        {subject.subjectId}
                      </Link>
                    </td>
                    <td>{subject.participantName}</td>
                    <td>{subject.status}</td>
                    <td>{subject.lastUploadAt || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtext">No study found.</p>
        )}
        {!project && projects.length === 0 ? <p className="subtext">No project access has been assigned yet.</p> : null}
        {isSubjectsLoading ? <p className="subtext">Loading subjects...</p> : null}
      </section>
    </main>
  );
}
