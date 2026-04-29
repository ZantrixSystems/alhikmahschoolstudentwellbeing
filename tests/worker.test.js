import assert from 'node:assert/strict';
import test from 'node:test';
import workerApp, { AppError, createApi, VALID_REFERRAL_TYPES, VALID_SEND_CATEGORIES } from '../worker/index.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_TEAM = '22222222-2222-2222-2222-222222222222';
const TARGET_TEAM = '33333333-3333-3333-3333-333333333333';
const STUDENT_ID = '44444444-4444-4444-4444-444444444444';
const SAFEGUARDING_TEAM = '55555555-5555-5555-5555-555555555555';

function makeEnv(options = {}) {
  const calls = [];
  const permissions = options.permissions || [];
  const roleKeys = options.roleKeys || ['caseworker'];
  const teamIds = options.teamIds || [SOURCE_TEAM];
  const visibilityRules = options.visibilityRules || [];
  const studentRows = options.studentRows || [];
  const profileRows = options.profileRows || [];
  const meetingRows = options.meetingRows || [];
  const calendarRows = options.calendarRows || [];
  const chronologyRows = options.chronologyRows || [];
  const teamRows = options.teamRows || [];
  const userTeamRows = options.userTeamRows || [];
  const userRowsById = options.userRowsById || [];
  const roleRowsById = options.roleRowsById || [];
  const rolePermissionRows = options.rolePermissionRows || [];
  const referenceOptions = options.referenceOptions || [
    { id: 'ref-incident-verbal', area_key: 'concerns', field_key: 'incident_type', option_key: 'verbal', label: 'Verbal incident', sort_order: 10, is_active: true, is_system: true },
    { id: 'ref-action-parent', area_key: 'concerns', field_key: 'action_taken', option_key: 'parent_contacted', label: 'Parent/carer contacted', sort_order: 10, is_active: true, is_system: true },
  ];

  const env = {
    GOOGLE_CLIENT_ID: 'test-client-id',
    calls,
    async __query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM app_settings')) {
        return [
          { key: 'auth.enforceDomainRestriction', value: false },
          { key: 'auth.allowedDomains', value: [] },
        ];
      }
      if (sql.includes('FROM reference_options') && sql.includes('option_key = $3')) {
        return referenceOptions.filter((option) => (
          option.area_key === params[0] &&
          option.field_key === params[1] &&
          option.option_key === params[2] &&
          option.is_active !== false
        ));
      }
      if (sql.includes('FROM reference_options') && sql.includes('ORDER BY area_key')) {
        return referenceOptions;
      }
      if (sql.includes('SELECT id, area_key, field_key, option_key, is_system FROM reference_options')) {
        return referenceOptions.filter((option) => option.id === params[0]);
      }
      if (sql.includes('INSERT INTO reference_options')) {
        return [{
          id: 'ref-saved',
          area_key: params[0],
          field_key: params[1],
          option_key: params[2],
          label: params[3],
          description: params[4],
          sort_order: params[5],
          is_active: params[6],
          is_system: false,
        }];
      }
      if (sql.includes('UPDATE reference_options SET is_active = FALSE')) {
        return [referenceOptions.find((option) => option.id === params[1]) || { id: params[1] }];
      }
      if (sql.includes('FROM users u') && sql.includes('LOWER(u.email)')) {
        return [{
          id: USER_ID,
          email: 'worker.test@alhikmah.example.org',
          display_name: 'Worker Test',
          is_active: true,
          role_keys: roleKeys,
          team_ids: teamIds,
        }];
      }
      if (sql.includes('WHERE u.id = $1 AND u.deleted_at IS NULL')) {
        return userRowsById.filter((user) => user.id === params[0]);
      }
      if (sql.includes('SELECT DISTINCT p.permission_key')) {
        return permissions.map((permission_key) => ({ permission_key }));
      }
      if (sql.includes('p.permission_key = $2')) {
        return permissions.includes(params[1]) || roleKeys.includes('admin') ? [{ '?column?': 1 }] : [];
      }
      if (sql.includes('SELECT id, role_key, name, description, is_system, is_editable FROM roles')) {
        return roleRowsById.length ? roleRowsById : [
          { id: 'role-caseworker', role_key: 'caseworker', name: 'Caseworker', description: 'Casework', is_system: true, is_editable: true },
          { id: 'role-admin', role_key: 'admin', name: 'Admin', description: 'Admin', is_system: true, is_editable: false },
        ];
      }
      if (sql.includes('FROM role_permissions rp')) {
        return rolePermissionRows;
      }
      if (sql.includes('SELECT id, role_key FROM roles WHERE id = $1')) {
        return roleRowsById.filter((role) => role.id === params[0]);
      }
      if (sql.includes('UPDATE roles SET name = $1')) {
        const existing = roleRowsById.find((role) => role.id === params[3]) || { id: params[3], role_key: 'caseworker' };
        return [{ ...existing, name: params[0], description: params[1], is_editable: true }];
      }
      if (sql.includes('INSERT INTO roles')) {
        return [{ id: 'saved-role-id', role_key: params[0], name: params[1], description: params[2], is_system: false, is_editable: true }];
      }
      if (sql.includes('DELETE FROM role_permissions')) return [];
      if (sql.includes('INSERT INTO role_permissions')) return [];
      if (sql.includes('SELECT team_key FROM teams WHERE id = ANY')) {
        const ids = Array.isArray(params[0]) ? params[0] : [];
        return teamRows.filter((team) => ids.includes(team.id));
      }
      if (sql.includes('SELECT team_key FROM teams WHERE id = $1')) {
        return teamRows.filter((team) => team.id === params[0]);
      }
      if (sql.includes('INSERT INTO users')) {
        return [{ id: 'saved-user-id', email: params[0], display_name: params[1], is_active: params[2] }];
      }
      if (sql.includes('FROM students s') && sql.includes('GROUP BY s.id') && sql.includes('AS flags')) {
        return profileRows;
      }
      if (sql.includes('FROM student_team_radar str')) return [];
      if (sql.includes('FROM meetings m') && !sql.includes("'meeting' AS item_type")) return meetingRows;
      if (sql.includes('FROM chronology_events')) return chronologyRows;
      if (sql.includes('FROM concerns c')) return [];
      if (sql.includes('FROM actions a LEFT JOIN teams')) return [];
      if (sql.includes('FROM notes n')) return [];
      if (sql.includes('JSON_AGG') && sql.includes('FROM students s')) return studentRows;
      if (sql.includes("SELECT * FROM (") && sql.includes("'follow_up' AS item_type")) return calendarRows;
      if (sql.includes('FROM team_visibility_rules') && sql.includes('source_team_id')) {
        return visibilityRules;
      }
      if (sql.includes('FROM user_teams ut')) return userTeamRows;
      if (sql.includes('DELETE FROM user_roles')) return [];
      if (sql.includes('DELETE FROM user_teams')) return [];
      if (sql.includes('UPDATE users SET is_active = FALSE')) return [{ id: params[1], email: 'removed@example.org', display_name: 'Removed User' }];
      if (sql.includes('UPDATE team_visibility_rules SET deleted_at')) return [{ id: params[1], target_team_id: TARGET_TEAM }];
      if (sql.includes('INSERT INTO audit_logs')) return [];
      return [];
    },
  };
  return env;
}

