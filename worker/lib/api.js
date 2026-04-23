import { assertDomainAllowed, assertPermission, getAppSettings, getEffectivePermissionKeys, loadAuthContext } from "./auth.js";
import { compileFilter, parseFilter, buildFieldRule, pushSqlParam, AppError } from "./filters.js";
import { neonQuery, neonQueryOne } from "./db.js";

const VISIBILITY_LEVELS = ["none", "indicator", "summary", "full"];

function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function maxVisibility(left, right) {
  return VISIBILITY_LEVELS[Math.max(VISIBILITY_LEVELS.indexOf(left), VISIBILITY_LEVELS.indexOf(right))];
}

async function writeAuditLog(env, auth, payload) {
  await neonQuery(
    env,
    [
      "INSERT INTO audit_logs (",
      "  actor_user_id, area_key, action_key, entity_type, entity_id, student_id, target_team_id, metadata",
      ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)",
    ].join("\n"),
    [
      auth?.userId ?? null,
      payload.areaKey,
      payload.actionKey,
      payload.entityType,
      payload.entityId ?? null,
      payload.studentId ?? null,
      payload.targetTeamId ?? null,
      JSON.stringify(payload.metadata ?? {}),
    ],
  );
}

async function getVisibilityMatrix(env, teamIds) {
  if (!teamIds?.length) return [];
  return neonQuery(
    env,
    [
      "SELECT source_team_id, target_team_id, content_type, visibility_level",
      "FROM team_visibility_rules",
      "WHERE deleted_at IS NULL",
      "  AND source_team_id = ANY($1::uuid[])",
    ].join("\n"),
    [teamIds],
  );
}

function computeVisibility(auth, matrix, ownerTeamId, contentType, recordVisibilityLevel) {
  if (auth.isAdmin || !ownerTeamId) return "full";
  if (auth.teamIds.includes(ownerTeamId)) return "full";

  const matching = matrix.filter(
    (rule) => rule.target_team_id === ownerTeamId && rule.content_type === contentType,
  );
  const granted = matching.reduce(
    (highest, rule) => maxVisibility(highest, rule.visibility_level),
    "none",
  );

  return VISIBILITY_LEVELS[
    Math.min(VISIBILITY_LEVELS.indexOf(granted), VISIBILITY_LEVELS.indexOf(recordVisibilityLevel ?? "full"))
  ];
}

