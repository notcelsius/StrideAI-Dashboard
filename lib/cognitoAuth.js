const SESSION_KEY = "stride_cognito_session";
const PKCE_VERIFIER_KEY = "stride_cognito_pkce_verifier";
const STATE_KEY = "stride_cognito_oauth_state";

export function getCognitoConfig() {
  const domain = process.env.NEXT_PUBLIC_COGNITO_DOMAIN?.trim() || "";
  const clientId = process.env.NEXT_PUBLIC_COGNITO_CLIENT_ID?.trim() || "";
  const redirectUri =
    process.env.NEXT_PUBLIC_COGNITO_REDIRECT_URI?.trim() ||
    (typeof window !== "undefined" ? `${window.location.origin}/login` : "");
  const logoutUri =
    process.env.NEXT_PUBLIC_COGNITO_LOGOUT_URI?.trim() ||
    (typeof window !== "undefined" ? `${window.location.origin}/login` : "");
  const scopes = process.env.NEXT_PUBLIC_COGNITO_SCOPES?.trim() || "openid email profile";

  return {
    domain,
    clientId,
    redirectUri,
    logoutUri,
    scopes,
    isConfigured: Boolean(domain && clientId && redirectUri),
  };
}

function base64UrlEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256(value) {
  const data = new TextEncoder().encode(value);
  return window.crypto.subtle.digest("SHA-256", data);
}

function randomString(length = 64) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(length);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => chars[byte % chars.length]).join("");
}

function decodeJwt(token) {
  try {
    const [, payload] = token.split(".");
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return {};
  }
}

function normalizeGroups(rawGroups) {
  if (Array.isArray(rawGroups)) return rawGroups;
  if (typeof rawGroups === "string" && rawGroups.trim()) {
    const value = rawGroups.trim();
    if (value.startsWith("[")) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed;
      } catch {}
    }
    return value.split(",").map((group) => group.trim()).filter(Boolean);
  }
  return [];
}

function buildSession(tokenResponse) {
  const claims = decodeJwt(tokenResponse.id_token);
  return {
    idToken: tokenResponse.id_token,
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token || "",
    expiresIn: tokenResponse.expires_in || 3600,
    tokenType: tokenResponse.token_type || "Bearer",
    claims,
    groups: normalizeGroups(claims["cognito:groups"]),
    authenticatedAt: new Date().toISOString(),
  };
}

const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function getStoredSession() {
  if (typeof window === "undefined") return null;

  const raw = window.localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    const session = JSON.parse(raw);
    if (session.authenticatedAt) {
      const age = Date.now() - new Date(session.authenticatedAt).getTime();
      if (age > MAX_SESSION_AGE_MS) {
        clearSession();
        return null;
      }
    }
    return session;
  } catch {
    window.localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function isTokenExpired(session) {
  if (!session?.claims?.exp) return true;
  return Date.now() >= session.claims.exp * 1000 - 60_000;
}

export async function refreshSession(session) {
  const config = getCognitoConfig();
  if (!config.isConfigured || !session?.refreshToken) return null;

  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      refresh_token: session.refreshToken,
    }).toString(),
  });

  if (!response.ok) return null;

  const tokenResponse = await response.json();
  const refreshed = buildSession({
    ...tokenResponse,
    refresh_token: session.refreshToken,
  });
  refreshed.authenticatedAt = session.authenticatedAt;
  saveSession(refreshed);
  return refreshed;
}

export async function getValidSession() {
  const session = getStoredSession();
  if (!session) return null;
  if (!isTokenExpired(session)) return session;
  return refreshSession(session);
}

export function saveSession(session) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession() {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(SESSION_KEY);
  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  window.sessionStorage.removeItem(STATE_KEY);
}

export function getUserRole(session) {
  const groups = (session?.groups || []).map((group) => String(group).toLowerCase());
  if (groups.includes("admin")) return "admin";
  if (groups.includes("pi")) return "pi";
  if (groups.includes("coordinator")) return "coordinator";
  if (groups.includes("patient")) return "patient";
  return "user";
}

export async function beginLogin() {
  const config = getCognitoConfig();
  if (!config.isConfigured) {
    throw new Error("Missing Cognito configuration.");
  }

  const verifier = randomString(96);
  const state = randomString(48);
  const challenge = base64UrlEncode(await sha256(verifier));

  window.sessionStorage.setItem(PKCE_VERIFIER_KEY, verifier);
  window.sessionStorage.setItem(STATE_KEY, state);

  const authorizeUrl = new URL(`${config.domain}/oauth2/authorize`);
  authorizeUrl.searchParams.set("client_id", config.clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("scope", config.scopes);
  authorizeUrl.searchParams.set("redirect_uri", config.redirectUri);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("code_challenge", challenge);
  authorizeUrl.searchParams.set("state", state);

  window.location.assign(authorizeUrl.toString());
}

export async function completeLoginFromUrl(currentUrl) {
  const config = getCognitoConfig();
  const url = new URL(currentUrl);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const verifier = window.sessionStorage.getItem(PKCE_VERIFIER_KEY);
  const expectedState = window.sessionStorage.getItem(STATE_KEY);

  if (!code) return null;
  if (!config.isConfigured) throw new Error("Missing Cognito configuration.");
  if (!verifier || !expectedState || expectedState !== state) {
    return null;
  }

  // Remove verifier immediately so concurrent StrictMode calls bail out above
  window.sessionStorage.removeItem(PKCE_VERIFIER_KEY);
  window.sessionStorage.removeItem(STATE_KEY);

  const response = await fetch(`${config.domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      code,
      code_verifier: verifier,
      redirect_uri: config.redirectUri,
    }).toString(),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(`Token exchange failed: ${body.error} — ${body.error_description ?? response.status}`);
  }

  const tokenResponse = await response.json();
  const session = buildSession(tokenResponse);
  saveSession(session);
  window.history.replaceState({}, document.title, url.pathname);
  return session;
}

export function logout() {
  const config = getCognitoConfig();
  clearSession();

  if (!config.domain || !config.clientId || !config.logoutUri) {
    window.location.assign("/login");
    return;
  }

  const logoutUrl = new URL(`${config.domain}/logout`);
  logoutUrl.searchParams.set("client_id", config.clientId);
  logoutUrl.searchParams.set("logout_uri", config.logoutUri);
  window.location.assign(logoutUrl.toString());
}
