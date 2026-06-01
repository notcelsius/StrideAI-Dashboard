"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { getSubjectExportManifest } from "@/lib/dashboardApi";
import { fetchAndParseCSVs } from "@/lib/csvFetcher";
import { computeHubs, buildTracks, TRACK_PALETTE } from "@/lib/hubComputation";

const LocationHubsMap = dynamic(() => import("./LocationHubsMap"), { ssr: false });

// How many participants to load in parallel. Each one internally batches its
// own CSV fetches, so keep this modest to avoid a fetch storm.
const PARTICIPANT_CONCURRENCY = 3;

// Load one participant's points. Presigned URLs live only 300s, so if a
// download 403s mid-run we transparently re-fetch a fresh manifest and retry
// once — the aggregate has no manual "reload exports" affordance, so it has to
// self-heal.
async function loadParticipantPoints(session, participant, range) {
  // Unlinked participants have no paired patient account, so no GPS exports
  // exist. That's expected, not a failure — don't even hit the API.
  if (participant.linked === false) {
    return { participant, points: [], status: "nodata" };
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    let manifest;
    try {
      manifest = await getSubjectExportManifest(
        session,
        participant.subjectId,
        range,
        participant.projectId || ""
      );
    } catch (err) {
      // "Not linked to a user yet" (404) means nothing to export — benign.
      if (err.message?.toLowerCase().includes("not linked")) {
        return { participant, points: [], status: "nodata" };
      }
      throw err;
    }
    const files = (manifest?.files || []).filter((f) => f.downloadUrl);
    if (files.length === 0) return { participant, points: [], status: "nodata", recovered: attempt > 0 };
    try {
      const points = await fetchAndParseCSVs(files);
      return { participant, points, status: "ok", recovered: attempt > 0 };
    } catch (err) {
      // On the first expiry, loop to regenerate fresh URLs; otherwise give up.
      if (attempt === 0 && err.message?.toLowerCase().includes("expired")) continue;
      throw err;
    }
  }
  return { participant, points: [], status: "nodata", recovered: true };
}

export default function StudyMapPanel({ session, range, participants, disabledReason }) {
  const [hubs, setHubs] = useState(null);
  const [points, setPoints] = useState(null);
  const [tracks, setTracks] = useState(null);
  const [legend, setLegend] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [progress, setProgress] = useState("");

  const participantCount = participants?.length || 0;

  async function handleCompute() {
    if (!session || participantCount === 0) return;

    setLoading(true);
    setError("");
    setNotice("");
    setLoaded(false);
    setHubs(null);
    setPoints(null);
    setTracks(null);
    setLegend([]);

    try {
      const perParticipant = [];
      let done = 0;
      let recoveredCount = 0;
      let failedCount = 0;
      let noDataCount = 0;
      for (let i = 0; i < participants.length; i += PARTICIPANT_CONCURRENCY) {
        const batch = participants.slice(i, i + PARTICIPANT_CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map((p) => loadParticipantPoints(session, p, range))
        );
        for (const result of results) {
          done++;
          setProgress(`Loading participant ${done} of ${participantCount}...`);
          if (result.status === "fulfilled") {
            if (result.value.recovered) recoveredCount++;
            if (result.value.points.length > 0) perParticipant.push(result.value);
            else noDataCount++; // unlinked or no GPS in range — expected, not an error
          } else {
            // Genuine error even after a refresh — skip and report as retryable.
            failedCount++;
          }
        }
      }

      // Surface what happened without blocking the map that did load. Keep
      // benign "no data" separate from the alarming "could not be loaded".
      const notes = [];
      if (recoveredCount > 0) {
        notes.push(`Refreshed expired download links for ${recoveredCount} participant${recoveredCount !== 1 ? "s" : ""}.`);
      }
      if (noDataCount > 0) {
        notes.push(`${noDataCount} participant${noDataCount !== 1 ? "s" : ""} had no GPS data in this range.`);
      }
      if (failedCount > 0) {
        notes.push(`${failedCount} participant${failedCount !== 1 ? "s" : ""} could not be loaded — recompute to retry.`);
      }
      setNotice(notes.join(" "));

      setProgress("Building map...");
      const allPoints = perParticipant.flatMap((pp) => pp.points);
      const trackGroups = perParticipant.map((pp, idx) => ({
        color: TRACK_PALETTE[idx % TRACK_PALETTE.length],
        segments: buildTracks(pp.points),
      }));
      const legendRows = perParticipant.map((pp, idx) => ({
        color: TRACK_PALETTE[idx % TRACK_PALETTE.length],
        name: pp.participant.participantName || pp.participant.subjectId,
        pointCount: pp.points.length,
      }));

      setHubs(computeHubs(allPoints));
      setPoints(allPoints);
      setTracks(trackGroups);
      setLegend(legendRows);
      setLoaded(true);
      setProgress("");
    } catch (err) {
      setError(err.message || "Failed to build the aggregate map.");
      setProgress("");
    } finally {
      setLoading(false);
    }
  }

  if (disabledReason) {
    return <p className="subtext">{disabledReason}</p>;
  }

  if (participantCount === 0) {
    return <p className="subtext">No participants match the current filters.</p>;
  }

  return (
    <div>
      {!loaded && !loading && (
        <button className="primary-btn" onClick={handleCompute}>
          Show Aggregate Map ({participantCount} participant{participantCount !== 1 ? "s" : ""})
        </button>
      )}

      {loading && <p className="subtext">{progress || "Processing..."}</p>}

      {notice && <p className="subtext" style={{ color: "var(--muted)" }}>{notice}</p>}

      {error && (
        <div>
          <p className="error-text">{error}</p>
          <button className="secondary-btn" style={{ marginTop: "0.5rem" }} onClick={handleCompute}>
            Retry
          </button>
        </div>
      )}

      {loaded && (!points || points.length === 0) && (
        <p className="subtext">No GPS data found for these participants in the selected range.</p>
      )}

      {loaded && points && points.length > 0 && (
        <div>
          {hubs && hubs.length === 0 && (
            <p className="subtext" style={{ marginTop: 0 }}>
              No significant shared location hubs — showing each participant&apos;s tracks and a combined heatmap.
            </p>
          )}
          <div className="hub-map-layout">
            <LocationHubsMap hubs={hubs} points={points} tracks={tracks} />
            <div className="hub-legend">
              <p className="subtext" style={{ fontSize: "0.82rem", marginBottom: "0.2rem" }}>
                {legend.length} participant{legend.length !== 1 ? "s" : ""} with GPS
              </p>
              {legend.map((row) => (
                <div key={row.name} className="hub-legend-item">
                  <span className="hub-legend-dot" style={{ background: row.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ fontSize: "0.85rem" }}>{row.name}</span>
                    <p style={{ fontSize: "0.78rem", margin: 0, color: "var(--muted)" }}>
                      {row.pointCount.toLocaleString()} points
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <button className="secondary-btn" style={{ marginTop: "0.75rem" }} onClick={handleCompute}>
            Recompute
          </button>
        </div>
      )}
    </div>
  );
}
