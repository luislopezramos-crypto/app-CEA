// Base de datos en Supabase (Postgres). Antes era un SQLite local en data/clinic.db.
// El esquema está en supabase/migrations/. El servidor entra con su propio usuario
// (clinica_app), por la conexión cifrada del pooler de Supabase (DATABASE_URL en .env).
import pg from 'pg';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// En data/ ya solo queda la sesión de WhatsApp (data/wa-auth).
export const DATA_DIR = process.env.DATA_DIR || join(root, 'data');
mkdirSync(DATA_DIR, { recursive: true });

export const STAGES = ['nuevo', 'interesado', 'quiere_cita', 'paciente'];

// ---------- Conexión ----------
// Las fechas salen como texto, igual que con SQLite, para que el resto de la app no cambie:
// timestamptz → '2026-11-18T18:26:01.443Z' y timestamp (hora local de la cita) → '2026-11-20T10:00'.
const { Pool, types } = pg;
const parseTimestamptz = types.getTypeParser(1184);
types.setTypeParser(1184, (v) => parseTimestamptz(v).toISOString());
types.setTypeParser(1114, (v) => v.slice(0, 16).replace(' ', 'T'));
types.setTypeParser(20, (v) => Number(v)); // COUNT(*) devuelve bigint: lo queremos como número

if (!process.env.DATABASE_URL) {
  throw new Error('Falta DATABASE_URL en .env: es la conexión con la base de datos de Supabase.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Certificado raíz de Supabase: la conexión va cifrada y se comprueba que es Supabase de verdad.
  ssl: { ca: readFileSync(join(root, 'certs', 'supabase-ca-2021.crt'), 'utf8') },
  max: Number(process.env.DB_POOL_MAX || 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 15_000,
});
pool.on('error', (err) => console.error('[base de datos]', err.message));

export const query = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0];
export const all = async (text, params) => (await pool.query(text, params)).rows;

// Varias operaciones que van juntas o no van (por ejemplo, cargar los datos de ejemplo).
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Comprueba al arrancar que la base de datos responde y tiene las tablas.
export async function checkDatabase() {
  const r = await one("SELECT to_regclass('public.appointments') IS NOT NULL AND to_regclass('public.settings') IS NOT NULL AS ok");
  if (!r?.ok) {
    throw new Error('La base de datos de Supabase no tiene las tablas de la clínica. Aplica supabase/migrations/ antes de arrancar.');
  }
}

export const now = () => new Date().toISOString();

// ---------- Ajustes del asistente ----------
// Se leen de Supabase al arrancar y se guardan en memoria: solo este servidor los cambia.
const clinicDefaults = JSON.parse(readFileSync(join(root, 'server', 'clinic.json'), 'utf8'));
let settingsCache = null;

// Ajustes guardados antes de existir la agenda: se completan con los valores por defecto.
function normalizeSettings(s) {
  s.agenda = { ...structuredClone(clinicDefaults.agenda), ...(s.agenda ?? {}) };
  if (!Array.isArray(s.agenda.apertura) || s.agenda.apertura.length !== 7) s.agenda.apertura = structuredClone(clinicDefaults.agenda.apertura);
  s.equipo = (s.equipo ?? []).map((p) => ({
    ...p,
    turno: ['completo', 'mananas', 'tardes'].includes(p.turno)
      ? p.turno
      : clinicDefaults.equipo.find((x) => x.nombre === p.nombre)?.turno ?? 'completo',
  }));
  return s;
}

export async function loadSettings() {
  const row = await one('SELECT value FROM settings WHERE key = $1', ['clinic']);
  settingsCache = normalizeSettings(row ? row.value : structuredClone(clinicDefaults));
  return getSettings();
}

export function getSettings() {
  if (!settingsCache) throw new Error('Los ajustes aún no se han cargado (falta loadSettings() al arrancar).');
  return structuredClone(settingsCache);
}

export async function saveSettings(value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
    ['clinic', JSON.stringify(value)],
  );
  settingsCache = normalizeSettings(structuredClone(value));
}

export function getDefaultSettings() {
  return structuredClone(clinicDefaults);
}

