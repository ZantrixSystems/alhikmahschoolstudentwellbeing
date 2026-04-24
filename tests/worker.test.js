import assert from 'node:assert/strict';
import test from 'node:test';
import { createApi, hmacHex, verifySignedAppsScriptRequest } from '../worker/index.js';

const USER_ID = '11111111-1111-1111-1111-111111111111';
const SOURCE_TEAM = '22222222-2222-2222-2222-222222222222';
const TARGET_TEAM = '33333333-3333-3333-3333-333333333333';
const STUDENT_ID = '44444444-4444-4444-4444-444444444444';

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

  const env = {
    WORKER_SHARED_SECRET: 'test-secret',
    calls,
    async __query(sql, params) {
      calls.push({ sql, params });
      if (sql.includes('FROM app_settings')) {
        return [
          { key: 'auth.enforceDomainRestriction', value: false },
          { key: 'auth.allowedDomains', value: [] },
        ];
      }
      if (sql.includes('FROM users u') && sql.includes('LOWER(u.email)')) {
        return [{
          id: USER_ID,
          email: 'worker.test@alhikmah.example.org',
          display_name: 'Worker Test',
          primary_team_id: null,
          is_active: true,
          role_keys: roleKeys,
          team_ids: teamIds,
        }];
      }
      if (sql.includes('SELECT DISTINCT p.permission_key')) {
        return permissions.map((permission_key) => ({ permission_key }));
      }
      if (sql.includes('p.permission_key = $2')) {
        return permissions.includes(params[1]) || roleKeys.includes('admin') ? [{ '?column?': 1 }] : [];
      }
      if (sql.includes('FROM students s') && sql.includes('GROUP BY s.id') && sql.includes('AS flags')) {
        return profileRows;
      }
      if (sql.includes('FROM student_team_radar str')) return [];
      if (sql.includes('FROM meetings m LEFT JOIN teams')) return meetingRows;
      if (sql.includes('FROM chronology_events')) return chronologyRows;
      if (sql.includes('FROM concerns c')) return [];
      if (sql.includes('FROM actions a LEFT JOIN teams')) return [];
      if (sql.includes('FROM notes n')) return [];
      if (sql.includes('JSON_AGG') && sql.includes('FROM students s')) return studentRows;
      if (sql.includes("SELECT * FROM (") && sql.includes("'follow_up' AS item_type")) return calendarRows;
      if (sql.includes('FROM team_visibility_rules') && sql.includes('source_team_id')) {
        return visibilityRules;
      }
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

test('signed request nonce cannot be replayed', async () => {
  const seen = new Set();
  const env = {
    WORKER_SHARED_SECRET: 'test-secret',
    async __query(sql, params) {
      if (sql.startsWith('DELETE FROM signed_request_nonces')) return [];
      if (sql.includes('INSERT INTO signed_request_nonces')) {
        const key = params[0] + ':' + params[1];
        if (seen.has(key)) return [];
        seen.add(key);
        return [{ nonce_hash: params[1] }];
      }
      return [];
    },
  };
  const body = JSON.stringify({ path: '/api/bootstrap', method: 'get', query: {}, payload: {} });
  const timestamp = String(Date.now());
  const nonce = 'nonce-1';
  const email = 'worker.test@alhikmah.example.org';
  const signature = await hmacHex('test-secret', [timestamp, nonce, email, body].join('\n'));
  const request = () => new Request('https://worker.test/api/proxy', {
    method: 'POST',
    body,
    headers: {
      'X-AHW-Key-Id': 'apps-script-main',
      'X-AHW-Timestamp': timestamp,
      'X-AHW-Nonce': nonce,
      'X-AHW-User-Email': email,
      'X-AHW-Signature': signature,
    },
  });

  await verifySignedAppsScriptRequest(request(), body, env);
  await assert.rejects(
    () => verifySignedAppsScriptRequest(request(), body, env),
    /nonce has already been used/
  );
});
