const VISIBILITY_LEVELS = ['none', 'indicator', 'summary', 'full'];
const FILTER_OPERATORS = ['=isnull=', '=in=', '=out=', '~=', '==', '!=', '>=', '<=', '>', '<'];
const VALID_REFERRAL_TYPES = ['none', 'mash', 'lado', 'police', 'early_help', 'camhs', 'social_care', 'other'];
const VALID_SEND_CATEGORIES = ['none', 'sen_support', 'ehcp', 'assessed_no_need'];
const VALID_SEND_PLAN_TYPES = ['sen_support', 'ehcp', 'early_help'];
const VALID_SEND_PLAN_STATUSES = ['active', 'under_review', 'closed'];
const VALID_INCIDENT_TYPES = ['verbal','physical','disruption','bullying','online','damage','substance','other'];
const VALID_SANCTION_TYPES = ['none','verbal_warning','detention','isolation','ftes','managed_move','permanent_exclusion'];

class AppError extends Error {
  constructor(message, statusCode = 400, details = null) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'GET' && url.pathname === '/health') {
        return json({ ok: true, service: 'al-hikmah-wellbeing-worker' });
      }
      if (request.method !== 'POST' || url.pathname !== '/api/proxy') {
        throw new AppError('Route not found', 404);
      }

      const rawBody = await request.text();
      await verifySignedAppsScriptRequest(request, rawBody, env);
      const body = rawBody ? JSON.parse(rawBody) : {};
      const email = request.headers.get('X-AHW-User-Email') || '';
      const api = createApi(env, email.toLowerCase());
      const data = await api.dispatch(body);
      return json({ ok: true, data });
    } catch (error) {
      const status = error.statusCode || 500;
      return json({
        ok: false,
        error: {
          message: status >= 500 ? 'Worker request failed' : error.message,
          details: error.details || null,
        },
      }, status);
    }
  },
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

async function verifySignedAppsScriptRequest(request, rawBody, env) {
  const secret = env.WORKER_SHARED_SECRET;
  if (!secret) throw new AppError('Worker shared secret is not configured', 500);

  const timestamp = request.headers.get('X-AHW-Timestamp') || '';
  const nonce = request.headers.get('X-AHW-Nonce') || '';
  const email = (request.headers.get('X-AHW-User-Email') || '').trim().toLowerCase();
  const signature = request.headers.get('X-AHW-Signature') || '';
  const keyId = request.headers.get('X-AHW-Key-Id') || 'apps-script-main';
  if (!timestamp || !nonce || !email || !signature) {
    throw new AppError('Missing signed bridge headers', 401);
  }
  const timestampMs = Number(timestamp);
  if (!Number.isFinite(timestampMs)) {
    throw new AppError('Invalid signed request timestamp', 401);
  }
  if (Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
    throw new AppError('Signed request expired', 401);
  }

  const canonical = [timestamp, nonce, email, rawBody].join('\n');
  const expected = await hmacHex(secret, canonical);
  if (!timingSafeEqual(signature, expected)) {
    throw new AppError('Invalid Worker bridge signature', 401);
  }
  await persistSignedRequestNonce(env, {
    keyId,
    nonce,
    email,
    timestamp: new Date(timestampMs),
  });
}

async function persistSignedRequestNonce(env, requestNonce) {
  const nonceHash = await sha256Hex(requestNonce.nonce);
  await workerQuery(
    env,
    'DELETE FROM signed_request_nonces WHERE expires_at < NOW()',
    []
  );
  const row = await workerQueryOne(
    env,
    [
      'INSERT INTO signed_request_nonces (key_id, nonce_hash, actor_email, request_timestamp, expires_at)',
      "VALUES ($1, $2, $3, $4, NOW() + INTERVAL '10 minutes')",
      'ON CONFLICT (key_id, nonce_hash) DO NOTHING',
      'RETURNING nonce_hash',
    ].join('\n'),
    [requestNonce.keyId, nonceHash, requestNonce.email, requestNonce.timestamp.toISOString()]
  );
  if (!row) throw new AppError('Signed request nonce has already been used', 401);
}