// ---------- Contactos y conversaciones ----------
const parseContact = (c) => (c ? { ...c, tags: Array.isArray(c.tags) ? c.tags : JSON.parse(c.tags || '[]') } : c);

export async function getContact(id) {
  return parseContact(await one('SELECT * FROM contacts WHERE id = $1', [id]));
}

export async function findWebContact(visitorId) {
  return parseContact(await one("SELECT * FROM contacts WHERE channel = 'web' AND external_id = $1", [visitorId]));
}

export async function findOrCreateContact({ channel, externalId, phone = null, name = null }) {
  const t = now();
  const created = await one(
    `INSERT INTO contacts (name, channel, external_id, phone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (channel, external_id) DO NOTHING
     RETURNING *`,
    [name, channel, externalId, phone, t],
  );
  if (created) return { contact: parseContact(created), created: true };
  const c = await one('SELECT * FROM contacts WHERE channel = $1 AND external_id = $2', [channel, externalId]);
  return { contact: parseContact(c), created: false };
}

export async function updateContact(id, fields) {
  const allowed = ['name', 'reason', 'since', 'urgency', 'tags', 'stage', 'summary', 'language', 'phone'];
  const sets = [];
  const vals = [];
  for (const k of allowed) {
    if (fields[k] === undefined) continue;
    vals.push(k === 'tags' ? JSON.stringify(fields[k]) : fields[k]);
    sets.push(k === 'tags' ? `tags = $${vals.length}::jsonb` : `${k} = $${vals.length}`);
  }
  if (!sets.length) return getContact(id);
  vals.push(now());
  sets.push(`updated_at = $${vals.length}`);
  vals.push(id);
  return parseContact(await one(`UPDATE contacts SET ${sets.join(', ')} WHERE id = $${vals.length} RETURNING *`, vals));
}

export async function getConversationByContact(contactId) {
  return one('SELECT * FROM conversations WHERE contact_id = $1', [contactId]);
}

export async function getConversation(id) {
  return one('SELECT * FROM conversations WHERE id = $1', [id]);
}

export async function findOrCreateConversation(contact) {
  const created = await one(
    `INSERT INTO conversations (contact_id, channel, created_at) VALUES ($1, $2, $3)
     ON CONFLICT (contact_id) DO NOTHING RETURNING *`,
    [contact.id, contact.channel, now()],
  );
  return created ?? getConversationByContact(contact.id);
}

export async function setConversationMode(id, mode, handledBy = null) {
  return one('UPDATE conversations SET mode = $1, handled_by = $2 WHERE id = $3 RETURNING *', [mode, handledBy, id]);
}

export async function markRead(id) {
  await query('UPDATE conversations SET unread = 0 WHERE id = $1', [id]);
}

// Guarda el mensaje y actualiza la conversación (última hora y no leídos) en un solo paso.
export async function addMessage({ conversationId, author, authorName = null, text, createdAt = now() }) {
  return one(
    `WITH msg AS (
       INSERT INTO messages (conversation_id, author, author_name, text, created_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING *
     ), upd AS (
       UPDATE conversations SET last_message_at = $5, unread = unread + $6 WHERE id = $1
     )
     SELECT * FROM msg`,
    [conversationId, author, authorName, text, createdAt, author === 'paciente' ? 1 : 0],
  );
}

export async function getMessages(conversationId, limit = 500) {
  return all('SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at, id LIMIT $2', [conversationId, limit]);
}

const CONVERSATION_SELECT = `SELECT cv.*, c.name, c.tags, c.stage, c.urgency, c.phone, c.external_id,
    lm.text AS last_text, lm.author AS last_author
  FROM conversations cv
  JOIN contacts c ON c.id = cv.contact_id
  LEFT JOIN LATERAL (
    SELECT m.text, m.author FROM messages m WHERE m.conversation_id = cv.id ORDER BY m.created_at DESC, m.id DESC LIMIT 1
  ) lm ON true`;

export async function listConversations() {
  return all(`${CONVERSATION_SELECT} ORDER BY cv.last_message_at DESC NULLS LAST`);
}

