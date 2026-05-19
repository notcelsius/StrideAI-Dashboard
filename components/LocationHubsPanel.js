"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { fetchAndParseCSVs } from "@/lib/csvFetcher";
import { computeHubs } from "@/lib/hubComputation";
import HubLegend from "./HubLegend";

const LocationHubsMap = dynamic(() => import("./LocationHubsMap"), { ssr: false });

export default function LocationHubsPanel({ exportFiles, exportLoaded, onLoadExports, isExportLoading }) {
  const [hubs, setHubs] = useState(null);
  const [hubsLoading, setHubsLoading] = useState(false);
  const [hubsError, setHubsError] = useState("");
  const [progress, setProgress] = useState("");

  async function handleCompute() {
    setHubsLoading(true);
    setHubsError("");
    setHubs(null);
    setProgress("Fetching CSV files...");

    try {
      const points = await fetchAndParseCSVs(exportFiles, (done, total) => {
        setProgress(`Fetching CSV ${done} of ${total}...`);
      });

      setProgress("Computing location hubs...");
      const result = computeHubs(points);
      setHubs(result);
      setProgress("");
    } catch (err) {
      setHubsError(err.message || "Failed to compute location hubs.");
      setProgress("");
    } finally {
      setHubsLoading(false);
    }
  }

  if (!exportLoaded) {
    return (
      <div>
        <p className="subtext">Load CSV exports first to enable Location Hubs.</p>
        <button
          className="secondary-btn"
          style={{ marginTop: "0.5rem" }}
          onClick={onLoadExports}
          disabled={isExportLoading}
        >
          {isExportLoading ? "Loading..." : "Load CSV Exports"}
        </button>
      </div>
    );
  }

  if (exportFiles.length === 0) {
    return <p className="subtext">No GPS data available for this date range.</p>;
  }

  return (
    <div>
      {!hubs && !hubsLoading && (
        <button className="primary-btn" onClick={handleCompute}>
          Compute Location Hubs ({exportFiles.length} file{exportFiles.length !== 1 ? "s" : ""})
        </button>
      )}

      {hubsLoading && (
        <p className="subtext">{progress || "Processing..."}</p>
      )}

      {hubsError && (
        <div>
          <p className="error-text">{hubsError}</p>
          {hubsError.includes("expired") && (
            <button className="secondary-btn" style={{ marginTop: "0.5rem" }} onClick={onLoadExports}>
              Reload CSV Exports
            </button>
          )}
        </div>
      )}

      {hubs && hubs.length === 0 && (
        <p className="subtext">No significant location hubs found. The subject may not have stayed in any location long enough to register.</p>
      )}

      {hubs && hubs.length > 0 && (
        <div>
          <div className="hub-map-layout">
            <LocationHubsMap hubs={hubs} />
            <HubLegend hubs={hubs} />
          </div>
          <button
            className="secondary-btn"
            style={{ marginTop: "0.75rem" }}
            onClick={handleCompute}
          >
            Recompute
          </button>
        </div>
      )}
    </div>
  );
}
