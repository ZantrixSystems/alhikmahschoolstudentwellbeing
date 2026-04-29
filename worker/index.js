const APP_HTML = '__APP_HTML_PLACEHOLDER__';

const VISIBILITY_LEVELS = ['none', 'indicator', 'summary', 'full'];
const FILTER_OPERATORS = ['=isnull=', '=in=', '=out=', '~=', '==', '!=', '>=', '<=', '>', '<'];
const VALID_REFERRAL_TYPES = ['none', 'mash', 'lado', 'police', 'early_help', 'camhs', 'social_care', 'other'];
const VALID_SEND_CATEGORIES = ['none', 'sen_support', 'ehcp', 'assessed_no_need'];
const VALID_SEND_PLAN_TYPES = ['sen_support', 'ehcp', 'early_help'];
const VALID_SEND_PLAN_STATUSES = ['active', 'under_review', 'closed'];
const MANAGED_REFERENCE_FIELDS = {
  concerns: ['incident_type', 'action_taken'],
};

// JWKS cache: module-level, survives across requests within a Worker isolate.
// Google rotates keys infrequently; 6-hour TTL is safe.
const JWKS_CACHE = { keys: null, expiresAt: 0 };
const JWKS_TTL_MS = 6 * 60 * 60 * 1000;

// Rate limiter: sliding-window per IP, max 120 requests per 60 seconds.
// Module-level Map survives across requests within the same isolate.
// Cloudflare Worker isolates are per-PoP so this is best-effort, not global.
const RATE_LIMIT_MAP = new Map();
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (RATE_LIMIT_MAP.get(ip) || []).filter(t => t > windowStart);
  if (timestamps.length >= RATE_LIMIT_MAX) return false;
  timestamps.push(now);
  RATE_LIMIT_MAP.set(ip, timestamps);
  // Evict stale entries periodically to prevent unbounded growth
  if (RATE_LIMIT_MAP.size > 5000) {
    for (const [key, ts] of RATE_LIMIT_MAP) {
      if (!ts.some(t => t > windowStart)) RATE_LIMIT_MAP.delete(key);
    }
  }
  return true;
}

class AppError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // CORS preflight
    if (request.method === 'OPTIONS') return corsResponse(env, origin);

    // Health check (unauthenticated, no rate limit)
    if (request.method === 'GET' && url.pathname === '/health') {
      return addCors(env, origin, json({ ok: true, service: 'al-hikmah-wellbeing-worker' }));
    }

    // Rate limiting on all non-health requests
    const clientIp = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    if (!checkRateLimit(clientIp)) {
      return addCors(env, origin, json({ ok: false, error: { message: 'Too many requests' } }, 429));
    }

    // Serve the SPA for browser deep links. Asset-like paths should still 404.
    if (isSpaNavigationRequest(request, url)) {
      return spaResponse(env, origin);
    }

    // API routes
    if (url.pathname.startsWith('/api/')) {
      let email = null;
      try {
        email = await verifyGoogleIdToken(request, env);
        const api = createApi(env, email);
        // Load auth context once here so dispatch receives it — prevents per-handler repetition
        const auth = await api.loadAuthContext();
        const requestQuery = Object.fromEntries(url.searchParams);
        let payload = {};
        if (['POST', 'PUT', 'PATCH'].includes(request.method)) {
          const text = await request.text();
          try {
            payload = text ? JSON.parse(text) : {};
          } catch {
            throw new AppError('Invalid JSON request body', 400);
          }
        }
        const data = await api.dispatch({ path: url.pathname, method: request.method.toLowerCase(), query: requestQuery, payload }, auth);
        return addCors(env, origin, json({ ok: true, data }));
      } catch (error) {
        const status = error.statusCode || 500;
        // Log failed auth attempts (401/403) to a lightweight audit record when possible
        if ((status === 401 || status === 403) && email !== null) {
          try {
            const api = createApi(env, email);
            await api.writeFailedAuthAudit(email, url.pathname, error.message);
          } catch { /* best-effort */ }
        }
        return addCors(env, origin, json({ ok: false, error: { message: status >= 500 ? 'Server error' : error.message, details: error.details || null } }, status));
      }
    }

    return addCors(env, origin, json({ ok: false, error: { message: 'Not found' } }, 404));
  },
};

function getAllowedOrigins(env) {
  // ALLOWED_ORIGINS env var: comma-separated list of allowed origins.
  // Falls back to the deployed Worker's own URL pattern if not set.
  const raw = (env && env.ALLOWED_ORIGINS) ? env.ALLOWED_ORIGINS : '';
  const explicit = raw.split(',').map(s => s.trim()).filter(Boolean);
  // Always allow the localhost dev origin so wrangler dev works without config
  return explicit.length ? explicit : ['http://localhost:8787', 'http://127.0.0.1:8787'];
}

function resolveOrigin(env, requestOrigin) {
  if (!requestOrigin) return 'null';
  const allowed = getAllowedOrigins(env);
  return allowed.includes(requestOrigin) ? requestOrigin : 'null';
}

function corsHeaders(env, requestOrigin) {
  return {
    'Access-Control-Allow-Origin': resolveOrigin(env, requestOrigin),
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function corsResponse(env, requestOrigin) {
  return new Response(null, { status: 204, headers: corsHeaders(env, requestOrigin) });
}

function addCors(env, requestOrigin, response) {
  const r = new Response(response.body, response);
  Object.entries(corsHeaders(env, requestOrigin)).forEach(([k, v]) => r.headers.set(k, v));
  return r;
}

function isSpaNavigationRequest(request, url) {
  if (request.method !== 'GET') return false;
  if (url.pathname === '/health' || url.pathname.startsWith('/api/')) return false;
  const lastSegment = url.pathname.split('/').pop() || '';
  return !lastSegment.includes('.');
}

function spaResponse(env, requestOrigin) {
  const html = APP_HTML.replaceAll('__GOOGLE_CLIENT_ID__', env.GOOGLE_CLIENT_ID || '');
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', ...corsHeaders(env, requestOrigin) },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function verifyGoogleIdToken(request, env) {
  if (env.__verifyGoogleIdToken) return env.__verifyGoogleIdToken(request, env);
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) throw new AppError('Missing Authorization header', 401);
  const token = authHeader.slice(7);

  // Decode JWT header+payload (no library needed — Workers has WebCrypto)
  const parts = token.split('.');
  if (parts.length !== 3) throw new AppError('Invalid token format', 401);

  let payload;
  try {
    payload = JSON.parse(decodeBase64Url(parts[1]));
  } catch (error) {
    throw new AppError('Invalid token payload', 401);
  }

  // Verify expiry
  if (!payload.exp || Date.now() / 1000 > payload.exp) throw new AppError('Token expired', 401);

  // Verify issuer
  if (payload.iss !== 'accounts.google.com' && payload.iss !== 'https://accounts.google.com') {
    throw new AppError('Invalid token issuer', 401);
  }

  // Verify audience matches our Google Client ID
  const clientId = env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new AppError('GOOGLE_CLIENT_ID not configured', 500);
  if (payload.aud !== clientId) throw new AppError('Token audience mismatch', 401);

  // Verify signature using Google's public keys
  await verifyGoogleTokenSignature(token, parts, env);

  const email = (payload.email || '').toLowerCase();
  if (!email) throw new AppError('Token has no email claim', 401);
  return email;
}

async function verifyGoogleTokenSignature(token, parts, env) {
  // Use module-level JWKS cache to avoid a Google round-trip on every request.
  let certs;
  if (JWKS_CACHE.keys && Date.now() < JWKS_CACHE.expiresAt) {
    certs = { keys: JWKS_CACHE.keys };
  } else {
    const certsResp = await fetch('https://www.googleapis.com/oauth2/v3/certs');
    if (!certsResp.ok) throw new AppError('Could not fetch Google public keys', 500);
    certs = await certsResp.json();
    JWKS_CACHE.keys = certs.keys;
    JWKS_CACHE.expiresAt = Date.now() + JWKS_TTL_MS;
  }

  let header;
  try {
    header = JSON.parse(decodeBase64Url(parts[0]));
  } catch (error) {
    throw new AppError('Invalid token header', 401);
  }
  const jwk = certs.keys.find(k => k.kid === header.kid);
  if (!jwk) throw new AppError('No matching key found for token', 401);

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const signedData = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  let sigBytes;
  try {
    sigBytes = Uint8Array.from(decodeBase64Url(parts[2]), c => c.charCodeAt(0));
  } catch (error) {
    throw new AppError('Invalid token signature', 401);
  }
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sigBytes, signedData);
  if (!valid) throw new AppError('Token signature invalid', 401);
}

function decodeBase64Url(value) {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return atob(base64);
}

async function workerQuery(env, sql, params = []) {
  if (env.__query) return env.__query(sql, params);
  const databaseUrl = env.DATABASE_URL || env.NEON_DATABASE_URL;
  if (!databaseUrl) throw new AppError('DATABASE_URL is not configured for the Worker', 500);
  const response = await fetch(buildNeonSqlEndpoint(databaseUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Neon-Connection-String': databaseUrl,
      'Neon-Array-Mode': 'true',
    },
    body: JSON.stringify({ query: sql, params }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new AppError('Neon query failed', 500, { status: response.status, body: text.slice(0, 500) });
  }
  const result = text ? JSON.parse(text) : {};
  return mapNeonRows(result);
}

async function workerQueryOne(env, sql, params = []) {
  return (await workerQuery(env, sql, params))[0] || null;
}

function buildNeonSqlEndpoint(connectionString) {
  const match = connectionString.match(/@([^/\?:]+)/);
  if (!match) throw new AppError('Could not parse Neon host from connection string', 500);
  return 'https://' + match[1].replace(/^[^.]+\./, 'api.') + '/sql';
}

function parseNeonValue(value, dataTypeID) {
  if (value === null || value === undefined) return value;
  // Postgres array type IDs are the scalar type ID + 1 in most cases,
  // but the reliable signal is that the value is a string starting with '{'.
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1);
    if (inner === '') return [];
    // Split on commas that are not inside quotes
    const parts = [];
    let current = '';
    let inQuote = false;
    for (let i = 0; i < inner.length; i++) {
      const ch = inner[i];
      if (ch === '"') { inQuote = !inQuote; continue; }
      if (ch === ',' && !inQuote) { parts.push(current); current = ''; continue; }
      current += ch;
    }
    parts.push(current);
    return parts.map((p) => p === 'NULL' ? null : p);
  }
  return value;
}

function mapNeonRows(result) {
  const rows = result.rows || [];
  if (!rows.length || !Array.isArray(rows[0])) return rows;
  const fields = result.fields || [];
  return rows.map((row) => {
    const mapped = {};
    fields.forEach((field, index) => {
      mapped[field.name] = parseNeonValue(row[index], field.dataTypeID);
    });
    return mapped;
  });
}

