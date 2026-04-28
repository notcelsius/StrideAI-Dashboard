"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getPIById } from "@/lib/demoAuth";

const SESSION_KEY = "stride_demo_pi_id";

export default function DashboardPage() {
  const router = useRouter();
  const [piRecord, setPIRecord] = useState(null);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const activeSession = window.localStorage.getItem(SESSION_KEY);

    if (!activeSession) {
      router.replace("/login");
      return;
    }

    const pi = getPIById(activeSession);
    if (!pi) {
      window.localStorage.removeItem(SESSION_KEY);
      router.replace("/login");
      return;
    }

    setPIRecord(pi);
    setSelectedProjectId(pi.projects[0]?.projectId || "");
    setIsLoading(false);
  }, [router]);

  const selectedProject = useMemo(() => {
    if (!piRecord) return null;
    return (
      piRecord.projects.find((project) => project.projectId === selectedProjectId) || null
    );
  }, [piRecord, selectedProjectId]);

  function handleLogout() {
    window.localStorage.removeItem(SESSION_KEY);
    router.replace("/login");
  }

  if (isLoading) {
    return (
      <main className="centered-page">
        <p>Loading dashboard...</p>
      </main>
    );
  }

  if (!piRecord) {
    return null;
  }

  const totalSubjects = piRecord.projects.reduce(
    (total, project) => total + project.subjects.length,
    0
  );

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Signed in as</p>
          <h1>{piRecord.piName}</h1>
          <p className="subtext">{piRecord.piId}</p>
        </div>
        <button onClick={handleLogout} className="secondary-btn">
          Logout
        </button>
      </header>

      <section className="kpi-row">
        <div className="kpi-card">
          <p className="subtext">Projects (Studies)</p>
          <p className="kpi-value">{piRecord.projects.length}</p>
        </div>
        <div className="kpi-card">
          <p className="subtext">Subjects (Participants)</p>
          <p className="kpi-value">{totalSubjects}</p>
        </div>
      </section>

      <section className="content-grid">
        <aside className="panel">
          <h2>Projects Under This PI</h2>
          <div className="project-list">
            {piRecord.projects.map((project) => {
              const isSelected = project.projectId === selectedProjectId;
              return (
                <button
                  key={project.projectId}
                  onClick={() => setSelectedProjectId(project.projectId)}
                  className={`project-btn ${isSelected ? "selected" : ""}`}
                >
                  <span>{project.projectName}</span>
                  <small>{project.projectId}</small>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="panel">
          <h2>Subjects Under Selected Project</h2>
          {selectedProject ? (
            <>
              <p className="subtext">
                {selectedProject.projectName} ({selectedProject.projectId})
              </p>
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
                    {selectedProject.subjects.map((subject) => (
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
                        <td>{subject.lastUpload}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="subtext">No project selected.</p>
          )}
        </section>
      </section>
    </main>
  );
}
