"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getUserRole, getValidSession } from "@/lib/cognitoAuth";
import { getProjects } from "@/lib/dashboardApi";

const STAFF_ROLES = ["admin", "pi", "coordinator"];

// Explicit sentinel so "All studies" (projectId=all) is distinguishable from
// "no study chosen yet" (no param), which we auto-default to the first study.
const ALL_STUDIES = "all";

const StudyContext = createContext(null);

export function useStudy() {
  const context = useContext(StudyContext);
  if (!context) {
    throw new Error("useStudy must be used within a StudyProvider");
  }
  return context;
}

export default function StudyProvider({ children }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlProjectId = searchParams.get("projectId") || "";

  const [session, setSession] = useState(null);
  const [role, setRole] = useState("user");
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  // Auth + projects bootstrap, shared by every Study Management page.
  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      const stored = await getValidSession();
      if (!stored) {
        router.replace("/login");
        return;
      }
      const userRole = getUserRole(stored);
      if (!STAFF_ROLES.includes(userRole)) {
        router.replace("/login");
        return;
      }

      let loadedProjects = [];
      try {
        const payload = await getProjects(stored);
        loadedProjects = payload.projects || [];
      } catch {
        loadedProjects = [];
      }

      if (!isMounted) return;
      setSession(stored);
      setRole(userRole);
      setProjects(loadedProjects);
      setIsLoading(false);
    }

    bootstrap();
    return () => {
      isMounted = false;
    };
  }, [router]);

  // The selected study is whatever the URL says, if it still resolves to an
  // accessible project. "" means "All studies" (Overview only).
  const selectedProjectId = useMemo(() => {
    if (!urlProjectId || urlProjectId === ALL_STUDIES) return "";
    return projects.some((project) => project.projectId === urlProjectId) ? urlProjectId : "";
  }, [urlProjectId, projects]);

  // Default to the first concrete study so it's always obvious which study you
  // are on, but only once projects are known and the URL hasn't already picked one.
  useEffect(() => {
    if (isLoading || urlProjectId || !projects.length) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("projectId", projects[0].projectId);
    router.replace(`?${params.toString()}`);
  }, [isLoading, urlProjectId, projects, searchParams, router]);

  const setSelectedProjectId = useCallback(
    (projectId) => {
      const params = new URLSearchParams(searchParams.toString());
      // Empty selection persists as the "all" sentinel so it isn't mistaken
      // for an uninitialized URL and auto-reset to the first study.
      params.set("projectId", projectId || ALL_STUDIES);
      router.replace(`?${params.toString()}`);
    },
    [searchParams, router]
  );

  const refreshProjects = useCallback(async () => {
    if (!session) return [];
    try {
      const payload = await getProjects(session);
      const nextProjects = payload.projects || [];
      setProjects(nextProjects);
      return nextProjects;
    } catch {
      return projects;
    }
  }, [session, projects]);

  const selectedProject = useMemo(
    () => projects.find((project) => project.projectId === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const value = useMemo(
    () => ({
      session,
      role,
      projects,
      selectedProjectId,
      selectedProject,
      setSelectedProjectId,
      refreshProjects,
      isLoading,
    }),
    [session, role, projects, selectedProjectId, selectedProject, setSelectedProjectId, refreshProjects, isLoading]
  );

  return <StudyContext.Provider value={value}>{children}</StudyContext.Provider>;
}