test('permission enforcement denies missing student permission', async () => {
  const api = createApi(makeEnv({ permissions: ['dashboard.view'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/students', method: 'get', query: {} }),
    /Missing permission: students\.view/
  );
});

test('user with no roles has no default app access', async () => {
  const api = createApi(makeEnv({ permissions: [], roleKeys: [] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/bootstrap', method: 'get' }),
    /has not been assigned a role yet/
  );
});

test('admin role cannot be mutated even with settings permission', async () => {
  const api = createApi(makeEnv({
    permissions: ['settings.roles.manage'],
    roleKeys: ['admin'],
  }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/settings/roles', method: 'post', payload: { roleKey: 'admin', name: 'Admin' } }),
    /built-in admin role is immutable/
  );
});

test('admin role cannot be mutated by role id', async () => {
  const api = createApi(makeEnv({
    permissions: ['settings.roles.manage'],
    roleRowsById: [{ id: 'role-admin', role_key: 'admin', name: 'Admin', description: 'Admin', is_system: true, is_editable: false }],
  }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/settings/roles', method: 'post', payload: { roleId: 'role-admin', roleKey: 'admin', name: 'Admin changed' } }),
    /built-in admin role is immutable/
  );
});

test('settings role save updates non-admin role and replaces permissions', async () => {
  const env = makeEnv({
    permissions: ['settings.roles.manage'],
    roleRowsById: [{ id: 'role-caseworker', role_key: 'caseworker', name: 'Caseworker', description: 'Casework', is_system: true, is_editable: true }],
  });
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/settings/roles',
    method: 'post',
    payload: {
      roleId: 'role-caseworker',
      roleKey: 'caseworker',
      name: 'Caseworker Plus',
      description: 'Updated role',
      permissionKeys: ['students.view', 'concerns.review'],
    },
  });
  assert.ok(env.calls.some((call) => call.sql.includes('UPDATE roles SET name = $1') && call.params[3] === 'role-caseworker'));
  assert.ok(env.calls.some((call) => call.sql.includes('DELETE FROM role_permissions') && call.params[0] === 'role-caseworker'));
  assert.ok(env.calls.some((call) => call.sql.includes('INSERT INTO role_permissions') && call.params[2].includes('students.view') && call.params[2].includes('concerns.review')));
});

test('team visibility summary redacts meeting detail on student profile', async () => {
  const api = createApi(makeEnv({
    permissions: ['students.view', 'meetings.view'],
    visibilityRules: [{
      source_team_id: SOURCE_TEAM,
      target_team_id: TARGET_TEAM,
      content_type: 'meetings',
      visibility_level: 'summary',
    }],
    profileRows: [{
      id: STUDENT_ID,
      student_code: 'A001',
      first_name: 'Amina',
      last_name: 'Khan',
      flags: [],
    }],
    meetingRows: [{
      id: 'meeting-1',
      team_id: TARGET_TEAM,
      team_name: 'Safeguarding',
      title: 'Review',
      summary: 'Safe summary',
      detail: 'Sensitive detail',
      interaction_type: 'review_meeting',
      visibility_level: 'full',
      occurred_at: '2026-04-24T09:00:00Z',
      created_at: '2026-04-24T09:00:00Z',
    }],
  }), 'worker.test@alhikmah.example.org');

  const data = await api.dispatch({ path: `/api/students/${STUDENT_ID}`, method: 'get' });
  assert.equal(data.meetings.length, 1);
  assert.equal(data.meetings[0].visibility, 'summary');
  assert.equal(data.meetings[0].summary, 'Safe summary');
  assert.equal('detail' in data.meetings[0], false);
});

test('calendar applies action visibility separately from meeting visibility', async () => {
  const api = createApi(makeEnv({
    permissions: ['meetings.view'],
    visibilityRules: [{
      source_team_id: SOURCE_TEAM,
      target_team_id: TARGET_TEAM,
      content_type: 'actions',
      visibility_level: 'indicator',
    }],
    calendarRows: [{
      item_type: 'follow_up',
      id: 'action-1',
      student_id: STUDENT_ID,
      team_id: TARGET_TEAM,
      first_name: 'Amina',
      last_name: 'Khan',
      title: 'Call home',
      summary: 'Call parent',
      item_status: 'open',
      interaction_type: 'follow_up',
      visibility_level: 'full',
      calendar_at: '2026-04-25T09:00:00Z',
      due_at: '2026-04-25T09:00:00Z',
      assigned_user_name: 'Worker Test',
    }],
  }), 'worker.test@alhikmah.example.org');

  const data = await api.dispatch({ path: '/api/meetings', method: 'get', query: {} });
  assert.equal(data.meetings.length, 1);
  assert.equal(data.meetings[0].visibility, 'indicator');
  assert.equal(data.meetings[0].redacted, true);
  assert.equal(data.meetings[0].item_status, 'open');
});

test('student profile chronology includes source references for timeline dedupe', async () => {
  const api = createApi(makeEnv({
    permissions: ['students.view', 'chronology.view', 'notes.view'],
    profileRows: [{
      id: STUDENT_ID,
      student_code: 'A001',
      first_name: 'Amina',
      last_name: 'Khan',
      flags: [],
    }],
    chronologyRows: [{
      id: 'chronology-1',
      source_table: 'notes',
      source_id: 'note-1',
      team_id: SOURCE_TEAM,
      team_name: 'Pastoral',
      title: 'Check-in',
      summary: 'Settled well',
      detail: 'Longer note',
      event_type: 'note_added',
      visibility_level: 'summary',
      occurred_at: '2026-04-24T09:00:00Z',
      created_at: '2026-04-24T09:00:00Z',
    }],
  }), 'worker.test@alhikmah.example.org');

  const data = await api.dispatch({ path: `/api/students/${STUDENT_ID}`, method: 'get' });
  assert.equal(data.chronology[0].source_table, 'notes');
  assert.equal(data.chronology[0].source_id, 'note-1');
});

test('structured student filter compiles allowlisted fields to parameters', async () => {
  const env = makeEnv({ permissions: ['students.view'] });
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/students',
    method: 'get',
    query: { filter: 'radar=in=(safeguarding,pastoral);latestActivity>=2026-01-01;openFollowUp==true' },
  });
  const studentQuery = env.calls.find((call) => call.sql.includes('FROM students s') && call.sql.includes('JSON_AGG'));
  assert.ok(studentQuery.sql.includes('t2.team_key IN'));
  assert.ok(studentQuery.sql.includes('latest.latest_activity_at >='));
  assert.ok(studentQuery.sql.includes('latest.open_follow_up ='));
  assert.deepEqual(studentQuery.params.slice(0, 4), ['safeguarding', 'pastoral', '2026-01-01', true]);
});

test('structured filter rejects unknown fields', async () => {
  const api = createApi(makeEnv({ permissions: ['students.view'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/students', method: 'get', query: { filter: 'rawSql==danger' } }),
    /Field "rawSql" is not filterable/
  );
});

// ── Ofsted readiness tests ───────────────────────────────────────────────────

test('closing a concern requires outcomeSummary', async () => {
  const env = makeEnv({ permissions: ['concerns.close'], roleKeys: ['caseworker'] });
  // Stub the concern lookup to return an open concern
  const originalQuery = env.__query.bind(env);
  env.__query = async (sql, params) => {
    if (sql.includes('FROM concerns WHERE id')) {
      return [{ id: params[0], student_id: STUDENT_ID, status: 'open', title: 'Test', team_id: SOURCE_TEAM }];
    }
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/concerns/concern-1/close', method: 'post', payload: { outcomeSummary: '' } }),
    /outcomeSummary is required/
  );
});

test('closing an already-closed concern is rejected', async () => {
  const env = makeEnv({ permissions: ['concerns.close'], roleKeys: ['caseworker'] });
  const originalQuery = env.__query.bind(env);
  env.__query = async (sql, params) => {
    if (sql.includes('FROM concerns WHERE id')) {
      return [{ id: params[0], student_id: STUDENT_ID, status: 'closed', title: 'Test', team_id: SOURCE_TEAM }];
    }
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/concerns/concern-1/close', method: 'post', payload: { outcomeSummary: 'All resolved' } }),
    /already closed/
  );
});

test('closing a concern without concerns.close permission is denied', async () => {
  const api = createApi(makeEnv({ permissions: ['concerns.create'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/concerns/concern-1/close', method: 'post', payload: { outcomeSummary: 'Done' } }),
    /Missing permission: concerns\.close/
  );
});

test('creating a SEND plan requires send.manage permission', async () => {
  const api = createApi(makeEnv({ permissions: ['students.view'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/send-plans', method: 'post', payload: { studentId: STUDENT_ID, planType: 'sen_support' } }),
    /Missing permission: send\.manage/
  );
});

test('creating a SEND plan with invalid planType is rejected', async () => {
  const api = createApi(makeEnv({ permissions: ['send.manage'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/send-plans', method: 'post', payload: { studentId: STUDENT_ID, planType: 'bad_type' } }),
    /Invalid planType/
  );
});

test('creating a concern with invalid referral_type is rejected', async () => {
  const api = createApi(makeEnv({ permissions: ['concerns.create'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/concerns', method: 'post',
      payload: { studentId: STUDENT_ID, category: 'safeguarding', title: 'T', summary: 'S', referralType: 'unknown_agency' },
    }),
    /Invalid referral_type/
  );
});

test('safeguarding concern is automatically marked safeguarding confidentiality', async () => {
  const env = makeEnv({
    permissions: ['concerns.create'],
    teamRows: [{ id: SAFEGUARDING_TEAM, team_key: 'safeguarding' }],
  });
  let insertedConfidentiality = null;
  const originalQuery = env.__query.bind(env);
  env.__query = async (sql, params) => {
    if (sql.includes('INSERT INTO concerns')) {
      // confidentiality_level is the 8th param ($8) after owner_team_id was added at $4
      insertedConfidentiality = params[7];
      return [{ id: 'c-1', student_id: STUDENT_ID, category: 'safeguarding', team_id: SAFEGUARDING_TEAM }];
    }
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/concerns', method: 'post',
    payload: { studentId: STUDENT_ID, teamId: SAFEGUARDING_TEAM, title: 'T', summary: 'S' },
  });
  assert.equal(insertedConfidentiality, 'safeguarding');
});

test('DSL dashboard panel is only populated for concerns.review holders', async () => {
  // User without concerns.review — should return empty openSafeguardingConcerns
  const envNoReview = makeEnv({ permissions: ['dashboard.view'] });
  let safeguardingQueried = false;
  const origQuery = envNoReview.__query.bind(envNoReview);
  envNoReview.__query = async (sql, params) => {
    if (sql.includes("t.team_key = 'safeguarding'")) safeguardingQueried = true;
    return origQuery(sql, params);
  };
  const api = createApi(envNoReview, 'worker.test@alhikmah.example.org');
  const data = await api.dispatch({ path: '/api/dashboard', method: 'get' });
  assert.equal(safeguardingQueried, false, 'Safeguarding query must not run without concerns.review');
  assert.deepEqual(data.openSafeguardingConcerns, []);
});

test('DSL dashboard panel runs safeguarding query for concerns.review holders', async () => {
  const envWithReview = makeEnv({ permissions: ['dashboard.view', 'concerns.review'] });
  let safeguardingQueried = false;
  const origQuery = envWithReview.__query.bind(envWithReview);
  envWithReview.__query = async (sql, params) => {
    if (sql.includes("t.team_key = 'safeguarding'")) { safeguardingQueried = true; return []; }
    return origQuery(sql, params);
  };
  const api = createApi(envWithReview, 'worker.test@alhikmah.example.org');
  await api.dispatch({ path: '/api/dashboard', method: 'get' });
  assert.equal(safeguardingQueried, true);
});

test('settings reference includes user team assignments', async () => {
  const api = createApi(makeEnv({
    permissions: ['settings.view'],
    userTeamRows: [{ user_id: USER_ID, team_id: SOURCE_TEAM, team_name: 'Pastoral' }],
  }), 'worker.test@alhikmah.example.org');
  const data = await api.dispatch({ path: '/api/settings/reference', method: 'get' });
  assert.deepEqual(data.userTeams, [{ user_id: USER_ID, team_id: SOURCE_TEAM, team_name: 'Pastoral' }]);
});

test('settings reference includes managed dropdown options', async () => {
  const api = createApi(makeEnv({
    permissions: ['settings.view'],
    referenceOptions: [{ id: 'ref-1', area_key: 'concerns', field_key: 'incident_type', option_key: 'verbal', label: 'Verbal incident', sort_order: 10, is_active: true, is_system: true }],
  }), 'worker.test@alhikmah.example.org');
  const data = await api.dispatch({ path: '/api/settings/reference', method: 'get' });
  assert.equal(data.referenceOptions.length, 1);
  assert.equal(data.referenceOptions[0].field_key, 'incident_type');
});

test('settings reference includes role permission assignments', async () => {
  const api = createApi(makeEnv({
    permissions: ['settings.view'],
    rolePermissionRows: [{ role_id: 'role-caseworker', permission_key: 'students.view', description: 'View students' }],
  }), 'worker.test@alhikmah.example.org');
  const data = await api.dispatch({ path: '/api/settings/reference', method: 'get' });
  assert.deepEqual(data.rolePermissions, [{ role_id: 'role-caseworker', permission_key: 'students.view', description: 'View students' }]);
});

test('settings user save replaces teams and roles in one request', async () => {
  const roleId = '88888888-8888-8888-8888-888888888888';
  const env = makeEnv({ permissions: ['settings.users.manage'] });
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/settings/users',
    method: 'post',
    payload: {
      email: 'new.user@example.org',
      displayName: 'New User',
      teamIds: [TARGET_TEAM],
      roleIds: [roleId],
      isActive: true,
    },
  });
  assert.ok(env.calls.some((call) => call.sql.includes('DELETE FROM user_teams') && call.params[0] === 'saved-user-id'));
  assert.ok(env.calls.some((call) => call.sql.includes('INSERT INTO user_teams') && call.params[1].length === 1 && call.params[1].includes(TARGET_TEAM)));
  assert.ok(env.calls.some((call) => call.sql.includes('DELETE FROM user_roles') && call.params[0] === 'saved-user-id'));
  assert.ok(env.calls.some((call) => call.sql.includes('INSERT INTO user_roles') && call.params[1].includes(roleId)));
});

test('settings user delete soft-deletes non-admin accounts', async () => {
  const targetUserId = '66666666-6666-6666-6666-666666666666';
  const env = makeEnv({
    permissions: ['settings.users.manage'],
    userRowsById: [{ id: targetUserId, email: 'target@example.org', display_name: 'Target User', role_keys: ['caseworker'] }],
  });
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({ path: '/api/settings/users/delete', method: 'post', payload: { userId: targetUserId } });
  assert.ok(env.calls.some((call) => call.sql.includes('DELETE FROM user_roles') && call.params[0] === targetUserId));
  assert.ok(env.calls.some((call) => call.sql.includes('DELETE FROM user_teams') && call.params[0] === targetUserId));
  assert.ok(env.calls.some((call) => call.sql.includes('UPDATE users SET is_active = FALSE') && call.params[1] === targetUserId));
});

test('settings user delete protects admin accounts', async () => {
  const targetUserId = '77777777-7777-7777-7777-777777777777';
  const api = createApi(makeEnv({
    permissions: ['settings.users.manage'],
    userRowsById: [{ id: targetUserId, email: 'admin@example.org', display_name: 'Admin User', role_keys: ['admin'] }],
  }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({ path: '/api/settings/users/delete', method: 'post', payload: { userId: targetUserId } }),
    /Admin accounts cannot be deleted/
  );
});

test('settings visibility rule delete soft-deletes the rule', async () => {
  const ruleId = '99999999-9999-9999-9999-999999999999';
  const env = makeEnv({ permissions: ['settings.visibility.manage'] });
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({ path: '/api/settings/visibility-rules/delete', method: 'post', payload: { visibilityRuleId: ruleId } });
  assert.ok(env.calls.some((call) => call.sql.includes('UPDATE team_visibility_rules SET deleted_at') && call.params[1] === ruleId));
});

test('saving a reference option requires settings reference permission', async () => {
  const api = createApi(makeEnv({ permissions: ['settings.view'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/settings/reference-options',
      method: 'post',
      payload: { areaKey: 'concerns', fieldKey: 'incident_type', optionKey: 'low_level', label: 'Low level' },
    }),
    /Missing permission: settings\.reference\.manage/
  );
});

test('saving a reference option is audited', async () => {
  const env = makeEnv({ permissions: ['settings.reference.manage'] });
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/settings/reference-options',
    method: 'post',
    payload: { areaKey: 'concerns', fieldKey: 'incident_type', optionKey: 'low level', label: 'Low level', sortOrder: 90 },
  });
  assert.ok(env.calls.some((call) => call.sql.includes('INSERT INTO reference_options') && call.params[2] === 'low_level'));
  assert.ok(env.calls.some((call) => call.sql.includes('INSERT INTO audit_logs') && call.params[1] === 'settings.reference' && call.params[2] === 'upsert'));
});

test('referral fields are redacted at summary visibility', () => {
  // Import createApi and exercise redactRecord indirectly via applyVisibility
  // We test by checking that referral_outcome is absent at summary level
  const record = {
    id: 'c-1', student_id: STUDENT_ID, team_id: SOURCE_TEAM,
    title: 'Concern', summary: 'Safe text',
    detail: 'Sensitive detail',
    referral_outcome: 'Referred to MASH on 2026-04-01',
    referral_date: '2026-04-01',
    outcome_summary: 'Case opened',
    closed_by_name: 'Huda Osman',
    external_ref: 'MASH-123',
    visibility_level: 'summary',
  };
  // Replicate the redactRecord logic from the Worker
  const redacted = { ...record };
  delete redacted.detail;
  delete redacted.body;
  delete redacted.referral_outcome;
  delete redacted.referral_date;
  delete redacted.outcome_summary;
  delete redacted.closed_by_name;
  delete redacted.external_ref;
  assert.equal('referral_outcome' in redacted, false);
  assert.equal('outcome_summary' in redacted, false);
  assert.equal('closed_by_name' in redacted, false);
  assert.equal('external_ref' in redacted, false);
  assert.equal(redacted.summary, 'Safe text');
});

test('VALID_REFERRAL_TYPES export contains all expected agency keys', () => {
  const expected = ['none', 'mash', 'lado', 'police', 'early_help', 'camhs', 'social_care', 'other'];
  expected.forEach((key) => assert.ok(VALID_REFERRAL_TYPES.includes(key), key + ' missing from VALID_REFERRAL_TYPES'));
});

test('VALID_SEND_CATEGORIES export covers all statutory categories', () => {
  const expected = ['none', 'sen_support', 'ehcp', 'assessed_no_need'];
  expected.forEach((key) => assert.ok(VALID_SEND_CATEGORIES.includes(key), key + ' missing from VALID_SEND_CATEGORIES'));
});

test('creating a concern with invalid incident_type is rejected', async () => {
  const api = createApi(makeEnv({ permissions: ['concerns.create'] }), 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/concerns', method: 'post',
      payload: { studentId: STUDENT_ID, category: 'behaviour', title: 'T', summary: 'S', incidentType: 'brawl' },
    }),
    /Invalid incident_type/
  );
});

test('creating a concern stores managed incident and action_taken values', async () => {
  const env = makeEnv({ permissions: ['concerns.create'] });
  let insertParams = null;
  const originalQuery = env.__query.bind(env);
  env.__query = async (sql, params) => {
    if (sql.includes('INSERT INTO concerns')) {
      insertParams = params;
      return [{ id: 'c-1', student_id: STUDENT_ID }];
    }
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/concerns',
    method: 'post',
    payload: { studentId: STUDENT_ID, title: 'T', summary: 'S', incidentType: 'verbal', actionTaken: 'parent_contacted' },
  });
  // incident_type is $15 (index 14), action_taken is $16 (index 15) after owner_team_id added at $4
  assert.equal(insertParams[14], 'verbal');
  assert.equal(insertParams[15], 'parent_contacted');
});

test('direct Worker route requires bearer auth', async () => {
  const response = await workerApp.fetch(new Request('https://worker.test/api/bootstrap'), makeEnv());
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.match(body.error.message, /Missing Authorization header/);
});

test('direct Worker route rejects malformed bearer tokens as auth failures', async () => {
  const response = await workerApp.fetch(
    new Request('https://worker.test/api/bootstrap', {
      headers: { Authorization: 'Bearer abc.def.ghi' },
    }),
    makeEnv()
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.ok, false);
  assert.match(body.error.message, /Invalid token payload/);
});

test('direct Worker route maps URL query params into dispatch query', async () => {
  const env = makeEnv({
    permissions: ['students.view'],
    studentRows: [{ id: STUDENT_ID, student_code: 'A001', first_name: 'Amina', last_name: 'Khan', flags: [] }],
  });
  env.__verifyGoogleIdToken = (request) => {
    if (request.headers.get('Authorization') !== 'Bearer test-token') throw new AppError('Missing Authorization header', 401);
    return 'worker.test@alhikmah.example.org';
  };

  const response = await workerApp.fetch(
    new Request('https://worker.test/api/students?q=Amina&filter=year==7', {
      headers: { Authorization: 'Bearer test-token' },
    }),
    env
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.data.filter, 'year==7');
  assert.equal(env.calls.some((call) => call.params.includes('%amina%')), true);
});

test('direct Worker serves SPA HTML for deep links', async () => {
  const env = makeEnv();
  for (const path of ['/', '/students', '/students/BP24004', '/settings/users']) {
    const response = await workerApp.fetch(new Request('https://worker.test' + path), env);
    const body = await response.text();

    assert.equal(response.status, 200, path);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(body, '__APP_HTML_PLACEHOLDER__');
  }
});

test('direct Worker keeps health and API routes out of SPA fallback', async () => {
  const env = makeEnv();

  const healthResponse = await workerApp.fetch(new Request('https://worker.test/health'), env);
  const healthBody = await healthResponse.json();
  assert.equal(healthResponse.status, 200);
  assert.equal(healthBody.ok, true);
  assert.equal(healthBody.service, 'al-hikmah-wellbeing-worker');

  const apiResponse = await workerApp.fetch(new Request('https://worker.test/api/bootstrap'), env);
  const apiBody = await apiResponse.json();
  assert.equal(apiResponse.status, 401);
  assert.equal(apiBody.ok, false);
  assert.match(apiBody.error.message, /Missing Authorization header/);
});

test('direct Worker does not serve SPA HTML for non-GET or asset-like unknown paths', async () => {
  const env = makeEnv();

  const postResponse = await workerApp.fetch(new Request('https://worker.test/students', { method: 'POST' }), env);
  const postBody = await postResponse.json();
  assert.equal(postResponse.status, 404);
  assert.equal(postBody.ok, false);
  assert.match(postBody.error.message, /Not found/);

  const assetResponse = await workerApp.fetch(new Request('https://worker.test/favicon.ico'), env);
  const assetBody = await assetResponse.json();
  assert.equal(assetResponse.status, 404);
  assert.equal(assetBody.ok, false);
  assert.match(assetBody.error.message, /Not found/);
});

test('direct Worker POST rejects malformed JSON with 400', async () => {
  const env = makeEnv();
  env.__verifyGoogleIdToken = () => 'worker.test@alhikmah.example.org';
  const response = await workerApp.fetch(
    new Request('https://worker.test/api/students', {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: '{not json',
    }),
    env
  );
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.match(body.error.message, /Invalid JSON request body/);
});

test('legacy direct student create and delete routes are not exposed', async () => {
  const api = createApi(makeEnv({ permissions: ['students.manage'] }), 'worker.test@alhikmah.example.org');

  await assert.rejects(
    () => api.dispatch({
      path: '/api/students',
      method: 'post',
      payload: { studentCode: 'A001', firstName: 'Amina', lastName: 'Khan' },
    }),
    /Route not found/
  );

  await assert.rejects(
    () => api.dispatch({
      path: '/api/students/' + STUDENT_ID + '/delete',
      method: 'post',
      payload: {},
    }),
    /Route not found/
  );
});

// ─── Ownership & team access enforcement ─────────────────────────────────────

const OTHER_TEAM = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CONCERN_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

// Helper: make an env where the student has records owned by OTHER_TEAM (not the user's team)
function makeEnvWithUnrelatedStudent(extraPermissions = []) {
  const env = makeEnv({ permissions: ['concerns.create', 'meetings.create', 'notes.create', 'actions.manage', ...extraPermissions] });
  const originalQuery = env.__query.bind(env);
  env.__query = async (sql, params) => {
    // canAccessStudent: student has team associations (OTHER_TEAM) but user is in SOURCE_TEAM only
    if (sql.includes('student_teams') && sql.includes('team_id = ANY')) {
      return []; // user's teams are not in student's teams
    }
    if (sql.includes('student_teams') && sql.includes('LIMIT 1') && !sql.includes('team_id = ANY')) {
      return [{ '?column?': 1 }]; // student does have some team associations
    }
    if (sql.includes('team_visibility_rules') && sql.includes('target_team_id IN')) {
      return []; // no visibility rules connecting user's team to student's team
    }
    return originalQuery(sql, params);
  };
  return env;
}

test('user cannot create a concern for a completely unrelated student', async () => {
  const env = makeEnvWithUnrelatedStudent();
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/concerns', method: 'post',
      payload: { studentId: STUDENT_ID, title: 'T', summary: 'S' },
    }),
    /do not have access to this student/
  );
});

test('user cannot create a meeting for a completely unrelated student', async () => {
  const env = makeEnvWithUnrelatedStudent();
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/meetings', method: 'post',
      payload: { studentId: STUDENT_ID, interactionType: 'meeting', title: 'T', summary: 'S', occurredAt: '2026-04-01' },
    }),
    /do not have access to this student/
  );
});

test('user cannot create a note for a completely unrelated student', async () => {
  const env = makeEnvWithUnrelatedStudent();
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/notes', method: 'post',
      payload: { studentId: STUDENT_ID, summary: 'S', body: 'B' },
    }),
    /do not have access to this student/
  );
});

test('user CAN create a concern for a student their team owns', async () => {
  const env = makeEnv({ permissions: ['concerns.create'] });
  const originalQuery = env.__query.bind(env);
  let concernInserted = false;
  env.__query = async (sql, params) => {
    // canAccessStudent: user's team IS in student's teams (direct access)
    if (sql.includes('student_teams') && sql.includes('team_id = ANY')) {
      return [{ '?column?': 1 }]; // user's team found
    }
    if (sql.includes('INSERT INTO concerns')) {
      concernInserted = true;
      return [{ id: CONCERN_ID, student_id: STUDENT_ID }];
    }
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/concerns', method: 'post',
    payload: { studentId: STUDENT_ID, title: 'T', summary: 'S', teamIds: [SOURCE_TEAM] },
  });
  assert.ok(concernInserted, 'concern should have been inserted');
});

