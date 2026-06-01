"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  BarChart,
  Bar,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getDefaultDateRange,
  getParticipantStatistics,
} from "@/lib/dashboardApi";
import { useStudy } from "@/app/dashboard/StudyProvider";

const SORTABLE_COLUMNS = [
  { key: "totalMiles", label: "Total Miles" },
  { key: "averageMilesPerActiveDay", label: "Avg / Active Day" },
  { key: "activeDays", label: "Active Days" },
  { key: "sessionCount", label: "Sessions" },
];

const UNGROUPED_OPTION = { groupId: "ungrouped", groupName: "Ungrouped" };

function formatChartLabel(date) {
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function readFiltersFromUrl(searchParams) {
  const defaults = getDefaultDateRange();
  return {
    start: searchParams.get("start") || defaults.start,
    end: searchParams.get("end") || defaults.end,
    projectId: searchParams.get("projectId") || "",
    groupId: searchParams.get("groupId") || "",
    sortBy: searchParams.get("sortBy") || "totalMiles",
    sortDir: searchParams.get("sortDir") || "desc",
  };
}

function buildQueryString(filters) {
  const params = new URLSearchParams();
  if (filters.start) params.set("start", filters.start);
  if (filters.end) params.set("end", filters.end);
  if (filters.projectId) params.set("projectId", filters.projectId);
  if (filters.groupId) params.set("groupId", filters.groupId);
  if (filters.sortBy) params.set("sortBy", filters.sortBy);
  if (filters.sortDir) params.set("sortDir", filters.sortDir);
  return params.toString();
}

export default function DashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, selectedProject, selectedProjectId } = useStudy();
  const [statistics, setStatistics] = useState(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshedAt, setRefreshedAt] = useState(null);

  const filters = useMemo(() => readFiltersFromUrl(searchParams), [searchParams]);

  const loadStatistics = useCallback(
    async (activeSession, activeFilters) => {
      if (!activeSession) return;
      setIsStatsLoading(true);
      setError("");
      try {
        const payload = await getParticipantStatistics(activeSession, {
          start: activeFilters.start,
          end: activeFilters.end,
          projectIds: activeFilters.projectId ? [activeFilters.projectId] : [],
          groupIds: activeFilters.groupId ? [activeFilters.groupId] : [],
          sortBy: activeFilters.sortBy,
          sortDir: activeFilters.sortDir,
        });
        setStatistics(payload);
        setRefreshedAt(new Date());
      } catch (loadError) {
        setError(loadError.message || "Unable to load statistics.");
        setStatistics(null);
      } finally {
        setIsStatsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (!session) return;
    // selectedProjectId resolves the "all" sentinel to "" (no study filter).
    loadStatistics(session, { ...filters, projectId: selectedProjectId });
  }, [session, filters, selectedProjectId, loadStatistics]);

  function updateFilters(patch) {
    const next = { ...filters, ...patch };
    const query = buildQueryString(next);
    router.replace(`/dashboard${query ? `?${query}` : ""}`);
  }

  function handleSort(columnKey) {
    if (filters.sortBy === columnKey) {
      updateFilters({ sortDir: filters.sortDir === "desc" ? "asc" : "desc" });
    } else {
      updateFilters({ sortBy: columnKey, sortDir: "desc" });
    }
  }

  function handleReset() {
    const defaults = getDefaultDateRange();
    // Keep the active study selected when clearing the other filters.
    const query = buildQueryString({
      start: defaults.start,
      end: defaults.end,
      projectId: filters.projectId,
    });
    router.replace(`/dashboard${query ? `?${query}` : ""}`);
  }

  const groupOptions = useMemo(() => {
    const byId = new Map();
    for (const group of statistics?.byGroup || []) {
      if (!group.groupId) continue;
      byId.set(group.groupId, { groupId: group.groupId, groupName: group.groupName || group.groupId });
    }
    byId.set(UNGROUPED_OPTION.groupId, UNGROUPED_OPTION);
    return Array.from(byId.values());
  }, [statistics]);

  const chartData = useMemo(
    () =>
      (statistics?.dailyTotals || []).map((row) => ({
        ...row,
        label: formatChartLabel(row.date),
      })),
    [statistics]
  );

  const aggregate = statistics?.aggregate || {
    participantCount: 0,
    linkedParticipantCount: 0,
    totalMiles: 0,
    averageMilesPerActiveDay: 0,
    totalSessionCount: 0,
  };
  const participants = statistics?.participants || [];
  const studyLabel = selectedProject
    ? `${selectedProject.projectName} · ${selectedProject.projectId}`
    : "All studies";

  return (
    <>
      <section className="panel">
        <p className="eyebrow">Overview</p>
        <h1 className="study-heading">{studyLabel}</h1>
        <div className="filter-bar">
          <label className="field-label">
            Start date
            <input
              type="date"
              value={filters.start}
              onChange={(e) => updateFilters({ start: e.target.value })}
            />
          </label>
          <label className="field-label">
            End date
            <input
              type="date"
              value={filters.end}
              onChange={(e) => updateFilters({ end: e.target.value })}
            />
          </label>
          <label className="field-label">
            Group
            <select
              value={filters.groupId}
              onChange={(e) => updateFilters({ groupId: e.target.value })}
            >
              <option value="">All groups</option>
              {groupOptions.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  {group.groupName}
                </option>
              ))}
            </select>
          </label>
          <div className="filter-bar-actions">
            <button type="button" className="secondary-btn" onClick={handleReset}>
              Reset
            </button>
          </div>
        </div>
        <p className="refreshed-badge">
          {refreshedAt ? `Refreshed: ${refreshedAt.toLocaleTimeString()}` : "Loading…"}
          {" · "}Max range 90 days
        </p>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      <section className="kpi-row kpi-row-five">
        <div className="kpi-card">
          <p className="kpi-label">Participants</p>
          <p className="kpi-value">{aggregate.participantCount}</p>
        </div>
        <div className="kpi-card">
          <p className="kpi-label">Linked</p>
          <p className="kpi-value">{aggregate.linkedParticipantCount}</p>
        </div>
        <div className="kpi-card">
          <p className="kpi-label">Total Miles</p>
          <p className="kpi-value">{aggregate.totalMiles}</p>
        </div>
        <div className="kpi-card">
          <p className="kpi-label">Avg / Active Day</p>
          <p className="kpi-value">{aggregate.averageMilesPerActiveDay}</p>
        </div>
        <div className="kpi-card">
          <p className="kpi-label">Sessions</p>
          <p className="kpi-value">{aggregate.totalSessionCount}</p>
        </div>
      </section>

      <section className="panel">
        <h2>Daily Miles</h2>
        <p className="subtext" style={{ marginTop: "-0.4rem" }}>
          {filters.start} to {filters.end}
        </p>
        {chartData.length ? (
          <div className="chart-wrap">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ef" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: "#475569" }} />
                <YAxis unit=" mi" tick={{ fontSize: 12, fill: "#475569" }} domain={[0, "auto"]} />
                <Tooltip
                  formatter={(v) => [`${v} mi`, "Miles"]}
                  contentStyle={{ borderRadius: 10, border: "1px solid #d9e2ef", fontSize: 13 }}
                />
                <Bar dataKey="miles" fill="#6c5ce7" radius={[4, 4, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="empty-state">No daily activity in this range.</p>
        )}
      </section>

      <section className="panel">
        <h2>Participants</h2>
        {isStatsLoading ? <p className="subtext">Loading…</p> : null}
        {!isStatsLoading && participants.length === 0 ? (
          <p className="empty-state">No participants matched these filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Subject</th>
                  <th>Name</th>
                  <th>Study</th>
                  <th>Group</th>
                  {SORTABLE_COLUMNS.map((column) => {
                    const isActive = filters.sortBy === column.key;
                    const arrow = isActive ? (filters.sortDir === "desc" ? "▼" : "▲") : "↕";
                    return (
                      <th
                        key={column.key}
                        className={`sortable ${isActive ? "active" : ""}`}
                        onClick={() => handleSort(column.key)}
                      >
                        {column.label}
                        <span className="sort-indicator">{arrow}</span>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {participants.map((participant) => {
                  const groups = participant.groups || [];
                  const metrics = participant.metrics || {};
                  return (
                    <tr key={`${participant.projectId}:${participant.subjectId}`} className="subject-row">
                      <td>
                        <Link
                          href={`/dashboard/subject/${participant.subjectId}?projectId=${participant.projectId}`}
                          className="subject-link"
                        >
                          {participant.subjectId}
                        </Link>
                      </td>
                      <td>{participant.participantName || "—"}</td>
                      <td>{participant.projectName || participant.projectId}</td>
                      <td>
                        {groups.length ? (
                          <span className="group-chip-list">
                            {groups.map((group) => (
                              <span key={group.groupId} className="group-chip">
                                {group.groupName}
                              </span>
                            ))}
                          </span>
                        ) : (
                          <span className="group-chip group-chip-muted">ungrouped</span>
                        )}
                      </td>
                      <td>{metrics.totalMiles ?? 0}</td>
                      <td>{metrics.averageMilesPerActiveDay ?? 0}</td>
                      <td>{metrics.activeDays ?? 0}</td>
                      <td>{metrics.totalSessionCount ?? 0}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