async function sha256Hex(value) {
  const encoder = new TextEncoder();
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function hmacHex(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(left, right) {
  if (!left || !right || left.length !== right.length) return false;
  let result = 0;
  for (let index = 0; index < left.length; index += 1) {
    result |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return result === 0;
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

function mapNeonRows(result) {
  const rows = result.rows || [];
  if (!rows.length || !Array.isArray(rows[0])) return rows;
  const fields = result.fields || [];
  return rows.map((row) => {
    const mapped = {};
    fields.forEach((field, index) => {
      mapped[field.name] = row[index];
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
        'SELECT u.id, u.email, u.display_name, u.primary_team_id, u.is_active,',
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
    if (!row || !row.is_active) throw new AppError('User is not authorised for this app', 403);
    const teamIds = compactUnique([row.primary_team_id].concat(row.team_ids || []));
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

  async function getEffectivePermissionKeys(auth) {
    if (auth.isAdmin) return ['*'];
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
    return rows.map((row) => row.permission_key);
  }

  async function assertPermission(auth, permissionKey) {
    if (auth.isAdmin) return;
    const row = await queryOne(
      [
        'SELECT 1',
        'FROM user_roles ur',
        'JOIN role_permissions rp ON rp.role_id = ur.role_id',
        'JOIN permissions p ON p.id = rp.permission_id',
        'WHERE ur.user_id = $1 AND p.permission_key = $2',
        'LIMIT 1',
      ].join('\n'),
      [auth.userId, permissionKey]
    );
    if (!row) throw new AppError('Missing permission: ' + permissionKey, 403);
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
      teamId: buildFieldRule('m.team_id'),
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

  function computeVisibility(auth, matrix, ownerTeamId, contentType, recordVisibilityLevel) {
    if (auth.isAdmin || !ownerTeamId) return 'full';
    if (auth.teamIds.includes(ownerTeamId)) return 'full';
    const recordLevel = normaliseVisibilityLevel(recordVisibilityLevel);
    const granted = matrix
      .filter((rule) => rule.target_team_id === ownerTeamId && rule.content_type === contentType)
      .reduce((highest, rule) => maxVisibility(highest, rule.visibility_level), 'none');
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
        team_id: record.team_id,
        team_name: record.team_name,
        visibility,
        redacted: true,
      };
    }
    return null;
  }

  function applyVisibility(auth, matrix, records, contentType, visibilityField) {
    return (records || [])
      .map((record) => redactRecord(record, computeVisibility(auth, matrix, record.team_id, contentType, record[visibilityField] || 'full')))
      .filter(Boolean);
  }

  function applyCalendarVisibility(auth, matrix, records) {
    return (records || [])
      .map((record) => {
        const contentType = record.item_type === 'follow_up' ? 'actions' : 'meetings';
        return redactRecord(record, computeVisibility(auth, matrix, record.team_id, contentType, record.visibility_level || 'summary'));
      })
      .filter(Boolean);
  }

  async function getBootstrapPayload(auth) {
    await assertPermission(auth, 'dashboard.view');
    const [teams, savedFilters, settings, permissionKeys] = await Promise.all([
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
    ]);
    return {
      currentUser: { ...auth, permissionKeys },
      teams,
      savedFilters,
      settings,
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
            "SELECT 'follow_up' AS item_type, a.id, a.student_id, a.team_id, s.first_name, s.last_name,",
            "  a.title, a.summary, 'follow_up' AS interaction_type, COALESCE(a.visibility_level, 'summary') AS visibility_level,",
            '  COALESCE(a.due_at, a.created_at) AS calendar_at, COALESCE(a.due_at, a.created_at) AS occurred_at,',
            '  a.status AS item_status, a.due_at, a.priority, t.name AS team_name,',
            '  u.display_name AS assigned_user_name',
            'FROM actions a',
            'JOIN students s ON s.id = a.student_id AND s.deleted_at IS NULL',
            'LEFT JOIN teams t ON t.id = a.team_id',
            'LEFT JOIN users u ON u.id = a.owner_user_id',
            "WHERE a.deleted_at IS NULL AND a.owner_user_id = $1 AND a.status IN ('open', 'in_progress')",
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
            '  t.name AS team_name, u.display_name AS submitted_by_name',
            'FROM concerns c',
            'JOIN students s ON s.id = c.student_id AND s.deleted_at IS NULL',
            'LEFT JOIN teams t ON t.id = c.team_id',
            'LEFT JOIN users u ON u.id = c.submitted_by_user_id',
            "WHERE c.deleted_at IS NULL AND t.team_key = 'safeguarding'",
            "  AND c.status IN ('open', 'triage', 'escalated')",
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
          "LEFT JOIN concerns c ON c.team_id = t.id AND c.deleted_at IS NULL AND c.status IN ('open','triage','escalated')",
          'WHERE t.deleted_at IS NULL',
          'GROUP BY t.id',
          'ORDER BY t.name',
        ].join('\n')
      ),
      upcomingFollowUpsQuery,
      safeguardingConcernsQuery,
    ]);

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
        'SELECT s.id, s.student_code, s.first_name, s.last_name, s.preferred_name,',
        '  s.year_group, COALESCE(s.tutor_group, s.form_group) AS tutor_group, s.current_status,',
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
        'GROUP BY s.id, latest.latest_activity_at, latest.open_follow_up, latest.has_open_concern',
        'ORDER BY s.last_name, s.first_name',
        'LIMIT 100',
      ].join('\n'),
      params
    );
    return { students, filter: filterExpression };
  }

  async function createStudent(auth, body) {
    await assertPermission(auth, 'students.manage');
    if (!body.firstName || !body.lastName) throw new AppError('firstName and lastName are required');
    const code = body.studentCode || 'STU-' + Date.now();
    const student = await queryOne(
      [
        'INSERT INTO students (student_code, first_name, last_name, preferred_name, year_group, tutor_group, current_status, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)',
        'RETURNING *',
      ].join('\n'),
      [code, body.firstName, body.lastName, body.preferredName || null, body.yearGroup || null, body.tutorGroup || null, body.status || 'active', auth.userId]
    );
    await writeAuditLog(auth, { areaKey: 'students', actionKey: 'create', entityType: 'student', entityId: student.id, studentId: student.id });
    return { student };
  }

  async function getStudentProfilePayload(auth, studentId) {
    await assertPermission(auth, 'students.view');
    const permissionKeys = await getEffectivePermissionKeys(auth);
    const student = await queryOne(
      [
        'SELECT s.*, COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(',
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

    const [concernsRaw, meetingsRaw, actionsRaw, notesRaw, chronologyRaw, activeSendPlan] = await Promise.all([
      canReviewConcerns ? query(
        [
          'SELECT c.id, c.team_id, t.name AS team_name, t.team_key AS team_key, c.title, c.summary, c.detail,',
          '  c.status, c.category, c.severity, c.urgency, c.confidentiality_level,',
          '  c.outcome_summary, c.referral_type, c.referral_date, c.referral_outcome,',
          '  c.closed_at, c.created_at, c.created_at AS occurred_at,',
          '  closed_by.display_name AS closed_by_name',
          'FROM concerns c',
          'LEFT JOIN teams t ON t.id = c.team_id',
          'LEFT JOIN users closed_by ON closed_by.id = c.closed_by_user_id',
          'WHERE c.student_id = $1 AND c.deleted_at IS NULL',
          'ORDER BY c.created_at DESC',
        ].join('\n'), [studentId]) : [],
      canViewMeetings ? query(
        [
          'SELECT m.id, m.team_id, t.name AS team_name, m.title, m.summary, m.detail,',
          '  m.interaction_type, m.visibility_level, m.occurred_at, m.created_at,',
          '  m.occurred_at AS calendar_at, m.external_agency, m.external_contact_name, m.external_ref,',
          '  u.display_name AS assigned_user_name',
          'FROM meetings m',
          'LEFT JOIN teams t ON t.id = m.team_id',
          'LEFT JOIN users u ON u.id = m.logged_by_user_id',
          'WHERE m.student_id = $1 AND m.deleted_at IS NULL',
          'ORDER BY m.occurred_at DESC',
        ].join('\n'), [studentId]) : [],
      canManageActions ? query('SELECT a.id, a.team_id, t.name AS team_name, a.title, a.summary, a.status, a.priority, a.due_at, a.completed_at, a.created_at, COALESCE(a.due_at, a.created_at) AS occurred_at, a.due_at AS calendar_at, COALESCE(a.visibility_level, \'summary\') AS visibility_level, u.display_name AS assigned_user_name FROM actions a LEFT JOIN teams t ON t.id = a.team_id LEFT JOIN users u ON u.id = a.owner_user_id WHERE a.student_id = $1 AND a.deleted_at IS NULL ORDER BY COALESCE(a.due_at, a.created_at) DESC', [studentId]) : [],
      canViewNotes ? query('SELECT n.id, n.team_id, t.name AS team_name, n.summary AS title, n.summary, n.body, n.note_type, n.visibility_level, n.created_at, n.created_at AS occurred_at FROM notes n LEFT JOIN teams t ON t.id = n.team_id WHERE n.student_id = $1 AND n.deleted_at IS NULL ORDER BY n.created_at DESC', [studentId]) : [],
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
    ]);
    // Attach linked follow-ups (actions with concern_id) to each concern
    const linkedActions = canManageActions ? await query(
      'SELECT a.id, a.concern_id, a.title, a.summary, a.status, a.priority, a.due_at, a.created_at, t.name AS team_name FROM actions a LEFT JOIN teams t ON t.id = a.team_id WHERE a.student_id = $1 AND a.concern_id IS NOT NULL AND a.deleted_at IS NULL ORDER BY a.created_at DESC',
      [studentId]
    ) : [];
    concernsRaw.forEach(c => { c.linkedFollowUps = linkedActions.filter(a => a.concern_id === c.id); });

    const linkedNotes = canViewNotes ? await query(
      'SELECT n.id, n.concern_id, n.summary AS title, n.summary, n.body, n.created_at, t.name AS team_name FROM notes n LEFT JOIN teams t ON t.id = n.team_id WHERE n.student_id = $1 AND n.concern_id IS NOT NULL AND n.deleted_at IS NULL ORDER BY n.created_at DESC',
      [studentId]
    ) : [];
    concernsRaw.forEach(c => { c.linkedNotes = linkedNotes.filter(n => n.concern_id === c.id); });

    // Derive radar badges from open concerns (does not replace the radar table query)
    const derivedRadar = {};
    (concernsRaw || [])
      .filter(c => ['open', 'triage', 'escalated'].includes(c.status) && c.team_id)
      .forEach(c => {
        if (!derivedRadar[c.team_id]) {
          derivedRadar[c.team_id] = { team_id: c.team_id, team_name: c.team_name, team_key: c.team_key || null, status: 'active', severity: c.severity };
        } else if (['high', 'medium', 'low'].indexOf(c.severity) < ['high', 'medium', 'low'].indexOf(derivedRadar[c.team_id].severity)) {
          derivedRadar[c.team_id].severity = c.severity;
        }
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

  async function createConcern(auth, body) {
    await assertPermission(auth, 'concerns.create');
    if (!body.studentId || !body.title || !body.summary) throw new AppError('studentId, title, and summary are required');
    const referralType = body.referralType || null;
    if (referralType && !VALID_REFERRAL_TYPES.includes(referralType)) {
      throw new AppError('Invalid referral_type: ' + referralType);
    }
    const incidentType = body.incidentType || null;
    if (incidentType && !VALID_INCIDENT_TYPES.includes(incidentType)) {
      throw new AppError('Invalid incident_type: ' + incidentType);
    }
    const sanctionType = body.sanctionType || null;
    if (sanctionType && !VALID_SANCTION_TYPES.includes(sanctionType)) {
      throw new AppError('Invalid sanction_type: ' + sanctionType);
    }
    // Derive confidentiality from the team's key: safeguarding team = safeguarding confidentiality.
    let isSafeguarding = false;
    if (body.teamId) {
      const teamRow = await queryOne('SELECT team_key FROM teams WHERE id = $1', [body.teamId]);
      isSafeguarding = teamRow && teamRow.team_key === 'safeguarding';
    }
    const requestedConfidentiality = body.confidentialityLevel || 'summary';
    const confidentialityLevel = isSafeguarding ? 'safeguarding' : (requestedConfidentiality === 'safeguarding' ? 'summary' : requestedConfidentiality);
    const derivedCategory = isSafeguarding ? 'safeguarding' : 'wellbeing';
    const concern = await queryOne(
      [
        'INSERT INTO concerns',
        '  (student_id, concern_ref, team_id, submitted_by_user_id, category, severity, urgency,',
        '   confidentiality_level, title, summary, detail, referral_type, referral_date, referral_outcome,',
        '   incident_type, sanction_type, sanction_duration, behaviour_plan_active,',
        '   created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $4, $4) RETURNING *',
      ].join('\n'),
      [
        body.studentId, 'CON-' + Date.now(), body.teamId || null, auth.userId,
        derivedCategory, body.severity || 'medium', body.urgency || 'standard', confidentialityLevel,
        body.title, body.summary, body.detail || null,
        referralType, body.referralDate || null, body.referralOutcome || null,
        incidentType, sanctionType, body.sanctionDuration || null, body.behaviourPlanActive === true,
      ]
    );
    await addChronology(auth, body.studentId, 'concerns', concern.id, 'concern_logged', body.teamId, body.title, body.summary, body.detail, 'summary', null, null, null, null, null);
    await writeAuditLog(auth, { areaKey: 'concerns', actionKey: 'create', entityType: 'concern', entityId: concern.id, studentId: body.studentId, metadata: { severity: body.severity, teamId: body.teamId } });
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
    await addChronology(
      auth, existing.student_id, 'concerns', concernId, 'concern_logged',
      existing.team_id,
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

    const referralType = body.referralType !== undefined ? body.referralType : existing.referral_type;
    if (referralType && !VALID_REFERRAL_TYPES.includes(referralType)) throw new AppError('Invalid referral_type: ' + referralType);
    const incidentType = body.incidentType !== undefined ? body.incidentType : existing.incident_type;
    if (incidentType && !VALID_INCIDENT_TYPES.includes(incidentType)) throw new AppError('Invalid incident_type: ' + incidentType);
    const sanctionType = body.sanctionType !== undefined ? body.sanctionType : existing.sanction_type;
    if (sanctionType && !VALID_SANCTION_TYPES.includes(sanctionType)) throw new AppError('Invalid sanction_type: ' + sanctionType);
    const teamId = body.teamId !== undefined ? (body.teamId || null) : existing.team_id;
    let isSafeguarding = false;
    if (teamId) {
      const teamRow = await queryOne('SELECT team_key FROM teams WHERE id = $1', [teamId]);
      isSafeguarding = teamRow && teamRow.team_key === 'safeguarding';
    }
    const requestedConfidentiality = body.confidentialityLevel !== undefined ? (body.confidentialityLevel || 'summary') : (existing.confidentiality_level || 'summary');
    const confidentialityLevel = isSafeguarding ? 'safeguarding' : (requestedConfidentiality === 'safeguarding' ? 'summary' : requestedConfidentiality);
    const derivedCategory = isSafeguarding ? 'safeguarding' : (existing.category === 'safeguarding' ? 'wellbeing' : existing.category);

    const concern = await queryOne(
      [
        'UPDATE concerns SET',
        '  title = $1, summary = $2, severity = $3, team_id = $4,',
        '  category = $5, confidentiality_level = $6,',
        '  referral_type = $7, referral_date = $8, referral_outcome = $9,',
        '  incident_type = $10, sanction_type = $11, sanction_duration = $12,',
        '  behaviour_plan_active = $13,',
        '  updated_at = NOW(), updated_by = $14',
        'WHERE id = $15 AND deleted_at IS NULL RETURNING *',
      ].join('\n'),
      [
        body.title || existing.title,
        body.summary || existing.summary,
        body.severity || existing.severity,
        teamId,
        derivedCategory,
        confidentialityLevel,
        referralType,
        body.referralDate !== undefined ? (body.referralDate || null) : existing.referral_date,
        body.referralOutcome !== undefined ? (body.referralOutcome || null) : existing.referral_outcome,
        incidentType || null,
        sanctionType || null,
        body.sanctionDuration !== undefined ? (body.sanctionDuration || null) : existing.sanction_duration,
        body.behaviourPlanActive !== undefined ? body.behaviourPlanActive === true : existing.behaviour_plan_active,
        auth.userId,
        concernId,
      ]
    );
    await writeAuditLog(auth, { areaKey: 'concerns', actionKey: 'update', entityType: 'concern', entityId: concernId, studentId: existing.student_id, metadata: { severity: body.severity, teamId } });
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
    const meeting = await queryOne(
      [
        'INSERT INTO meetings',
        '  (student_id, team_id, logged_by_user_id, interaction_type, visibility_level, confidentiality_level,',
        '   title, summary, detail, occurred_at, external_agency, external_contact_name, external_ref,',
        '   created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $3, $3) RETURNING *',
      ].join('\n'),
      [
        body.studentId, body.teamId || null, auth.userId,
        body.interactionType, body.visibilityLevel || 'summary', body.confidentialityLevel || 'summary',
        body.title, body.summary, body.detail || null, body.occurredAt,
        body.externalAgency || null, body.externalContactName || null, body.externalRef || null,
      ]
    );
    const eventType = body.externalAgency && body.externalAgency !== '' ? 'external_agency_contact' : 'meeting_logged';
    await addChronology(auth, body.studentId, 'meetings', meeting.id, eventType, body.teamId, body.title, body.summary, body.detail, body.visibilityLevel || 'summary', body.occurredAt);
    return { meeting };
  }

  async function createNote(auth, body) {
    await assertPermission(auth, 'notes.create');
    if (!body.studentId || !body.summary || !body.body) throw new AppError('studentId, summary, and body are required');
    const note = await queryOne(
      [
        'INSERT INTO notes (student_id, team_id, author_user_id, note_type, visibility_level, confidentiality_level, summary, body, concern_id, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $3, $3) RETURNING *',
      ].join('\n'),
      [body.studentId, body.teamId || null, auth.userId, body.noteType || 'case_note', body.visibilityLevel || 'summary', body.confidentialityLevel || 'restricted', body.summary, body.body, body.concernId || null]
    );
    await addChronology(auth, body.studentId, 'notes', note.id, 'note_added', body.teamId, body.summary, body.summary, body.body, body.visibilityLevel || 'summary');
    return { note };
  }

  async function createFollowUp(auth, body) {
    await assertPermission(auth, 'actions.manage');
    if (!body.studentId || !body.title || !body.summary) throw new AppError('studentId, title, and summary are required');
    const action = await queryOne(
      [
        'INSERT INTO actions (student_id, team_id, owner_user_id, title, summary, status, priority, due_at, visibility_level, concern_id, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $3, $3) RETURNING *',
      ].join('\n'),
      [body.studentId, body.teamId || null, body.ownerUserId || auth.userId, body.title, body.summary, body.status || 'open', body.priority || 'medium', body.dueAt || null, body.visibilityLevel || 'summary', body.concernId || null]
    );
    await addChronology(auth, body.studentId, 'actions', action.id, 'follow_up_created', body.teamId, body.title, body.summary, null, 'summary');
    return { action };
  }

  async function updateStudentStatus(auth, body) {
    await assertPermission(auth, 'students.manage');
    if (!body.studentId || !body.status) throw new AppError('studentId and status are required');
    const student = await queryOne('UPDATE students SET current_status = $1, updated_at = NOW(), updated_by = $2 WHERE id = $3 AND deleted_at IS NULL RETURNING *', [body.status, auth.userId, body.studentId]);
    await addChronology(auth, body.studentId, 'students', body.studentId, 'status_changed', null, 'Status changed', 'Status changed to ' + body.status, null, 'summary');
    return { student };
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
        "  SELECT 'meeting' AS item_type, m.id, m.student_id, m.team_id, s.first_name, s.last_name, s.year_group,",
        '    m.title, m.summary, m.detail, m.interaction_type, m.visibility_level, m.occurred_at AS calendar_at,',
        '    m.occurred_at, m.created_at, m.logged_by_user_id AS assigned_user_id, u.display_name AS assigned_user_name,',
        "    'scheduled'::text AS item_status, NULL::timestamptz AS due_at, NULL::timestamptz AS completed_at, NULL::text AS priority,",
        '    t.name AS team_name',
        '  FROM meetings m',
        '  JOIN students s ON s.id = m.student_id',
        '  LEFT JOIN teams t ON t.id = m.team_id',
        '  LEFT JOIN users u ON u.id = m.logged_by_user_id',
        '  WHERE m.deleted_at IS NULL AND s.deleted_at IS NULL',
        '  UNION ALL',
        "  SELECT 'follow_up' AS item_type, a.id, a.student_id, a.team_id, s.first_name, s.last_name, s.year_group,",
        "    a.title, a.summary, NULL::text AS detail, 'follow_up' AS interaction_type, COALESCE(a.visibility_level, 'summary') AS visibility_level,",
        '    COALESCE(a.due_at, a.created_at) AS calendar_at, COALESCE(a.due_at, a.created_at) AS occurred_at, a.created_at,',
        '    a.owner_user_id AS assigned_user_id, u.display_name AS assigned_user_name, a.status AS item_status,',
        '    a.due_at, a.completed_at, a.priority, t.name AS team_name',
        '  FROM actions a',
        '  JOIN students s ON s.id = a.student_id',
        '  LEFT JOIN teams t ON t.id = a.team_id',
        '  LEFT JOIN users u ON u.id = a.owner_user_id',
        '  WHERE a.deleted_at IS NULL AND s.deleted_at IS NULL',
        ') m',
        'WHERE ' + filterSql + ' AND ' + searchSql,
        '  AND (m.assigned_user_id = $' + (params.length + 1),
        '    OR m.team_id IS NULL',
        '    OR m.team_id = ANY($' + (params.length + 2) + '::uuid[])',
        '    OR EXISTS (',
        '      SELECT 1 FROM team_visibility_rules tvr',
        '      WHERE tvr.deleted_at IS NULL',
        '        AND tvr.source_team_id = ANY($' + (params.length + 2) + '::uuid[])',
        '        AND tvr.target_team_id = m.team_id',
        "        AND tvr.content_type IN ('meetings', 'actions')",
        "        AND tvr.visibility_level <> 'none'",
        '    )',
        '  )',
        'ORDER BY m.calendar_at ASC LIMIT 150',
      ].join('\n'),
      params.concat([auth.userId, auth.teamIds])
    );
    const matrix = await getVisibilityMatrix(auth.teamIds);
    return { meetings: applyCalendarVisibility(auth, matrix, rows), filter: filterExpression };
  }

  async function getSettingsReferencePayload(auth) {
    await assertPermission(auth, 'settings.view');
    const [users, roles, permissions, teams, visibilityRules, savedFilters, userRoles] = await Promise.all([
      query('SELECT id, email, display_name, primary_team_id, is_active FROM users WHERE deleted_at IS NULL ORDER BY display_name'),
      query('SELECT id, role_key, name, description, is_system, is_editable FROM roles WHERE deleted_at IS NULL ORDER BY name'),
      query('SELECT id, permission_key, area_key, action_key, description FROM permissions ORDER BY permission_key'),
      query('SELECT id, team_key, name, description, accent_color, is_active FROM teams WHERE deleted_at IS NULL ORDER BY name'),
      query('SELECT tvr.id, tvr.source_team_id, source_team.name AS source_team_name, tvr.target_team_id, target_team.name AS target_team_name, tvr.content_type, tvr.visibility_level FROM team_visibility_rules tvr JOIN teams source_team ON source_team.id = tvr.source_team_id JOIN teams target_team ON target_team.id = tvr.target_team_id WHERE tvr.deleted_at IS NULL ORDER BY source_team.name, target_team.name, tvr.content_type'),
      query('SELECT id, area_key, name, filter_expression, is_shared FROM saved_filters WHERE deleted_at IS NULL ORDER BY area_key, name'),
      query('SELECT ur.user_id, ur.role_id, u.display_name AS user_name, u.email AS user_email, r.role_key, r.name AS role_name FROM user_roles ur JOIN users u ON u.id = ur.user_id AND u.deleted_at IS NULL JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL ORDER BY u.display_name, r.name'),
      query('SELECT ut.user_id, ut.team_id, t.name AS team_name FROM user_teams ut JOIN teams t ON t.id = ut.team_id AND t.deleted_at IS NULL ORDER BY t.name'),
    ]);
    return { users, roles, permissions, teams, visibilityRules, savedFilters, userRoles, userTeams };
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
    const user = await queryOne('INSERT INTO users (email, display_name, primary_team_id, is_active, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (email) DO UPDATE SET display_name = EXCLUDED.display_name, primary_team_id = EXCLUDED.primary_team_id, is_active = EXCLUDED.is_active, updated_at = NOW(), updated_by = EXCLUDED.updated_by RETURNING *', [String(body.email).toLowerCase(), body.displayName, body.primaryTeamId || null, body.isActive !== false, auth.userId]);
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
    const visibilityRule = await queryOne('INSERT INTO team_visibility_rules (source_team_id, target_team_id, content_type, visibility_level, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $5) ON CONFLICT (source_team_id, target_team_id, content_type) DO UPDATE SET visibility_level = EXCLUDED.visibility_level, updated_at = NOW(), updated_by = EXCLUDED.updated_by RETURNING *', [body.sourceTeamId, body.targetTeamId, body.contentType, body.visibilityLevel, auth.userId]);
    await writeAuditLog(auth, { areaKey: 'settings.visibility', actionKey: 'upsert', entityType: 'team_visibility_rule', entityId: visibilityRule.id, targetTeamId: body.targetTeamId });
    return { visibilityRule };
  }

  async function saveFilter(auth, body) {
    await assertPermission(auth, 'settings.view');
    if (!body.areaKey || !body.name || !body.filterExpression) throw new AppError('areaKey, name, and filterExpression are required');
    const savedFilter = await queryOne('INSERT INTO saved_filters (owner_user_id, area_key, name, filter_expression, is_shared, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $1, $1) RETURNING *', [auth.userId, body.areaKey, body.name, body.filterExpression, body.isShared === true && auth.isAdmin]);
    return { savedFilter };
  }

  async function getAuditLogsPayload(auth) {
    await assertPermission(auth, 'audit.view');
    const auditLogs = await query('SELECT a.id, a.area_key, a.action_key, a.entity_type, a.created_at, u.display_name AS actor_name, s.student_code, s.first_name, s.last_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_user_id LEFT JOIN students s ON s.id = a.student_id ORDER BY a.created_at DESC LIMIT 100');
    return { auditLogs };
  }

  async function dispatch(request) {
    const auth = await loadAuthContext();
    const path = request?.path ? decodeURIComponent(request.path) : '/api/bootstrap';
    const method = (request?.method || 'get').toLowerCase();
    const payload = request?.payload || {};
    const requestQuery = request?.query || {};

    if (method === 'get' && path === '/api/bootstrap') return getBootstrapPayload(auth);
    if (method === 'get' && path === '/api/dashboard') return getDashboardPayload(auth);
    if (method === 'get' && path === '/api/students') return getStudentsPayload(auth, requestQuery);
    if (method === 'post' && path === '/api/students') return createStudent(auth, payload);
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
    if (method === 'post' && path === '/api/students/status') return updateStudentStatus(auth, payload);
    if (method === 'get' && path === '/api/settings/reference') return getSettingsReferencePayload(auth);
    if (method === 'post' && path === '/api/settings/users') return saveUser(auth, payload);
    if (method === 'post' && path === '/api/settings/roles') return saveRole(auth, payload);
    if (method === 'post' && path === '/api/settings/teams') return saveTeam(auth, payload);
    if (method === 'post' && path === '/api/settings/visibility-rules') return saveVisibilityRule(auth, payload);
    if (method === 'post' && path === '/api/settings/user-roles') return assignUserRole(auth, payload);
    if (method === 'post' && path === '/api/settings/user-teams') return assignUserTeam(auth, payload);
    if (method === 'post' && path === '/api/saved-filters') return saveFilter(auth, payload);
    if (method === 'get' && path === '/api/audit-logs') return getAuditLogsPayload(auth);
    throw new AppError('Route not found: ' + path, 404);
  }

  return { dispatch };
}

function compactUnique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export {
  AppError,
  createApi,
  hmacHex,
  persistSignedRequestNonce,
  timingSafeEqual,
  verifySignedAppsScriptRequest,
  workerQuery,
  VALID_REFERRAL_TYPES,
  VALID_SEND_CATEGORIES,
  VALID_INCIDENT_TYPES,
  VALID_SANCTION_TYPES,
};