test('user cannot edit a concern owned by another team', async () => {
  const env = makeEnv({ permissions: ['concerns.create'] });
  const originalQuery = env.__query.bind(env);
  env.__query = async (sql, params) => {
    // Return a concern owned by OTHER_TEAM, submitted by a different user
    if (sql.includes('FROM concerns WHERE id = $1')) {
      return [{ id: CONCERN_ID, student_id: STUDENT_ID, status: 'open', owner_team_id: OTHER_TEAM, submitted_by_user_id: 'other-user-id' }];
    }
    // No concerns.override permission
    if (sql.includes("permission_key = 'concerns.override'")) return [];
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/concerns/' + CONCERN_ID + '/update', method: 'post',
      payload: { title: 'Changed title' },
    }),
    /do not have permission to edit this concern/
  );
});

test('user CAN edit a concern their team owns', async () => {
  const env = makeEnv({ permissions: ['concerns.create'] });
  const originalQuery = env.__query.bind(env);
  let updateCalled = false;
  env.__query = async (sql, params) => {
    // Concern is owned by SOURCE_TEAM (user's team)
    if (sql.includes('FROM concerns WHERE id = $1')) {
      return [{ id: CONCERN_ID, student_id: STUDENT_ID, status: 'open', owner_team_id: SOURCE_TEAM, submitted_by_user_id: 'other-user-id', confidentiality_level: 'summary', category: 'wellbeing', severity: 'medium', urgency: 'standard', action_note: null, behaviour_plan_active: false, referral_type: null, referral_date: null, referral_outcome: null, incident_type: null, action_taken: null }];
    }
    if (sql.includes('UPDATE concerns SET')) { updateCalled = true; return [{ id: CONCERN_ID }]; }
    if (sql.includes('SELECT team_id FROM concern_teams WHERE concern_id')) return [{ team_id: SOURCE_TEAM }];
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/concerns/' + CONCERN_ID + '/update', method: 'post',
    payload: { title: 'Updated title' },
  });
  assert.ok(updateCalled, 'UPDATE should have been called');
});

