import { parseGPSPoints } from "./hubComputation";

export async function fetchAndParseCSVs(exportFiles, onProgress, maxConcurrency = 6) {
  const withUrls = exportFiles.filter((f) => f.downloadUrl);
  if (withUrls.length === 0) return [];

  const allPoints = [];
  let completed = 0;

  for (let i = 0; i < withUrls.length; i += maxConcurrency) {
    const batch = withUrls.slice(i, i + maxConcurrency);
    const results = await Promise.allSettled(
      batch.map(async (file) => {
        const res = await fetch(file.downloadUrl);
        if (!res.ok) {
          if (res.status === 403) throw new Error("EXPIRED");
          throw new Error(`HTTP ${res.status}`);
        }
        return res.text();
      })
    );

    for (const result of results) {
      completed++;
      if (onProgress) onProgress(completed, withUrls.length);

      if (result.status === "fulfilled") {
        const points = parseGPSPoints(result.value);
        for (const p of points) allPoints.push(p);
      } else if (result.reason?.message === "EXPIRED") {
        throw new Error("Presigned URLs have expired. Please reload CSV exports.");
      }
    }
  }

  allPoints.sort((a, b) => a.timestamp - b.timestamp);
  return allPoints;
}
