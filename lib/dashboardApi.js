import { clearSession } from "@/lib/cognitoAuth";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "";

function authHeaders(session) {
  const token = session?.idToken || session?.accessToken || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatChartLabel(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function dateInputValue(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return value.toISOString().slice(0, 10);
}

export function getDefaultDateRange() {
  return {
    start: dateInputValue(-13),
    end: dateInputValue(0),
  };
}

function handleUnauthorized(response) {
  if (response.status === 401 && typeof window !== "undefined") {
    clearSession();
    window.location.assign("/login");
  }
}

async function fetchJson(path, session) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(session),
    },
    cache: "no-store",
  });

  if (!response.ok) {
    handleUnauthorized(response);
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return response.json();
}

async function postJson(path, body, session) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(session),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    handleUnauthorized(response);
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return response.json();
}

export async function getProjects(session) {
  return fetchJson("/projects", session);
}

export async function createProject(session, { projectId, projectName, piName, adminName }) {
  return postJson("/admin/projects", { projectId, projectName, piName, adminName }, session);
}

export async function createPiRequest({ name, email, requestedProjectId, note }) {
  return postJson("/pi-requests", { name, email, requestedProjectId, note });
}

export async function addPi(session, { email, name, projectId }) {
  return postJson("/admin/pis", { email, name, projectId }, session);
}

export async function getPiRequests(session, status = "pending") {
  const query = new URLSearchParams({ status });
  return fetchJson(`/admin/pi-requests?${query.toString()}`, session);
}

export async function approvePiRequest(session, requestId, projectId) {
  return postJson(`/admin/pi-requests/${encodeURIComponent(requestId)}/approve`, { projectId }, session);
}

export async function rejectPiRequest(session, requestId, reason = "") {
  return postJson(`/admin/pi-requests/${encodeURIComponent(requestId)}/reject`, { reason }, session);
}

export async function getProjectSubjects(session, projectId) {
  return fetchJson(`/projects/${projectId}/subjects`, session);
}

export async function getProjectGroups(session, projectId) {
  return fetchJson(`/projects/${projectId}/groups`, session);
}

export async function upsertProjectGroup(session, { projectId, groupId, groupName }) {
  return postJson("/admin/groups", { projectId, groupId, groupName }, session);
}

export async function archiveProjectGroup(session, projectId, groupId) {
  const query = new URLSearchParams({ projectId });
  const response = await fetch(`${API_BASE_URL}/admin/groups/${encodeURIComponent(groupId)}?${query.toString()}`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(session),
    },
    body: JSON.stringify({ projectId }),
  });

  if (!response.ok) {
    handleUnauthorized(response);
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with ${response.status}`);
  }

  return response.json();
}

export async function getSubjectMiles(session, subjectId, range, projectId = "") {
  const query = new URLSearchParams({ ...range, ...(projectId ? { projectId } : {}) });
  const payload = await fetchJson(`/subjects/${subjectId}/miles?${query.toString()}`, session);
  return {
    ...payload,
    dailyMiles: (payload.dailyMiles || []).map((row) => ({
      ...row,
      label: formatChartLabel(row.date),
    })),
  };
}

export async function getSubjectExportManifest(session, subjectId, range, projectId = "") {
  const query = new URLSearchParams({ ...range, ...(projectId ? { projectId } : {}) });
  return fetchJson(`/subjects/${subjectId}/export.csv?${query.toString()}`, session);
}

export async function linkPatientSubject(session, patientSub, subjectId, projectId) {
  return postJson("/admin/subject-links", { patientSub, subjectId, projectId }, session);
}

export async function deleteUser(session, userSub, { userPoolId, username, projectId } = {}) {
  const res = await fetch(`${API_BASE_URL}/admin/users`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json", ...authHeaders(session) },
    body: JSON.stringify({ userSub, userPoolId, username, projectId }),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed with ${res.status}`);
  }
  return res.json();
}

export async function createSubject(session, subjectId, projectId, participantName, groups = []) {
  return postJson("/admin/subjects", { subjectId, projectId, participantName, groups }, session);
}

export async function createEnrollmentCode(session, subjectId, projectId, participantName) {
  return postJson("/admin/enrollment-codes", { subjectId, projectId, participantName }, session);
}

export async function getParticipantStatistics(session, params = {}) {
  const start = params.start || "";
  const end = params.end || "";
  if (!start || !end) {
    throw new Error("start and end are required");
  }

  const projectIds = [...(params.projectIds || [])].map(String).filter(Boolean);
  const groupIds = [...(params.groupIds || [])].map(String).filter(Boolean);
  const subjectIds = [...(params.subjectIds || [])].map(String).filter(Boolean);

  const query = new URLSearchParams();
  query.set("start", start);
  query.set("end", end);
  if (projectIds.length) query.set("projectIds", projectIds.join(","));
  if (groupIds.length) query.set("groupIds", groupIds.join(","));
  if (subjectIds.length) query.set("subjectIds", subjectIds.join(","));
  query.set("sortBy", params.sortBy || "totalMiles");
  query.set("sortDir", params.sortDir || "desc");

  return fetchJson(`/participants/statistics?${query.toString()}`, session);
}

export async function updateSubjectGroups(session, body) {
  return postJson("/admin/subject-groups", body, session);
}

export async function findAccessibleSubject(session, subjectId) {
  const projectsPayload = await getProjects(session);
  for (const project of projectsPayload.projects || []) {
    const subjectsPayload = await getProjectSubjects(session, project.projectId);
    const subject = (subjectsPayload.subjects || []).find((candidate) => candidate.subjectId === subjectId);
    if (subject) {
      return { project, subject };
    }
  }
  return null;
}
