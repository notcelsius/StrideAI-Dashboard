"use client";

import { HUB_COLORS, formatDwell } from "@/lib/hubComputation";

export default function HubLegend({ hubs }) {
  const counts = {};
  for (const h of hubs) {
    counts[h.classification] = (counts[h.classification] || 0) + 1;
  }

  return (
    <div className="hub-legend">
      <p className="subtext" style={{ fontSize: "0.82rem", marginBottom: "0.2rem" }}>
        {hubs.length} hub{hubs.length !== 1 ? "s" : ""} found
        {counts.habitual ? ` · ${counts.habitual} habitual` : ""}
        {counts.frequented ? ` · ${counts.frequented} frequented` : ""}
      </p>
      {hubs.map((hub, i) => (
        <div key={`${hub.gridX},${hub.gridY}`} className="hub-legend-item">
          <span
            className="hub-legend-dot"
            style={{ background: HUB_COLORS[hub.classification] }}
          />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="hub-classification-badge" style={{ color: HUB_COLORS[hub.classification] }}>
                {hub.classification}
              </span>
              <span style={{ fontSize: "0.8rem", color: "var(--muted)" }}>
                {hub.timePercentage}%
              </span>
            </div>
            <p style={{ fontSize: "0.82rem", margin: 0 }}>
              {formatDwell(hub.totalTimeSeconds)} · {hub.visitCount} visits
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
