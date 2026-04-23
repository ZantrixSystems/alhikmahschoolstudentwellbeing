function parseBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

module.exports = {
  port: Number(process.env.API_PORT || 3000),
  apiToken: process.env.APPS_SCRIPT_API_TOKEN || '',
  signingSecret: process.env.APPS_SCRIPT_SIGNING_SECRET || '',
  requestTtlMs: Number(process.env.REQUEST_SIGNATURE_TTL_MS || 5 * 60 * 1000),
  logSensitiveReads: parseBoolean(process.env.LOG_SENSITIVE_READS, true),
};
