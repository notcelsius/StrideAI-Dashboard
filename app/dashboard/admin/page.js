"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getStoredSession, getUserRole, logout } from "@/lib/cognitoAuth";
import {
  getProjects,
  getProjectSubjects,
  linkPatientSubject,
  deleteUser,
  createEnrollmentCode,
} from "@/lib/dashboardApi";

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [role, setRole] = useState("user");
  const [projects, setProjects] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [linkSub, setLinkSub] = useState("");
  const [linkSubjectId, setLinkSubjectId] = useState("");
  const [linkStatus, setLinkStatus] = useState("");

  const [enrollSubjectId, setEnrollSubjectId] = useState("");
  const [enrollParticipant, setEnrollParticipant] = useState("");
  const [enrollStatus, setEnrollStatus] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");

  const [deleteSub, setDeleteSub] = useState("");
  const [deleteUsername, setDeleteUsername] = useState("");
  const [deletePoolId, setDeletePoolId] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");

  useEffect(() => {
    async function bootstrap() {
      const stored = getStoredSession();
      if (!stored) { router.replace("/login"); return; }

      const userRole = getUserRole(stored);
      if (userRole !== "admin") { router.replace("/dashboard"); return; }

      setSession(stored);
      setRole(userRole);

      try {
        const payload = await getProjects(stored);
        setProjects(payload.projects || []);
        const firstId = (payload.projects || [])[0]?.projectId || "";
        setSelectedProjectId(firstId);
      } catch {}
      setIsLoading(false);
    }
    bootstrap();
  }, [router]);

  useEffect(() => {
    if (!session || !selectedProjectId) return;
    async function load() {
      try {
        const payload = await getProjectSubjects(session, selectedProjectId);
        setSubjects(payload.subjects || []);
      } catch {}
    }
    load();
  }, [session, selectedProjectId]);

  async function handleLink(e) {
    e.preventDefault();
    setLinkStatus("");
    if (!linkSub || !linkSubjectId || !selectedProjectId) {
      setLinkStatus("All fields are required.");
      return;
    }
    try {
      await linkPatientSubject(session, linkSub, linkSubjectId, selectedProjectId);
      setLinkStatus("Patient linked successfully.");
      setLinkSub("");
      setLinkSubjectId("");
      const payload = await getProjectSubjects(session, selectedProjectId);
      setSubjects(payload.subjects || []);
    } catch (err) {
      setLinkStatus(err.message);
    }
  }

  async function handleEnroll(e) {
    e.preventDefault();
    setEnrollStatus("");
    setGeneratedCode("");
    if (!enrollSubjectId || !selectedProjectId) {
      setEnrollStatus("Subject ID is required.");
      return;
    }
    try {
      const result = await createEnrollmentCode(session, enrollSubjectId, selectedProjectId, enrollParticipant);
      setGeneratedCode(result.code);
      setEnrollStatus(`Code generated for ${result.participantName || result.subjectId}.`);
      setEnrollSubjectId("");
      setEnrollParticipant("");
    } catch (err) {
      setEnrollStatus(err.message);
    }
  }

  async function handleDelete(e) {
    e.preventDefault();
    setDeleteStatus("");
    if (!deleteSub) {
      setDeleteStatus("User sub is required.");
      return;
    }
    if (!window.confirm(`Delete user ${deleteSub}? This cannot be undone.`)) return;
    try {
      const result = await deleteUser(session, deleteSub, {
        userPoolId: deletePoolId || undefined,
        username: deleteUsername || undefined,
        projectId: selectedProjectId || undefined,
      });
      const d = result.deleted;
      const parts = [];
      if (d.dynamoProfile) parts.push("profile removed");
      if (d.cognitoUser) parts.push("Cognito user deleted");
      if (d.subjectUnlinked) parts.push("subject unlinked");
      setDeleteStatus(parts.length ? `Done: ${parts.join(", ")}.` : "No records found for that user.");
      setDeleteSub("");
      setDeleteUsername("");
      setDeletePoolId("");
      const payload = await getProjectSubjects(session, selectedProjectId);
      setSubjects(payload.subjects || []);
    } catch (err) {
      setDeleteStatus(err.message);
    }
  }

  if (isLoading) {
    return <main className="centered-page"><p>Loading...</p></main>;
  }

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">Admin Panel</p>
          <h1>User Management</h1>
          <p className="subtext">
            Project: <strong>{projects.find((p) => p.projectId === selectedProjectId)?.projectName || selectedProjectId || "—"}</strong>
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href="/dashboard" className="secondary-btn" style={{ textDecoration: "none", display: "inline-block" }}>
            Dashboard
          </Link>
          <button onClick={logout} className="secondary-btn">Logout</button>
        </div>
      </header>

      <section className="panel">
        <h2>Current Subjects</h2>
        {subjects.length === 0 ? (
          <p className="subtext">No subjects in this project.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject ID</th>
                  <th>Participant</th>
                  <th>Status</th>
                  <th>Linked User Sub</th>
                </tr>
              </thead>
              <tbody>
                {subjects.map((s) => (
                  <tr key={s.subjectId} className="subject-row">
                    <td className="subject-link">{s.subjectId}</td>
                    <td>{s.participantName}</td>
                    <td>{s.status}</td>
                    <td style={{ fontFamily: "monospace", fontSize: "0.82rem" }}>{s.userSub || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Generate Enrollment Code</h2>
        <p className="subtext">Create a one-time code for a patient to enroll in the study via the mobile app.</p>
        <form onSubmit={handleEnroll} className="admin-form" style={{ maxWidth: "480px" }}>
          <label>
            Subject ID
            <input
              type="text"
              value={enrollSubjectId}
              onChange={(e) => setEnrollSubjectId(e.target.value)}
              placeholder="e.g. SUB_001"
            />
          </label>
          <label>
            Participant Name <span className="subtext">(optional override)</span>
            <input
              type="text"
              value={enrollParticipant}
              onChange={(e) => setEnrollParticipant(e.target.value)}
              placeholder="Uses subject's name if blank"
            />
          </label>
          <button type="submit" className="primary-btn">Generate Code</button>
          {generatedCode && (
            <div className="code-display">
              <p className="subtext">Give this code to the patient:</p>
              <p className="enrollment-code">{generatedCode}</p>
            </div>
          )}
          {enrollStatus && <p className={generatedCode ? "success-text" : "error-text"}>{enrollStatus}</p>}
        </form>
      </section>

      <div className="admin-forms-row">
        <section className="panel">
          <h2>Link Patient to Subject</h2>
          <p className="subtext">Connect a Cognito patient account to a subject record in the current project.</p>
          <form onSubmit={handleLink} className="admin-form">
            <label>
              Patient Cognito Sub
              <input
                type="text"
                value={linkSub}
                onChange={(e) => setLinkSub(e.target.value)}
                placeholder="e.g. d1bbb550-7031-70e3-..."
              />
            </label>
            <label>
              Subject ID
              <input
                type="text"
                value={linkSubjectId}
                onChange={(e) => setLinkSubjectId(e.target.value)}
                placeholder="e.g. SUB_001"
              />
            </label>
            <button type="submit" className="primary-btn">Link Patient</button>
            {linkStatus && <p className={linkStatus.includes("success") ? "success-text" : "error-text"}>{linkStatus}</p>}
          </form>
        </section>

        <section className="panel">
          <h2>Delete User</h2>
          <p className="subtext">Remove a user's profile, unlink from subjects, and optionally delete from Cognito.</p>
          <form onSubmit={handleDelete} className="admin-form">
            <label>
              User Cognito Sub
              <input
                type="text"
                value={deleteSub}
                onChange={(e) => setDeleteSub(e.target.value)}
                placeholder="e.g. d1bbb550-7031-70e3-..."
              />
            </label>
            <label>
              Username <span className="subtext">(optional, for Cognito deletion)</span>
              <input
                type="text"
                value={deleteUsername}
                onChange={(e) => setDeleteUsername(e.target.value)}
                placeholder="e.g. jdoe"
              />
            </label>
            <label>
              User Pool ID <span className="subtext">(optional, for Cognito deletion)</span>
              <input
                type="text"
                value={deletePoolId}
                onChange={(e) => setDeletePoolId(e.target.value)}
                placeholder="e.g. us-east-2_xQiH4YW8S"
              />
            </label>
            <button type="submit" className="danger-btn">Delete User</button>
            {deleteStatus && <p className={deleteStatus.startsWith("Done") ? "success-text" : "error-text"}>{deleteStatus}</p>}
          </form>
        </section>
      </div>
    </main>
  );
}