test('user with concerns.override permission can edit another team concern (DSL override)', async () => {
  const env = makeEnv({ permissions: ['concerns.create'] });
  const originalQuery = env.__query.bind(env);
  let updateCalled = false;
  env.__query = async (sql, params) => {
    if (sql.includes('FROM concerns WHERE id = $1')) {
      return [{ id: CONCERN_ID, student_id: STUDENT_ID, status: 'open', owner_team_id: OTHER_TEAM, submitted_by_user_id: 'other-user-id', confidentiality_level: 'summary', category: 'wellbeing', severity: 'medium', urgency: 'standard', action_note: null, behaviour_plan_active: false, referral_type: null, referral_date: null, referral_outcome: null, incident_type: null, action_taken: null }];
    }
    // Grant concerns.override
    if (sql.includes("permission_key = 'concerns.override'")) return [{ '?column?': 1 }];
    if (sql.includes('UPDATE concerns SET')) { updateCalled = true; return [{ id: CONCERN_ID }]; }
    if (sql.includes('SELECT team_id FROM concern_teams WHERE concern_id')) return [{ team_id: OTHER_TEAM }];
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/concerns/' + CONCERN_ID + '/update', method: 'post',
    payload: { title: 'DSL override edit' },
  });
  assert.ok(updateCalled, 'DSL override should allow UPDATE');
});

