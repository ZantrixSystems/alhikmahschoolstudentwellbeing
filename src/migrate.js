require('dotenv').config({ path: '.env.local' });

const fs = require('fs');
const path = require('path');
const { withClient } = require('./db');

async function ensureMigrationsTable(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function run() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  await withClient(async (client) => {
    await ensureMigrationsTable(client);

    for (const file of files) {
      const existing = await client.query(
        'SELECT 1 FROM schema_migrations WHERE id = $1',
        [file]
      );

      if (existing.rowCount > 0) {
        continue;
      }

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (id) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`Applied migration: ${file}`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
  });
}

run()
  .then(() => {
    console.log('Migrations complete.');
    process.exit(0);
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

