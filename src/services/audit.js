const { query } = require('../db');

async function writeAuditLog(auth, payload) {
  await query(
    `
      INSERT INTO audit_logs (
        actor_user_id,
        area_key,
        action_key,
        entity_type,
        entity_id,
        student_id,
        target_team_id,
        metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
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

module.exports = {
  writeAuditLog,
};
