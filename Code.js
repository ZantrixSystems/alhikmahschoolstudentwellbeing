const VISIBILITY_LEVELS = ['none', 'indicator', 'summary', 'full'];
const FILTER_OPERATORS = ['=isnull=', '=in=', '=out=', '==', '!=', '>=', '<=', '>', '<'];

function AppError(message, statusCode, details) {
  const error = new Error(message);
  error.statusCode = statusCode || 400;
  error.details = details || null;
  return error;
}

function getConfig_() {
  const properties = PropertiesService.getScriptProperties();
  const databaseUrl = properties.getProperty('NEON_DATABASE_URL');
  if (!databaseUrl) {
    throw new Error('Missing script property. Set NEON_DATABASE_URL.');
  }
  return { databaseUrl: databaseUrl };
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Al Hikmah Student Wellbeing')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function buildNeonSqlEndpoint_(connectionString) {
  const hostMatch = connectionString.match(/@([^\/\?:]+)/);
  if (!hostMatch) {
    throw new Error('Could not parse Neon host from connection string.');
  }
  return 'https://' + hostMatch[1].replace(/^[^.]+\./, 'api.') + '/sql';
}

function mapNeonRows_(result) {
  const rows = result.rows || [];
  if (!rows.length || !Array.isArray(rows[0])) {
    return rows;
  }
  const fields = result.fields || [];
  return rows.map(function (row) {
    const mapped = {};
    fields.forEach(function (field, index) {
      mapped[field.name] = row[index];
    });
    return mapped;
  });
}

function neonQuery_(query, params) {
  const config = getConfig_();
  const response = UrlFetchApp.fetch(buildNeonSqlEndpoint_(config.databaseUrl), {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'Neon-Connection-String': config.databaseUrl,
      'Neon-Array-Mode': 'true',
    },
    payload: JSON.stringify({
      query: query,
      params: params || [],
    }),
    muteHttpExceptions: true,
  });

  const statusCode = response.getResponseCode();
  const text = response.getContentText();
  if (statusCode >= 400) {
    throw new Error('Neon query failed: ' + statusCode + ' ' + text);
  }

  return mapNeonRows_(JSON.parse(text));
}

function neonQueryOne_(query, params) {
  return neonQuery_(query, params)[0] || null;
}

function getCurrentUserContext_() {
  const email = (Session.getActiveUser().getEmail() || '').trim().toLowerCase();
  if (!email) {
    throw new Error(
      'Unable to resolve signed-in Google Workspace user email. Deploy the web app to your school domain and access it with an authorised account.'
    );
  }
  return {
    email: email,
    domain: email.split('@')[1] || '',
  };
}

function getAppSettings_(keys) {
  const rows = neonQuery_(
    'SELECT key, value FROM app_settings WHERE key = ANY($1::text[])',
    [keys]
  );
  const settings = {};
  rows.forEach(function (row) {
    settings[row.key] = row.value;
  });
  return settings;
}

function assertDomainAllowed_(email) {
  const settings = getAppSettings_([
    'auth.allowedDomains',
    'auth.enforceDomainRestriction',
  ]);
  if (settings['auth.enforceDomainRestriction'] !== true) return;
  const allowedDomains = settings['auth.allowedDomains'] || [];
  const domain = String(email || '').split('@')[1] || '';
  if (allowedDomains.indexOf(domain) === -1) {
    throw AppError('Domain is not allowed for this app', 403);
  }
}

function loadAuthContext_() {
  const user = getCurrentUserContext_();
  assertDomainAllowed_(user.email);

  const row = neonQueryOne_(
    [
      'SELECT',
      '  u.id,',
      '  u.email,',
      '  u.display_name,',
      '  u.primary_team_id,',
      '  u.is_active,',
      '  COALESCE(',
      '    ARRAY_AGG(DISTINCT r.role_key) FILTER (WHERE r.role_key IS NOT NULL),',
      '    ARRAY[]::text[]',
      '  ) AS role_keys,',
      '  COALESCE(',
      '    ARRAY_AGG(DISTINCT ut.team_id) FILTER (WHERE ut.team_id IS NOT NULL),',
      '    ARRAY[]::uuid[]',
      '  ) AS team_ids',
      'FROM users u',
      'LEFT JOIN user_roles ur ON ur.user_id = u.id',
      'LEFT JOIN roles r ON r.id = ur.role_id AND r.deleted_at IS NULL',
      'LEFT JOIN user_teams ut ON ut.user_id = u.id',
      'WHERE LOWER(u.email) = LOWER($1)',
      '  AND u.deleted_at IS NULL',
      'GROUP BY u.id',
    ].join('\n'),
    [user.email]
  );

  if (!row || !row.is_active) {
    throw AppError('User is not authorised for this app', 403);
  }

  const roleKeys = row.role_keys || [];
  const teamIds = [];
  if (row.primary_team_id) teamIds.push(row.primary_team_id);
  (row.team_ids || []).forEach(function (teamId) {
    if (teamId && teamIds.indexOf(teamId) === -1) teamIds.push(teamId);
  });

  return {
    userId: row.id,
    email: row.email,
    displayName: row.display_name,
    roleKeys: roleKeys,
    teamIds: teamIds,
    isAdmin: roleKeys.indexOf('admin') !== -1,
  };
}

