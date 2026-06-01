"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { fetchAndParseCSVs } from "@/lib/csvFetcher";
import { computeHubs, buildTracks, TRACK_PALETTE } from "@/lib/hubComputation";
import HubLegend from "./HubLegend";

const LocationHubsMap = dynamic(() => import("./LocationHubsMap"), { ssr: false });

export default function LocationHubsPanel({ exportFiles, exportLoaded, onLoadExports, isExportLoading }) {
  const [hubs, setHubs] = useState(null);
  const [points, setPoints] = useState(null);
  const [hubsLoading, setHubsLoading] = useState(false);
  const [hubsError, setHubsError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");

  // One track group for this subject; gap-split into session segments.
  const tracks = useMemo(
    () => (points?.length ? [{ color: TRACK_PALETTE[0], segments: buildTracks(points) }] : null),
    [points]
  );

  async function handleCompute() {
    setHubsLoading(true);
    setHubsError("");
    setNotice("");
    setHubs(null);
    setPoints(null);
    setProgress("Fetching CSV files...");

    const onProgress = (done, total) => setProgress(`Fetching CSV ${done} of ${total}...`);

    try {
      let gpsPoints;
      try {
        gpsPoints = await fetchAndParseCSVs(exportFiles, onProgress);
      } catch (err) {
        // Presigned URLs live only 300s. On expiry, silently re-fetch a fresh
        // manifest and retry once, leaving a note rather than a dead end.
        if (err.message?.toLowerCase().includes("expired") && onLoadExports) {
          setProgress("Download links expired — refreshing...");
          const fresh = await onLoadExports();
          setNotice("Some download links had expired and were refreshed automatically.");
          gpsPoints = await fetchAndParseCSVs(fresh || [], onProgress);
        } else {
          throw err;
        }
      }

      setProgress("Computing location hubs...");
      setHubs(computeHubs(gpsPoints));
      setPoints(gpsPoints);
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
      {!points && !hubsLoading && (
        <button className="primary-btn" onClick={handleCompute}>
          Show Activity Map ({exportFiles.length} file{exportFiles.length !== 1 ? "s" : ""})
        </button>
      )}

      {hubsLoading && (
        <p className="subtext">{progress || "Processing..."}</p>
      )}

      {notice && <p className="subtext" style={{ color: "var(--muted)" }}>{notice}</p>}

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

      {points && points.length === 0 && (
        <p className="subtext">No GPS points found in the loaded CSV files for this date range.</p>
      )}

      {points && points.length > 0 && (
        <div>
          {hubs && hubs.length === 0 && (
            <p className="subtext" style={{ marginTop: 0 }}>
              No significant location hubs (no spot held long enough to register) — showing GPS tracks and heatmap.
            </p>
          )}
          <div className="hub-map-layout">
            <LocationHubsMap hubs={hubs} points={points} tracks={tracks} />
            <HubLegend hubs={hubs || []} />
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