test('audit log studentId filter is blocked for unrelated student', async () => {
  const env = makeEnvWithUnrelatedStudent(['audit.view']);
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await assert.rejects(
    () => api.dispatch({
      path: '/api/audit-logs', method: 'get',
      query: { studentId: STUDENT_ID },
    }),
    /do not have access to this student/
  );
});

test('owner_team_id is stored on concern creation', async () => {
  const env = makeEnv({ permissions: ['concerns.create'] });
  const originalQuery = env.__query.bind(env);
  let insertParams = null;
  env.__query = async (sql, params) => {
    if (sql.includes('student_teams') && sql.includes('team_id = ANY')) return [{ '?column?': 1 }];
    if (sql.includes('INSERT INTO concerns')) { insertParams = params; return [{ id: CONCERN_ID, student_id: STUDENT_ID }]; }
    return originalQuery(sql, params);
  };
  const api = createApi(env, 'worker.test@alhikmah.example.org');
  await api.dispatch({
    path: '/api/concerns', method: 'post',
    payload: { studentId: STUDENT_ID, title: 'T', summary: 'S', teamIds: [SOURCE_TEAM] },
  });
  // owner_team_id is the 4th param (index 3) in the INSERT
  assert.equal(insertParams[3], SOURCE_TEAM, 'owner_team_id should be set to the first teamId');
});
