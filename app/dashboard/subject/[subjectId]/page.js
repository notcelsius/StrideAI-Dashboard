"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { getPIById } from "@/lib/demoAuth";
import { subjectMilesData } from "@/lib/demoData";
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

const SESSION_KEY = "stride_demo_pi_id";

function findSubject(piRecord, subjectId) {
  for (const project of piRecord.projects) {
    const subject = project.subjects.find((s) => s.subjectId === subjectId);
    if (subject) return { subject, project };
  }
  return null;
}

function avg(data) {
  if (!data.length) return 0;
  return parseFloat((data.reduce((s, d) => s + d.miles, 0) / data.length).toFixed(2));
}

export default function SubjectDetailPage() {
  const router = useRouter();
  const { subjectId } = useParams();
  const [piRecord, setPIRecord] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const session = window.localStorage.getItem(SESSION_KEY);
    if (!session) { router.replace("/login"); return; }
    const pi = getPIById(session);
    if (!pi) { window.localStorage.removeItem(SESSION_KEY); router.replace("/login"); return; }
    setPIRecord(pi);
    setIsLoading(false);
  }, [router]);

  if (isLoading) return <main className="centered-page"><p>Loading...</p></main>;
  if (!piRecord) return null;

  const found = findSubject(piRecord, subjectId);
  if (!found) return <main className="centered-page"><p>Subject not found.</p></main>;

  const { subject, project } = found;
  const data = subjectMilesData[subjectId] || [];
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

      <section className="kpi-row" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <div className="kpi-card">
          <p className="subtext">Avg Miles / Day</p>
          <p className="kpi-value">{average} mi</p>
        </div>
        <div className="kpi-card">
          <p className="subtext">Total Miles (14 days)</p>
          <p className="kpi-value">{totalMiles} mi</p>
        </div>
        <div className="kpi-card">
          <p className="subtext">Best Day</p>
          <p className="kpi-value">{maxDay.miles} mi</p>
          <p className="subtext" style={{ fontSize: "0.8rem" }}>{maxDay.date}</p>
        </div>
      </section>

      <section className="panel" style={{ minHeight: "360px" }}>
        <h2>Miles Traveled Per Day</h2>
        <p className="subtext" style={{ marginTop: "-0.4rem" }}>Last 14 days</p>
        <div style={{ height: 300 }}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d9e2ef" vertical={false} />
              <XAxis dataKey="date" tick={{ fontSize: 12, fill: "#475569" }} />
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
                  <tr key={row.date}>
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
