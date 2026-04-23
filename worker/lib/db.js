function buildNeonSqlEndpoint(connectionString) {
  const hostMatch = connectionString.match(/@([^\/\?:]+)/);
  if (!hostMatch) {
    throw new Error("Could not parse Neon host from connection string.");
  }

  return `https://${hostMatch[1].replace(/^[^.]+\./, "api.")}/sql`;
}

function mapNeonResult(result) {
  const fields = result.fields ?? [];
  const rows = (result.rows ?? []).map((row) =>
    Object.fromEntries(fields.map((field, index) => [field.name, row[index]])),
  );

  return {
    rows,
    fields,
    rowCount: result.rowCount ?? rows.length,
    command: result.command,
  };
}

export async function neonQuery(env, query, params = [], options = {}) {
  const connectionString = env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL secret is not configured in Cloudflare.");
  }

  const response = await fetch(buildNeonSqlEndpoint(connectionString), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "Neon-Connection-String": connectionString,
      "Neon-Array-Mode": "true",
    },
    body: JSON.stringify({
      query,
      params,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Neon query failed: ${response.status} ${text}`);
  }

  const result = mapNeonResult(JSON.parse(text));
  return options.fullResults ? result : result.rows;
}

export async function neonQueryOne(env, query, params = []) {
  const rows = await neonQuery(env, query, params);
  return rows[0] ?? null;
}
