import { demoPIs } from "@/lib/demoData";

function normalizePIId(rawPIId) {
  return String(rawPIId || "").trim().toUpperCase();
}

function sanitizePIRecord(record) {
  if (!record) return null;
  const { password, ...safeRecord } = record;
  return safeRecord;
}

export function authenticatePI(piId, password) {
  const normalizedPIId = normalizePIId(piId);
  const candidate = demoPIs.find(
    (pi) => pi.piId === normalizedPIId && pi.password === String(password || "")
  );
  return sanitizePIRecord(candidate);
}

export function getPIById(piId) {
  const normalizedPIId = normalizePIId(piId);
  const candidate = demoPIs.find((pi) => pi.piId === normalizedPIId);
  return sanitizePIRecord(candidate);
}
