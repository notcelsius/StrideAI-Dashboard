"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getStoredSession } from "@/lib/cognitoAuth";
import {
  findAccessibleSubject,
  getDefaultDateRange,
  getSubjectExportManifest,
  getSubjectMiles,
} from "@/lib/dashboardApi";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

function avg(data) {
  if (!data.length) return 0;
  return parseFloat((data.reduce((s, d) => s + d.miles, 0) / data.length).toFixed(2));
}

export default function SubjectDetailPage() {
  const router = useRouter();
  const { subjectId } = useParams();
  const [session, setSession] = useState(null);
  const [subjectContext, setSubjectContext] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [exportFiles, setExportFiles] = useState([]);
  const [exportLoaded, setExportLoaded] = useState(false);
  const [range, setRange] = useState(getDefaultDateRange());
  const [isLoading, setIsLoading] = useState(true);
  const [isExportLoading, setIsExportLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function bootstrap() {
      const storedSession = getStoredSession();
      if (!storedSession) {
        router.replace("/login");
        return;
      }

      try {
        const found = await findAccessibleSubject(storedSession, subjectId);
        if (!isMounted) return;
        setSession(storedSession);
        setSubjectContext(found);
        if (!found) {
          setError("Subject not found.");
        }
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError.message || "Unable to load subject.");
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
  }, [router, subjectId]);

  useEffect(() => {
    let isMounted = true;

    async function loadMetrics() {
      if (!session || !subjectContext?.subject) return;

      try {
        setError("");
        const payload = await getSubjectMiles(session, subjectContext.subject.subjectId, range);
        if (!isMounted) return;
        setMetrics(payload);
      } catch (loadError) {
        if (!isMounted) return;
        setError(loadError.message || "Unable to load subject metrics.");
      }
    }

    loadMetrics();

    return () => {
      isMounted = false;
    };
  }, [range, session, subjectContext]);

  async function handleLoadExports() {
    if (!session || !subjectContext?.subject) return;

    setIsExportLoading(true);
    try {
      setError("");
      const payload = await getSubjectExportManifest(session, subjectContext.subject.subjectId, range);
      setExportFiles(payload.files || []);
      setExportLoaded(true);
    } catch (loadError) {
      setError(loadError.message || "Unable to load CSV exports.");
    } finally {
      setIsExportLoading(false);
    }
  }

  if (isLoading) return <main className="centered-page"><p>Loading...</p></main>;
  if (!subjectContext) return <main className="centered-page"><p>{error || "Subject not found."}</p></main>;

  const { subject, project } = subjectContext;
  const data = metrics?.dailyMiles || [];
  const average = avg(data);
  const totalMiles = parseFloat(data.reduce((s, d) => s + d.miles, 0).toFixed(2));
  const maxDay = data.reduce((best, d) => (d.miles > best.miles ? d : best), data[0] || { miles: 0 });

  const statusColor = {
    Active: "#16a34a",
    Paused: "#d97706",
    Completed: "#6366f1",
  }[subject.status] || "#475569";

  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <button
            onClick={() => router.back()}
            className="secondary-btn"
            style={{ padding: "0.5rem 0.8rem" }}
          >
            ← Back
          </button>
          <div>
            <p className="eyebrow">{project.projectName} · {project.projectId}</p>
            <h1 style={{ fontSize: "1.25rem" }}>{subject.participantName}</h1>
            <p className="subtext" style={{ fontFamily: "monospace" }}>{subject.subjectId}</p>
          </div>
        </div>
        <span
          className="status-badge"
          style={{ background: statusColor + "18", color: statusColor, border: `1px solid ${statusColor}40` }}
        >
          {subject.status}
        </span>
      </header>

      <section className="panel">
        <h2>Date Range</h2>
        <div className="range-controls">
          <label>
            <span className="subtext">Start</span>
            <input
              type="date"
              value={range.start}
              onChange={(event) => { setRange((current) => ({ ...current, start: event.target.value })); setExportLoaded(false); }}
            />
          </label>
          <label>
            <span className="subtext">End</span>
            <input
              type="date"
              value={range.end}
              onChange={(event) => { setRange((current) => ({ ...current, end: event.target.value })); setExportLoaded(false); }}
            />
          </label>
          <button type="button" className="secondary-btn" onClick={handleLoadExports}>
            {isExportLoading ? "Loading CSV..." : "Load CSV Exports"}
          </button>
        </div>
        {error ? <p className="error-text">{error}</p> : null}
      </section>

      <section className="kpi-row" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi-card">
          <p className="subtext">Avg Miles / Day</p>
          <p className="kpi-value">{average} mi</p>
        </div>
        <div className="kpi-card">
          <p className="subtext">Total Miles (Selected Range)</p>
          <p className="kpi-value">{totalMiles} mi</p>
        </div>
        <div className="kpi-card">
          <p className="subtext">Best Day</p>
          <p className="kpi-value">{maxDay.miles} mi</p>
          <p className="subtext" style={{ fontSize: "0.8rem" }}>{maxDay.date || "—"}</p>
        </div>
      </section>

      <section className="panel" style={{ minHeight: "360px" }}>
        <h2>Miles Traveled Per Day</h2>
        <p className="subtext" style={{ marginTop: "-0.4rem" }}>
          {range.start} to {range.end}
        </p>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ef" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 12, fill: "#475569" }}
                tickFormatter={(_, index) => data[index]?.label || data[index]?.date || ""}
              />
              <YAxis
                unit=" mi"
                tick={{ fontSize: 12, fill: "#475569" }}
                domain={[0, "auto"]}
              />
              <Tooltip
                formatter={(v) => [`${v} mi`, "Miles"]}
                contentStyle={{ borderRadius: 10, border: "1px solid #d9e2ef", fontSize: 13 }}
              />
              <ReferenceLine y={average} stroke="#1d4ed8" strokeDasharray="4 3" label={{ value: "avg", fill: "#1d4ed8", fontSize: 11, position: "insideTopRight" }} />
              <Bar dataKey="miles" fill="#1d4ed8" radius={[4, 4, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="panel">
        <h2>CSV Exports</h2>
        {exportFiles.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Created</th>
                  <th>Download</th>
                </tr>
              </thead>
              <tbody>
                {exportFiles.map((file) => (
                  <tr key={file.uploadId}>
                    <td>{file.fileName}</td>
                    <td>{file.createdAt || "—"}</td>
                    <td>
                      {file.downloadUrl ? (
                        <a className="subject-link" href={file.downloadUrl} target="_blank" rel="noreferrer">
                          Download
                        </a>
                      ) : (
                        "Unavailable"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="subtext">
            {exportLoaded
              ? "No CSV files found for this date range."
              : "Load exports to view matching CSV files for this range."}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>Daily Log</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Miles</th>
                <th>vs Avg</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((row) => {
                const diff = parseFloat((row.miles - average).toFixed(2));
                const diffColor = diff >= 0 ? "#16a34a" : "#dc2626";
                return (
                  <tr key={row.date || row.label}>
                    <td>{row.date}</td>
                    <td>{row.miles} mi</td>
                    <td style={{ color: diffColor, fontWeight: 600 }}>
                      {diff >= 0 ? "+" : ""}{diff} mi
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