function getEffectivePermissionKeys_(auth) {
  if (auth.isAdmin) return ['*'];
  return neonQuery_(
    [
      'SELECT DISTINCT p.permission_key',
      'FROM user_roles ur',
      'JOIN role_permissions rp ON rp.role_id = ur.role_id',
      'JOIN permissions p ON p.id = rp.permission_id',
      'WHERE ur.user_id = $1',
      'ORDER BY p.permission_key',
    ].join('\n'),
    [auth.userId]
  ).map(function (row) {
    return row.permission_key;
  });
}

function assertPermission_(auth, permissionKey) {
  if (auth.isAdmin) return;
  const row = neonQueryOne_(
    [
      'SELECT 1',
      'FROM user_roles ur',
      'JOIN role_permissions rp ON rp.role_id = ur.role_id',
      'JOIN permissions p ON p.id = rp.permission_id',
      'WHERE ur.user_id = $1',
      '  AND p.permission_key = $2',
      'LIMIT 1',
    ].join('\n'),
    [auth.userId, permissionKey]
  );
  if (!row) throw AppError('Missing permission: ' + permissionKey, 403);
}

function writeAuditLog_(auth, payload) {
  neonQuery_(
    [
      'INSERT INTO audit_logs (',
      '  actor_user_id, area_key, action_key, entity_type, entity_id, student_id, target_team_id, metadata',
      ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)',
    ].join('\n'),
    [
      auth && auth.userId ? auth.userId : null,
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

function pushSqlParam_(params, value) {
  params.push(value);
  return '$' + params.length;
}

function normaliseValue_(value) {
  if (Array.isArray(value)) return value.map(normaliseValue_);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value !== '' && !isNaN(Number(value))) return Number(value);
  return value;
}

function tokenizeFilter_(input) {
  const tokens = [];
  let index = 0;
  while (index < input.length) {
    const ch = input[index];
    if (/\s/.test(ch)) {
      index += 1;
      continue;
    }
    if (['(', ')', ';', ','].indexOf(ch) !== -1) {
      tokens.push({ type: ch, value: ch });
      index += 1;
      continue;
    }
    const operator = FILTER_OPERATORS.find(function (candidate) {
      return input.indexOf(candidate, index) === index;
    });
    if (operator) {
      tokens.push({ type: 'operator', value: operator });
      index += operator.length;
      continue;
    }
    let value = '';
    while (index < input.length) {
      const nextOperator = FILTER_OPERATORS.find(function (candidate) {
        return input.indexOf(candidate, index) === index;
      });
      if (/\s/.test(input[index]) || ['(', ')', ';', ','].indexOf(input[index]) !== -1 || nextOperator) {
        break;
      }
      value += input[index];
      index += 1;
    }
    if (!value) throw AppError('Invalid filter token near "' + input.slice(index, index + 12) + '"');
    tokens.push({ type: 'literal', value: value });
  }
  return tokens;
}

function parseFilter_(input) {
  if (!input) return null;
  const tokens = tokenizeFilter_(input);
  let cursor = 0;

  function peek() {
    return tokens[cursor];
  }
  function consume(expectedType) {
    const token = tokens[cursor];
    if (!token || token.type !== expectedType) {
      throw AppError('Expected ' + expectedType + ' in filter expression');
    }
    cursor += 1;
    return token;
  }
  function parseValueToken() {
    const token = peek();
    if (!token) throw AppError('Unexpected end of filter expression');
    if (token.type === 'literal') {
      cursor += 1;
      return token.value;
    }
    if (token.type === '(') {
      consume('(');
      const values = [];
      while (peek() && peek().type !== ')') {
        values.push(parseValueToken());
        if (peek() && peek().type === ',') consume(',');
      }
      consume(')');
      return values;
    }
    throw AppError('Invalid filter value');
  }
  function parseComparison() {
    if (peek() && peek().type === '(') {
      consume('(');
      const nested = parseOr();
      consume(')');
      return nested;
    }
    const field = consume('literal').value;
    const operator = consume('operator').value;
    const value = parseValueToken();
    return { type: 'comparison', field: field, operator: operator, value: value };
  }
  function parseAnd() {
    let left = parseComparison();
    while (peek() && peek().type === ';') {
      consume(';');
      left = { type: 'and', children: [left, parseComparison()] };
    }
    return left;
  }
  function parseOr() {
    let left = parseAnd();
    while (peek() && peek().type === ',') {
      consume(',');
      left = { type: 'or', children: [left, parseAnd()] };
    }
    return left;
  }

  const ast = parseOr();
  if (cursor !== tokens.length) throw AppError('Unexpected trailing filter content');
  return ast;
}

function buildFieldRule_(columnSql, options) {
  options = options || {};
  const allowOperators = options.allowOperators || ['==', '!=', '>=', '<=', '>', '<', '=in=', '=out=', '=isnull='];
  return function (operator, rawValue, params) {
    if (allowOperators.indexOf(operator) === -1) {
      throw AppError('Operator "' + operator + '" is not supported for this field');
    }
    const value = normaliseValue_(rawValue);
    if (operator === '=isnull=') {
      return { sql: columnSql + ' IS ' + (value === true || value === 'true' ? '' : 'NOT ') + 'NULL' };
    }
    if (operator === '=in=' || operator === '=out=') {
      const values = Array.isArray(value) ? value : [value];
      if (!values.length) throw AppError('IN filters require at least one value');
      const placeholders = values.map(function (entry) {
        return pushSqlParam_(params, entry);
      }).join(', ');
      return { sql: columnSql + ' ' + (operator === '=in=' ? 'IN' : 'NOT IN') + ' (' + placeholders + ')' };
    }
    const placeholder = pushSqlParam_(params, value);
    const operatorMap = {
      '==': '=',
      '!=': '<>',
      '>=': '>=',
      '<=': '<=',
      '>': '>',
      '<': '<',
    };
    return { sql: columnSql + ' ' + operatorMap[operator] + ' ' + placeholder };
  };
}

function compileFilter_(ast, fieldMap, params) {
  if (!ast) return { sql: 'TRUE' };
  if (ast.type === 'and' || ast.type === 'or') {
    const joiner = ast.type === 'and' ? ' AND ' : ' OR ';
    return {
      sql: '(' + ast.children.map(function (child) {
        return compileFilter_(child, fieldMap, params).sql;
      }).join(joiner) + ')',
    };
  }
  const rule = fieldMap[ast.field];
  if (!rule) throw AppError('Field "' + ast.field + '" is not filterable');
  return rule(ast.operator, normaliseValue_(ast.value), params);
}

function studentFieldMap_() {
  return {
    status: buildFieldRule_('s.current_status'),
    yearGroup: buildFieldRule_('s.year_group'),
    tutorGroup: buildFieldRule_('s.tutor_group'),
    safeguardingFlag: buildFieldRule_('s.safeguarding_flag', { allowOperators: ['==', '!='] }),
    attendanceConcern: buildFieldRule_('s.attendance_concern', { allowOperators: ['==', '!='] }),
    createdAt: buildFieldRule_('s.created_at'),
    radarTeam: function (operator, value, params) {
      if (operator !== '==' && operator !== '=in=') throw AppError('radarTeam only supports == and =in=');
      const values = Array.isArray(value) ? value : [value];
      const placeholders = values.map(function (entry) {
        return pushSqlParam_(params, entry);
      }).join(', ');
      return {
        sql: [
          'EXISTS (',
          '  SELECT 1',
          '  FROM student_team_radar str',
          '  JOIN teams t ON t.id = str.team_id',
          '  WHERE str.student_id = s.id',
          '    AND str.deleted_at IS NULL',
          "    AND str.status IN ('active', 'monitoring')",
          '    AND t.team_key IN (' + placeholders + ')',
          ')',
        ].join('\n'),
      };
    },
    hasOpenConcern: function (operator, value, params) {
      if (operator !== '==') throw AppError('hasOpenConcern only supports ==');
      const expected = pushSqlParam_(params, normaliseValue_(value));
      return {
        sql: [
          '(EXISTS (',
          '  SELECT 1',
          '  FROM concerns c',
          '  WHERE c.student_id = s.id',
          '    AND c.deleted_at IS NULL',
          "    AND c.status IN ('open', 'triage', 'escalated')",
          ') = ' + expected + ')',
        ].join('\n'),
      };
    },
  };
}

function concernFieldMap_() {
  return {
    status: buildFieldRule_('c.status'),
    category: buildFieldRule_('c.category'),
    severity: buildFieldRule_('c.severity'),
    teamId: buildFieldRule_('c.team_id'),
    createdAt: buildFieldRule_('c.created_at'),
    assignedTo: buildFieldRule_('c.assigned_to_user_id'),
  };
}

function meetingFieldMap_() {
  return {
    teamId: buildFieldRule_('m.team_id'),
    interactionType: buildFieldRule_('m.interaction_type'),
    createdAt: buildFieldRule_('m.created_at'),
    occurredAt: buildFieldRule_('m.occurred_at'),
  };
}

function maxVisibility_(left, right) {
  return VISIBILITY_LEVELS[Math.max(VISIBILITY_LEVELS.indexOf(left), VISIBILITY_LEVELS.indexOf(right))];
}

function getVisibilityMatrix_(teamIds) {
  if (!teamIds || !teamIds.length) return [];
  return neonQuery_(
    [
      'SELECT source_team_id, target_team_id, content_type, visibility_level',
      'FROM team_visibility_rules',
      'WHERE deleted_at IS NULL',
      '  AND source_team_id = ANY($1::uuid[])',
    ].join('\n'),
    [teamIds]
  );
}

function computeVisibility_(auth, matrix, ownerTeamId, contentType, recordVisibilityLevel) {
  if (auth.isAdmin || !ownerTeamId) return 'full';
  if (auth.teamIds.indexOf(ownerTeamId) !== -1) return 'full';
  const matching = matrix.filter(function (rule) {
    return rule.target_team_id === ownerTeamId && rule.content_type === contentType;
  });
  const granted = matching.reduce(function (highest, rule) {
    return maxVisibility_(highest, rule.visibility_level);
  }, 'none');
  return VISIBILITY_LEVELS[
    Math.min(
      VISIBILITY_LEVELS.indexOf(granted),
      VISIBILITY_LEVELS.indexOf(recordVisibilityLevel || 'full')
    )
  ];
}

function redactRecord_(record, visibility) {
  if (visibility === 'full') {
    const full = Object.assign({}, record);
    full.visibility = visibility;
    return full;
  }
  if (visibility === 'summary') {
    const redacted = Object.assign({}, record);
    redacted.visibility = visibility;
    delete redacted.detail;
    delete redacted.body;
    return redacted;
  }
  if (visibility === 'indicator') {
    return {
      id: record.id,
      title: record.title,
      summary: record.summary,
      occurred_at: record.occurred_at,
      created_at: record.created_at,
      team_id: record.team_id,
      team_name: record.team_name,
      visibility: visibility,
      redacted: true,
    };
  }
  return null;
}

function applyVisibility_(auth, matrix, records, contentType, visibilityField) {
  return (records || []).map(function (record) {
    return redactRecord_(
      record,
      computeVisibility_(auth, matrix, record.team_id, contentType, record[visibilityField] || 'full')
    );
  }).filter(Boolean);
}

function getBootstrapPayload_(auth) {
  assertPermission_(auth, 'dashboard.view');
  const teams = neonQuery_('SELECT id, team_key, name, accent_color FROM teams WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY name');
  const savedFilters = neonQuery_(
    [
      'SELECT id, area_key, name, filter_expression, is_shared',
      'FROM saved_filters',
      'WHERE deleted_at IS NULL',
      '  AND (owner_user_id = $1 OR is_shared = TRUE)',
      'ORDER BY area_key, name',
    ].join('\n'),
    [auth.userId]
  );
  const settings = getAppSettings_(['app.name', 'app.mode', 'auth.allowedDomains', 'auth.enforceDomainRestriction']);
  const permissionKeys = getEffectivePermissionKeys_(auth);
  return {
    currentUser: {
      userId: auth.userId,
      email: auth.email,
      displayName: auth.displayName,
      roleKeys: auth.roleKeys,
      teamIds: auth.teamIds,
      isAdmin: auth.isAdmin,
      permissionKeys: permissionKeys,
    },
    teams: teams,
    savedFilters: savedFilters,
    settings: settings,
    navigation: [
      { key: 'dashboard', label: 'Dashboard' },
      { key: 'students', label: 'Students' },
      { key: 'concerns', label: 'Concerns' },
      { key: 'meetings', label: 'Meetings' },
      { key: 'settings', label: 'Settings' },
    ],
  };
}

function getDashboardPayload_(auth) {
  assertPermission_(auth, 'dashboard.view');
  const headline = neonQueryOne_(
    [
      'SELECT',
      '  (SELECT COUNT(*) FROM students WHERE deleted_at IS NULL)::int AS student_count,',
      "  (SELECT COUNT(*) FROM concerns WHERE deleted_at IS NULL AND status IN ('open', 'triage', 'escalated'))::int AS open_concern_count,",
      "  (SELECT COUNT(*) FROM student_team_radar WHERE deleted_at IS NULL AND status IN ('active', 'monitoring'))::int AS active_radar_count,",
      "  (SELECT COUNT(*) FROM actions WHERE deleted_at IS NULL AND status IN ('open', 'in_progress'))::int AS open_action_count",
    ].join('\n')
  );
  const teamLoad = neonQuery_(
    [
      'SELECT t.id, t.name, t.team_key, t.accent_color, COUNT(r.id)::int AS active_students',
      'FROM teams t',
      'LEFT JOIN student_team_radar r',
      '  ON r.team_id = t.id',
      ' AND r.deleted_at IS NULL',
      " AND r.status IN ('active', 'monitoring')",
      'WHERE t.deleted_at IS NULL',
      'GROUP BY t.id',
      'ORDER BY t.name',
    ].join('\n')
  );
  return { headline: headline, teamLoad: teamLoad };
}

function getStudentsPayload_(auth, query) {
  assertPermission_(auth, 'students.view');
  const params = [];
  const filterExpression = query.filter || '';
  const filterSql = compileFilter_(parseFilter_(filterExpression), studentFieldMap_(), params).sql;
  let searchSql = 'TRUE';
  const search = query.q ? String(query.q).trim().toLowerCase() : '';
  if (search) {
    const placeholder = pushSqlParam_(params, '%' + search + '%');
    searchSql = '(LOWER(s.first_name) LIKE ' + placeholder + ' OR LOWER(s.last_name) LIKE ' + placeholder + ' OR LOWER(s.student_code) LIKE ' + placeholder + ')';
  }
  const students = neonQuery_(
    [
      'SELECT',
      '  s.id, s.student_code, s.first_name, s.last_name, s.preferred_name,',
      '  s.year_group, s.tutor_group, s.current_status, s.safeguarding_flag,',
      '  s.attendance_concern, s.notes_summary,',
      '  COALESCE(',
      '    JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(',
      "      'teamName', t.name,",
      "      'teamKey', t.team_key,",
      "      'status', str.status,",
      "      'severity', str.severity,",
      "      'addedAt', str.added_at",
      '    )) FILTER (WHERE str.id IS NOT NULL),',
      "    '[]'::json",
      '  ) AS radar',
      'FROM students s',
      'LEFT JOIN student_team_radar str',
      '  ON str.student_id = s.id',
      ' AND str.deleted_at IS NULL',
      " AND str.status IN ('active', 'monitoring', 'paused')",
      'LEFT JOIN teams t ON t.id = str.team_id',
      'WHERE s.deleted_at IS NULL',
      '  AND ' + filterSql,
      '  AND ' + searchSql,
      'GROUP BY s.id',
      'ORDER BY s.last_name, s.first_name',
      'LIMIT 100',
    ].join('\n'),
    params
  );
  return { students: students, filter: filterExpression };
}

function getStudentProfilePayload_(auth, studentId) {
  assertPermission_(auth, 'students.view');
  const permissionKeys = getEffectivePermissionKeys_(auth);
  const student = neonQueryOne_(
    [
      'SELECT',
      '  s.*,',
      '  COALESCE(',
      '    JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(',
      "      'id', f.id,",
      "      'flagKey', f.flag_key,",
      "      'label', f.label,",
      "      'severity', f.severity,",
      "      'visibilityLevel', f.visibility_level",
      '    )) FILTER (WHERE f.id IS NOT NULL AND f.deleted_at IS NULL AND f.is_active = TRUE),',
      "    '[]'::json",
      '  ) AS flags',
      'FROM students s',
      'LEFT JOIN student_flags f ON f.student_id = s.id',
      'WHERE s.id = $1',
      '  AND s.deleted_at IS NULL',
      'GROUP BY s.id',
    ].join('\n'),
    [studentId]
  );
  if (!student) throw AppError('Student not found', 404);

  const matrix = getVisibilityMatrix_(auth.teamIds);
  const canReviewConcerns = auth.isAdmin || permissionKeys.indexOf('concerns.review') !== -1;
  const canViewMeetings = auth.isAdmin || permissionKeys.indexOf('meetings.view') !== -1;
  const canManageActions = auth.isAdmin || permissionKeys.indexOf('actions.manage') !== -1;
  const canViewChronology = auth.isAdmin || permissionKeys.indexOf('chronology.view') !== -1;

  const radarRaw = neonQuery_(
    [
      'SELECT',
      '  str.id, str.team_id, t.name AS team_name, t.team_key, str.status, str.category,',
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
  const concernsRaw = canReviewConcerns ? neonQuery_(
    [
      'SELECT c.id, c.team_id, t.name AS team_name, c.title, c.summary, c.detail, c.status, c.category,',
      '  c.severity, c.urgency, c.confidentiality_level, c.created_at, c.created_at AS occurred_at',
      'FROM concerns c',
      'LEFT JOIN teams t ON t.id = c.team_id',
      'WHERE c.student_id = $1 AND c.deleted_at IS NULL',
      'ORDER BY c.created_at DESC',
    ].join('\n'),
    [studentId]
  ) : [];
  const meetingsRaw = canViewMeetings ? neonQuery_(
    [
      'SELECT m.id, m.team_id, t.name AS team_name, m.title, m.summary, m.detail, m.interaction_type,',
      '  m.visibility_level, m.occurred_at, m.created_at',
      'FROM meetings m',
      'LEFT JOIN teams t ON t.id = m.team_id',
      'WHERE m.student_id = $1 AND m.deleted_at IS NULL',
      'ORDER BY m.occurred_at DESC',
    ].join('\n'),
    [studentId]
  ) : [];
  const actionsRaw = canManageActions ? neonQuery_(
    [
      'SELECT a.id, a.team_id, t.name AS team_name, a.title, a.summary, a.status, a.priority,',
      '  a.due_at, a.completed_at, a.created_at, a.created_at AS occurred_at',
      'FROM actions a',
      'LEFT JOIN teams t ON t.id = a.team_id',
      'WHERE a.student_id = $1 AND a.deleted_at IS NULL',
      'ORDER BY a.created_at DESC',
    ].join('\n'),
    [studentId]
  ) : [];
  const chronologyRaw = canViewChronology ? neonQuery_(
    [
      'SELECT ce.id, ce.team_id, t.name AS team_name, ce.title, ce.summary, ce.detail, ce.event_type,',
      '  ce.visibility_level, ce.occurred_at, ce.created_at',
      'FROM chronology_events ce',
      'LEFT JOIN teams t ON t.id = ce.team_id',
      'WHERE ce.student_id = $1 AND ce.deleted_at IS NULL',
      'ORDER BY ce.occurred_at DESC',
      'LIMIT 100',
    ].join('\n'),
    [studentId]
  ) : [];

  writeAuditLog_(auth, {
    areaKey: 'students',
    actionKey: 'profile.view',
    entityType: 'student',
    entityId: studentId,
    studentId: studentId,
    metadata: { sensitiveRead: true },
  });

  return {
    profile: student,
    radar: applyVisibility_(auth, matrix, radarRaw, 'radar', 'visibility_level'),
    concerns: applyVisibility_(auth, matrix, concernsRaw, 'concerns', 'confidentiality_level'),
    meetings: applyVisibility_(auth, matrix, meetingsRaw, 'meetings', 'visibility_level'),
    actions: applyVisibility_(auth, matrix, actionsRaw, 'actions', 'visibility_level'),
    chronology: applyVisibility_(auth, matrix, chronologyRaw, 'chronology', 'visibility_level'),
  };
}

function getConcernsPayload_(auth, query) {
  assertPermission_(auth, 'concerns.review');
  const params = [];
  const filterExpression = query.filter || '';
  const filterSql = compileFilter_(parseFilter_(filterExpression), concernFieldMap_(), params).sql;
  let searchSql = 'TRUE';
  const search = query.q ? String(query.q).trim().toLowerCase() : '';
  if (search) {
    const placeholder = pushSqlParam_(params, '%' + search + '%');
    searchSql = '(LOWER(c.title) LIKE ' + placeholder + ' OR LOWER(c.summary) LIKE ' + placeholder + ' OR LOWER(s.first_name) LIKE ' + placeholder + ' OR LOWER(s.last_name) LIKE ' + placeholder + ')';
  }
  const concerns = neonQuery_(
    [
      'SELECT c.id, c.concern_ref, c.student_id, s.first_name, s.last_name, s.year_group,',
      '  c.title, c.summary, c.status, c.category, c.severity, c.urgency, c.confidentiality_level,',
      '  c.created_at, t.name AS team_name',
      'FROM concerns c',
      'JOIN students s ON s.id = c.student_id',
      'LEFT JOIN teams t ON t.id = c.team_id',
      'WHERE c.deleted_at IS NULL',
      '  AND s.deleted_at IS NULL',
      '  AND ' + filterSql,
      '  AND ' + searchSql,
      'ORDER BY c.created_at DESC',
      'LIMIT 100',
    ].join('\n'),
    params
  );
  return { concerns: concerns, filter: filterExpression };
}

function createConcern_(auth, body) {
  assertPermission_(auth, 'concerns.create');
  if (!body.studentId || !body.category || !body.title || !body.summary) {
    throw AppError('studentId, category, title, and summary are required');
  }
  const concernRef = 'CON-' + Date.now();
  const concern = neonQueryOne_(
    [
      'INSERT INTO concerns (',
      '  student_id, concern_ref, team_id, submitted_by_user_id, category, severity, urgency,',
      '  confidentiality_level, title, summary, detail, created_by, updated_by',
      ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $4, $4)',
      'RETURNING *',
    ].join('\n'),
    [
      body.studentId,
      concernRef,
      body.teamId || null,
      auth.userId,
      body.category,
      body.severity || 'medium',
      body.urgency || 'standard',
      body.confidentialityLevel || 'summary',
      body.title,
      body.summary,
      body.detail || null,
    ]
  );
  neonQuery_(
    [
      'INSERT INTO chronology_events (',
      '  student_id, source_table, source_id, event_type, team_id, actor_user_id, visibility_level, confidentiality_level,',
      '  title, summary, detail, created_by',
      ") VALUES ($1, 'concerns', $2, 'concern_logged', $3, $4, $5, $6, $7, $8, $9, $4)",
    ].join('\n'),
    [
      body.studentId,
      concern.id,
      body.teamId || null,
      auth.userId,
      'summary',
      body.confidentialityLevel || 'summary',
      body.title,
      body.summary,
      body.detail || null,
    ]
  );
  return { concern: concern };
}

function getMeetingsPayload_(auth, query) {
  assertPermission_(auth, 'meetings.view');
  const params = [];
  const filterExpression = query.filter || '';
  const filterSql = compileFilter_(parseFilter_(filterExpression), meetingFieldMap_(), params).sql;
  let searchSql = 'TRUE';
  const search = query.q ? String(query.q).trim().toLowerCase() : '';
  if (search) {
    const placeholder = pushSqlParam_(params, '%' + search + '%');
    searchSql = '(LOWER(m.title) LIKE ' + placeholder + ' OR LOWER(m.summary) LIKE ' + placeholder + ' OR LOWER(s.first_name) LIKE ' + placeholder + ' OR LOWER(s.last_name) LIKE ' + placeholder + ')';
  }
  const meetings = neonQuery_(
    [
      'SELECT m.id, m.student_id, s.first_name, s.last_name, s.year_group,',
      '  m.title, m.summary, m.interaction_type, m.visibility_level, m.occurred_at, t.name AS team_name',
      'FROM meetings m',
      'JOIN students s ON s.id = m.student_id',
      'LEFT JOIN teams t ON t.id = m.team_id',
      'WHERE m.deleted_at IS NULL',
      '  AND s.deleted_at IS NULL',
      '  AND ' + filterSql,
      '  AND ' + searchSql,
      'ORDER BY m.occurred_at DESC',
      'LIMIT 100',
    ].join('\n'),
    params
  );
  return { meetings: meetings, filter: filterExpression };
}

function createMeeting_(auth, body) {
  assertPermission_(auth, 'meetings.create');
  if (!body.studentId || !body.interactionType || !body.title || !body.summary || !body.occurredAt) {
    throw AppError('studentId, interactionType, title, summary, and occurredAt are required');
  }
  const meeting = neonQueryOne_(
    [
      'INSERT INTO meetings (',
      '  student_id, team_id, logged_by_user_id, interaction_type, visibility_level, confidentiality_level,',
      '  title, summary, detail, occurred_at, created_by, updated_by',
      ') VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $3, $3)',
      'RETURNING *',
    ].join('\n'),
    [
      body.studentId,
      body.teamId || null,
      auth.userId,
      body.interactionType,
      body.visibilityLevel || 'summary',
      body.confidentialityLevel || 'summary',
      body.title,
      body.summary,
      body.detail || null,
      body.occurredAt,
    ]
  );
  neonQuery_(
    [
      'INSERT INTO chronology_events (',
      '  student_id, source_table, source_id, event_type, team_id, actor_user_id, visibility_level, confidentiality_level,',
      '  title, summary, detail, occurred_at, created_by',
      ") VALUES ($1, 'meetings', $2, 'meeting_logged', $3, $4, $5, $6, $7, $8, $9, $10, $4)",
    ].join('\n'),
    [
      body.studentId,
      meeting.id,
      body.teamId || null,
      auth.userId,
      body.visibilityLevel || 'summary',
      body.confidentialityLevel || 'summary',
      body.title,
      body.summary,
      body.detail || null,
      body.occurredAt,
    ]
  );
  return { meeting: meeting };
}

function getSettingsReferencePayload_(auth) {
  assertPermission_(auth, 'settings.view');
  return {
    users: neonQuery_('SELECT id, email, display_name, primary_team_id, is_active FROM users WHERE deleted_at IS NULL ORDER BY display_name'),
    roles: neonQuery_('SELECT id, role_key, name, description, is_system, is_editable FROM roles WHERE deleted_at IS NULL ORDER BY name'),
    permissions: neonQuery_('SELECT id, permission_key, area_key, action_key, description FROM permissions ORDER BY permission_key'),
    teams: neonQuery_('SELECT id, team_key, name, description, accent_color, is_active FROM teams WHERE deleted_at IS NULL ORDER BY name'),
    visibilityRules: neonQuery_(
      [
        'SELECT tvr.id, tvr.source_team_id, source_team.name AS source_team_name,',
        '  tvr.target_team_id, target_team.name AS target_team_name, tvr.content_type, tvr.visibility_level',
        'FROM team_visibility_rules tvr',
        'JOIN teams source_team ON source_team.id = tvr.source_team_id',
        'JOIN teams target_team ON target_team.id = tvr.target_team_id',
        'WHERE tvr.deleted_at IS NULL',
        'ORDER BY source_team.name, target_team.name, tvr.content_type',
      ].join('\n')
    ),
  };
}

function saveUser_(auth, body) {
  assertPermission_(auth, 'settings.users.manage');
  if (!body.email || !body.displayName) throw AppError('email and displayName are required');
  return {
    user: neonQueryOne_(
      [
        'INSERT INTO users (email, display_name, primary_team_id, is_active, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $5)',
        'ON CONFLICT (email) DO UPDATE',
        'SET display_name = EXCLUDED.display_name, primary_team_id = EXCLUDED.primary_team_id,',
        '    is_active = EXCLUDED.is_active, updated_at = NOW(), updated_by = EXCLUDED.updated_by',
        'RETURNING *',
      ].join('\n'),
      [String(body.email).toLowerCase(), body.displayName, body.primaryTeamId || null, body.isActive !== false, auth.userId]
    ),
  };
}

function saveRole_(auth, body) {
  assertPermission_(auth, 'settings.roles.manage');
  if (!body.roleKey || !body.name) throw AppError('roleKey and name are required');
  const role = neonQueryOne_(
    [
      'INSERT INTO roles (role_key, name, description, is_system, is_editable, created_by, updated_by)',
      'VALUES ($1, $2, $3, FALSE, TRUE, $4, $4)',
      'ON CONFLICT (role_key) DO UPDATE',
      'SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW(), updated_by = EXCLUDED.updated_by',
      'RETURNING *',
    ].join('\n'),
    [body.roleKey, body.name, body.description || '', auth.userId]
  );
  neonQuery_('DELETE FROM role_permissions WHERE role_id = $1', [role.id]);
  if ((body.permissionKeys || []).length) {
    neonQuery_(
      [
        'INSERT INTO role_permissions (role_id, permission_id, created_by)',
        'SELECT $1, p.id, $2',
        'FROM permissions p',
        'WHERE p.permission_key = ANY($3::text[])',
      ].join('\n'),
      [role.id, auth.userId, body.permissionKeys]
    );
  }
  writeAuditLog_(auth, {
    areaKey: 'settings.roles',
    actionKey: 'upsert',
    entityType: 'role',
    entityId: role.id,
    metadata: { roleKey: body.roleKey, permissionKeys: body.permissionKeys || [] },
  });
  return { role: role };
}

function saveTeam_(auth, body) {
  assertPermission_(auth, 'settings.teams.manage');
  if (!body.teamKey || !body.name) throw AppError('teamKey and name are required');
  return {
    team: neonQueryOne_(
      [
        'INSERT INTO teams (team_key, name, description, accent_color, is_active, created_by, updated_by)',
        'VALUES ($1, $2, $3, $4, $5, $6, $6)',
        'ON CONFLICT (team_key) DO UPDATE',
        'SET name = EXCLUDED.name, description = EXCLUDED.description, accent_color = EXCLUDED.accent_color,',
        '    is_active = EXCLUDED.is_active, updated_at = NOW(), updated_by = EXCLUDED.updated_by',
        'RETURNING *',
      ].join('\n'),
      [body.teamKey, body.name, body.description || '', body.accentColor || '#735c00', body.isActive !== false, auth.userId]
    ),
  };
}

function saveVisibilityRule_(auth, body) {
  assertPermission_(auth, 'settings.visibility.manage');
  if (!body.sourceTeamId || !body.targetTeamId || !body.contentType || !body.visibilityLevel) {
    throw AppError('sourceTeamId, targetTeamId, contentType, and visibilityLevel are required');
  }
  const visibilityRule = neonQueryOne_(
    [
      'INSERT INTO team_visibility_rules (source_team_id, target_team_id, content_type, visibility_level, created_by, updated_by)',
      'VALUES ($1, $2, $3, $4, $5, $5)',
      'ON CONFLICT (source_team_id, target_team_id, content_type)',
      'DO UPDATE SET visibility_level = EXCLUDED.visibility_level, updated_at = NOW(), updated_by = EXCLUDED.updated_by',
      'RETURNING *',
    ].join('\n'),
    [body.sourceTeamId, body.targetTeamId, body.contentType, body.visibilityLevel, auth.userId]
  );
  writeAuditLog_(auth, {
    areaKey: 'settings.visibility',
    actionKey: 'upsert',
    entityType: 'team_visibility_rule',
    entityId: visibilityRule.id,
    targetTeamId: body.targetTeamId,
    metadata: {
      sourceTeamId: body.sourceTeamId,
      contentType: body.contentType,
      visibilityLevel: body.visibilityLevel,
    },
  });
  return { visibilityRule: visibilityRule };
}

function getAuditLogsPayload_(auth) {
  assertPermission_(auth, 'audit.view');
  return {
    auditLogs: neonQuery_(
      [
        'SELECT a.id, a.area_key, a.action_key, a.entity_type, a.created_at,',
        '  u.display_name AS actor_name, s.student_code, s.first_name, s.last_name',
        'FROM audit_logs a',
        'LEFT JOIN users u ON u.id = a.actor_user_id',
        'LEFT JOIN students s ON s.id = a.student_id',
        'ORDER BY a.created_at DESC',
        'LIMIT 100',
      ].join('\n')
    ),
  };
}

function apiProxy(request) {
  const auth = loadAuthContext_();
  const path = request && request.path ? decodeURIComponent(request.path) : '/api/bootstrap';
  const method = (request && request.method ? request.method : 'get').toLowerCase();
  const payload = request && request.payload ? request.payload : {};
  const query = request && request.query ? request.query : {};

  if (method === 'get' && path === '/api/bootstrap') return getBootstrapPayload_(auth);
  if (method === 'get' && path === '/api/dashboard') return getDashboardPayload_(auth);
  if (method === 'get' && path === '/api/students') return getStudentsPayload_(auth, query);
  if (method === 'get' && /^\/api\/students\/[^/]+$/.test(path)) {
    return getStudentProfilePayload_(auth, path.split('/')[3]);
  }
  if (method === 'get' && path === '/api/concerns') return getConcernsPayload_(auth, query);
  if (method === 'post' && path === '/api/concerns') return createConcern_(auth, payload);
  if (method === 'get' && path === '/api/meetings') return getMeetingsPayload_(auth, query);
  if (method === 'post' && path === '/api/meetings') return createMeeting_(auth, payload);
  if (method === 'get' && path === '/api/settings/reference') return getSettingsReferencePayload_(auth);
  if (method === 'post' && path === '/api/settings/users') return saveUser_(auth, payload);
  if (method === 'post' && path === '/api/settings/roles') return saveRole_(auth, payload);
  if (method === 'post' && path === '/api/settings/teams') return saveTeam_(auth, payload);
  if (method === 'post' && path === '/api/settings/visibility-rules') return saveVisibilityRule_(auth, payload);
  if (method === 'get' && path === '/api/audit-logs') return getAuditLogsPayload_(auth);

  throw AppError('Route not found: ' + path, 404);
}

function getBootstrapData() {
  return apiProxy({ path: '/api/bootstrap', method: 'get' });
}
