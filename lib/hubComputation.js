const BIN_SIZE = 50;
const MIN_DWELL = 900;
const MAX_GAP = 1800;

const CLASSIFICATIONS = [
  { name: "habitual", min: 15 },
  { name: "frequented", min: 5 },
  { name: "occasional", min: 2 },
  { name: "transient", min: 0 },
];

const HUB_COLORS = {
  habitual: "#cc0000",
  frequented: "#ea580c",
  occasional: "#eab308",
  transient: "#86efac",
};

export { HUB_COLORS };

export function parseGPSPoints(csvText) {
  const lines = csvText.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].toLowerCase().split(",").map((h) => h.trim());
  const latIdx = header.indexOf("latitude");
  const lonIdx = header.indexOf("longitude");
  if (latIdx === -1 || lonIdx === -1) return [];

  const tsIdx = header.indexOf("timestamp");
  const speedIdx = header.indexOf("speed_mps");
  const altIdx = header.indexOf("altitude_m");
  const actIdx = header.indexOf("activity");

  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const lat = parseFloat(cols[latIdx]);
    const lon = parseFloat(cols[lonIdx]);
    if (isNaN(lat) || isNaN(lon)) continue;

    const ts = tsIdx !== -1 ? new Date(cols[tsIdx].trim()).getTime() : 0;
    if (isNaN(ts)) continue;

    points.push({
      timestamp: ts,
      lat,
      lon,
      speed: speedIdx !== -1 ? parseFloat(cols[speedIdx]) || 0 : 0,
      altitude: altIdx !== -1 ? parseFloat(cols[altIdx]) || 0 : 0,
      activity: actIdx !== -1 ? (cols[actIdx] || "").trim() : "",
    });
  }

  points.sort((a, b) => a.timestamp - b.timestamp);
  return points;
}

function classify(timePercentage) {
  for (const c of CLASSIFICATIONS) {
    if (timePercentage > c.min) return c.name;
  }
  return "transient";
}

export function computeHubs(points) {
  if (points.length === 0) return [];

  const refLat = points[0].lat;
  const refLon = points[0].lon;
  const cosRef = Math.cos(refLat * Math.PI / 180);

  const bins = new Map();

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const latMeters = (p.lat - refLat) * 111320;
    const lonMeters = (p.lon - refLon) * 111320 * cosRef;
    const gridX = Math.floor(lonMeters / BIN_SIZE);
    const gridY = Math.floor(latMeters / BIN_SIZE);
    const key = `${gridX},${gridY}`;

    let dwell = 0;
    if (i < points.length - 1) {
      const gap = (points[i + 1].timestamp - p.timestamp) / 1000;
      dwell = gap < 0 ? 0 : Math.min(gap, MAX_GAP);
    }

    let bin = bins.get(key);
    if (!bin) {
      bin = { gridX, gridY, totalTime: 0, visitCount: 0, sumLat: 0, sumLon: 0, pointCount: 0 };
      bins.set(key, bin);
    }
    bin.totalTime += dwell;
    bin.visitCount++;
    bin.sumLat += p.lat;
    bin.sumLon += p.lon;
    bin.pointCount++;
  }

  const totalTimeAll = Array.from(bins.values()).reduce((s, b) => s + b.totalTime, 0);
  if (totalTimeAll === 0) return [];

  const hubs = [];
  for (const bin of bins.values()) {
    if (bin.totalTime < MIN_DWELL) continue;

    const timePercentage = (bin.totalTime / totalTimeAll) * 100;
    hubs.push({
      gridX: bin.gridX,
      gridY: bin.gridY,
      centerLat: bin.sumLat / bin.pointCount,
      centerLon: bin.sumLon / bin.pointCount,
      totalTimeSeconds: Math.round(bin.totalTime),
      visitCount: bin.visitCount,
      timePercentage: parseFloat(timePercentage.toFixed(1)),
      classification: classify(timePercentage),
    });
  }

  hubs.sort((a, b) => b.totalTimeSeconds - a.totalTimeSeconds);
  return hubs;
}

export function formatDwell(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

// Distinct, high-contrast colors for per-participant track lines. Cycles if
// there are more participants than colors.
export const TRACK_PALETTE = [
  "#2563eb", "#16a34a", "#db2777", "#ea580c", "#7c3aed",
  "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#059669",
  "#be185d", "#c2410c", "#0d9488", "#9333ea", "#65a30d",
];

const TRACK_MAX_GAP_MS = 30 * 60 * 1000; // break the line across gaps > 30 min

// Split one participant's time-sorted points into polyline segments, breaking
// the line wherever there's a large time gap (separate sessions) so we don't
// draw a straight jump across hours of missing data.
export function buildTracks(points, maxGapMs = TRACK_MAX_GAP_MS) {
  if (!points || points.length === 0) return [];
  const segments = [];
  let current = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (current.length > 0 && p.timestamp - points[i - 1].timestamp > maxGapMs) {
      if (current.length > 1) segments.push(current);
      current = [];
    }
    current.push({ lat: p.lat, lon: p.lon });
  }
  if (current.length > 1) segments.push(current);
  return segments;
}
