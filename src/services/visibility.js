const LEVELS = ['none', 'indicator', 'summary', 'full'];

function maxVisibility(left, right) {
  return LEVELS[Math.max(LEVELS.indexOf(left), LEVELS.indexOf(right))];
}

async function getVisibilityMatrix(db, viewerTeamIds) {
  if (!viewerTeamIds?.length) {
    return [];
  }

  const result = await db.query(
    `
      SELECT source_team_id, target_team_id, content_type, visibility_level
      FROM team_visibility_rules
      WHERE deleted_at IS NULL
        AND source_team_id = ANY($1::uuid[])
    `,
    [viewerTeamIds]
  );

  return result.rows;
}

function computeVisibility({ auth, matrix, ownerTeamId, contentType, recordVisibilityLevel }) {
  if (auth.isAdmin) {
    return 'full';
  }

  if (!ownerTeamId) {
    return 'full';
  }

  if (auth.teamIds.includes(ownerTeamId)) {
    return 'full';
  }

  const matching = matrix.filter(
    (rule) => rule.target_team_id === ownerTeamId && rule.content_type === contentType
  );

  const granted = matching.reduce((highest, rule) => maxVisibility(highest, rule.visibility_level), 'none');
  return LEVELS[Math.min(LEVELS.indexOf(granted), LEVELS.indexOf(recordVisibilityLevel || 'full'))];
}

function redactRecord(record, visibility) {
  if (visibility === 'full') {
    return { ...record, visibility };
  }

  const redacted = { ...record, visibility };
  if (visibility === 'summary') {
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
      visibility,
      redacted: true,
    };
  }

  return null;
}

module.exports = {
  getVisibilityMatrix,
  computeVisibility,
  redactRecord,
};