// Conversación con los datos del contacto (para la bandeja).
export async function getFullConversation(id) {
  return one(`${CONVERSATION_SELECT} WHERE cv.id = $1`, [id]);
}

export async function listContacts() {
  const rows = await all(
    `SELECT c.*, cv.id AS conversation_id, cv.last_message_at,
       (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = cv.id) AS message_count
     FROM contacts c LEFT JOIN conversations cv ON cv.contact_id = c.id
     ORDER BY COALESCE(cv.last_message_at, c.updated_at) DESC`,
  );
  return rows.map(parseContact);
}

// ---------- Usuarios del panel ----------
export async function findUser(username) {
  return one('SELECT * FROM users WHERE username = $1', [username]);
}

export async function countUsers() {
  return (await one('SELECT COUNT(*) AS n FROM users')).n;
}

// ---------- Actividad ----------
export async function addEvent({ type, contactId = null, text, createdAt = now() }) {
  return one('INSERT INTO events (type, contact_id, text, created_at) VALUES ($1, $2, $3, $4) RETURNING *', [type, contactId, text, createdAt]);
}

export async function listEvents(limit = 30) {
  return all('SELECT * FROM events ORDER BY created_at DESC, id DESC LIMIT $1', [limit]);
}

// ---------- Números del día ----------
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function getMetrics() {
  const since = startOfToday();
  const d = new Date();
  const todayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

  const [counts, responses, todayMessages, stageRows] = await Promise.all([
    one(
      `SELECT
         (SELECT COUNT(*) FROM messages WHERE created_at >= $1) AS messages,
         (SELECT COUNT(*) FROM contacts WHERE stage IN ('interesado','quiere_cita') AND updated_at >= $1) AS interested,
         (SELECT COUNT(*) FROM contacts WHERE created_at >= $1) AS new_contacts,
         -- Citas nuevas de hoy (las agende la IA o la recepción) y citas que hay hoy en la agenda.
         (SELECT COUNT(*) FROM appointments WHERE created_at >= $1 AND status <> 'cancelada') AS appointments,
         (SELECT COUNT(*) FROM appointments WHERE starts_at::date = $2::date AND status IN ('pendiente','confirmada')) AS agenda_today,
         (SELECT COUNT(*) FROM appointments WHERE status = 'pendiente') AS pending_appointments`,
      [since, todayKey],
    ),
    // Tiempo de respuesta: para cada mensaje del paciente de hoy, cuánto tardó la
    // siguiente respuesta (IA o recepción) en esa conversación.
    all(
      `SELECT m.created_at AS asked,
         (SELECT MIN(r.created_at) FROM messages r
           WHERE r.conversation_id = m.conversation_id AND r.author <> 'paciente'
             AND (r.created_at > m.created_at OR (r.created_at = m.created_at AND r.id > m.id))) AS answered
       FROM messages m
       WHERE m.author = 'paciente' AND m.created_at >= $1`,
      [since],
    ),
    all('SELECT created_at FROM messages WHERE created_at >= $1', [since]),
    all('SELECT stage, COUNT(*) AS n FROM contacts GROUP BY stage'),
  ]);

  const diffs = responses
    .filter((r) => r.answered)
    .map((r) => (new Date(r.answered) - new Date(r.asked)) / 1000)
    .filter((s) => s >= 0 && s < 6 * 3600);
  const avgResponse = diffs.length ? diffs.reduce((a, b) => a + b, 0) / diffs.length : null;

  // Mensajes por hora de hoy, para el gráfico de Inicio.
  const byHour = Array.from({ length: 24 }, () => 0);
  for (const r of todayMessages) byHour[new Date(r.created_at).getHours()] += 1;

  const stages = Object.fromEntries(STAGES.map((s) => [s, 0]));
  for (const r of stageRows) stages[r.stage] = r.n;

  return {
    messages: counts.messages,
    interested: counts.interested,
    newContacts: counts.new_contacts,
    appointments: counts.appointments,
    agendaToday: counts.agenda_today,
    pendingAppointments: counts.pending_appointments,
    avgResponse,
    byHour,
    stages,
  };
}
