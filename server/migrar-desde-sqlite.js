// Copia la base de datos antigua (SQLite, data/clinic.db) a Supabase, tal cual:
// mismos ids, mismas fechas, mismas citas. Vacía antes las tablas de Supabase.
// Uso: npm run migrar-sqlite  (o: node server/migrar-desde-sqlite.js ruta/a/clinic.db)
import './tz.js';
import 'dotenv/config';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR, one, pool, transaction } from './db.js';

const file = process.argv[2] || join(DATA_DIR, 'clinic.db');
if (!existsSync(file)) {
  console.error(`No encuentro la base de datos antigua en ${file}`);
  process.exit(1);
}
const lite = new DatabaseSync(file, { readOnly: true });
const rows = (sql) => lite.prepare(sql).all();

// tabla → columnas que se copian (en el orden de Supabase)
const TABLES = [
  ['settings', ['key', 'value']],
  ['users', ['id', 'username', 'name', 'role', 'password_hash']],
  ['contacts', ['id', 'name', 'channel', 'external_id', 'phone', 'reason', 'since', 'urgency', 'tags', 'stage', 'summary', 'language', 'created_at', 'updated_at']],
  ['conversations', ['id', 'contact_id', 'channel', 'mode', 'handled_by', 'unread', 'last_message_at', 'created_at']],
  ['messages', ['id', 'conversation_id', 'author', 'author_name', 'text', 'created_at']],
  ['events', ['id', 'type', 'contact_id', 'text', 'created_at']],
  [
    'appointments',
    ['id', 'contact_id', 'name', 'preference', 'reason', 'status', 'starts_at', 'duration', 'therapist', 'service', 'source', 'booked_by', 'notes', 'reminder_sent_at', 'created_at', 'updated_at'],
  ],
];
const JSONB = new Set(['settings.value', 'contacts.tags']);

async function insertMany(client, table, cols, data) {
  for (let i = 0; i < data.length; i += 300) {
    const chunk = data.slice(i, i + 300);
    const params = [];
    const values = chunk.map(
      (r) => `(${cols.map((c) => `$${params.push(r[c] ?? null)}${JSONB.has(`${table}.${c}`) ? '::jsonb' : ''}`).join(', ')})`,
    );
    await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}`, params);
  }
}

const summary = [];
await transaction(async (db) => {
  await db.query('TRUNCATE events, appointments, messages, conversations, contacts, users, settings CASCADE');
  for (const [table, cols] of TABLES) {
    const data = rows(`SELECT * FROM ${table} ORDER BY 1`);
    await insertMany(db, table, cols, data);
    if (cols.includes('id')) {
      // Los próximos registros siguen numerando después del último copiado.
      await db.query(`SELECT setval(pg_get_serial_sequence('public.${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 0) + 1, false)`);
    }
    summary.push([table, data.length]);
  }
});

console.log('Copiado de SQLite a Supabase:');
for (const [table, n] of summary) {
  const inSupabase = (await one(`SELECT COUNT(*) AS n FROM ${table}`)).n;
  console.log(`  ${table.padEnd(14)} ${String(n).padStart(4)} filas → en Supabase: ${inSupabase}${inSupabase === n ? '' : '  ¡NO COINCIDE!'}`);
}
await pool.end();