function createApi(env, actorEmail) {
  async function query(sql, params = []) {
    return workerQuery(env, sql, params);
  }

  async function queryOne(sql, params = []) {
    return (await query(sql, params))[0] || null;
  }

  async function loadAuthContext() {
    if (!actorEmail) throw new AppError('Missing Workspace email', 401);
    await assertDomainAllowed(actorEmail);
    const row = await queryOne(
      [
        'SELECT u.id, u.email, u.display_name, u.is_active,',
        '  COALESCE(ARRAY_AGG(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL), ARRAY[]::text[]) AS role_keys,',
        '  COALESCE(ARRAY_AGG(DISTINCT ut.team_id) FILTER (WHERE ut.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids',
        'FROM users u',
        'LEFT JOIN user_roles ur ON ur.user_id = u.id',
        'LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL',
        'LEFT JOIN user_teams ut ON ut.user_id = u.id',
        'WHERE LOWER(u.email) = LOWER($1) AND u.deleted_at IS NULL',
        'GROUP BY u.id',
      ].join('\n'),
      [actorEmail]
    );
    if (!row) throw new AppError('Your account is not registered for this app. Please contact your administrator.', 403);
    if (!row.is_active) throw new AppError('Your account has been deactivated. Please contact your administrator.', 403);
    const roleKeys = row.role_keys || [];
    if (!roleKeys.includes('admin') && roleKeys.length === 0) {
      throw new AppError('Your account exists but has not been assigned a role yet. Please contact your administrator.', 403);
    }
    const teamIds = compactUnique(row.team_ids || []);
    return {
      userId: row.id,
      email: row.email,
      displayName: row.display_name,
      roleKeys: row.role_keys || [],
      teamIds,
      isAdmin: (row.role_keys || []).includes('admin'),
    };
  }

  async function assertDomainAllowed(email) {
    const settings = await getAppSettings(['auth.allowedDomains', 'auth.enforceDomainRestriction']);
    if (settings['auth.enforceDomainRestriction'] !== true) return;
    const domain = String(email).split('@')[1] || '';
    if (!(settings['auth.allowedDomains'] || []).includes(domain)) {
      throw new AppError('Domain is not allowed for this app', 403);
    }
  }

  async function getAppSettings(keys) {
    const rows = await query('SELECT key, value FROM app_settings WHERE key = ANY($1::text[])', [keys]);
    return Object.fromEntries(rows.map((row) => [row.key, row.value]));
  }

  async function getReferenceOptions(areaKey = null, fieldKey = null, activeOnly = true) {
    const clauses = ['deleted_at IS NULL'];
    const params = [];
    if (areaKey) clauses.push('area_key = ' + pushParam(params, areaKey));
    if (fieldKey) clauses.push('field_key = ' + pushParam(params, fieldKey));
    if (activeOnly) clauses.push('is_active = TRUE');
    return query(
      [
        'SELECT id, area_key, field_key, option_key, label, description, team_scope, team_id, sort_order, is_active, is_system',
        'FROM reference_options',
        'WHERE ' + clauses.join(' AND '),
        'ORDER BY area_key, field_key, sort_order, label',
      ].join('\n'),
      params
    );
  }

  async function assertReferenceOption(areaKey, fieldKey, value) {
    if (!value) return null;
    const row = await queryOne(
      [
        'SELECT option_key',
        'FROM reference_options',
        'WHERE area_key = $1 AND field_key = $2 AND option_key = $3',
        '  AND is_active = TRUE AND deleted_at IS NULL',
        'LIMIT 1',
      ].join('\n'),
      [areaKey, fieldKey, value]
    );
    if (!row) throw new AppError('Invalid ' + fieldKey + ': ' + value);
    return value;
  }

  async function getEffectivePermissionKeys(auth) {
    if (auth.isAdmin) return ['*'];
    if (auth._permissionKeys) return auth._permissionKeys;
    const rows = await query(
      [
        'SELECT DISTINCT p.permission_key',
        'FROM user_roles ur',
        'JOIN role_permissions rp ON rp.role_id = ur.role_id',
        'JOIN permissions p ON p.id = rp.permission_id',
        'WHERE ur.user_id = $1',
        'ORDER BY p.permission_key',
      ].join('\n'),
      [auth.userId]
    );
    auth._permissionKeys = rows.map((row) => row.permission_key);
    return auth._permissionKeys;
  }

  async function assertPermission(auth, permissionKey) {
    if (auth.isAdmin) return;
    const keys = await getEffectivePermissionKeys(auth);
    if (!keys.includes(permissionKey)) throw new AppError('Missing permission: ' + permissionKey, 403);
  }

  // Returns true if the user's teams have any visibility relationship with the student.
  // A student is "accessible" if:
  //   (a) admin — always
  //   (b) student has no team associations (unassigned student — visible to all)
  //   (c) user is in one of the student's active concern/radar teams
  //   (d) user's teams have a non-none visibility rule targeting a team that owns
  //       at least one of the student's records
  // This is used to gate CREATE and AUDIT-LOG access — not to replace the existing
  // visibility/redaction model which still controls what fields are shown.
  async function canAccessStudent(auth, studentId) {
    if (auth.isAdmin) return true;
    // Check if any of the student's records belong to the user's teams directly
    const directRows = await query(
      [
        'SELECT 1 FROM (',
        '  SELECT team_id FROM concern_teams ct JOIN concerns c ON c.id = ct.concern_id WHERE c.student_id = $1 AND c.deleted_at IS NULL',
        '  UNION ALL',
        '  SELECT team_id FROM meeting_teams mt JOIN meetings m ON m.id = mt.meeting_id WHERE m.student_id = $1 AND m.deleted_at IS NULL',
        '  UNION ALL',
        '  SELECT team_id FROM note_teams nt JOIN notes n ON n.id = nt.note_id WHERE n.student_id = $1 AND n.deleted_at IS NULL',
        '  UNION ALL',
        '  SELECT team_id FROM action_teams at2 JOIN actions a ON a.id = at2.action_id WHERE a.student_id = $1 AND a.deleted_at IS NULL',
        '  UNION ALL',
        '  SELECT team_id FROM student_team_radar WHERE student_id = $1 AND deleted_at IS NULL',
        ') AS student_teams',
        'WHERE team_id = ANY($2::uuid[])',
        'LIMIT 1',
      ].join('\n'),
      [studentId, auth.teamIds]
    );
    if (directRows.length > 0) return true;
    // Check if student has ANY team associations at all — if none, treat as shared
    const anyTeamRows = await query(
      [
        'SELECT 1 FROM (',
        '  SELECT team_id FROM concern_teams ct JOIN concerns c ON c.id = ct.concern_id WHERE c.student_id = $1 AND c.deleted_at IS NULL',
        '  UNION ALL',
        '  SELECT team_id FROM student_team_radar WHERE student_id = $1 AND deleted_at IS NULL',
        ') AS student_teams LIMIT 1',
      ].join('\n'),
      [studentId]
    );
    if (anyTeamRows.length === 0) return true; // No team associations — open student
    // Check visibility rules: user's teams have a non-none rule toward a team that owns this student
    if (auth.teamIds.length === 0) return false;
    const visibilityRows = await query(
      [
        'SELECT 1 FROM team_visibility_rules tvr',
        'WHERE tvr.deleted_at IS NULL',
        '  AND tvr.source_team_id = ANY($1::uuid[])',
        "  AND tvr.visibility_level <> 'none'",
        '  AND tvr.target_team_id IN (',
        '    SELECT DISTINCT team_id FROM (',
        '      SELECT team_id FROM concern_teams ct JOIN concerns c ON c.id = ct.concern_id WHERE c.student_id = $2 AND c.deleted_at IS NULL',
        '      UNION ALL',
        '      SELECT team_id FROM student_team_radar WHERE student_id = $2 AND deleted_at IS NULL',
        '    ) AS student_teams',
        '  )',
        'LIMIT 1',
      ].join('\n'),
      [auth.teamIds, studentId]
    );
    return visibilityRows.length > 0;
  }

  // Returns true if the user is allowed to edit (not just view) a record.
  // owner_team_id is the team that created the record.
  // creator_user_id is the individual who created the record.
  // Elevated override: admin role OR any role with 'concerns.override' permission (DSL).
  function canEditRecord(auth, ownerTeamId, creatorUserId) {
    if (auth.isAdmin) return true;
    if (creatorUserId && creatorUserId === auth.userId) return true;
    if (ownerTeamId && auth.teamIds.includes(ownerTeamId)) return true;
    return false;
  }

  async function assertCanEditRecord(auth, ownerTeamId, creatorUserId, recordLabel) {
    // Also allow users with the concerns.override permission (DSL-level override)
    if (canEditRecord(auth, ownerTeamId, creatorUserId)) return;
    // Check for override permission
    const overrideRow = await queryOne(
      [
        'SELECT 1 FROM user_roles ur',
        'JOIN role_permissions rp ON rp.role_id = ur.role_id',
        'JOIN permissions p ON p.id = rp.permission_id',
        "WHERE ur.user_id = $1 AND p.permission_key = 'concerns.override'",
        'LIMIT 1',
      ].join('\n'),
      [auth.userId]
    );
    if (overrideRow) return;
    throw new AppError('You do not have permission to edit this ' + (recordLabel || 'record') + ' — it belongs to another team', 403);
  }

  async function writeAuditLog(auth, payload) {
    await query(
      [
        'INSERT INTO audit_logs (actor_user_id, area_key, action_key, entity_type, entity_id, student_id, target_team_id, metadata)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
      ].join('\n'),
      [
        auth?.userId || null,
        payload.areaKey,
        payload.actionKey,
        payload.entityType,
        payload.entityId || null,
        payload.studentId || null,
        payload.targetTeamId || null,
        JSON.stringify(payload.metadata || {}),
      ]
    );
  }

  function pushParam(params, value) {
    params.push(value);
    return '$' + params.length;
  }

  function normaliseTeamIds(teamIds, teamId) {
    if (Array.isArray(teamIds)) return teamIds.filter(Boolean);
    if (teamId) return [teamId];
    return [];
  }

  function normaliseValue(value) {
    if (Array.isArray(value)) return value.map(normaliseValue);
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (value === 'null') return null;
    if (value !== '' && !Number.isNaN(Number(value))) return Number(value);
    return value;
  }

  function tokenizeFilter(input) {
    const tokens = [];
    let index = 0;
    while (index < input.length) {
      if (/\s/.test(input[index])) {
        index += 1;
        continue;
      }
      if (['(', ')', ';', ','].includes(input[index])) {
        tokens.push({ type: input[index], value: input[index] });
        index += 1;
        continue;
      }
      const operator = FILTER_OPERATORS.find((candidate) => input.indexOf(candidate, index) === index);
      if (operator) {
        tokens.push({ type: 'operator', value: operator });
        index += operator.length;
        continue;
      }
      let value = '';
      while (index < input.length) {
        const nextOperator = FILTER_OPERATORS.find((candidate) => input.indexOf(candidate, index) === index);
        if (/\s/.test(input[index]) || ['(', ')', ';', ','].includes(input[index]) || nextOperator) break;
        value += input[index];
        index += 1;
      }
      if (!value) throw new AppError('Invalid filter token near "' + input.slice(index, index + 12) + '"');
      tokens.push({ type: 'literal', value });
    }
    return tokens;
  }

  function parseFilter(input) {
    if (!input) return null;
    const tokens = tokenizeFilter(input);
    let cursor = 0;
    const peek = () => tokens[cursor];
    const consume = (type) => {
      const token = tokens[cursor];
      if (!token || token.type !== type) throw new AppError('Expected ' + type + ' in filter expression');
      cursor += 1;
      return token;
    };
    const parseValue = () => {
      const token = peek();
      if (!token) throw new AppError('Unexpected end of filter expression');
      if (token.type === 'literal') {
        cursor += 1;
        return token.value;
      }
      if (token.type === '(') {
        consume('(');
        const values = [];
        while (peek() && peek().type !== ')') {
          values.push(parseValue());
          if (peek() && peek().type === ',') consume(',');
        }
        consume(')');
        return values;
      }
      throw new AppError('Invalid filter value');
    };
    const parseComparison = () => {
      if (peek() && peek().type === '(') {
        consume('(');
        const nested = parseOr();
        consume(')');
        return nested;
      }
      return { type: 'comparison', field: consume('literal').value, operator: consume('operator').value, value: parseValue() };
    };
    const parseAnd = () => {
      let left = parseComparison();
      while (peek() && peek().type === ';') left = { type: 'and', children: [left, (consume(';'), parseComparison())] };
      return left;
    };
    const parseOr = () => {
      let left = parseAnd();
      while (peek() && peek().type === ',') left = { type: 'or', children: [left, (consume(','), parseAnd())] };
      return left;
    };
    const ast = parseOr();
    if (cursor !== tokens.length) throw new AppError('Unexpected trailing filter content');
    return ast;
  }

  function buildFieldRule(columnSql, options = {}) {
    const allowOperators = options.allowOperators || ['==', '!=', '~=', '>=', '<=', '>', '<', '=in=', '=out=', '=isnull='];
    return (operator, rawValue, params) => {
      if (!allowOperators.includes(operator)) throw new AppError('Operator "' + operator + '" is not supported for this field');
      const value = normaliseValue(rawValue);
      if (operator === '=isnull=') return { sql: columnSql + ' IS ' + (value === true ? '' : 'NOT ') + 'NULL' };
      if (operator === '=in=' || operator === '=out=') {
        const values = Array.isArray(value) ? value : [value];
        if (!values.length) throw new AppError('IN filters require at least one value');
        const placeholders = values.map((entry) => pushParam(params, entry)).join(', ');
        return { sql: columnSql + ' ' + (operator === '=in=' ? 'IN' : 'NOT IN') + ' (' + placeholders + ')' };
      }
      if (operator === '~=') {
        return { sql: 'LOWER(' + columnSql + ') LIKE ' + pushParam(params, '%' + String(value).toLowerCase() + '%') };
      }
      const map = { '==': '=', '!=': '<>', '>=': '>=', '<=': '<=', '>': '>', '<': '<' };
      return { sql: columnSql + ' ' + map[operator] + ' ' + pushParam(params, value) };
    };
  }

  function compileFilter(ast, fieldMap, params) {
    if (!ast) return { sql: 'TRUE' };
    if (ast.type === 'and' || ast.type === 'or') {
      const joiner = ast.type === 'and' ? ' AND ' : ' OR ';
      return { sql: '(' + ast.children.map((child) => compileFilter(child, fieldMap, params).sql).join(joiner) + ')' };
    }
    const rule = fieldMap[ast.field];
    if (!rule) throw new AppError('Field "' + ast.field + '" is not filterable');
    return rule(ast.operator, ast.value, params);
  }

  function studentFieldMap() {
    return {
      name: buildFieldRule("CONCAT_WS(' ', s.first_name, s.preferred_name, s.last_name)", { allowOperators: ['~='] }),
      status: buildFieldRule('s.current_status'),
      yearGroup: buildFieldRule('s.year_group'),
      year: buildFieldRule('s.year_group'),
      class: buildFieldRule('COALESCE(s.tutor_group, s.form_group)'),
      tutorGroup: buildFieldRule('s.tutor_group'),
      lead: buildFieldRule('lead.display_name', { allowOperators: ['~='] }),
      latestActivity: buildFieldRule('latest.latest_activity_at'),
      openFollowUp: (operator, value, params) => {
        if (operator !== '==') throw new AppError('openFollowUp only supports ==');
        return { sql: '(latest.open_follow_up = ' + pushParam(params, normaliseValue(value)) + ')' };
      },
      hasOpenConcern: (operator, value, params) => {
        if (operator !== '==') throw new AppError('hasOpenConcern only supports ==');
        return { sql: '(latest.has_open_concern = ' + pushParam(params, normaliseValue(value)) + ')' };
      },
      radar: radarFilter,
      radarTeam: radarFilter,
    };
  }

  function radarFilter(operator, value, params) {
    if (!['==', '=in='].includes(operator)) throw new AppError('radar only supports == and =in=');
    const values = Array.isArray(value) ? value : [value];
    const placeholders = values.map((entry) => pushParam(params, entry)).join(', ');
    return {
      sql: [
        'EXISTS (SELECT 1 FROM student_team_radar str2',
        'JOIN teams t2 ON t2.id = str2.team_id',
        'WHERE str2.student_id = s.id AND str2.deleted_at IS NULL',
        "AND str2.status IN ('active', 'monitoring')",
        'AND t2.team_key IN (' + placeholders + '))',
      ].join(' '),
    };
  }

  function meetingFieldMap() {
    return {
      assignedTo: buildFieldRule('m.assigned_user_id'),
      type: buildFieldRule('m.item_type'),
      interactionType: buildFieldRule('m.interaction_type'),
      createdAt: buildFieldRule('m.created_at'),
      occurredAt: buildFieldRule('m.calendar_at'),
      meetingDate: buildFieldRule('m.calendar_at'),
      dueDate: buildFieldRule('m.calendar_at'),
      status: buildFieldRule('m.item_status'),
    };
  }

  async function getVisibilityMatrix(teamIds) {
    if (!teamIds.length) return [];
    return query(
      [
        'SELECT source_team_id, target_team_id, content_type, visibility_level',
        'FROM team_visibility_rules',
        'WHERE deleted_at IS NULL AND source_team_id = ANY($1::uuid[])',
      ].join('\n'),
      [teamIds]
    );
  }

  function maxVisibility(left, right) {
    return VISIBILITY_LEVELS[Math.max(VISIBILITY_LEVELS.indexOf(left), VISIBILITY_LEVELS.indexOf(right))];
  }

  function computeVisibility(auth, matrix, ownerTeamIds, contentType, recordVisibilityLevel) {
    // ownerTeamIds may be a single id (string/null) or an array — normalise to array
    const teamIds = Array.isArray(ownerTeamIds)
      ? ownerTeamIds.filter(Boolean)
      : ownerTeamIds ? [ownerTeamIds] : [];
    if (auth.isAdmin || !teamIds.length) return 'full';
    // If the viewer belongs to any owning team, they get full access
    if (teamIds.some((id) => auth.teamIds.includes(id))) return 'full';
    const recordLevel = normaliseVisibilityLevel(recordVisibilityLevel);
    // Best grant across all owning teams
    const granted = teamIds.reduce((best, ownerTeamId) => {
      const teamGrant = matrix
        .filter((rule) => rule.target_team_id === ownerTeamId && rule.content_type === contentType)
        .reduce((highest, rule) => maxVisibility(highest, rule.visibility_level), 'none');
      return maxVisibility(best, teamGrant);
    }, 'none');
    return VISIBILITY_LEVELS[Math.min(
      VISIBILITY_LEVELS.indexOf(granted),
      VISIBILITY_LEVELS.indexOf(recordLevel)
    )];
  }

  function normaliseVisibilityLevel(level) {
    if (VISIBILITY_LEVELS.includes(level)) return level;
    if (level === 'restricted' || level === 'safeguarding') return 'summary';
    return 'full';
  }

  function redactRecord(record, visibility) {
    if (visibility === 'full') return { ...record, visibility };
    if (visibility === 'summary') {
      const redacted = { ...record, visibility };
      // Operational detail fields — strip at summary level
      delete redacted.detail;
      delete redacted.body;
      // Referral specifics are full-visibility-only; show only type at summary
      delete redacted.referral_outcome;
      delete redacted.referral_date;
      delete redacted.outcome_summary;
      delete redacted.closed_by_name;
      delete redacted.external_contact_name;
      delete redacted.external_ref;
      return redacted;
    }
    if (visibility === 'indicator') {
      return {
        id: record.id,
        student_id: record.student_id,
        first_name: record.first_name,
        last_name: record.last_name,
        item_type: record.item_type,
        item_status: record.item_status,
        interaction_type: record.interaction_type,
        calendar_at: record.calendar_at,
        due_at: record.due_at,
        completed_at: record.completed_at,
        assigned_user_id: record.assigned_user_id,
        assigned_user_name: record.assigned_user_name,
        title: record.title,
        summary: record.summary || 'Protected event',
        occurred_at: record.occurred_at,
        created_at: record.created_at,
        team_ids: record.team_ids || [],
        team_name: record.team_name,
        visibility,
        redacted: true,
      };
    }
    return null;
  }

  function applyVisibility(auth, matrix, records, contentType, visibilityField) {
    return (records || [])
      .map((record) => redactRecord(record, computeVisibility(auth, matrix, record.team_ids || record.team_id, contentType, record[visibilityField] || 'full')))
      .filter(Boolean);
  }

  function applyCalendarVisibility(auth, matrix, records) {
    return (records || [])
      .map((record) => {
        const contentType = record.item_type === 'follow_up' ? 'actions' : 'meetings';
        return redactRecord(record, computeVisibility(auth, matrix, record.team_ids || record.team_id, contentType, record.visibility_level || 'summary'));
      })
      .filter(Boolean);
  }

  async function getBootstrapPayload(auth) {
    await assertPermission(auth, 'dashboard.view');
    const [teams, savedFilters, settings, permissionKeys, referenceOptions] = await Promise.all([
      query('SELECT id, team_key, name, accent_color FROM teams WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY name'),
      query(
        [
          'SELECT id, area_key, name, filter_expression, is_shared',
          'FROM saved_filters',
          'WHERE deleted_at IS NULL AND (owner_user_id = $1 OR is_shared = TRUE)',
          'ORDER BY area_key, name',
        ].join('\n'),
        [auth.userId]
      ),
      getAppSettings(['app.name', 'app.mode', 'auth.allowedDomains', 'auth.enforceDomainRestriction']),
      getEffectivePermissionKeys(auth),
      getReferenceOptions(null, null, true),
    ]);
    return {
      currentUser: { ...auth, permissionKeys },
      teams,
      savedFilters,
      settings,
      referenceOptions,
      navigation: [
        { key: 'dashboard', label: 'Dashboard' },
        { key: 'students', label: 'Students' },
        { key: 'meetings', label: 'Calendar' },
        { key: 'settings', label: 'Settings' },
      ],
    };
  }

  async function getDashboardPayload(auth) {
    await assertPermission(auth, 'dashboard.view');
    const permissionKeys = await getEffectivePermissionKeys(auth);
    const canReviewConcerns = auth.isAdmin || permissionKeys.includes('concerns.review');
    const canViewMeetings = auth.isAdmin || permissionKeys.includes('meetings.view');

    const upcomingFollowUpsQuery = canViewMeetings
      ? query(
          [
            "SELECT 'follow_up' AS item_type, a.id, a.student_id, s.first_name, s.last_name,",
            "  a.title, a.summary, 'follow_up' AS interaction_type, COALESCE(a.visibility_level, 'summary') AS visibility_level,",
            '  COALESCE(a.due_at, a.created_at) AS calendar_at, COALESCE(a.due_at, a.created_at) AS occurred_at,',
            "  a.status AS item_status, a.due_at, a.priority,",
            "  COALESCE(STRING_AGG(DISTINCT t.name, ', ') FILTER (WHERE t.name IS NOT NULL), NULL) AS team_name,",
            '  u.display_name AS assigned_user_name',
            'FROM actions a',
            'JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL',
            'LEFT JOIN action_teams at2 ON at2.action_id = a.id',
            'LEFT JOIN teams t ON t.id = at2.team_id',
            'LEFT JOIN users u ON u.id = a.owner_user_id',
            "WHERE a.deleted_at IS NULL AND a.owner_user_id = $1 AND a.status IN ('open', 'in_progress')",
            'GROUP BY a.id, s.id, u.display_name',
            'ORDER BY COALESCE(a.due_at, a.created_at) ASC LIMIT 6',
          ].join('\n'),
          [auth.userId]
        )
      : Promise.resolve([]);

    const safeguardingConcernsQuery = canReviewConcerns
      ? query(
          [
            'SELECT c.id, c.student_id, s.first_name, s.last_name, s.student_code, s.year_group,',
            '  c.title, c.status, c.severity, c.urgency, c.category, c.referral_type,',
            '  c.created_at, c.updated_at, c.occurred_at,',
            "  STRING_AGG(DISTINCT t.name, ', ') AS team_name, u.display_name AS submitted_by_name",
            'FROM concerns c',
            'JOIN students s ON s.id = c.student_id AND s.deleted_at IS NULL',
            'JOIN concern_teams ct ON ct.concern_id = c.id',
            'JOIN teams t ON t.id = ct.team_id',
            'LEFT JOIN users u ON u.id = c.submitted_by_user_id',
            "WHERE c.deleted_at IS NULL AND t.team_key = 'safeguarding'",
            "  AND c.status IN ('open', 'triage', 'escalated')",
            'GROUP BY c.id, s.id, u.display_name',
            "ORDER BY CASE c.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,",
            '  c.updated_at DESC',
            'LIMIT 30',
          ].join('\n')
        )
      : Promise.resolve([]);

    const [headline, teamLoad, upcomingFollowUps, openSafeguardingConcerns] = await Promise.all([
      queryOne(
        [
          'SELECT',
          '  (SELECT COUNT(*) FROM students WHERE deleted_at IS NULL)::int AS student_count,',
          "  (SELECT COUNT(*) FROM concerns WHERE deleted_at IS NULL AND status IN ('open', 'triage', 'escalated'))::int AS open_concern_count,",
          "  (SELECT COUNT(*) FROM student_team_radar WHERE deleted_at IS NULL AND status IN ('active', 'monitoring'))::int AS active_radar_count,",
          "  (SELECT COUNT(*) FROM actions WHERE deleted_at IS NULL AND status IN ('open', 'in_progress'))::int AS open_action_count",
        ].join('\n')
      ),
      query(
        [
          'SELECT t.id, t.name, t.team_key, t.accent_color, COUNT(DISTINCT c.student_id)::int AS active_students',
          'FROM teams t',
          "LEFT JOIN concern_teams ct ON ct.team_id = t.id",
          "LEFT JOIN concerns c ON c.id = ct.concern_id AND c.deleted_at IS NULL AND c.status IN ('open','triage','escalated')",
          'WHERE t.deleted_at IS NULL',
          'GROUP BY t.id',
          'ORDER BY t.name',
        ].join('\n')
      ),
      upcomingFollowUpsQuery,
      safeguardingConcernsQuery,
    ]);

    // Audit: sensitive read — safeguarding concern list was accessed
    if (canReviewConcerns) {
      await writeAuditLog(auth, { areaKey: 'dashboard', actionKey: 'safeguarding.view', entityType: 'dashboard', metadata: { sensitiveRead: true, concernCount: openSafeguardingConcerns.length } });
    }
    return { headline, teamLoad, upcomingFollowUps, openSafeguardingConcerns };
  }

  async function getStudentsPayload(auth, requestQuery) {
    await assertPermission(auth, 'students.view');
    const params = [];
    const filterExpression = requestQuery.filter || '';
    const filterSql = compileFilter(parseFilter(filterExpression), studentFieldMap(), params).sql;
    let searchSql = 'TRUE';
    const search = requestQuery.q ? String(requestQuery.q).trim().toLowerCase() : '';
    if (search) {
      const placeholder = pushParam(params, '%' + search + '%');
      searchSql = '(LOWER(s.first_name) LIKE ' + placeholder + ' OR LOWER(s.last_name) LIKE ' + placeholder + ' OR LOWER(s.student_code) LIKE ' + placeholder + ')';
    }
    const students = await query(
      [
        'SELECT s.id, s.student_code, s.first_name, s.last_name, s.preferred_name, s.date_of_birth,',
        "  CASE WHEN s.date_of_birth IS NOT NULL THEN 'Year ' || (",
        '    (EXTRACT(YEAR FROM NOW())::int - CASE WHEN EXTRACT(MONTH FROM NOW())::int < 9 THEN 1 ELSE 0 END)',
        '    - (EXTRACT(YEAR FROM s.date_of_birth)::int + CASE WHEN EXTRACT(MONTH FROM s.date_of_birth)::int >= 9 THEN 5 ELSE 4 END)',
        "  )::text ELSE s.year_group END AS year_group,",
        '  COALESCE(s.tutor_group, s.form_group) AS tutor_group, s.current_status,',
        '  latest.latest_activity_at, latest.open_follow_up, latest.has_open_concern, MIN(lead.display_name) AS lead_name,',
        '  COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(',
        "    'teamName', t.name, 'teamKey', t.team_key, 'status', str.status, 'severity', str.severity, 'addedAt', str.added_at",
        "  )) FILTER (WHERE str.id IS NOT NULL), '[]'::json) AS radar",
        'FROM students s',
        'LEFT JOIN student_team_radar str ON str.student_id = s.id AND str.deleted_at IS NULL AND str.status IN (\'active\', \'monitoring\', \'paused\')',
        'LEFT JOIN teams t ON t.id = str.team_id',
        'LEFT JOIN users lead ON lead.id = str.assigned_lead_user_id',
        'LEFT JOIN LATERAL (',
        '  SELECT',
        '    GREATEST(',
        "      COALESCE((SELECT MAX(occurred_at) FROM meetings WHERE student_id = s.id AND deleted_at IS NULL), '1970-01-01'::timestamptz),",
        "      COALESCE((SELECT MAX(created_at) FROM concerns WHERE student_id = s.id AND deleted_at IS NULL), '1970-01-01'::timestamptz),",
        "      COALESCE((SELECT MAX(created_at) FROM actions WHERE student_id = s.id AND deleted_at IS NULL), '1970-01-01'::timestamptz),",
        "      COALESCE((SELECT MAX(created_at) FROM notes WHERE student_id = s.id AND deleted_at IS NULL), '1970-01-01'::timestamptz)",
        '    ) AS latest_activity_at,',
        "    EXISTS (SELECT 1 FROM actions WHERE student_id = s.id AND deleted_at IS NULL AND status IN ('open', 'in_progress')) AS open_follow_up,",
        "    EXISTS (SELECT 1 FROM concerns WHERE student_id = s.id AND deleted_at IS NULL AND status IN ('open', 'triage', 'escalated')) AS has_open_concern",
        '  ) latest ON TRUE',
        'WHERE s.deleted_at IS NULL AND ' + filterSql + ' AND ' + searchSql,
        'GROUP BY s.id, s.date_of_birth, latest.latest_activity_at, latest.open_follow_up, latest.has_open_concern',
        'ORDER BY s.last_name, s.first_name',
        'LIMIT 100',
      ].join('\n'),
      params
    );
    await writeAuditLog(auth, { areaKey: 'students', actionKey: 'list.view', entityType: 'student_list', metadata: { filter: filterExpression, search: search || null, count: students.length } });
    return { students, filter: filterExpression };
  }

  async function getStudentProfilePayload(auth, studentId) {
    await assertPermission(auth, 'students.view');
    const permissionKeys = await getEffectivePermissionKeys(auth);
    const student = await queryOne(
      [
        'SELECT s.*,',
        "  CASE WHEN s.date_of_birth IS NOT NULL THEN 'Year ' || (",
        '    (EXTRACT(YEAR FROM NOW())::int - CASE WHEN EXTRACT(MONTH FROM NOW())::int < 9 THEN 1 ELSE 0 END)',
        '    - (EXTRACT(YEAR FROM s.date_of_birth)::int + CASE WHEN EXTRACT(MONTH FROM s.date_of_birth)::int >= 9 THEN 5 ELSE 4 END)',
        "  )::text ELSE s.year_group END AS year_group,",
        '  COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(',
        "  'id', f.id, 'flagKey', f.flag_key, 'label', f.label, 'severity', f.severity, 'visibilityLevel', f.visibility_level",
        " )) FILTER (WHERE f.id IS NOT NULL AND f.deleted_at IS NULL AND f.is_active = TRUE), '[]'::json) AS flags",
        'FROM students s',
        'LEFT JOIN student_flags f ON f.student_id = s.id',
        'WHERE s.id = $1 AND s.deleted_at IS NULL',
        'GROUP BY s.id',
      ].join('\n'),
      [studentId]
    );
    if (!student) throw new AppError('Student not found', 404);
    const matrix = await getVisibilityMatrix(auth.teamIds);
    const canReviewConcerns = auth.isAdmin || permissionKeys.includes('concerns.review');
    const canViewMeetings = auth.isAdmin || permissionKeys.includes('meetings.view');
    const canManageActions = auth.isAdmin || permissionKeys.includes('actions.manage');
    const canViewChronology = auth.isAdmin || permissionKeys.includes('chronology.view');
    const canViewNotes = auth.isAdmin || permissionKeys.includes('notes.view');

    const radarRaw = await query(
      [
        'SELECT str.id, str.team_id, t.name AS team_name, t.team_key, str.status, str.category,',
        '  str.reason_summary AS summary, str.detail_note AS detail, str.severity, str.visibility_level,',
        '  str.added_at AS occurred_at, str.offboarded_at, u.display_name AS assigned_lead_name',
        'FROM student_team_radar str',
        'JOIN teams t ON t.id = str.team_id',
        'LEFT JOIN users u ON u.id = str.assigned_lead_user_id',
        'WHERE str.student_id = $1 AND str.deleted_at IS NULL',
        'ORDER BY str.added_at DESC',
      ].join('\n'),
      [studentId]
    );
    const canManageSend = auth.isAdmin || permissionKeys.includes('send.manage');

    const [concernsRaw, meetingsRaw, actionsRaw, notesRaw, chronologyRaw, activeSendPlan, linkedActions, linkedNotes] = await Promise.all([
      canReviewConcerns ? query(
        [
          'SELECT c.id, c.title, c.summary, c.detail,',
          '  c.status, c.category, c.severity, c.urgency, c.confidentiality_level,',
          '  c.outcome_summary, c.referral_type, c.referral_date, c.referral_outcome,',
          '  c.incident_type, c.action_taken, c.behaviour_plan_active,',
          '  c.closed_at, c.created_at, c.created_at AS occurred_at,',
          '  closed_by.display_name AS closed_by_name,',
          '  COALESCE(ARRAY_AGG(DISTINCT ct.team_id) FILTER (WHERE ct.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
          '  COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), ARRAY[]::text[]) AS team_names,',
          '  COALESCE(ARRAY_AGG(DISTINCT t.team_key) FILTER (WHERE t.team_key IS NOT NULL), ARRAY[]::text[]) AS team_keys',
          'FROM concerns c',
          'LEFT JOIN concern_teams ct ON ct.concern_id = c.id',
          'LEFT JOIN teams t ON t.id = ct.team_id',
          'LEFT JOIN users closed_by ON closed_by.id = c.closed_by_user_id',
          'WHERE c.student_id = $1 AND c.deleted_at IS NULL',
          'GROUP BY c.id, closed_by.display_name',
          'ORDER BY c.created_at DESC',
        ].join('\n'), [studentId]) : [],
      canViewMeetings ? query(
        [
          'SELECT m.id, m.title, m.summary, m.detail,',
          '  m.interaction_type, m.visibility_level, m.occurred_at, m.created_at,',
          '  m.occurred_at AS calendar_at, m.external_agency, m.external_contact_name, m.external_ref,',
          '  u.display_name AS assigned_user_name,',
          '  COALESCE(ARRAY_AGG(DISTINCT mt.team_id) FILTER (WHERE mt.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
          '  COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), ARRAY[]::text[]) AS team_names',
          'FROM meetings m',
          'LEFT JOIN meeting_teams mt ON mt.meeting_id = m.id',
          'LEFT JOIN teams t ON t.id = mt.team_id',
          'LEFT JOIN users u ON u.id = m.logged_by_user_id',
          'WHERE m.student_id = $1 AND m.deleted_at IS NULL',
          'GROUP BY m.id, u.display_name',
          'ORDER BY m.occurred_at DESC',
        ].join('\n'), [studentId]) : [],
      canManageActions ? query(
        [
          'SELECT a.id, a.title, a.summary, a.status, a.priority, a.due_at, a.completed_at, a.created_at,',
          '  COALESCE(a.due_at, a.created_at) AS occurred_at, a.due_at AS calendar_at,',
          "  COALESCE(a.visibility_level, 'summary') AS visibility_level,",
          '  u.display_name AS assigned_user_name,',
          '  COALESCE(ARRAY_AGG(DISTINCT at2.team_id) FILTER (WHERE at2.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
          '  COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), ARRAY[]::text[]) AS team_names',
          'FROM actions a',
          'LEFT JOIN action_teams at2 ON at2.action_id = a.id',
          'LEFT JOIN teams t ON t.id = at2.team_id',
          'LEFT JOIN users u ON u.id = a.owner_user_id',
          'WHERE a.student_id = $1 AND a.deleted_at IS NULL',
          'GROUP BY a.id, u.display_name',
          'ORDER BY COALESCE(a.due_at, a.created_at) DESC',
        ].join('\n'), [studentId]) : [],
      canViewNotes ? query(
        [
          'SELECT n.id, n.summary AS title, n.summary, n.body, n.note_type, n.visibility_level, n.created_at, n.created_at AS occurred_at,',
          '  COALESCE(ARRAY_AGG(DISTINCT nt.team_id) FILTER (WHERE nt.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
          '  COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), ARRAY[]::text[]) AS team_names',
          'FROM notes n',
          'LEFT JOIN note_teams nt ON nt.note_id = n.id',
          'LEFT JOIN teams t ON t.id = nt.team_id',
          'WHERE n.student_id = $1 AND n.deleted_at IS NULL',
          'GROUP BY n.id',
          'ORDER BY n.created_at DESC',
        ].join('\n'), [studentId]) : [],
      canViewChronology ? query(
        [
          'SELECT ce.id, ce.source_table, ce.source_id, ce.team_id, t.name AS team_name,',
          '  ce.title, ce.summary, ce.detail, ce.event_type, ce.visibility_level,',
          '  ce.action_taken, ce.outcome, ce.next_step, ce.next_step_due,',
          '  nso.display_name AS next_step_owner_name,',
          '  ce.occurred_at, ce.created_at',
          'FROM chronology_events ce',
          'LEFT JOIN teams t ON t.id = ce.team_id',
          'LEFT JOIN users nso ON nso.id = ce.next_step_owner_id',
          'WHERE ce.student_id = $1 AND ce.deleted_at IS NULL',
          'ORDER BY ce.occurred_at DESC LIMIT 100',
        ].join('\n'), [studentId]) : [],
      canManageSend ? queryOne(
        [
          'SELECT sp.id, sp.plan_type, sp.plan_ref, sp.ehcp_annual_review_date,',
          '  sp.identified_needs, sp.planned_provision, sp.review_date, sp.review_outcome,',
          '  sp.external_agency, sp.specialist_name, sp.status, sp.created_at, sp.updated_at',
          'FROM send_plans sp',
          "WHERE sp.student_id = $1 AND sp.deleted_at IS NULL AND sp.status IN ('active','under_review')",
          'ORDER BY sp.created_at DESC LIMIT 1',
        ].join('\n'), [studentId]) : null,
      canManageActions ? query(
        [
          'SELECT a.id, a.concern_id, a.title, a.summary, a.status, a.priority, a.due_at, a.created_at,',
          '  COALESCE(ARRAY_AGG(DISTINCT at2.team_id) FILTER (WHERE at2.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
          '  COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), ARRAY[]::text[]) AS team_names',
          'FROM actions a',
          'LEFT JOIN action_teams at2 ON at2.action_id = a.id',
          'LEFT JOIN teams t ON t.id = at2.team_id',
          'WHERE a.student_id = $1 AND a.concern_id IS NOT NULL AND a.deleted_at IS NULL',
          'GROUP BY a.id',
          'ORDER BY a.created_at DESC',
        ].join('\n'), [studentId]) : [],
      canViewNotes ? query(
        [
          'SELECT n.id, n.concern_id, n.summary AS title, n.summary, n.body, n.created_at,',
          '  COALESCE(ARRAY_AGG(DISTINCT nt.team_id) FILTER (WHERE nt.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
          '  COALESCE(ARRAY_AGG(DISTINCT t.name) FILTER (WHERE t.name IS NOT NULL), ARRAY[]::text[]) AS team_names',
          'FROM notes n',
          'LEFT JOIN note_teams nt ON nt.note_id = n.id',
          'LEFT JOIN teams t ON t.id = nt.team_id',
          'WHERE n.student_id = $1 AND n.concern_id IS NOT NULL AND n.deleted_at IS NULL',
          'GROUP BY n.id',
          'ORDER BY n.created_at DESC',
        ].join('\n'), [studentId]) : [],
    ]);
    concernsRaw.forEach(c => { c.linkedFollowUps = linkedActions.filter(a => a.concern_id === c.id); });
    concernsRaw.forEach(c => { c.linkedNotes = linkedNotes.filter(n => n.concern_id === c.id); });

    // Derive radar badges from open concerns (does not replace the radar table query)
    const derivedRadar = {};
    (concernsRaw || [])
      .filter(c => ['open', 'triage', 'escalated'].includes(c.status) && c.team_ids && c.team_ids.length)
      .forEach(c => {
        c.team_ids.forEach((tid, i) => {
          if (!derivedRadar[tid]) {
            derivedRadar[tid] = { team_id: tid, team_name: (c.team_names || [])[i] || null, team_key: (c.team_keys || [])[i] || null, status: 'active', severity: c.severity };
          } else if (['high', 'medium', 'low'].indexOf(c.severity) < ['high', 'medium', 'low'].indexOf(derivedRadar[tid].severity)) {
            derivedRadar[tid].severity = c.severity;
          }
        });
      });

    await writeAuditLog(auth, { areaKey: 'students', actionKey: 'profile.view', entityType: 'student', entityId: studentId, studentId, metadata: { sensitiveRead: true } });
    return {
      profile: student,
      radar: applyVisibility(auth, matrix, radarRaw, 'radar', 'visibility_level'),
      concerns: applyVisibility(auth, matrix, concernsRaw, 'concerns', 'confidentiality_level'),
      meetings: applyVisibility(auth, matrix, meetingsRaw, 'meetings', 'visibility_level'),
      actions: applyVisibility(auth, matrix, actionsRaw, 'actions', 'visibility_level'),
      notes: applyVisibility(auth, matrix, notesRaw, 'chronology', 'visibility_level'),
      chronology: applyVisibility(auth, matrix, chronologyRaw, 'chronology', 'visibility_level'),
      activeSendPlan: activeSendPlan || null,
      derivedRadar: Object.values(derivedRadar),
    };
  }

  // Shared validation for concern create and update: validates referral type, managed reference
  // fields, and derives safeguarding confidentiality from the resolved team list.
  async function resolveConcernFields(body, existingTeamIds = null) {
    const referralType = body.referralType !== undefined ? (body.referralType || null) : null;
    if (referralType && !VALID_REFERRAL_TYPES.includes(referralType)) {
      throw new AppError('Invalid referral_type: ' + referralType);
    }
    const [incidentType, actionTaken] = await Promise.all([
      assertReferenceOption('concerns', 'incident_type', body.incidentType !== undefined ? body.incidentType : null),
      assertReferenceOption('concerns', 'action_taken', body.actionTaken !== undefined ? body.actionTaken : (body.action_taken !== undefined ? body.action_taken : null)),
    ]);

    let teamIds;
    if (body.teamIds !== undefined) {
      teamIds = normaliseTeamIds(body.teamIds, null);
    } else if (body.teamId !== undefined) {
      teamIds = normaliseTeamIds(null, body.teamId);
    } else {
      teamIds = existingTeamIds || [];
    }

    let isSafeguarding = false;
    if (teamIds.length) {
      const teamRows = await query('SELECT team_key FROM teams WHERE id = ANY($1::uuid[])', [teamIds]);
      isSafeguarding = teamRows.some(r => r.team_key === 'safeguarding');
    }
    return { referralType, incidentType, actionTaken, teamIds, isSafeguarding };
  }

  async function createConcern(auth, body) {
    await assertPermission(auth, 'concerns.create');
    if (!body.studentId || !body.title || !body.summary) throw new AppError('studentId, title, and summary are required');
    if (!await canAccessStudent(auth, body.studentId)) throw new AppError('You do not have access to this student', 403);
    const { referralType, incidentType, actionTaken, teamIds, isSafeguarding } = await resolveConcernFields(body);
    const ownerTeamId = teamIds[0] || auth.teamIds[0] || null;
    const requestedConfidentiality = body.confidentialityLevel || 'summary';
    const confidentialityLevel = isSafeguarding ? 'safeguarding' : (requestedConfidentiality === 'safeguarding' ? 'summary' : requestedConfidentiality);
    const derivedCategory = isSafeguarding ? 'safeguarding' : 'wellbeing';
    const concern = await queryOne(
      [
        'INSERT INTO concerns',
        '  (student_id, concern_ref, submitted_by_user_id, owner_team_id, category, severity, urgency,',
        '   confidentiality_level, title, summary, detail, referral_type, referral_date, referral_outcome,',
        '   incident_type, action_taken, action_note, behaviour_plan_active,',
        '   created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $3, $3) RETURNING *',
      ].join('\n'),
      [
        body.studentId, 'CON-' + Date.now(), auth.userId, ownerTeamId,
        derivedCategory, body.severity || 'medium', body.urgency || 'standard', confidentialityLevel,
        body.title, body.summary, body.detail || null,
        referralType, body.referralDate || null, body.referralOutcome || null,
        incidentType, actionTaken, body.actionNote || null, body.behaviourPlanActive === true,
      ]
    );
    if (teamIds.length) {
      await query(
        'INSERT INTO concern_teams (concern_id, team_id) SELECT $1, UNNEST($2::uuid[]) ON CONFLICT DO NOTHING',
        [concern.id, teamIds]
      );
    }
    await addChronology(auth, body.studentId, 'concerns', concern.id, 'concern_logged', teamIds[0] || null, body.title, body.summary, body.detail, 'summary', null, actionTaken, null, null, null);
    await writeAuditLog(auth, { areaKey: 'concerns', actionKey: 'create', entityType: 'concern', entityId: concern.id, studentId: body.studentId, metadata: { severity: body.severity, teamIds } });
    return { concern };
  }

  async function closeConcern(auth, concernId, body) {
    await assertPermission(auth, 'concerns.close');
    if (!body.outcomeSummary || !String(body.outcomeSummary).trim()) {
      throw new AppError('outcomeSummary is required when closing a concern');
    }
    const existing = await queryOne('SELECT * FROM concerns WHERE id = $1 AND deleted_at IS NULL', [concernId]);
    if (!existing) throw new AppError('Concern not found', 404);
    if (existing.status === 'closed') throw new AppError('Concern is already closed', 400);

    // Append to escalation_log so the transition to closed is permanently recorded.
    const logEntry = {
      actor_user_id: auth.userId,
      timestamp: new Date().toISOString(),
      from_status: existing.status,
      to_status: 'closed',
      note: body.closureNote || null,
    };
    const concern = await queryOne(
      [
        'UPDATE concerns SET',
        "  status = 'closed',",
        '  outcome_summary = $1,',
        '  closed_by_user_id = $2,',
        '  closed_at = NOW(),',
        '  escalation_log = escalation_log || $3::jsonb,',
        '  updated_at = NOW(), updated_by = $2',
        'WHERE id = $4 AND deleted_at IS NULL RETURNING *',
      ].join('\n'),
      [body.outcomeSummary, auth.userId, JSON.stringify([logEntry]), concernId]
    );
    const closingTeam = await queryOne('SELECT team_id FROM concern_teams WHERE concern_id = $1 LIMIT 1', [concernId]);
    await addChronology(
      auth, existing.student_id, 'concerns', concernId, 'concern_logged',
      closingTeam ? closingTeam.team_id : null,
      'Concern closed: ' + existing.title,
      body.outcomeSummary,
      body.closureNote || null,
      'summary',
      null,
      null, body.outcomeSummary, null, null
    );
    await writeAuditLog(auth, { areaKey: 'concerns', actionKey: 'close', entityType: 'concern', entityId: concernId, studentId: existing.student_id, metadata: { previousStatus: existing.status } });
    return { concern };
  }

  async function updateConcern(auth, concernId, body) {
    await assertPermission(auth, 'concerns.create');
    const existing = await queryOne('SELECT * FROM concerns WHERE id = $1 AND deleted_at IS NULL', [concernId]);
    if (!existing) throw new AppError('Concern not found', 404);
    if (existing.status === 'closed') throw new AppError('Closed concerns cannot be edited', 400);
    await assertCanEditRecord(auth, existing.owner_team_id, existing.submitted_by_user_id, 'concern');

    // Resolve existing teams if body doesn't supply them, so resolveConcernFields can use them
    let existingTeamIds = null;
    if (body.teamIds === undefined && body.teamId === undefined) {
      const existingTeams = await query('SELECT team_id FROM concern_teams WHERE concern_id = $1', [concernId]);
      existingTeamIds = existingTeams.map(r => r.team_id);
    }
    // Merge body with existing values for fields not provided
    const mergedBody = {
      referralType: body.referralType !== undefined ? body.referralType : existing.referral_type,
      incidentType: body.incidentType !== undefined ? body.incidentType : existing.incident_type,
      actionTaken: body.actionTaken !== undefined ? body.actionTaken : (body.action_taken !== undefined ? body.action_taken : existing.action_taken),
      teamIds: body.teamIds,
      teamId: body.teamId,
    };
    const { referralType, incidentType, actionTaken, teamIds, isSafeguarding } = await resolveConcernFields(mergedBody, existingTeamIds);
    const requestedConfidentiality = body.confidentialityLevel !== undefined ? (body.confidentialityLevel || 'summary') : (existing.confidentiality_level || 'summary');
    const confidentialityLevel = isSafeguarding ? 'safeguarding' : (requestedConfidentiality === 'safeguarding' ? 'summary' : requestedConfidentiality);
    const derivedCategory = isSafeguarding ? 'safeguarding' : (existing.category === 'safeguarding' ? 'wellbeing' : existing.category);

    const concern = await queryOne(
      [
        'UPDATE concerns SET',
        '  title = $1, summary = $2, severity = $3,',
        '  category = $4, confidentiality_level = $5,',
        '  referral_type = $6, referral_date = $7, referral_outcome = $8,',
        '  incident_type = $9, action_taken = $10, action_note = $11,',
        '  behaviour_plan_active = $12,',
        '  updated_at = NOW(), updated_by = $13',
        'WHERE id = $14 AND deleted_at IS NULL RETURNING *',
      ].join('\n'),
      [
        body.title || existing.title,
        body.summary || existing.summary,
        body.severity || existing.severity,
        derivedCategory,
        confidentialityLevel,
        referralType,
        body.referralDate !== undefined ? (body.referralDate || null) : existing.referral_date,
        body.referralOutcome !== undefined ? (body.referralOutcome || null) : existing.referral_outcome,
        incidentType || null,
        actionTaken || null,
        body.actionNote !== undefined ? (body.actionNote || null) : existing.action_note,
        body.behaviourPlanActive !== undefined ? body.behaviourPlanActive === true : existing.behaviour_plan_active,
        auth.userId,
        concernId,
      ]
    );
    // Replace junction rows atomically
    await query('DELETE FROM concern_teams WHERE concern_id = $1', [concernId]);
    if (teamIds.length) {
      await query(
        'INSERT INTO concern_teams (concern_id, team_id) SELECT $1, UNNEST($2::uuid[]) ON CONFLICT DO NOTHING',
        [concernId, teamIds]
      );
    }
    await writeAuditLog(auth, { areaKey: 'concerns', actionKey: 'update', entityType: 'concern', entityId: concernId, studentId: existing.student_id, metadata: { severity: body.severity, teamIds } });
    return { concern };
  }

  async function createSendPlan(auth, body) {
    await assertPermission(auth, 'send.manage');
    if (!body.studentId || !body.planType) throw new AppError('studentId and planType are required');
    if (!VALID_SEND_PLAN_TYPES.includes(body.planType)) throw new AppError('Invalid planType: ' + body.planType);
    // Close any existing active plan before creating a new one
    await query(
      "UPDATE send_plans SET status = 'closed', updated_at = NOW(), updated_by = $1 WHERE student_id = $2 AND status IN ('active','under_review') AND deleted_at IS NULL",
      [auth.userId, body.studentId]
    );
    const plan = await queryOne(
      [
        'INSERT INTO send_plans',
        '  (student_id, plan_type, plan_ref, ehcp_annual_review_date, identified_needs,',
        '   planned_provision, review_date, review_outcome, external_agency, specialist_name,',
        '   status, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12) RETURNING *',
      ].join('\n'),
      [
        body.studentId, body.planType, body.planRef || null,
        body.ehcpAnnualReviewDate || null, body.identifiedNeeds || null,
        body.plannedProvision || null, body.reviewDate || null,
        body.reviewOutcome || null, body.externalAgency || null,
        body.specialistName || null,
        body.status && VALID_SEND_PLAN_STATUSES.includes(body.status) ? body.status : 'active',
        auth.userId,
      ]
    );
    // Update student send_category to match plan type if not already more specific
    if (body.planType === 'ehcp') {
      await query('UPDATE students SET send_category = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND send_category != $1', ['ehcp', auth.userId, body.studentId]);
    } else if (body.planType === 'sen_support') {
      await query("UPDATE students SET send_category = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND send_category = 'none'", ['sen_support', auth.userId, body.studentId]);
    }
    await addChronology(auth, body.studentId, 'send_plans', plan.id, 'review_held', null, 'SEND plan created: ' + body.planType, body.identifiedNeeds || 'SEND plan recorded.', null, 'summary');
    await writeAuditLog(auth, { areaKey: 'send', actionKey: 'plan.create', entityType: 'send_plan', entityId: plan.id, studentId: body.studentId, metadata: { planType: body.planType } });
    return { plan };
  }

  async function createMeeting(auth, body) {
    await assertPermission(auth, 'meetings.create');
    if (!body.studentId || !body.interactionType || !body.title || !body.summary || !body.occurredAt) throw new AppError('studentId, interactionType, title, summary, and occurredAt are required');
    if (!await canAccessStudent(auth, body.studentId)) throw new AppError('You do not have access to this student', 403);
    const teamIds = normaliseTeamIds(body.teamIds, body.teamId);
    const meetingOwnerTeamId = teamIds[0] || auth.teamIds[0] || null;
    const meeting = await queryOne(
      [
        'INSERT INTO meetings',
        '  (student_id, logged_by_user_id, owner_team_id, interaction_type, visibility_level, confidentiality_level,',
        '   title, summary, detail, occurred_at, external_agency, external_contact_name, external_ref,',
        '   created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $2, $2) RETURNING *',
      ].join('\n'),
      [
        body.studentId, auth.userId, meetingOwnerTeamId,
        body.interactionType, body.visibilityLevel || 'summary', body.confidentialityLevel || 'summary',
        body.title, body.summary, body.detail || null, body.occurredAt,
        body.externalAgency || null, body.externalContactName || null, body.externalRef || null,
      ]
    );
    if (teamIds.length) {
      await query(
        'INSERT INTO meeting_teams (meeting_id, team_id) SELECT $1, UNNEST($2::uuid[]) ON CONFLICT DO NOTHING',
        [meeting.id, teamIds]
      );
    }
    const eventType = body.externalAgency && body.externalAgency !== '' ? 'external_agency_contact' : 'meeting_logged';
    await addChronology(auth, body.studentId, 'meetings', meeting.id, eventType, teamIds[0] || null, body.title, body.summary, body.detail, body.visibilityLevel || 'summary', body.occurredAt);
    return { meeting };
  }

  async function createNote(auth, body) {
    await assertPermission(auth, 'notes.create');
    if (!body.studentId || !body.summary || !body.body) throw new AppError('studentId, summary, and body are required');
    if (!await canAccessStudent(auth, body.studentId)) throw new AppError('You do not have access to this student', 403);
    const teamIds = normaliseTeamIds(body.teamIds, body.teamId);
    const noteOwnerTeamId = teamIds[0] || auth.teamIds[0] || null;
    const note = await queryOne(
      [
        'INSERT INTO notes (student_id, author_user_id, owner_team_id, note_type, visibility_level, confidentiality_level, summary, body, concern_id, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $2, $2) RETURNING *',
      ].join('\n'),
      [body.studentId, auth.userId, noteOwnerTeamId, body.noteType || 'case_note', body.visibilityLevel || 'summary', body.confidentialityLevel || 'restricted', body.summary, body.body, body.concernId || null]
    );
    if (teamIds.length) {
      await query(
        'INSERT INTO note_teams (note_id, team_id) SELECT $1, UNNEST($2::uuid[]) ON CONFLICT DO NOTHING',
        [note.id, teamIds]
      );
    }
    await addChronology(auth, body.studentId, 'notes', note.id, 'note_added', teamIds[0] || null, body.summary, body.summary, body.body, body.visibilityLevel || 'summary');
    return { note };
  }

  async function createFollowUp(auth, body) {
    await assertPermission(auth, 'actions.manage');
    if (!body.studentId || !body.title || !body.summary) throw new AppError('studentId, title, and summary are required');
    if (!await canAccessStudent(auth, body.studentId)) throw new AppError('You do not have access to this student', 403);
    const teamIds = normaliseTeamIds(body.teamIds, body.teamId);
    const actionOwnerTeamId = teamIds[0] || auth.teamIds[0] || null;
    const action = await queryOne(
      [
        'INSERT INTO actions (student_id, owner_user_id, owner_team_id, title, summary, status, priority, due_at, visibility_level, concern_id, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $2, $2) RETURNING *',
      ].join('\n'),
      [body.studentId, body.ownerUserId || auth.userId, actionOwnerTeamId, body.title, body.summary, body.status || 'open', body.priority || 'medium', body.dueAt || null, body.visibilityLevel || 'summary', body.concernId || null]
    );
    if (teamIds.length) {
      await query(
        'INSERT INTO action_teams (action_id, team_id) SELECT $1, UNNEST($2::uuid[]) ON CONFLICT DO NOTHING',
        [action.id, teamIds]
      );
    }
    await addChronology(auth, body.studentId, 'actions', action.id, 'follow_up_created', teamIds[0] || null, body.title, body.summary, null, 'summary');
    return { action };
  }

  async function importStudents(auth, body) {
    await assertPermission(auth, 'students.manage');
    const rows = body.students;
    if (!Array.isArray(rows) || rows.length === 0) throw new AppError('students array is required');
    if (rows.length > 500) throw new AppError('Maximum 500 students per import');
    const results = { created: 0, updated: 0, errors: [] };
    for (const row of rows) {
      const code = (row.studentCode || row.student_code || '').trim();
      const firstName = (row.firstName || row.first_name || '').trim();
      const lastName = (row.lastName || row.last_name || '').trim();
      if (!code || !firstName || !lastName) {
        results.errors.push({ studentCode: code || '(blank)', reason: 'studentCode, firstName, and lastName are required' });
        continue;
      }
      const dob = row.dateOfBirth || row.date_of_birth || null;
      const dobValue = dob ? dob.trim() || null : null;
      try {
        const existing = await queryOne('SELECT id FROM students WHERE student_code = $1 AND deleted_at IS NULL', [code]);
        if (existing) {
          await queryOne(
            'UPDATE students SET first_name=$1, last_name=$2, date_of_birth=COALESCE($3::date, date_of_birth), updated_at=NOW(), updated_by=$4 WHERE id=$5 RETURNING id',
            [firstName, lastName, dobValue, auth.userId, existing.id]
          );
          results.updated++;
        } else {
          await queryOne(
            'INSERT INTO students (student_code, first_name, last_name, date_of_birth, current_status, created_by, updated_by) VALUES ($1,$2,$3,$4::date,$5,$6,$6) RETURNING id',
            [code, firstName, lastName, dobValue, 'active', auth.userId]
          );
          results.created++;
        }
      } catch (err) {
        results.errors.push({ studentCode: code, reason: err.message });
      }
    }
    await writeAuditLog(auth, { areaKey: 'students', actionKey: 'import', entityType: 'student', entityId: null });
    return { results };
  }

  async function bulkUpdateStudentStatus(auth, body) {
    await assertPermission(auth, 'students.manage');
    const { studentIds, status } = body;
    if (!Array.isArray(studentIds) || studentIds.length === 0) throw new AppError('studentIds array is required');
    if (!['active', 'inactive'].includes(status)) throw new AppError('Invalid status');
    await query(
      `UPDATE students SET current_status=$1, updated_at=NOW(), updated_by=$2 WHERE id = ANY($3::uuid[]) AND deleted_at IS NULL`,
      [status, auth.userId, studentIds]
    );
    await writeAuditLog(auth, { areaKey: 'students', actionKey: 'bulk_status', entityType: 'student', entityId: null });
    return { ok: true, count: studentIds.length };
  }

  async function addRadar(auth, body) {
    await assertPermission(auth, 'radar.manage');
    if (!body.studentId || !body.teamId || !body.summary) throw new AppError('studentId, teamId, and summary are required');
    const radar = await queryOne(
      [
        'INSERT INTO student_team_radar (student_id, team_id, status, category, reason_summary, severity, visibility_level, assigned_lead_user_id, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING *',
      ].join('\n'),
      [body.studentId, body.teamId, body.status || 'active', body.category || 'general', body.summary, body.severity || 'medium', body.visibilityLevel || 'summary', body.assignedLeadUserId || auth.userId, auth.userId]
    );
    await addChronology(auth, body.studentId, 'student_team_radar', radar.id, 'radar_added', body.teamId, 'Radar added', body.summary, null, body.visibilityLevel || 'summary');
    return { radar };
  }

  async function addChronology(auth, studentId, sourceTable, sourceId, eventType, teamId, title, summary, detail, visibilityLevel, occurredAt = null, actionTaken = null, outcome = null, nextStep = null, nextStepDue = null) {
    await query(
      [
        'INSERT INTO chronology_events',
        '  (student_id, source_table, source_id, event_type, team_id, actor_user_id,',
        '   visibility_level, confidentiality_level, title, summary, detail,',
        '   action_taken, outcome, next_step, next_step_due,',
        '   occurred_at, created_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, COALESCE($16::timestamptz, NOW()), $6)',
      ].join('\n'),
      [studentId, sourceTable, sourceId, eventType, teamId || null, auth.userId, visibilityLevel || 'summary', 'summary', title, summary, detail || null, actionTaken || null, outcome || null, nextStep || null, nextStepDue || null, occurredAt]
    );
  }

  async function getMeetingsPayload(auth, requestQuery) {
    await assertPermission(auth, 'meetings.view');
    const params = [];
    const filterExpression = requestQuery.filter || '';
    const filterSql = compileFilter(parseFilter(filterExpression), meetingFieldMap(), params).sql;
    let searchSql = 'TRUE';
    const search = requestQuery.q ? String(requestQuery.q).trim().toLowerCase() : '';
    if (search) {
      const placeholder = pushParam(params, '%' + search + '%');
      searchSql = '(LOWER(m.title) LIKE ' + placeholder + ' OR LOWER(m.summary) LIKE ' + placeholder + ' OR LOWER(m.first_name) LIKE ' + placeholder + ' OR LOWER(m.last_name) LIKE ' + placeholder + ')';
    }
    const rows = await query(
      [
        'SELECT * FROM (',
        "  SELECT 'meeting' AS item_type, m.id, m.student_id, s.first_name, s.last_name, s.year_group,",
        '    m.title, m.summary, m.detail, m.interaction_type, m.visibility_level, m.occurred_at AS calendar_at,',
        '    m.occurred_at, m.created_at, m.logged_by_user_id AS assigned_user_id, u.display_name AS assigned_user_name,',
        "    'scheduled'::text AS item_status, NULL::timestamptz AS due_at, NULL::timestamptz AS completed_at, NULL::text AS priority,",
        '    COALESCE(ARRAY_AGG(DISTINCT mt.team_id) FILTER (WHERE mt.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
        "    COALESCE(STRING_AGG(DISTINCT t.name, ', ') FILTER (WHERE t.name IS NOT NULL), NULL) AS team_name",
        '  FROM meetings m',
        '  JOIN students s ON s.id = m.student_id',
        '  LEFT JOIN meeting_teams mt ON mt.meeting_id = m.id',
        '  LEFT JOIN teams t ON t.id = mt.team_id',
        '  LEFT JOIN users u ON u.id = m.logged_by_user_id',
        '  WHERE m.deleted_at IS NULL AND s.deleted_at IS NULL',
        '  GROUP BY m.id, s.id, u.display_name',
        '  UNION ALL',
        "  SELECT 'follow_up' AS item_type, a.id, a.student_id, s.first_name, s.last_name, s.year_group,",
        "    a.title, a.summary, NULL::text AS detail, 'follow_up' AS interaction_type, COALESCE(a.visibility_level, 'summary') AS visibility_level,",
        '    COALESCE(a.due_at, a.created_at) AS calendar_at, COALESCE(a.due_at, a.created_at) AS occurred_at, a.created_at,',
        '    a.owner_user_id AS assigned_user_id, u.display_name AS assigned_user_name, a.status AS item_status,',
        '    a.due_at, a.completed_at, a.priority,',
        '    COALESCE(ARRAY_AGG(DISTINCT at2.team_id) FILTER (WHERE at2.team_id IS NOT NULL), ARRAY[]::uuid[]) AS team_ids,',
        "    COALESCE(STRING_AGG(DISTINCT t.name, ', ') FILTER (WHERE t.name IS NOT NULL), NULL) AS team_name",
        '  FROM actions a',
        '  JOIN students s ON s.id = a.student_id',
        '  LEFT JOIN action_teams at2 ON at2.action_id = a.id',
        '  LEFT JOIN teams t ON t.id = at2.team_id',
        '  LEFT JOIN users u ON u.id = a.owner_user_id',
        '  WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL',
        '  GROUP BY a.id, s.id, u.display_name',
        ') m',
        'WHERE ' + filterSql + ' AND ' + searchSql,
        '  AND (m.assigned_user_id = $' + (params.length + 1),
        '    OR m.team_ids = ARRAY[]::uuid[]',
        '    OR m.team_ids && $' + (params.length + 2) + '::uuid[]',
        '    OR EXISTS (',
        '      SELECT 1 FROM team_visibility_rules tvr',
        '      WHERE tvr.deleted_at IS NULL',
        '        AND tvr.source_team_id = ANY($' + (params.length + 2) + '::uuid[])',
        '        AND tvr.target_team_id = ANY(m.team_ids)',
        "        AND tvr.content_type IN ('meetings', 'actions')",
        "        AND tvr.visibility_level <> 'none'",
        '    )',
        '  )',
        'ORDER BY m.calendar_at ASC LIMIT 150',
      ].join('\n'),
      params.concat([auth.userId, auth.teamIds])
    );
    const matrix = await getVisibilityMatrix(auth.teamIds);
    const visibleMeetings = applyCalendarVisibility(auth, matrix, rows);
    await writeAuditLog(auth, { areaKey: 'meetings', actionKey: 'list.view', entityType: 'meeting_list', metadata: { filter: filterExpression, count: visibleMeetings.length } });
    return { meetings: visibleMeetings, filter: filterExpression };
  }

  async function getSettingsReferencePayload(auth) {
    await assertPermission(auth, 'settings.view');
    const [users, roles, permissions, teams, visibilityRules, savedFilters, userRoles, userTeams, referenceOptions] = await Promise.all([
      query('SELECT id, email, display_name, is_active FROM users WHERE deleted_at IS NULL ORDER BY display_name'),
      query('SELECT id, role_key, name, description, is_system, is_editable FROM roles WHERE deleted_at IS NULL ORDER BY name'),
      query('SELECT id, permission_key, area_key, action_key, description FROM permissions ORDER BY permission_key'),
      query('SELECT id, team_key, name, description, accent_color, is_active FROM teams WHERE deleted_at IS NULL ORDER BY name'),
      query('SELECT tvr.id, tvr.source_team_id, source_team.name AS source_team_name, tvr.target_team_id, target_team.name AS target_team_name, tvr.content_type, tvr.visibility_level FROM team_visibility_rules tvr JOIN teams source_team ON source_team.id = tvr.source_team_id JOIN teams target_team ON target_team.id = tvr.target_team_id WHERE tvr.deleted_at IS NULL ORDER BY source_team.name, target_team.name, tvr.content_type'),
      query('SELECT id, area_key, name, filter_expression, is_shared FROM saved_filters WHERE deleted_at IS NULL ORDER BY area_key, name'),
      query('SELECT ur.user_id, ur.role_id, u.display_name AS user_name, u.email AS user_email, r.role_key, r.name AS role_name FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL ORDER BY u.display_name, r.name'),
      query('SELECT ut.user_id, ut.team_id, t.name AS team_name FROM user_teams ut JOIN teams t ON t.id = ut.team_id AND t.deleted_at IS NULL ORDER BY t.name'),
      getReferenceOptions(null, null, false),
    ]);
    return { users, roles, permissions, teams, visibilityRules, savedFilters, userRoles, userTeams, referenceOptions };
  }

  function assertManagedReferenceField(areaKey, fieldKey) {
    if (!MANAGED_REFERENCE_FIELDS[areaKey] || !MANAGED_REFERENCE_FIELDS[areaKey].includes(fieldKey)) {
      throw new AppError('Reference field is not manageable: ' + areaKey + '.' + fieldKey, 400);
    }
  }

  async function saveReferenceOption(auth, body) {
    await assertPermission(auth, 'settings.reference.manage');
    if (!body.areaKey || !body.fieldKey || !body.label) {
      throw new AppError('areaKey, fieldKey, and label are required');
    }
    assertManagedReferenceField(body.areaKey, body.fieldKey);
    // Update-by-ID path
    if (body.referenceOptionId) {
      const existing = await queryOne('SELECT id FROM reference_options WHERE id = $1 AND deleted_at IS NULL', [body.referenceOptionId]);
      if (!existing) throw new AppError('Reference option not found', 404);
      const referenceOption = await queryOne(
        'UPDATE reference_options SET label = $1, sort_order = $2, is_active = $3, updated_at = NOW(), updated_by = $4 WHERE id = $5 RETURNING *',
        [body.label, Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0, body.isActive !== false, auth.userId, body.referenceOptionId]
      );
      await writeAuditLog(auth, { areaKey: 'settings.reference', actionKey: 'update', entityType: 'reference_option', entityId: body.referenceOptionId });
      return { referenceOption };
    }
    if (!body.optionKey) throw new AppError('optionKey is required for new options');
    const optionKey = String(body.optionKey).trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '');
    if (!optionKey) throw new AppError('optionKey must contain letters or numbers');
    const referenceOption = await queryOne(
      [
        'INSERT INTO reference_options',
        '  (area_key, field_key, option_key, label, description, team_scope, team_id, sort_order, is_active, is_system, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, FALSE, $10, $10)',
        'ON CONFLICT (area_key, field_key, option_key) DO UPDATE SET',
        '  label = EXCLUDED.label,',
        '  description = EXCLUDED.description,',
        '  sort_order = EXCLUDED.sort_order,',
        '  is_active = EXCLUDED.is_active,',
        '  deleted_at = NULL,',
        '  updated_at = NOW(),',
        '  updated_by = EXCLUDED.updated_by',
        'RETURNING *',
      ].join('\n'),
      [
        body.areaKey,
        body.fieldKey,
        optionKey,
        body.label,
        body.description || null,
        body.teamId ? 'team' : 'global',
        body.teamId || null,
        Number.isFinite(Number(body.sortOrder)) ? Number(body.sortOrder) : 0,
        body.isActive !== false,
        auth.userId,
      ]
    );
    await writeAuditLog(auth, {
      areaKey: 'settings.reference',
      actionKey: 'upsert',
      entityType: 'reference_option',
      entityId: referenceOption.id,
      metadata: { areaKey: body.areaKey, fieldKey: body.fieldKey, optionKey },
    });
    return { referenceOption };
  }

  async function deleteReferenceOption(auth, body) {
    await assertPermission(auth, 'settings.reference.manage');
    if (!body.referenceOptionId) throw new AppError('referenceOptionId is required');
    const existing = await queryOne(
      'SELECT id, area_key, field_key, option_key, is_system FROM reference_options WHERE id = $1 AND deleted_at IS NULL',
      [body.referenceOptionId]
    );
    if (!existing) throw new AppError('Reference option not found', 404);
    assertManagedReferenceField(existing.area_key, existing.field_key);
    const referenceOption = await queryOne(
      'UPDATE reference_options SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW(), updated_by = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING *',
      [auth.userId, body.referenceOptionId]
    );
    await writeAuditLog(auth, {
      areaKey: 'settings.reference',
      actionKey: 'delete',
      entityType: 'reference_option',
      entityId: referenceOption.id,
      metadata: { areaKey: existing.area_key, fieldKey: existing.field_key, optionKey: existing.option_key },
    });
    return { referenceOption };
  }

  async function assignUserTeam(auth, body) {
    await assertPermission(auth, 'settings.users.manage');
    if (!body.userId || !body.teamId) throw new AppError('userId and teamId are required');
    if (body.action === 'remove') {
      await query('DELETE FROM user_teams WHERE user_id = $1 AND team_id = $2', [body.userId, body.teamId]);
    } else {
      await query('INSERT INTO user_teams (user_id, team_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [body.userId, body.teamId, auth.userId]);
    }
    await writeAuditLog(auth, { areaKey: 'settings.users', actionKey: body.action === 'remove' ? 'team.remove' : 'team.assign', entityType: 'user_team', entityId: body.userId, metadata: { teamId: body.teamId } });
    return { ok: true };
  }

  async function assignUserRole(auth, body) {
    await assertPermission(auth, 'settings.users.manage');
    if (!body.userId || !body.roleId) throw new AppError('userId and roleId are required');
    if (body.action === 'remove') {
      await query('DELETE FROM user_roles WHERE user_id = $1 AND role_id = $2', [body.userId, body.roleId]);
    } else {
      await query('INSERT INTO user_roles (user_id, role_id, created_by) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [body.userId, body.roleId, auth.userId]);
    }
    await writeAuditLog(auth, { areaKey: 'settings.users', actionKey: body.action === 'remove' ? 'role.remove' : 'role.assign', entityType: 'user_role', entityId: body.userId, metadata: { roleId: body.roleId } });
    return { ok: true };
  }

  async function saveUser(auth, body) {
    await assertPermission(auth, 'settings.users.manage');
    if (!body.email || !body.displayName) throw new AppError('email and displayName are required');
    const roleIds = Array.isArray(body.roleIds) ? compactUnique(body.roleIds) : null;
    const teamIds = Array.isArray(body.teamIds) ? compactUnique(body.teamIds) : null;
    const user = await queryOne('INSERT INTO users (email, display_name, is_active, created_by, updated_by) VALUES ($1, $2, $3, $4, $4) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, is_active = EXCLUDED.is_active, deleted_at = NULL, updated_at = NOW(), updated_by = EXCLUDED.updated_by RETURNING *', [String(body.email).toLowerCase(), body.displayName, body.isActive !== false, auth.userId]);
    if (teamIds) {
      await query('DELETE FROM user_teams WHERE user_id = $1', [user.id]);
      if (teamIds.length) {
        await query('INSERT INTO user_teams (user_id, team_id, created_by) SELECT $1, t.id, $3 FROM teams t WHERE t.id = ANY($2::uuid[]) AND t.deleted_at IS NULL ON CONFLICT DO NOTHING', [user.id, teamIds, auth.userId]);
      }
    }
    if (roleIds) {
      await query('DELETE FROM user_roles WHERE user_id = $1', [user.id]);
      if (roleIds.length) {
        await query('INSERT INTO user_roles (user_id, role_id, created_by) SELECT $1, r.id, $3 FROM roles r WHERE r.id = ANY($2::uuid[]) AND r.deleted_at IS NULL ON CONFLICT DO NOTHING', [user.id, roleIds, auth.userId]);
      }
    }
    await writeAuditLog(auth, { areaKey: 'settings.users', actionKey: 'upsert', entityType: 'user', entityId: user.id, metadata: { email: user.email, isActive: user.is_active, teamCount: teamIds ? teamIds.length : null, roleCount: roleIds ? roleIds.length : null } });
    return { user };
  }

  async function deleteUser(auth, body) {
    await assertPermission(auth, 'settings.users.manage');
    if (!body.userId) throw new AppError('userId is required');
    if (body.userId === auth.userId) throw new AppError('You cannot delete your own account', 400);
    const existing = await queryOne(
      [
        'SELECT u.id, u.email, u.display_name,',
        "  COALESCE(ARRAY_AGG(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL), ARRAY[]::text[]) AS role_keys",
        'FROM users u',
        'LEFT JOIN user_roles ur ON ur.user_id = u.id',
        'LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL',
        'WHERE u.id = $1 AND u.deleted_at IS NULL',
        'GROUP BY u.id',
      ].join('\n'),
      [body.userId]
    );
    if (!existing) throw new AppError('User not found', 404);
    if ((existing.role_keys || []).includes('admin')) throw new AppError('Admin accounts cannot be deleted', 400);
    await query('DELETE FROM user_roles WHERE user_id = $1', [body.userId]);
    await query('DELETE FROM user_teams WHERE user_id = $1', [body.userId]);
    const user = await queryOne('UPDATE users SET is_active = FALSE, deleted_at = NOW(), updated_at = NOW(), updated_by = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, email, display_name', [auth.userId, body.userId]);
    await writeAuditLog(auth, { areaKey: 'settings.users', actionKey: 'delete', entityType: 'user', entityId: body.userId, metadata: { email: existing.email } });
    return { user };
  }

  async function saveRole(auth, body) {
    await assertPermission(auth, 'settings.roles.manage');
    if (!body.roleKey || !body.name) throw new AppError('roleKey and name are required');
    if (body.roleKey === 'admin') throw new AppError('The built-in admin role is immutable', 400);
    const role = await queryOne('INSERT INTO roles (role_key, name, description, is_system, is_editable, created_by, updated_by) VALUES ($1, $2, $3, FALSE, TRUE, $4, $4) ON CONFLICT (role_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW(), updated_by = EXCLUDED.updated_by RETURNING *', [body.roleKey, body.name, body.description || '', auth.userId]);
    await query('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
    if ((body.permissionKeys || []).length) {
      await query('INSERT INTO role_permissions (role_id, permission_id, created_by) SELECT $1, p.id, $2 FROM permissions p WHERE p.permission_key = ANY($3::text[])', [role.id, auth.userId, body.permissionKeys]);
    }
    await writeAuditLog(auth, { areaKey: 'settings.roles', actionKey: 'upsert', entityType: 'role', entityId: role.id, metadata: { roleKey: body.roleKey } });
    return { role };
  }

  async function saveTeam(auth, body) {
    await assertPermission(auth, 'settings.teams.manage');
    if (!body.teamKey || !body.name) throw new AppError('teamKey and name are required');
    const team = await queryOne('INSERT INTO teams (team_key, name, description, accent_color, is_active, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6) ON CONFLICT (team_key) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, accent_color = EXCLUDED.accent_color, is_active = EXCLUDED.is_active, updated_at = NOW(), updated_by = EXCLUDED.updated_by RETURNING *', [body.teamKey, body.name, body.description || '', body.accentColor || '#2F6B66', body.isActive !== false, auth.userId]);
    return { team };
  }

  async function saveVisibilityRule(auth, body) {
    await assertPermission(auth, 'settings.visibility.manage');
    if (!body.sourceTeamId || !body.targetTeamId || !body.contentType || !body.visibilityLevel) throw new AppError('sourceTeamId, targetTeamId, contentType, and visibilityLevel are required');
    // Manual upsert: UPDATE existing (including soft-deleted) first, INSERT only if no row matched
    let visibilityRule = await queryOne(
      'UPDATE team_visibility_rules SET visibility_level = $1, deleted_at = NULL, updated_at = NOW(), updated_by = $2 WHERE source_team_id = $3 AND target_team_id = $4 AND content_type = $5 RETURNING *',
      [body.visibilityLevel, auth.userId, body.sourceTeamId, body.targetTeamId, body.contentType]
    );
    if (!visibilityRule) {
      visibilityRule = await queryOne(
        'INSERT INTO team_visibility_rules (source_team_id, target_team_id, content_type, visibility_level, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) RETURNING *',
        [body.sourceTeamId, body.targetTeamId, body.contentType, body.visibilityLevel, auth.userId]
      );
    }
    await writeAuditLog(auth, { areaKey: 'settings.visibility', actionKey: 'upsert', entityType: 'team_visibility_rule', entityId: visibilityRule.id, targetTeamId: body.targetTeamId });
    return { visibilityRule };
  }

  async function deleteVisibilityRule(auth, body) {
    await assertPermission(auth, 'settings.visibility.manage');
    if (!body.visibilityRuleId) throw new AppError('visibilityRuleId is required');
    const visibilityRule = await queryOne(
      'UPDATE team_visibility_rules SET deleted_at = NOW(), updated_at = NOW(), updated_by = $1 WHERE id = $2 AND deleted_at IS NULL RETURNING id, target_team_id',
      [auth.userId, body.visibilityRuleId]
    );
    if (!visibilityRule) throw new AppError('Sharing rule not found', 404);
    await writeAuditLog(auth, { areaKey: 'settings.visibility', actionKey: 'delete', entityType: 'team_visibility_rule', entityId: visibilityRule.id, targetTeamId: visibilityRule.target_team_id });
    return { visibilityRule };
  }

  async function saveFilter(auth, body) {
    await assertPermission(auth, 'settings.view');
    if (!body.areaKey || !body.name || !body.filterExpression) throw new AppError('areaKey, name, and filterExpression are required');
    const savedFilter = await queryOne('INSERT INTO saved_filters (owner_user_id, area_key, name, filter_expression, is_shared, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $1, $1) RETURNING *', [auth.userId, body.areaKey, body.name, body.filterExpression, body.isShared === true && auth.isAdmin]);
    return { savedFilter };
  }

  async function getAuditLogsPayload(auth, requestQuery) {
    await assertPermission(auth, 'audit.view');
    const params = [];
    const clauses = [];
    if (requestQuery.actorId) clauses.push('a.actor_user_id = ' + pushParam(params, requestQuery.actorId));
    if (requestQuery.areaKey) clauses.push('a.area_key = ' + pushParam(params, requestQuery.areaKey));
    if (requestQuery.studentId) {
      if (!await canAccessStudent(auth, requestQuery.studentId)) throw new AppError('You do not have access to this student', 403);
      clauses.push('a.student_id = ' + pushParam(params, requestQuery.studentId));
    }
    if (requestQuery.since) clauses.push('a.created_at >= ' + pushParam(params, requestQuery.since));
    if (requestQuery.until) clauses.push('a.created_at <= ' + pushParam(params, requestQuery.until));
    const where = clauses.length ? 'WHERE ' + clauses.join(' AND ') : '';
    const limit = Math.min(Number(requestQuery.limit) || 100, 500);
    const offset = Math.max(Number(requestQuery.offset) || 0, 0);
    const auditLogs = await query(
      [
        'SELECT a.id, a.area_key, a.action_key, a.entity_type, a.entity_id, a.student_id,',
        '  a.created_at, a.metadata,',
        '  u.display_name AS actor_name, u.email AS actor_email,',
        '  s.student_code, s.first_name, s.last_name',
        'FROM audit_logs a',
        'LEFT JOIN users u ON u.id = a.actor_user_id',
        'LEFT JOIN students s ON s.id = a.student_id',
        where,
        'ORDER BY a.created_at DESC',
        'LIMIT ' + pushParam(params, limit) + ' OFFSET ' + pushParam(params, offset),
      ].join('\n'),
      params
    );
    return { auditLogs, limit, offset };
  }

  async function dispatch(request, auth) {
    // auth may be pre-loaded by the outer fetch handler (production path) or omitted (tests/direct calls).
    if (!auth) auth = await loadAuthContext();
    const path = request?.path ? decodeURIComponent(request.path) : '/api/bootstrap';
    const method = (request?.method || 'get').toLowerCase();
    const payload = request?.payload || {};
    const requestQuery = request?.query || {};

    if (method === 'get' && path === '/api/bootstrap') return getBootstrapPayload(auth);
    if (method === 'get' && path === '/api/dashboard') return getDashboardPayload(auth);
    if (method === 'get' && path === '/api/students') return getStudentsPayload(auth, requestQuery);
    if (method === 'get' && /^\/api\/students\/[^/]+$/.test(path)) return getStudentProfilePayload(auth, path.split('/')[3]);
    if (method === 'post' && path === '/api/concerns') return createConcern(auth, payload);
    if (method === 'post' && /^\/api\/concerns\/[^/]+\/close$/.test(path)) return closeConcern(auth, path.split('/')[3], payload);
    if (method === 'post' && /^\/api\/concerns\/[^/]+\/update$/.test(path)) return updateConcern(auth, path.split('/')[3], payload);
    if (method === 'post' && path === '/api/send-plans') return createSendPlan(auth, payload);
    if (method === 'get' && path === '/api/meetings') return getMeetingsPayload(auth, requestQuery);
    if (method === 'post' && path === '/api/meetings') return createMeeting(auth, payload);
    if (method === 'post' && path === '/api/notes') return createNote(auth, payload);
    if (method === 'post' && path === '/api/follow-ups') return createFollowUp(auth, payload);
    if (method === 'post' && path === '/api/radar') return addRadar(auth, payload);
    if (method === 'post' && path === '/api/students/import') return importStudents(auth, payload);
    if (method === 'post' && path === '/api/students/bulk-status') return bulkUpdateStudentStatus(auth, payload);
    if (method === 'get' && path === '/api/settings/reference') return getSettingsReferencePayload(auth);
    if (method === 'post' && path === '/api/settings/users') return saveUser(auth, payload);
    if (method === 'post' && path === '/api/settings/users/delete') return deleteUser(auth, payload);
    if (method === 'post' && path === '/api/settings/roles') return saveRole(auth, payload);
    if (method === 'post' && path === '/api/settings/teams') return saveTeam(auth, payload);
    if (method === 'post' && path === '/api/settings/visibility-rules') return saveVisibilityRule(auth, payload);
    if (method === 'post' && path === '/api/settings/visibility-rules/delete') return deleteVisibilityRule(auth, payload);
    if (method === 'post' && path === '/api/settings/user-roles') return assignUserRole(auth, payload);
    if (method === 'post' && path === '/api/settings/user-teams') return assignUserTeam(auth, payload);
    if (method === 'post' && path === '/api/settings/reference-options') return saveReferenceOption(auth, payload);
    if (method === 'post' && path === '/api/settings/reference-options/delete') return deleteReferenceOption(auth, payload);
    if (method === 'post' && path === '/api/saved-filters') return saveFilter(auth, payload);
    if (method === 'get' && path === '/api/audit-logs') return getAuditLogsPayload(auth, requestQuery);
    throw new AppError('Route not found: ' + path, 404);
  }

  // Lightweight failed-auth audit: writes directly without requiring a loaded auth context,
  // so it can be called from the outer fetch handler when auth fails.
  async function writeFailedAuthAudit(email, path, reason) {
    await query(
      'INSERT INTO audit_logs (actor_user_id, area_key, action_key, entity_type, metadata) VALUES (NULL, $1, $2, $3, $4::jsonb)',
      ['auth', 'denied', 'auth_failure', JSON.stringify({ email, path, reason })]
    );
  }

  return { dispatch, loadAuthContext, writeFailedAuthAudit };
}

function compactUnique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export {
  AppError,
  createApi,
  workerQuery,
  VALID_REFERRAL_TYPES,
  VALID_SEND_CATEGORIES,
};
