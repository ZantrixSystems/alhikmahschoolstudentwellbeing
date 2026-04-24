import { neonQuery, neonQueryOne } from "./db.js";
import { AppError } from "./filters.js";

const encoder = new TextEncoder();

function parseCookies(request) {
  const cookieHeader = request.headers.get("cookie") ?? "";
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf("=");
        return [part.slice(0, separatorIndex), decodeURIComponent(part.slice(separatorIndex + 1))];
      }),
  );
}

async function hmacHex(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function readAppsScriptEmail(request, env) {
  const apiToken = env.APPS_SCRIPT_API_TOKEN;
  const signingSecret = env.APPS_SCRIPT_SIGNING_SECRET;
  if (!apiToken || !signingSecret) return null;

  const providedToken = request.headers.get("x-api-token");
  const timestamp = request.headers.get("x-request-timestamp");
  const signature = request.headers.get("x-request-signature");
  const email = (request.headers.get("x-app-user-email") ?? "").trim().toLowerCase();
  if (!providedToken || !timestamp || !signature || !email) return null;
  if (providedToken !== apiToken) return null;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return null;
  if (Math.abs(Date.now() - timestampNumber) > 5 * 60 * 1000) return null;

  const url = new URL(request.url);
  const bodyText = request.method === "GET" || request.method === "HEAD"
    ? ""
    : await request.clone().text();
  const message = [
    String(timestamp),
    request.method.toUpperCase(),
    url.pathname,
    bodyText || "",
  ].join("\n");
  const expected = await hmacHex(signingSecret, message);

  return expected === signature ? email : null;
}

async function readSessionEmail(request, env) {
  const cookies = parseCookies(request);
  const raw = cookies.wellbeing_session;
  if (!raw || !env.SESSION_SECRET) return null;

  const [payload, signature] = raw.split(".");
  if (!payload || !signature) return null;

  const expected = await hmacHex(env.SESSION_SECRET, payload);
  if (expected !== signature) return null;

  try {
    const session = JSON.parse(atob(payload));
    return session.email ?? null;
  } catch {
    return null;
  }
}

export async function createSessionCookie(email, env) {
  if (!env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is not configured.");
  }

  const payload = btoa(
    JSON.stringify({
      email,
      issuedAt: new Date().toISOString(),
    }),
  );
  const signature = await hmacHex(env.SESSION_SECRET, payload);
  const value = `${payload}.${signature}`;
  return `wellbeing_session=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=604800`;
}

export function clearSessionCookie() {
  return "wellbeing_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export async function loadAuthContext(request, env) {
  const email =
    (await readAppsScriptEmail(request, env)) ||
    (await readSessionEmail(request, env)) ||
    env.BOOTSTRAP_EMAIL ||
    null;

  if (!email) {
    throw new AppError("Authentication is not configured yet.", 401);
  }

  const row = await neonQueryOne(
    env,
    [
      "SELECT",
      "  u.id,",
      "  u.email,",
      "  u.display_name,",
      "  u.primary_team_id,",
      "  u.is_active,",
      "  COALESCE(",
      "    ARRAY_AGG(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL),",
      "    ARRAY[]::text[]",
      "  ) AS role_keys,",
      "  COALESCE(",
      "    ARRAY_AGG(DISTINCT ut.team_id) FILTER (WHERE ut.team_id IS NOT NULL),",
      "    ARRAY[]::uuid[]",
      "  ) AS team_ids",
      "FROM users u",
      "LEFT JOIN user_roles ur ON ur.user_id = u.id",
      "LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL",
      "LEFT JOIN user_teams ut ON ut.user_id = u.id",
      "WHERE LOWER(u.email) = LOWER($1)",
      "  AND u.deleted_at IS NULL",
      "GROUP BY u.id",
    ].join("\n"),
    [email],
  );

  if (!row || !row.is_active) {
    throw new AppError("User is not authorised for this app", 403);
  }

  const roleKeys = row.role_keys ?? [];
  const teamIds = [];
  if (row.primary_team_id) teamIds.push(row.primary_team_id);
  for (const teamId of row.team_ids ?? []) {
    if (teamId && !teamIds.includes(teamId)) teamIds.push(teamId);
  }

  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    roleKeys,
    teamIds,
    isAdmin: roleKeys.includes("admin"),
  };
}

export async function getEffectivePermissionKeys(env, auth) {
  if (auth.isAdmin) return ["*"];

  const rows = await neonQuery(
    env,
    [
      "SELECT DISTINCT p.permission_key",
      "FROM user_roles ur",
      "JOIN role_permissions rp ON rp.role_id = ur.role_id",
      "JOIN permissions p ON p.id = rp.permission_id",
      "WHERE ur.user_id = $1",
      "ORDER BY p.permission_key",
    ].join("\n"),
    [auth.userId],
  );

  return rows.map((row) => row.permission_key);
}

export async function assertPermission(env, auth, permissionKey) {
  if (auth.isAdmin) return;
  const row = await neonQueryOne(
    env,
    [
      "SELECT 1",
      "FROM user_roles ur",
      "JOIN role_permissions rp ON rp.role_id = ur.role_id",
      "JOIN permissions p ON p.id = rp.permission_id",
      "WHERE ur.user_id = $1",
      "  AND p.permission_key = $2",
      "LIMIT 1",
    ].join("\n"),
    [auth.userId, permissionKey],
  );

  if (!row) {
    throw new AppError(`Missing permission: ${permissionKey}`, 403);
  }
}

export async function getAppSettings(env, keys) {
  const rows = await neonQuery(
    env,
    "SELECT key, value FROM app_settings WHERE key = ANY($1::text[])",
    [keys],
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

export async function assertDomainAllowed(env, email) {
  const settings = await getAppSettings(env, ["auth.allowedDomains", "auth.enforceDomainRestriction"]);
  if (settings["auth.enforceDomainRestriction"] !== true) return;

  const allowedDomains = settings["auth.allowedDomains"] ?? [];
  const domain = String(email ?? "").split("@")[1] ?? "";
  if (!allowedDomains.includes(domain)) {
    throw new AppError("Domain is not allowed for this app", 403);
  }
}