function redactRecord(record, visibility) {
  if (visibility === "full") return { ...record, visibility };
  if (visibility === "summary") {
    const redacted = { ...record, visibility };
    delete redacted.detail;
    delete redacted.body;
    return redacted;
  }
  if (visibility === "indicator") {
    return {
      id: record.id,
      title: record.title,
      summary: record.summary,
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

function studentFieldMap() {
  return {
    status: buildFieldRule("s.current_status"),
    yearGroup: buildFieldRule("s.year_group"),
    tutorGroup: buildFieldRule("s.tutor_group"),
    safeguardingFlag: buildFieldRule("s.safeguarding_flag", { allowOperators: ["==", "!="] }),
    attendanceConcern: buildFieldRule("s.attendance_concern", { allowOperators: ["==", "!="] }),
    createdAt: buildFieldRule("s.created_at"),
    radarTeam: (operator, value, params) => {
      if (!["==", "=in="].includes(operator)) {
        throw new AppError("radarTeam only supports == and =in=");
      }
      const values = Array.isArray(value) ? value : [value];
      const placeholders = values.map((entry) => pushSqlParam(params, entry)).join(", ");
      return {
        sql: [
          "EXISTS (",
          "  SELECT 1",
          "  FROM student_team_radar str",
          "  JOIN teams t ON t.id = str.team_id",
          "  WHERE str.student_id = s.id",
          "    AND str.deleted_at IS NULL",
          "    AND str.status IN ('active', 'monitoring')",
          `    AND t.team_key IN (${placeholders})`,
          ")",
        ].join("\n"),
      };
    },
    hasOpenConcern: (operator, value, params) => {
      if (operator !== "==") throw new AppError("hasOpenConcern only supports ==");
      const expected = pushSqlParam(params, value);
      return {
        sql: [
          "(EXISTS (",
          "  SELECT 1",
          "  FROM concerns c",
          "  WHERE c.student_id = s.id",
          "    AND c.deleted_at IS NULL",
          "    AND c.status IN ('open', 'triage', 'escalated')",
          `) = ${expected})`,
        ].join("\n"),
      };
    },
  };
}

function concernFieldMap() {
  return {
    status: buildFieldRule("c.status"),
    category: buildFieldRule("c.category"),
    severity: buildFieldRule("c.severity"),
    teamId: buildFieldRule("c.team_id"),
    createdAt: buildFieldRule("c.created_at"),
    assignedTo: buildFieldRule("c.assigned_to_user_id"),
  };
}

function meetingFieldMap() {
  return {
    teamId: buildFieldRule("m.team_id"),
    interactionType: buildFieldRule("m.interaction_type"),
    createdAt: buildFieldRule("m.created_at"),
    occurredAt: buildFieldRule("m.occurred_at"),
  };
}

async function getBootstrapPayload(env, auth) {
  await assertPermission(env, auth, "dashboard.view");
  const [teams, savedFilters, settings, permissionKeys] = await Promise.all([
    neonQuery(env, "SELECT id, team_key, name, accent_color FROM teams WHERE deleted_at IS NULL AND is_active = TRUE ORDER BY name"),
    neonQuery(
      env,
      [
        "SELECT id, area_key, name, filter_expression, is_shared",
        "FROM saved_filters",
        "WHERE deleted_at IS NULL",
        "  AND (owner_user_id = $1 OR is_shared = TRUE)",
        "ORDER BY area_key, name",
      ].join("\n"),
      [auth.userId],
    ),
    getAppSettings(env, ["app.name", "app.mode", "auth.allowedDomains", "auth.enforceDomainRestriction"]),
    getEffectivePermissionKeys(env, auth),
  ]);

  return {
    currentUser: {
      userId: auth.userId,
      email: auth.email,
      displayName: auth.displayName,
      roleKeys: auth.roleKeys,
      teamIds: auth.teamIds,
      isAdmin: auth.isAdmin,
      permissionKeys,
    },
    teams,
    savedFilters,
    settings,
    navigation: [
      { key: "dashboard", label: "Dashboard" },
      { key: "students", label: "Students" },
      { key: "concerns", label: "Concerns" },
      { key: "meetings", label: "Meetings" },
      { key: "settings", label: "Settings" },
    ],
  };
}

async function getDashboardPayload(env, auth) {
  await assertPermission(env, auth, "dashboard.view");
  const [headline, teamLoad] = await Promise.all([
    neonQueryOne(
      env,
      [
        "SELECT",
        "  (SELECT COUNT(*) FROM students WHERE deleted_at IS NULL) AS student_count,",
        "  (SELECT COUNT(*) FROM concerns WHERE deleted_at IS NULL AND status IN ('open', 'triage', 'escalated')) AS open_concern_count,",
        "  (SELECT COUNT(*) FROM student_team_radar WHERE deleted_at IS NULL AND status IN ('active', 'monitoring')) AS active_radar_count,",
        "  (SELECT COUNT(*) FROM actions WHERE deleted_at IS NULL AND status IN ('open', 'in_progress')) AS open_action_count",
      ].join("\n"),
    ),
    neonQuery(
      env,
      [
        "SELECT t.id, t.name, t.team_key, t.accent_color, COUNT(r.id)::int AS active_students",
        "FROM teams t",
        "LEFT JOIN student_team_radar r",
        "  ON r.team_id = t.id",
        " AND r.deleted_at IS NULL",
        " AND r.status IN ('active', 'monitoring')",
        "WHERE t.deleted_at IS NULL",
        "GROUP BY t.id",
        "ORDER BY t.name",
      ].join("\n"),
    ),
  ]);
  return { headline, teamLoad };
}

async function getStudentsPayload(env, auth, url) {
  await assertPermission(env, auth, "students.view");
  const params = [];
  const filterSql = compileFilter(parseFilter(url.searchParams.get("filter") ?? ""), studentFieldMap(), params).sql;
  let searchSql = "TRUE";
  const search = url.searchParams.get("q")?.trim().toLowerCase();
  if (search) {
    const placeholder = pushSqlParam(params, `%${search}%`);
    searchSql = `(LOWER(s.first_name) LIKE ${placeholder} OR LOWER(s.last_name) LIKE ${placeholder} OR LOWER(s.student_code) LIKE ${placeholder})`;
  }

  const students = await neonQuery(
    env,
    [
      "SELECT",
      "  s.id, s.student_code, s.first_name, s.last_name, s.preferred_name,",
      "  s.year_group, s.tutor_group, s.current_status, s.safeguarding_flag,",
      "  s.attendance_concern, s.notes_summary,",
      "  COALESCE(",
      "    JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(",
      "      'teamName', t.name,",
      "      'teamKey', t.team_key,",
      "      'status', str.status,",
      "      'severity', str.severity,",
      "      'addedAt', str.added_at",
      "    )) FILTER (WHERE str.id IS NOT NULL),",
      "    '[]'::json",
      "  ) AS radar",
      "FROM students s",
      "LEFT JOIN student_team_radar str",
      "  ON str.student_id = s.id",
      " AND str.deleted_at IS NULL",
      " AND str.status IN ('active', 'monitoring', 'paused')",
      "LEFT JOIN teams t ON t.id = str.team_id",
      "WHERE s.deleted_at IS NULL",
      `  AND ${filterSql}`,
      `  AND ${searchSql}`,
      "GROUP BY s.id",
      "ORDER BY s.last_name, s.first_name",
      "LIMIT 100",
    ].join("\n"),
    params,
  );

  return { students, filter: url.searchParams.get("filter") ?? "" };
}

async function getStudentProfilePayload(env, auth, studentId) {
  await assertPermission(env, auth, "students.view");
  const permissionKeys = await getEffectivePermissionKeys(env, auth);
  const student = await neonQueryOne(
    env,
    [
      "SELECT",
      "  s.*,",
      "  COALESCE(",
      "    JSON_AGG(DISTINCT JSONB_BUILD_OBJECT(",
      "      'id', f.id,",
      "      'flagKey', f.flag_key,",
      "      'label', f.label,",
      "      'severity', f.severity,",
      "      'visibilityLevel', f.visibility_level",
      "    )) FILTER (WHERE f.id IS NOT NULL AND f.deleted_at IS NULL AND f.is_active = TRUE),",
      "    '[]'::json",
      "  ) AS flags",
      "FROM students s",
      "LEFT JOIN student_flags f ON f.student_id = s.id",
      "WHERE s.id = $1",
      "  AND s.deleted_at IS NULL",
      "GROUP BY s.id",
    ].join("\n"),
    [studentId],
  );

  if (!student) throw new AppError("Student not found", 404);

  const matrix = await getVisibilityMatrix(env, auth.teamIds);

  const applyVisibility = (records, contentType, visibilityField) =>
    records
      .map((record) =>
        redactRecord(
          record,
          computeVisibility(auth, matrix, record.team_id, contentType, record[visibilityField] ?? "full"),
        ),
      )
      .filter(Boolean);

  const [radarRaw, concernsRaw, meetingsRaw, actionsRaw, chronologyRaw] = await Promise.all([
    neonQuery(
      env,
      [
        "SELECT",
        "  str.id, str.team_id, t.name AS team_name, t.team_key, str.status, str.category,",
        "  str.reason_summary AS summary, str.detail_note AS detail, str.severity, str.visibility_level,",
        "  str.added_at AS occurred_at, str.offboarded_at, u.display_name AS assigned_lead_name",
        "FROM student_team_radar str",
        "JOIN teams t ON t.id = str.team_id",
        "LEFT JOIN users u ON u.id = str.assigned_lead_user_id",
        "WHERE str.student_id = $1 AND str.deleted_at IS NULL",
        "ORDER BY str.added_at DESC",
      ].join("\n"),
      [studentId],
    ),
    auth.isAdmin || permissionKeys.includes("concerns.review")
      ? neonQuery(
          env,
          [
            "SELECT c.id, c.team_id, t.name AS team_name, c.title, c.summary, c.detail, c.status, c.category,",
            "  c.severity, c.urgency, c.confidentiality_level, c.created_at, c.created_at AS occurred_at",
            "FROM concerns c",
            "LEFT JOIN teams t ON t.id = c.team_id",
            "WHERE c.student_id = $1 AND c.deleted_at IS NULL",
            "ORDER BY c.created_at DESC",
          ].join("\n"),
          [studentId],
        )
      : [],
    auth.isAdmin || permissionKeys.includes("meetings.view")
      ? neonQuery(
          env,
          [
            "SELECT m.id, m.team_id, t.name AS team_name, m.title, m.summary, m.detail, m.interaction_type,",
            "  m.visibility_level, m.occurred_at, m.created_at",
            "FROM meetings m",
            "LEFT JOIN teams t ON t.id = m.team_id",
            "WHERE m.student_id = $1 AND m.deleted_at IS NULL",
            "ORDER BY m.occurred_at DESC",
          ].join("\n"),
          [studentId],
        )
      : [],
    auth.isAdmin || permissionKeys.includes("actions.manage")
      ? neonQuery(
          env,
          [
            "SELECT a.id, a.team_id, t.name AS team_name, a.title, a.summary, a.status, a.priority,",
            "  a.due_at, a.completed_at, a.created_at, a.created_at AS occurred_at",
            "FROM actions a",
            "LEFT JOIN teams t ON t.id = a.team_id",
            "WHERE a.student_id = $1 AND a.deleted_at IS NULL",
            "ORDER BY a.created_at DESC",
          ].join("\n"),
          [studentId],
        )
      : [],
    auth.isAdmin || permissionKeys.includes("chronology.view")
      ? neonQuery(
          env,
          [
            "SELECT ce.id, ce.team_id, t.name AS team_name, ce.title, ce.summary, ce.detail, ce.event_type,",
            "  ce.visibility_level, ce.occurred_at, ce.created_at",
            "FROM chronology_events ce",
            "LEFT JOIN teams t ON t.id = ce.team_id",
            "WHERE ce.student_id = $1 AND ce.deleted_at IS NULL",
            "ORDER BY ce.occurred_at DESC",
            "LIMIT 100",
          ].join("\n"),
          [studentId],
        )
      : [],
  ]);

  await writeAuditLog(env, auth, {
    areaKey: "students",
    actionKey: "profile.view",
    entityType: "student",
    entityId: studentId,
    studentId,
    metadata: { sensitiveRead: true },
  });

  return {
    profile: student,
    radar: applyVisibility(radarRaw, "radar", "visibility_level"),
    concerns: applyVisibility(concernsRaw, "concerns", "confidentiality_level"),
    meetings: applyVisibility(meetingsRaw, "meetings", "visibility_level"),
    actions: applyVisibility(actionsRaw, "actions", "visibility_level"),
    chronology: applyVisibility(chronologyRaw, "chronology", "visibility_level"),
  };
}

async function createConcern(env, auth, body) {
  await assertPermission(env, auth, "concerns.create");
  if (!body.studentId || !body.category || !body.title || !body.summary) {
    throw new AppError("studentId, category, title, and summary are required");
  }

  const concernRef = `CON-${Date.now()}`;
  const concern = await neonQueryOne(
    env,
    [
      "INSERT INTO concerns (",
      "  student_id, concern_ref, team_id, submitted_by_user_id, category, severity, urgency,",
      "  confidentiality_level, title, summary, detail, created_by, updated_by",
      ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $4, $4)",
      "RETURNING *",
    ].join("\n"),
    [
      body.studentId,
      concernRef,
      body.teamId ?? null,
      auth.userId,
      body.category,
      body.severity ?? "medium",
      body.urgency ?? "standard",
      body.confidentialityLevel ?? "summary",
      body.title,
      body.summary,
      body.detail ?? null,
    ],
  );

  await neonQuery(
    env,
    [
      "INSERT INTO chronology_events (",
      "  student_id, source_table, source_id, event_type, team_id, actor_user_id, visibility_level, confidentiality_level,",
      "  title, summary, detail, created_by",
      ") VALUES ($1, 'concerns', $2, 'concern_logged', $3, $4, $5, $6, $7, $8, $9, $4)",
    ].join("\n"),
    [
      body.studentId,
      concern.id,
      body.teamId ?? null,
      auth.userId,
      "summary",
      body.confidentialityLevel ?? "summary",
      body.title,
      body.summary,
      body.detail ?? null,
    ],
  );

  return { concern };
}

async function getConcernsPayload(env, auth, url) {
  await assertPermission(env, auth, "concerns.review");
  const params = [];
  const filterSql = compileFilter(parseFilter(url.searchParams.get("filter") ?? ""), concernFieldMap(), params).sql;
  let searchSql = "TRUE";
  const search = url.searchParams.get("q")?.trim().toLowerCase();
  if (search) {
    const placeholder = pushSqlParam(params, `%${search}%`);
    searchSql = `(LOWER(c.title) LIKE ${placeholder} OR LOWER(c.summary) LIKE ${placeholder} OR LOWER(s.first_name) LIKE ${placeholder} OR LOWER(s.last_name) LIKE ${placeholder})`;
  }

  const concerns = await neonQuery(
    env,
    [
      "SELECT c.id, c.concern_ref, c.student_id, s.first_name, s.last_name, s.year_group,",
      "  c.title, c.summary, c.status, c.category, c.severity, c.urgency, c.confidentiality_level,",
      "  c.created_at, t.name AS team_name",
      "FROM concerns c",
      "JOIN students s ON s.id = c.student_id",
      "LEFT JOIN teams t ON t.id = c.team_id",
      "WHERE c.deleted_at IS NULL",
      "  AND s.deleted_at IS NULL",
      `  AND ${filterSql}`,
      `  AND ${searchSql}`,
      "ORDER BY c.created_at DESC",
      "LIMIT 100",
    ].join("\n"),
    params,
  );

  return { concerns, filter: url.searchParams.get("filter") ?? "" };
}

async function createMeeting(env, auth, body) {
  await assertPermission(env, auth, "meetings.create");
  if (!body.studentId || !body.interactionType || !body.title || !body.summary || !body.occurredAt) {
    throw new AppError("studentId, interactionType, title, summary, and occurredAt are required");
  }

  const meeting = await neonQueryOne(
    env,
    [
      "INSERT INTO meetings (",
      "  student_id, team_id, logged_by_user_id, interaction_type, visibility_level, confidentiality_level,",
      "  title, summary, detail, occurred_at, created_by, updated_by",
      ") VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $3, $3)",
      "RETURNING *",
    ].join("\n"),
    [
      body.studentId,
      body.teamId ?? null,
      auth.userId,
      body.interactionType,
      body.visibilityLevel ?? "summary",
      body.confidentialityLevel ?? "summary",
      body.title,
      body.summary,
      body.detail ?? null,
      body.occurredAt,
    ],
  );

  await neonQuery(
    env,
    [
      "INSERT INTO chronology_events (",
      "  student_id, source_table, source_id, event_type, team_id, actor_user_id, visibility_level, confidentiality_level,",
      "  title, summary, detail, occurred_at, created_by",
      ") VALUES ($1, 'meetings', $2, 'meeting_logged', $3, $4, $5, $6, $7, $8, $9, $10, $4)",
    ].join("\n"),
    [
      body.studentId,
      meeting.id,
      body.teamId ?? null,
      auth.userId,
      body.visibilityLevel ?? "summary",
      body.confidentialityLevel ?? "summary",
      body.title,
      body.summary,
      body.detail ?? null,
      body.occurredAt,
    ],
  );

  return { meeting };
}

async function getMeetingsPayload(env, auth, url) {
  await assertPermission(env, auth, "meetings.view");
  const params = [];
  const filterSql = compileFilter(parseFilter(url.searchParams.get("filter") ?? ""), meetingFieldMap(), params).sql;
  let searchSql = "TRUE";
  const search = url.searchParams.get("q")?.trim().toLowerCase();
  if (search) {
    const placeholder = pushSqlParam(params, `%${search}%`);
    searchSql = `(LOWER(m.title) LIKE ${placeholder} OR LOWER(m.summary) LIKE ${placeholder} OR LOWER(s.first_name) LIKE ${placeholder} OR LOWER(s.last_name) LIKE ${placeholder})`;
  }

  const meetings = await neonQuery(
    env,
    [
      "SELECT m.id, m.student_id, s.first_name, s.last_name, s.year_group,",
      "  m.title, m.summary, m.interaction_type, m.visibility_level, m.occurred_at, t.name AS team_name",
      "FROM meetings m",
      "JOIN students s ON s.id = m.student_id",
      "LEFT JOIN teams t ON t.id = m.team_id",
      "WHERE m.deleted_at IS NULL",
      "  AND s.deleted_at IS NULL",
      `  AND ${filterSql}`,
      `  AND ${searchSql}`,
      "ORDER BY m.occurred_at DESC",
      "LIMIT 100",
    ].join("\n"),
    params,
  );

  return { meetings, filter: url.searchParams.get("filter") ?? "" };
}

async function getSettingsReferencePayload(env, auth) {
  await assertPermission(env, auth, "settings.view");
  const [users, roles, permissions, teams, visibilityRules] = await Promise.all([
    neonQuery(env, "SELECT id, email, display_name, primary_team_id, is_active FROM users WHERE deleted_at IS NULL ORDER BY display_name"),
    neonQuery(env, "SELECT id, role_key, name, description, is_system, is_editable FROM roles WHERE deleted_at IS NULL ORDER BY name"),
    neonQuery(env, "SELECT id, permission_key, area_key, action_key, description FROM permissions ORDER BY permission_key"),
    neonQuery(env, "SELECT id, team_key, name, description, accent_color, is_active FROM teams WHERE deleted_at IS NULL ORDER BY name"),
    neonQuery(
      env,
      [
        "SELECT tvr.id, tvr.source_team_id, source_team.name AS source_team_name,",
        "  tvr.target_team_id, target_team.name AS target_team_name, tvr.content_type, tvr.visibility_level",
        "FROM team_visibility_rules tvr",
        "JOIN teams source_team ON source_team.id = tvr.source_team_id",
        "JOIN teams target_team ON target_team.id = tvr.target_team_id",
        "WHERE tvr.deleted_at IS NULL",
        "ORDER BY source_team.name, target_team.name, tvr.content_type",
      ].join("\n"),
    ),
  ]);

  return { users, roles, permissions, teams, visibilityRules };
}

async function saveRole(env, auth, body) {
  await assertPermission(env, auth, "settings.roles.manage");
  if (!body.roleKey || !body.name) throw new AppError("roleKey and name are required");

  const role = await neonQueryOne(
    env,
    [
      "INSERT INTO roles (role_key, name, description, is_system, is_editable, created_by, updated_by)",
      "VALUES ($1, $2, $3, FALSE, TRUE, $4, $4)",
      "ON CONFLICT (role_key) DO UPDATE",
      "SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = NOW(), updated_by = EXCLUDED.updated_by",
      "RETURNING *",
    ].join("\n"),
    [body.roleKey, body.name, body.description ?? "", auth.userId],
  );

  await neonQuery(env, "DELETE FROM role_permissions WHERE role_id = $1", [role.id]);
  if ((body.permissionKeys ?? []).length) {
    await neonQuery(
      env,
      [
        "INSERT INTO role_permissions (role_id, permission_id, created_by)",
        "SELECT $1, p.id, $2",
        "FROM permissions p",
        "WHERE p.permission_key = ANY($3::text[])",
      ].join("\n"),
      [role.id, auth.userId, body.permissionKeys],
    );
  }

  await writeAuditLog(env, auth, {
    areaKey: "settings.roles",
    actionKey: "upsert",
    entityType: "role",
    entityId: role.id,
    metadata: { roleKey: body.roleKey, permissionKeys: body.permissionKeys ?? [] },
  });

  return { role };
}

async function saveTeam(env, auth, body) {
  await assertPermission(env, auth, "settings.teams.manage");
  if (!body.teamKey || !body.name) throw new AppError("teamKey and name are required");

  const team = await neonQueryOne(
    env,
    [
      "INSERT INTO teams (team_key, name, description, accent_color, is_active, created_by, updated_by)",
      "VALUES ($1, $2, $3, $4, $5, $6, $6)",
      "ON CONFLICT (team_key) DO UPDATE",
      "SET name = EXCLUDED.name, description = EXCLUDED.description, accent_color = EXCLUDED.accent_color,",
      "    is_active = EXCLUDED.is_active, updated_at = NOW(), updated_by = EXCLUDED.updated_by",
      "RETURNING *",
    ].join("\n"),
    [body.teamKey, body.name, body.description ?? "", body.accentColor ?? "#735c00", body.isActive !== false, auth.userId],
  );

  return { team };
}

async function saveVisibilityRule(env, auth, body) {
  await assertPermission(env, auth, "settings.visibility.manage");
  if (!body.sourceTeamId || !body.targetTeamId || !body.contentType || !body.visibilityLevel) {
    throw new AppError("sourceTeamId, targetTeamId, contentType, and visibilityLevel are required");
  }

  const visibilityRule = await neonQueryOne(
    env,
    [
      "INSERT INTO team_visibility_rules (source_team_id, target_team_id, content_type, visibility_level, created_by, updated_by)",
      "VALUES ($1, $2, $3, $4, $5, $5)",
      "ON CONFLICT (source_team_id, target_team_id, content_type)",
      "DO UPDATE SET visibility_level = EXCLUDED.visibility_level, updated_at = NOW(), updated_by = EXCLUDED.updated_by",
      "RETURNING *",
    ].join("\n"),
    [body.sourceTeamId, body.targetTeamId, body.contentType, body.visibilityLevel, auth.userId],
  );

  await writeAuditLog(env, auth, {
    areaKey: "settings.visibility",
    actionKey: "upsert",
    entityType: "team_visibility_rule",
    entityId: visibilityRule.id,
    targetTeamId: body.targetTeamId,
    metadata: {
      sourceTeamId: body.sourceTeamId,
      contentType: body.contentType,
      visibilityLevel: body.visibilityLevel,
    },
  });

  return { visibilityRule };
}

async function saveUser(env, auth, body) {
  await assertPermission(env, auth, "settings.users.manage");
  if (!body.email || !body.displayName) throw new AppError("email and displayName are required");

  const user = await neonQueryOne(
    env,
    [
      "INSERT INTO users (email, display_name, primary_team_id, is_active, created_by, updated_by)",
      "VALUES ($1, $2, $3, $4, $5, $5)",
      "ON CONFLICT (email) DO UPDATE",
      "SET display_name = EXCLUDED.display_name, primary_team_id = EXCLUDED.primary_team_id,",
      "    is_active = EXCLUDED.is_active, updated_at = NOW(), updated_by = EXCLUDED.updated_by",
      "RETURNING *",
    ].join("\n"),
    [String(body.email).toLowerCase(), body.displayName, body.primaryTeamId ?? null, body.isActive !== false, auth.userId],
  );

  return { user };
}

async function getAuditLogsPayload(env, auth) {
  await assertPermission(env, auth, "audit.view");
  const auditLogs = await neonQuery(
    env,
    [
      "SELECT a.id, a.area_key, a.action_key, a.entity_type, a.created_at,",
      "  u.display_name AS actor_name, s.student_code, s.first_name, s.last_name",
      "FROM audit_logs a",
      "LEFT JOIN users u ON u.id = a.actor_user_id",
      "LEFT JOIN students s ON s.id = a.student_id",
      "ORDER BY a.created_at DESC",
      "LIMIT 100",
    ].join("\n"),
  );
  return { auditLogs };
}

export async function handleApiRequest(request, env) {
  const url = new URL(request.url);

  try {
    const auth = await loadAuthContext(request, env);
    await assertDomainAllowed(env, auth.email);

    if (request.method === "GET" && url.pathname === "/api/bootstrap") {
      return json(await getBootstrapPayload(env, auth));
    }
    if (request.method === "GET" && url.pathname === "/api/dashboard") {
      return json(await getDashboardPayload(env, auth));
    }
    if (request.method === "GET" && url.pathname === "/api/students") {
      return json(await getStudentsPayload(env, auth, url));
    }
    if (request.method === "GET" && /^\/api\/students\/[^/]+$/.test(url.pathname)) {
      const studentId = url.pathname.split("/")[3];
      return json(await getStudentProfilePayload(env, auth, studentId));
    }
    if (request.method === "GET" && url.pathname === "/api/concerns") {
      return json(await getConcernsPayload(env, auth, url));
    }
    if (request.method === "POST" && url.pathname === "/api/concerns") {
      return json(await createConcern(env, auth, await request.json()), { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/api/meetings") {
      return json(await getMeetingsPayload(env, auth, url));
    }
    if (request.method === "POST" && url.pathname === "/api/meetings") {
      return json(await createMeeting(env, auth, await request.json()), { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/api/settings/reference") {
      return json(await getSettingsReferencePayload(env, auth));
    }
    if (request.method === "POST" && url.pathname === "/api/settings/users") {
      return json(await saveUser(env, auth, await request.json()), { status: 201 });
    }
    if (request.method === "POST" && url.pathname === "/api/settings/roles") {
      return json(await saveRole(env, auth, await request.json()), { status: 201 });
    }
    if (request.method === "POST" && url.pathname === "/api/settings/teams") {
      return json(await saveTeam(env, auth, await request.json()), { status: 201 });
    }
    if (request.method === "POST" && url.pathname === "/api/settings/visibility-rules") {
      return json(await saveVisibilityRule(env, auth, await request.json()), { status: 201 });
    }
    if (request.method === "GET" && url.pathname === "/api/audit-logs") {
      return json(await getAuditLogsPayload(env, auth));
    }

    throw new AppError(`Route not found: ${url.pathname}`, 404);
  } catch (error) {
    const statusCode = error instanceof AppError ? error.statusCode : 500;
    return json(
      {
        error: error.message || "Internal server error",
        details: error instanceof AppError ? error.details : undefined,
      },
      { status: statusCode },
    );
  }
}
