import { demoPIs } from "@/lib/demoData";
import { getUserRole } from "@/lib/cognitoAuth";

function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function flattenProjects() {
  return demoPIs.flatMap((pi) =>
    pi.projects.map((project) => ({
      ...project,
      ownerPiId: pi.piId,
      ownerPiName: pi.piName,
    }))
  );
}

export function buildDashboardRecord(session) {
  const claims = session?.claims || {};
  const role = getUserRole(session);
  const identity = claims.email || claims["cognito:username"] || claims.sub || "dashboard-user";
  const displayName = claims.name || claims.email || claims["cognito:username"] || "Dashboard User";

  if (role === "admin") {
    return {
      piId: identity,
      piName: displayName,
      role,
      projects: flattenProjects(),
    };
  }

  const assignmentSeed = hashString(identity);
  const assignedPi = demoPIs[assignmentSeed % demoPIs.length] || demoPIs[0];

  return {
    piId: identity,
    piName: displayName,
    role,
    projects: assignedPi?.projects || [],
  };
}
