"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getValidSession, getUserRole, logout } from "@/lib/cognitoAuth";
import {
  getProjects,
  getProjectSubjects,
  createProject,
  createSubject,
  linkPatientSubject,
  deleteUser,
  createEnrollmentCode,
  getPiRequests,
  approvePiRequest,
  rejectPiRequest,
} from "@/lib/dashboardApi";

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [role, setRole] = useState("user");
  const [projects, setProjects] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const [newProjectId, setNewProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPiName, setNewProjectPiName] = useState("");
  const [newProjectAdminName, setNewProjectAdminName] = useState("");
  const [createProjectStatus, setCreateProjectStatus] = useState("");

  const [linkSub, setLinkSub] = useState("");
  const [linkSubjectId, setLinkSubjectId] = useState("");
  const [linkStatus, setLinkStatus] = useState("");

  const [enrollSubjectId, setEnrollSubjectId] = useState("");
  const [enrollParticipant, setEnrollParticipant] = useState("");
  const [enrollStatus, setEnrollStatus] = useState("");
  const [generatedCode, setGeneratedCode] = useState("");

  const [newSubjectId, setNewSubjectId] = useState("");
  const [newParticipantName, setNewParticipantName] = useState("");
  const [createSubjectStatus, setCreateSubjectStatus] = useState("");

  const [deleteSub, setDeleteSub] = useState("");
  const [deleteUsername, setDeleteUsername] = useState("");
  const [deletePoolId, setDeletePoolId] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");

  const [piRequests, setPiRequests] = useState([]);
  const [piRequestStatus, setPiRequestStatus] = useState("");
  const [isPiRequestsLoading, setIsPiRequestsLoading] = useState(false);

  useEffect(() => {
    async function bootstrap() {
      const stored = await getValidSession();
      if (!stored) { router.replace("/login"); return; }

      const userRole = getUserRole(stored);
      if (!["admin", "pi", "coordinator"].includes(userRole)) { router.replace("/dashboard"); return; }

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

  async function refreshProjects(activeSession = session, nextSelectedProjectId = selectedProjectId) {
    if (!activeSession) return [];
    const payload = await getProjects(activeSession);
    const nextProjects = payload.projects || [];
    setProjects(nextProjects);
    const hasSelectedProject = nextProjects.some((project) => project.projectId === nextSelectedProjectId);
    setSelectedProjectId(hasSelectedProject ? nextSelectedProjectId : nextProjects[0]?.projectId || "");
    return nextProjects;
  }

  async function loadPiRequests(activeSession = session) {
    if (!activeSession) return;
    setIsPiRequestsLoading(true);
    try {
      const payload = await getPiRequests(activeSession, "pending");
      setPiRequests(payload.requests || []);
    } catch (err) {
      setPiRequestStatus(err.message);
    } finally {
      setIsPiRequestsLoading(false);
    }
  }

  useEffect(() => {
    if (!session || role !== "admin") return;
    loadPiRequests(session);
  }, [session, role]);

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

  async function handleCreateProject(e) {
    e.preventDefault();
    setCreateProjectStatus("");
    if (!newProjectId || !newProjectName) {
      setCreateProjectStatus("Project ID and study name are required.");
      return;
    }
    try {
      const created = await createProject(session, {
        projectId: newProjectId,
        projectName: newProjectName,
        piName: newProjectPiName,
        adminName: newProjectAdminName,
      });
      setCreateProjectStatus(`Study ${created.projectId} created successfully.`);
      setNewProjectId("");
      setNewProjectName("");
      setNewProjectPiName("");
      setNewProjectAdminName("");
      await refreshProjects(session, created.projectId);
      setSubjects([]);
    } catch (err) {
      setCreateProjectStatus(err.message);
    }
  }

  async function handleCreateSubject(e) {
    e.preventDefault();
    setCreateSubjectStatus("");
    if (!newSubjectId || !selectedProjectId) {
      setCreateSubjectStatus("Subject ID is required.");
      return;
    }
    try {
      await createSubject(session, newSubjectId, selectedProjectId, newParticipantName);
      setCreateSubjectStatus("Subject created successfully.");
      setNewSubjectId("");
      setNewParticipantName("");
      const payload = await getProjectSubjects(session, selectedProjectId);
      setSubjects(payload.subjects || []);
    } catch (err) {
      setCreateSubjectStatus(err.message);
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

  async function handleApprovePiRequest(request) {
    setPiRequestStatus("");
    try {
      await approvePiRequest(session, request.requestId, request.requestedProjectId);
      setPiRequestStatus(`Approved ${request.email}.`);
      await loadPiRequests(session);
    } catch (err) {
      setPiRequestStatus(err.message);
    }
  }

  async function handleRejectPiRequest(request) {
    setPiRequestStatus("");
    try {
      await rejectPiRequest(session, request.requestId);
      setPiRequestStatus(`Rejected ${request.email}.`);
      await loadPiRequests(session);
    } catch (err) {
      setPiRequestStatus(err.message);
    }
  }

  if (isLoading) {
    return <main className="centered-page"><p>Loading...</p></main>;
  }

  const isGlobalAdmin = role === "admin";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">{isGlobalAdmin ? "Admin Panel" : "PI Panel"}</p>
          <h1>Study Management</h1>
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
        {projects.length > 1 ? (
          <label style={{ display: "block", maxWidth: "360px", marginBottom: "1rem" }}>
            Project
            <select
              value={selectedProjectId}
              onChange={(event) => setSelectedProjectId(event.target.value)}
            >
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectName} ({project.projectId})
                </option>
              ))}
            </select>
          </label>
        ) : null}
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

      {isGlobalAdmin ? (
      <section className="panel">
        <div className="panel-heading-row">
          <div>
            <h2>PI Requests</h2>
            <p className="subtext">Approve project-scoped PI access requests.</p>
          </div>
          <button type="button" className="secondary-btn" onClick={() => loadPiRequests(session)}>
            Refresh
          </button>
        </div>
        {piRequestStatus ? (
          <p className={piRequestStatus.startsWith("Approved") || piRequestStatus.startsWith("Rejected") ? "success-text" : "error-text"}>
            {piRequestStatus}
          </p>
        ) : null}
        {isPiRequestsLoading ? <p className="subtext">Loading requests...</p> : null}
        {!isPiRequestsLoading && piRequests.length === 0 ? (
          <p className="subtext">No pending PI requests.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Project</th>
                  <th>Note</th>
                  <th>Requested</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {piRequests.map((request) => (
                  <tr key={request.requestId}>
                    <td>{request.name}</td>
                    <td>{request.email}</td>
                    <td>{request.requestedProjectId}</td>
                    <td>{request.note || "—"}</td>
                    <td>{request.createdAt ? new Date(request.createdAt).toLocaleString() : "—"}</td>
                    <td>
                      <div className="row-actions">
                        <button
                          type="button"
                          className="primary-btn"
                          onClick={() => handleApprovePiRequest(request)}
                        >
                          Approve
                        </button>
                        <button
                          type="button"
                          className="secondary-btn"
                          onClick={() => handleRejectPiRequest(request)}
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      ) : null}

      {isGlobalAdmin ? (
      <section className="panel">
        <h2>Create Study</h2>
        <p className="subtext">Create a new project before adding subjects or approving PI access.</p>
        <form onSubmit={handleCreateProject} className="admin-form" style={{ maxWidth: "520px" }}>
          <label>
            Project ID
            <input
              type="text"
              value={newProjectId}
              onChange={(e) => setNewProjectId(e.target.value)}
              placeholder="e.g. proj002"
            />
          </label>
          <label>
            Study Name
            <input
              type="text"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              placeholder="e.g. Balance Study"
            />
          </label>
          <label>
            PI Name <span className="subtext">(optional)</span>
            <input
              type="text"
              value={newProjectPiName}
              onChange={(e) => setNewProjectPiName(e.target.value)}
              placeholder="e.g. Dr. Smith"
            />
          </label>
          <label>
            Admin Name <span className="subtext">(optional)</span>
            <input
              type="text"
              value={newProjectAdminName}
              onChange={(e) => setNewProjectAdminName(e.target.value)}
              placeholder="e.g. Study Admin"
            />
          </label>
          <button type="submit" className="primary-btn">Create Study</button>
          {createProjectStatus && (
            <p className={createProjectStatus.includes("created successfully") ? "success-text" : "error-text"}>
              {createProjectStatus}
            </p>
          )}
        </form>
      </section>
      ) : null}

      <section className="panel">
        <h2>Create Subject</h2>
        <p className="subtext">Add a new subject to the current project before generating an enrollment code.</p>
        <form onSubmit={handleCreateSubject} className="admin-form" style={{ maxWidth: "480px" }}>
          <label>
            Subject ID
            <input
              type="text"
              value={newSubjectId}
              onChange={(e) => setNewSubjectId(e.target.value)}
              placeholder="e.g. SUB_001"
            />
          </label>
          <label>
            Participant Name <span className="subtext">(optional)</span>
            <input
              type="text"
              value={newParticipantName}
              onChange={(e) => setNewParticipantName(e.target.value)}
              placeholder="e.g. Jane Doe"
            />
          </label>
          <button type="submit" className="primary-btn">Create Subject</button>
          {createSubjectStatus && (
            <p className={createSubjectStatus.includes("success") ? "success-text" : "error-text"}>
              {createSubjectStatus}
            </p>
          )}
        </form>
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

        {isGlobalAdmin ? (
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
        ) : null}
      </div>
    </main>
  );
}
