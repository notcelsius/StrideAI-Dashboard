"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getValidSession, getUserRole, logout } from "@/lib/cognitoAuth";
import {
  getProjects,
  createProject,
  deleteUser,
  getPiRequests,
  approvePiRequest,
  rejectPiRequest,
  addPi,
} from "@/lib/dashboardApi";

export default function AdminPage() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  const [newProjectId, setNewProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectPiName, setNewProjectPiName] = useState("");
  const [newProjectAdminName, setNewProjectAdminName] = useState("");
  const [createProjectStatus, setCreateProjectStatus] = useState("");

  const [deleteSub, setDeleteSub] = useState("");
  const [deleteUsername, setDeleteUsername] = useState("");
  const [deletePoolId, setDeletePoolId] = useState("");
  const [deleteStatus, setDeleteStatus] = useState("");

  const [piRequests, setPiRequests] = useState([]);
  const [piRequestStatus, setPiRequestStatus] = useState("");
  const [isPiRequestsLoading, setIsPiRequestsLoading] = useState(false);

  const [addPiEmail, setAddPiEmail] = useState("");
  const [addPiName, setAddPiName] = useState("");
  const [addPiProjectId, setAddPiProjectId] = useState("");
  const [addPiStatus, setAddPiStatus] = useState("");

  useEffect(() => {
    async function bootstrap() {
      const stored = await getValidSession();
      if (!stored) { router.replace("/login"); return; }
      // Admin Management is admin-only; everyone else lands on Study Management.
      if (getUserRole(stored) !== "admin") { router.replace("/dashboard"); return; }

      setSession(stored);
      try {
        const payload = await getProjects(stored);
        setProjects(payload.projects || []);
      } catch {}
      setIsLoading(false);
      loadPiRequests(stored);
    }
    bootstrap();
  }, [router]);

  async function refreshProjects(activeSession = session) {
    if (!activeSession) return [];
    const payload = await getProjects(activeSession);
    const nextProjects = payload.projects || [];
    setProjects(nextProjects);
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
      await refreshProjects(session);
    } catch (err) {
      setCreateProjectStatus(err.message);
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

  async function handleAddPi(e) {
    e.preventDefault();
    setAddPiStatus("");
    if (!addPiEmail || !addPiName || !addPiProjectId) {
      setAddPiStatus("All fields required.");
      return;
    }
    try {
      const result = await addPi(session, {
        email: addPiEmail.trim(),
        name: addPiName.trim(),
        projectId: addPiProjectId,
      });
      const pids = (result.projectIds || []).join(", ");
      setAddPiStatus(`Added ${result.email}. Project access: ${pids}. Cognito invite email sent.`);
      setAddPiEmail("");
      setAddPiName("");
      setAddPiProjectId("");
    } catch (err) {
      setAddPiStatus(err.message);
    }
  }

  if (isLoading) {
    return <main className="centered-page"><p>Loading...</p></main>;
  }

  return (
    <main className="dashboard-shell">
      <header className="app-bar">
        <div className="app-bar-main">
          <div className="app-bar-brand">
            <span className="app-bar-logo">StrideAI</span>
            <span className="app-bar-area">Admin Management</span>
          </div>
          <Link href="/dashboard" className="secondary-btn" style={{ textDecoration: "none" }}>
            ← Study Management
          </Link>
        </div>
        <div className="app-bar-right">
          <button onClick={logout} className="secondary-btn">Logout</button>
        </div>
      </header>

      <section className="panel">
        <h2>Add PI</h2>
        <p className="subtext">
          Create a Cognito account in the admin pool, assign to a study, send an invite email with a temp password.
          Calling this again for an existing PI adds the project to their access list.
        </p>
        {addPiStatus ? (
          <p className={addPiStatus.startsWith("Added") ? "success-text" : "error-text"}>{addPiStatus}</p>
        ) : null}
        <form onSubmit={handleAddPi} className="admin-form" style={{ maxWidth: "520px" }}>
          <label>
            Email
            <input
              type="email"
              value={addPiEmail}
              onChange={(e) => setAddPiEmail(e.target.value)}
              placeholder="pi@university.edu"
              required
            />
          </label>
          <label>
            Name
            <input
              type="text"
              value={addPiName}
              onChange={(e) => setAddPiName(e.target.value)}
              placeholder="Dr Full Name"
              required
            />
          </label>
          <label>
            Project
            <select
              value={addPiProjectId}
              onChange={(e) => setAddPiProjectId(e.target.value)}
              required
            >
              <option value="">Select a project...</option>
              {projects.map((project) => (
                <option key={project.projectId} value={project.projectId}>
                  {project.projectName} ({project.projectId})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="primary-btn">Add PI</button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-heading-row">
          <div>
            <h2>PI Requests</h2>
            <p className="subtext">Legacy: approve project-scoped PI access requests.</p>
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

      <section className="panel">
        <h2>Delete User</h2>
        <p className="subtext">Remove a user's profile, unlink from subjects, and optionally delete from Cognito.</p>
        <form onSubmit={handleDelete} className="admin-form" style={{ maxWidth: "520px" }}>
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
    </main>
  );
}
