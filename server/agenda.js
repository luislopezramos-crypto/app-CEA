// La agenda de la clínica: huecos libres según el turno de cada fisio, reservas sin
// solapes, cambios, cancelaciones, avisos al paciente y recordatorios.
// La usan el asistente (web y WhatsApp), el modo demo y el panel.
import {
  addEvent,
  addMessage,
  all,
  getContact,
  getConversationByContact,
  getFullConversation,
  getSettings,
  now,
  one,
  query,
  updateContact,
} from './db.js';
import { emit, pushMetrics } from './realtime.js';
import { moveStage } from './stage.js';
import { canMessage, sendThroughChannel } from './channels/send.js';

// ---------- Fechas en hora local de la clínica ----------
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const toLocal = (d) => `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export function parseLocal(s) {
  const m = String(s ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0));
  return Number.isNaN(d.getTime()) ? null : d;
}
export const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
export const addDays = (d, n) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};
const hm = (s) => {
  const [h, m] = String(s ?? '').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};
const fromMin = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
const atMinute = (day, min) => {
  const x = startOfDay(day);
  x.setMinutes(min);
  return x;
};
const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
const firstName = (n) => String(n ?? '').split(' ')[0];
export const isEnglish = (lang) => /^(en|ingl|engl)/i.test(String(lang ?? '').trim());

const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// «jueves 20 de noviembre a las 10:00 con Lucía Ferrer»
export function when(a, lang) {
  const d = parseLocal(a.starts_at);
  if (!d) return a.preference ?? '';
  if (isEnglish(lang)) {
    const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });
    return `${day} at ${timeOf(d)}${a.therapist ? ` with ${a.therapist}` : ''}`;
  }
  const day = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');
  return `${day} a las ${timeOf(d)}${a.therapist ? ` con ${a.therapist}` : ''}`;
}

// «la primera valoración», «la sesión de suelo pélvico»…
export function serviceText(name) {
  const n = String(name ?? '').trim();
  if (!n) return 'la cita';
  if (/^primera/i.test(n)) return `la ${n[0].toLowerCase()}${n.slice(1)}`;
  if (/^sesi[oó]n/i.test(n)) return 'la sesión';
  return `la sesión de ${n[0].toLowerCase()}${n.slice(1)}`;
}

// «jue 20 nov · 10:00»
export function shortWhen(a) {
  const d = parseLocal(a.starts_at);
  if (!d) return 'sin hora';
  const day = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[,.]/g, '');
  return `${day} · ${timeOf(d)}`;
}

// ---------- Servicios y equipo ----------
export function minutesOf(text) {
  const all = [...String(text ?? '').matchAll(/(\d+)\s*min/gi)].map((m) => Number(m[1]));
  const n = all.at(-1) ?? Number.parseInt(text, 10);
  return n >= 10 && n <= 240 ? n : 45;
}
const clampDuration = (v) => {
  const n = Number.parseInt(v, 10);
  return n >= 10 && n <= 240 ? n : null;
};

export function findService(s, name) {
  if (!name) return null;
  const n = norm(name).trim();
  return (
    s.servicios.find((x) => norm(x.nombre) === n) ??
    s.servicios.find((x) => norm(x.nombre).includes(n) || n.includes(norm(x.nombre))) ??
    null
  );
}

export function findTherapist(s, name) {
  if (!name) return null;
  const n = norm(name).trim();
  const team = s.equipo.filter((p) => p.nombre?.trim());
  return (
    team.find((p) => norm(p.nombre) === n) ??
    team.find((p) => norm(p.nombre).split(' ')[0] === n.split(' ')[0]) ??
    team.find((p) => norm(p.nombre).includes(n)) ??
    null
  );
}

// Primero el fisio cuya especialidad encaja con el servicio (deportiva → Andrés…).
// Si solo una persona del equipo hace ese servicio (suelo pélvico → Marta), solo ella.
export function preferenceOrder(s, serviceName) {
  const words = norm(serviceName)
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 5)
    .map((w) => w.slice(0, 6));
  const score = (p) => words.filter((w) => norm(`${p.rol} ${p.foco}`).includes(w)).length;
  const ranked = s.equipo
    .filter((p) => p.nombre?.trim())
    .map((p, i) => ({ p, i, sc: score(p) }))
    .sort((a, b) => b.sc - a.sc || a.i - b.i);
  const top = ranked[0]?.sc ?? 0;
  const specialists = ranked.filter((x) => x.sc === top);
  if (top >= 2 && ranked.every((x) => x.sc === top || x.sc === 0)) return specialists.map((x) => x.p);
  return ranked.map((x) => x.p);
}

// Horas en las que atiende cada fisio un día de la semana (0 = domingo), en minutos.
export function windowFor(s, member, weekday) {
  const day = s.agenda.apertura?.[weekday];
  if (!day) return null;
  let a = hm(day[0]);
  let b = hm(day[1]);
  const cut = hm(s.agenda.cambio_turno ?? '15:00');
  if (member?.turno === 'mananas') b = Math.min(b, cut);
  if (member?.turno === 'tardes') a = Math.max(a, cut);
  return a < b ? [a, b] : null;
}

const COLORS = ['#56704f', '#4d6275', '#a0603f', '#6b5470', '#7a6a3f', '#3f6b66'];
const TURNO_LABEL = { completo: 'todo el horario', mananas: 'por las mañanas', tardes: 'por las tardes' };

// Lo que el panel necesita para pintar la agenda.
export function agendaConfig(s = getSettings()) {
  return {
    team: s.equipo
      .filter((p) => p.nombre?.trim())
      .map((p, i) => ({
        nombre: p.nombre,
        rol: p.rol,
        turno: p.turno,
        color: COLORS[i % COLORS.length],
        ventanas: [0, 1, 2, 3, 4, 5, 6].map((wd) => windowFor(s, p, wd)),
      })),
    services: s.servicios.filter((x) => x.nombre?.trim()).map((x) => ({ nombre: x.nombre, minutos: minutesOf(x.duracion) })),
    apertura: s.agenda.apertura,
    cambio_turno: s.agenda.cambio_turno,
    citas_ia: s.agenda.citas_ia,
    asistente: s.asistente.nombre,
  };
}

export const teamForPrompt = (s) =>
  s.equipo
    .filter((p) => p.nombre?.trim())
    .map((p) => `- ${p.nombre}, ${p.rol} (${p.foco}) · atiende ${TURNO_LABEL[p.turno] ?? 'todo el horario'}${p.telefono?.length ? ` · tel. ${p.telefono.join(' / ')}` : ''}${p.whatsapp?.length ? ` · WhatsApp ${p.whatsapp.join(' / ')}` : ''}`)
    .join('\n');

// ---------- Huecos libres ----------
const ACTIVE = "status IN ('pendiente','confirmada')";

// Lo ocupado de cada fisio entre dos días (ambos incluidos), en una sola consulta a la base de datos.
// Devuelve busy(fisio, 'AAAA-MM-DD') → [[inicio, fin], …] en minutos.
async function loadBusy(from, to, excludeId) {
  const rows = await all(
    `SELECT therapist, starts_at, duration FROM appointments
     WHERE ${ACTIVE} AND starts_at >= $1 AND starts_at < $2 AND id <> $3`,
    [`${dayKey(from)}T00:00`, `${dayKey(addDays(startOfDay(to), 1))}T00:00`, excludeId ?? 0],
  );
  const map = new Map();
  for (const x of rows) {
    const key = `${x.therapist}|${x.starts_at.slice(0, 10)}`;
    const a = hm(x.starts_at.slice(11, 16));
    if (!map.has(key)) map.set(key, []);
    map.get(key).push([a, a + x.duration]);
  }
  return (therapist, key) => map.get(`${therapist}|${key}`) ?? [];
}

// Las escrituras de la agenda van de una en una: así dos reservas a la vez nunca se pisan.
// (Además, la propia base de datos rechaza dos citas activas solapadas del mismo fisio.)
let agendaQueue = Promise.resolve();
function serialized(fn) {
  const run = agendaQueue.then(fn, fn);
  agendaQueue = run.catch(() => {});
  return run;
}
const isOverlapError = (err) => err?.code === '23P01';

export const minStartFor = (s) => new Date(Date.now() + (Number(s.agenda.antelacion_horas) || 0) * 3600e3);

// ¿Puede este fisio atender a esa hora? Devuelve el motivo si no.
export async function checkSlot(s, { member, start, duration, minStart, excludeId, busy }) {
  if (!member) return { ok: false, motivo: 'No hay nadie en el equipo con ese nombre' };
  const win = windowFor(s, member, start.getDay());
  const a = start.getHours() * 60 + start.getMinutes();
  const b = a + duration;
  if (!s.agenda.apertura?.[start.getDay()]) return { ok: false, motivo: 'Ese día la clínica está cerrada' };
  if (!win) return { ok: false, motivo: `${member.nombre} no atiende ese día` };
  if (a < win[0] || b > win[1])
    return { ok: false, motivo: `${member.nombre} atiende ese día de ${fromMin(win[0])} a ${fromMin(win[1])}` };
  if (minStart && start < minStart) return { ok: false, motivo: 'Esa hora ya ha pasado o está demasiado cerca' };
  busy ??= await loadBusy(start, start, excludeId);
  for (const [xa, xb] of busy(member.nombre, dayKey(start)))
    if (a < xb && xa < b) return { ok: false, motivo: `${member.nombre} ya tiene una cita a esa hora` };
  return { ok: true };
}

const normFranja = (f) => {
  const n = norm(f);
  if (/manana|morning/.test(n)) return 'manana';
  if (/tarde|afternoon|evening/.test(n)) return 'tarde';
  return null;
};

// Horas libres de un día: [{ min, therapists: [...] }], el primero de la lista es el preferido.
function daySlots(s, day, { members, duration, franja, minStart, step = 30, busy }) {
  const cut = hm(s.agenda.cambio_turno ?? '15:00');
  const f = normFranja(franja);
  const byMin = new Map();
  for (const m of members) {
    const win = windowFor(s, m, day.getDay());
    if (!win) continue;
    const taken = busy(m.nombre, dayKey(day));
    for (let t = Math.ceil(win[0] / step) * step; t + duration <= win[1]; t += step) {
      if (f === 'manana' && t >= cut) continue;
      if (f === 'tarde' && t < cut) continue;
      if (minStart && atMinute(day, t) < minStart) continue;
      if (taken.some(([a, b]) => t < b && a < t + duration)) continue;
      if (!byMin.has(t)) byMin.set(t, []);
      byMin.get(t).push(m.nombre);
    }
  }
  return [...byMin.entries()].sort((a, b) => a[0] - b[0]).map(([min, therapists]) => ({ min, therapists }));
}

// Para el formulario del panel: horas libres de un día, cada 15 minutos.
export async function freeTimes(s, { date, therapist, service, duration = 45, excludeId, minStart }) {
  const members = therapist ? [findTherapist(s, therapist)].filter(Boolean) : preferenceOrder(s, service);
  const busy = await loadBusy(date, date, excludeId);
  return daySlots(s, date, { members, duration, minStart, step: 15, busy }).map((x) => ({
    time: fromMin(x.min),
    therapists: x.therapists,
  }));
}

const spread = (arr, n) =>
  arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / (n - 1))]);

// Para el asistente: unos pocos huecos repartidos (o los más cercanos a la hora que pide).
export async function suggestSlots(s, { desde, hasta, franja, hora, fisio, servicio, duration, minStart, excludeId, maxDays = 4, perDay = 3 }) {
  const svc = findService(s, servicio);
  const dur = clampDuration(duration) ?? (svc ? minutesOf(svc.duracion) : 45);
  const member = fisio ? findTherapist(s, fisio) : null;
  if (fisio && !member) return { error: `No hay nadie en el equipo llamado ${fisio}. El equipo es: ${s.equipo.map((p) => p.nombre).join(', ')}` };
  const members = member ? [member] : preferenceOrder(s, svc?.nombre ?? servicio);
  const from = startOfDay(desde ?? new Date());
  const to = hasta ? startOfDay(hasta) : addDays(from, 13);
  const target = hora ? hm(hora) : null;
  const busy = await loadBusy(from, to, excludeId);
  const out = [];
  let days = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const slots = daySlots(s, d, { members, duration: dur, franja, minStart, step: 30, busy });
    if (!slots.length) continue;
    // Con hora pedida: primero la misma hora o justo después («a partir de las 18»), luego la anterior más cercana.
    const fit = (m) => (m >= target ? m - target : target - m + 45);
    const pick = target != null ? [...slots].sort((a, b) => fit(a.min) - fit(b.min)).slice(0, 2) : spread(slots, perDay);
    out.push(...pick.map((x) => ({ start: toLocal(atMinute(d, x.min)), therapist: x.therapists[0], therapists: x.therapists })));
    if (++days >= maxDays) break;
  }
  return { slots: out, duration: dur, service: svc?.nombre ?? null };
}

// ---------- Lo que dice un paciente: «el martes por la tarde», «mañana a primera hora» ----------
const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

export function parsePreference(text, ref = new Date()) {
  const t = norm(text);
  const out = { dates: [], hour: null, franja: null, first: false };
  const morning = /(por|de|en|a) las? mananas?\b|\bmananas\b|\bmorning\b|primera hora/.test(t);
  const evening = /\btardes?\b|\bafternoon\b|\bevening\b/.test(t);
  out.franja = morning && !evening ? 'manana' : evening && !morning ? 'tarde' : null;
  out.first = /primera hora|lo antes posible|cuanto antes|asap|first thing/.test(t);
  if (/mediodia|\bnoon\b|lunch/.test(t)) out.hour = '13:00';

  // Quitando «por la mañana», lo que queda de «mañana» es el día de mañana.
  const t2 = t.replace(/(por|de|en|a) las? mananas?/g, ' ').replace(/\bmananas\b/g, ' ');
  const today = startOfDay(ref);
  if (/\bhoy\b|\btoday\b/.test(t2)) out.dates.push(today);
  if (/pasado manana/.test(t2)) out.dates.push(addDays(today, 2));
  else if (/\bmanana\b|\btomorrow\b/.test(t2)) out.dates.push(addDays(today, 1));
  for (const [w, wd] of Object.entries(WEEKDAYS)) {
    if (!new RegExp(`\\b${w}\\b`).test(t2)) continue;
    let diff = (wd - today.getDay() + 7) % 7;
    if (diff === 0) diff = 7;
    out.dates.push(addDays(today, diff));
  }
  const dm = t2.match(new RegExp(`\\b(\\d{1,2}) de (${MONTHS.join('|')})\\b`));
  if (dm) {
    let d = new Date(today.getFullYear(), MONTHS.indexOf(dm[2]), Number(dm[1]));
    if (d < today) d = new Date(today.getFullYear() + 1, MONTHS.indexOf(dm[2]), Number(dm[1]));
    out.dates.push(d);
  } else {
    const el = t2.match(/\bel (?:dia )?(\d{1,2})\b(?!\s*(?:h\b|:|horas|de la))/);
    if (el && Number(el[1]) >= 1 && Number(el[1]) <= 31) {
      let d = new Date(today.getFullYear(), today.getMonth(), Number(el[1]));
      if (d < today) d = new Date(today.getFullYear(), today.getMonth() + 1, Number(el[1]));
      out.dates.push(d);
    }
  }
  const h =
    t2.match(/(?:a las|sobre las|hacia las|desde las|a partir de las|despues de las|at|from|after)\s*(\d{1,2})(?:[:.h](\d{2}))?/) ??
    t2.match(/\b(\d{1,2})[:.](\d{2})\b/) ??
    t2.match(/\b(\d{1,2})\s*(?:h|hrs?|horas|pm|am)\b/);
  if (h) {
    let hour = Number(h[1]);
    const min = Number(h[2] ?? 0);
    if (hour < 12 && (/de la tarde|\bpm\b|afternoon|evening/.test(t) || (out.franja === 'tarde' && hour <= 9))) hour += 12;
    if (hour >= 7 && hour <= 21 && min < 60) out.hour = `${pad(hour)}:${pad(min)}`;
  }
  out.dates = [...new Map(out.dates.map((d) => [dayKey(d), d])).values()].sort((a, b) => a - b);
  out.any = Boolean(out.dates.length || out.hour || out.franja || out.first);
  return out;
}

// El hueco que mejor encaja con lo que ha dicho (o null).
export async function slotForPreference(s, pref, { servicio, fisio, minStart } = {}) {
  const days = pref.dates.length ? pref.dates : [startOfDay(new Date())];
  for (const day of days) {
    const r = await suggestSlots(s, {
      desde: day,
      hasta: pref.dates.length ? day : addDays(day, 13),
      franja: pref.franja,
      hora: pref.first ? null : pref.hour,
      fisio,
      servicio,
      minStart,
      maxDays: 1,
      perDay: 40,
    });
    if (r.slots?.length) return r.slots[0];
  }
  return null;
}

// Tres huecos para ofrecer cuando no ha dicho cuándo: uno pronto, uno de tarde y otro otro día.
export async function offerSlots(s, { servicio, fisio, minStart } = {}) {
  const near = async (hora, desde) => (await suggestSlots(s, { servicio, fisio, minStart, hora, desde, maxDays: 1 })).slots?.[0];
  const a = await near('10:00');
  if (!a) return [];
  const [b, c] = await Promise.all([near('18:00', parseLocal(a.start)), near('10:00', addDays(startOfDay(parseLocal(a.start)), 1))]);
  return [a, b, c].filter((x, i, arr) => x && arr.findIndex((y) => y?.start === x.start) === i);
}

// ---------- Lectura ----------
const SELECT_PUBLIC = `SELECT a.*, c.name AS contact_name, c.channel, c.urgency, c.language, cv.id AS conversation_id
  FROM appointments a JOIN contacts c ON c.id = a.contact_id LEFT JOIN conversations cv ON cv.contact_id = c.id`;

export function publicAppointment(r) {
  if (!r) return r;
  return {
    ...r,
    name: r.name ?? r.contact_name ?? null,
    can_notify: Boolean(r.conversation_id) && (r.channel === 'web' || r.channel === 'whatsapp'),
  };
}
export const getAppointment = (id) => one('SELECT * FROM appointments WHERE id = $1', [id]);
export const getPublicAppointment = async (id) => publicAppointment(await one(`${SELECT_PUBLIC} WHERE a.id = $1`, [id]));
export const listAppointments = async () =>
  (await all(`${SELECT_PUBLIC} ORDER BY COALESCE(a.starts_at, a.created_at AT TIME ZONE 'America/Guatemala'), a.id`)).map(publicAppointment);

// Citas que siguen en pie para un contacto (próximas y peticiones sin hora).
export function upcomingFor(contactId) {
  return all(
    `SELECT * FROM appointments WHERE contact_id = $1 AND ${ACTIVE} AND (starts_at IS NULL OR starts_at >= $2)
     ORDER BY starts_at IS NULL, starts_at`,
    [contactId, toLocal(new Date())],
  );
}

const openRequestFor = (contactId) =>
  one("SELECT * FROM appointments WHERE contact_id = $1 AND starts_at IS NULL AND status = 'pendiente' ORDER BY id DESC LIMIT 1", [contactId]);

// ---------- Escritura ----------
// actor: { kind: 'ia' | 'recepcion', name }
export function bookAppointment(args) {
  return serialized(() => bookAppointmentNow(args));
}

async function bookAppointmentNow({ contactId, start, duration, therapist, service, reason, notes, status = 'confirmada', actor, name, requestId, minStart }) {
  const s = getSettings();
  let contact = await getContact(contactId);
  if (!contact) return { ok: false, motivo: 'No existe ese contacto' };
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) return { ok: false, motivo: 'Falta el día o la hora' };
  if (!['confirmada', 'pendiente'].includes(status)) status = 'confirmada';
  const svc = findService(s, service);
  const dur = clampDuration(duration) ?? (svc ? minutesOf(svc.duracion) : 45);

  // El modelo a veces repite la llamada: si ya tiene esa misma cita, se devuelve la que hay.
  const same = await one(`SELECT id FROM appointments WHERE contact_id = $1 AND starts_at = $2 AND ${ACTIVE}`, [contactId, toLocal(start)]);
  if (same) return { ok: true, appointment: await getPublicAppointment(same.id), repeated: true };

  const wanted = therapist ? findTherapist(s, therapist) : null;
  if (therapist && !wanted) return { ok: false, motivo: `No hay nadie en el equipo llamado ${therapist}` };
  const candidates = wanted ? [wanted] : preferenceOrder(s, svc?.nombre ?? service);
  const busy = await loadBusy(start, start);
  let chosen = null;
  let why = 'No queda ningún abogado libre a esa hora';
  for (const m of candidates) {
    const r = await checkSlot(s, { member: m, start, duration: dur, minStart, busy });
    if (r.ok) {
      chosen = m.nombre;
      break;
    }
    if (wanted || candidates.length === 1 || /cerrada|pasado/.test(r.motivo)) why = r.motivo;
  }
  if (!chosen) return { ok: false, motivo: why };

  const who = name ?? contact.name ?? null;
  const t = now();
  // Si tenía una petición sin hora, esa petición se convierte en esta cita.
  const open = requestId
    ? await one('SELECT * FROM appointments WHERE id = $1 AND contact_id = $2', [requestId, contactId])
    : await openRequestFor(contactId);
  const values = [who, reason ?? open?.reason ?? contact.reason ?? null, status, toLocal(start), dur, chosen, svc?.nombre ?? service ?? null, actor.kind, actor.name, notes ?? null, t];
  let id;
  try {
    if (open) {
      await query(
        `UPDATE appointments SET name = $1, reason = $2, status = $3, starts_at = $4, duration = $5, therapist = $6, service = $7, source = $8, booked_by = $9,
           notes = COALESCE($10, notes), updated_at = $11 WHERE id = $12`,
        [...values, open.id],
      );
      id = open.id;
    } else {
      const r = await one(
        `INSERT INTO appointments (name, reason, status, starts_at, duration, therapist, service, source, booked_by, notes, updated_at, contact_id, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $11) RETURNING id`,
        [...values, contactId],
      );
      id = r.id;
    }
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, motivo: `${chosen} ya tiene una cita a esa hora` };
    throw err;
  }

  // Lo que se sabe al reservar (nombre, motivo) se guarda también en la ficha si faltaba.
  const missing = { name: !contact.name && who ? who : undefined, reason: !contact.reason && reason ? reason : undefined };
  if (missing.name || missing.reason) {
    contact = await updateContact(contact.id, missing);
    emit.contact(contact);
  }
  contact = await moveStage(contact, status === 'confirmada' ? 'paciente' : 'quiere_cita');
  const appt = await getPublicAppointment(id);
  emit.event(
    await addEvent({
      type: 'appointment',
      contactId,
      text: `${actor.name} agenda a ${appt.name ?? 'un contacto'}: ${shortWhen(appt)} con ${firstName(chosen)}${status === 'pendiente' ? ' (por confirmar)' : ''}`,
    }),
  );
  emit.appointment(appt);
  pushMetrics();
  return { ok: true, appointment: appt, converted: Boolean(open) };
}

// Petición sin hora: la recepción la coloca en la agenda.
export function requestAppointment(args) {
  return serialized(() => requestAppointmentNow(args));
}

async function requestAppointmentNow({ contactId, name, preference, reason, actor }) {
  let contact = await getContact(contactId);
  const who = name ?? contact.name;
  if (!contact.name && who) {
    contact = await updateContact(contactId, { name: who });
    emit.contact(contact);
  }
  const pending = await openRequestFor(contactId);
  const t = now();
  let id;
  if (pending) {
    await query('UPDATE appointments SET name = $1, preference = $2, reason = $3, updated_at = $4 WHERE id = $5', [who, preference, reason ?? pending.reason ?? null, t, pending.id]);
    id = pending.id;
  } else {
    const r = await one(
      `INSERT INTO appointments (contact_id, name, preference, reason, status, source, booked_by, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'pendiente', $5, $6, $7, $7) RETURNING id`,
      [contactId, who, preference, reason ?? contact.reason ?? null, actor.kind, actor.name, t],
    );
    id = r.id;
  }
  await moveStage(contact, 'quiere_cita');
  const appt = await getPublicAppointment(id);
  emit.event(await addEvent({ type: 'appointment', contactId, text: `${appt.name ?? 'Un contacto'} pide cita sin hora · ${preference}` }));
  pending ? emit.appointmentUpdated(appt) : emit.appointment(appt);
  pushMetrics();
  return { ok: true, appointment: appt, updated: Boolean(pending) };
}

// Cambiar día, hora, fisio, servicio o notas de una cita (o dar hora a una petición).
export function updateAppointment(id, changes, actor, opts = {}) {
  return serialized(() => updateAppointmentNow(id, changes, actor, opts));
}

async function updateAppointmentNow(id, changes, actor, { minStart } = {}) {
  const a = await getAppointment(id);
  if (!a) return { ok: false, motivo: 'No existe esa cita' };
  if (a.status === 'cancelada') return { ok: false, motivo: 'Esa cita está cancelada' };
  const s = getSettings();
  const svc = changes.service !== undefined ? findService(s, changes.service) : null;
  const service = changes.service !== undefined ? svc?.nombre ?? (changes.service || null) : a.service;
  const duration = clampDuration(changes.duration) ?? (changes.service !== undefined && svc ? minutesOf(svc.duracion) : a.duration);
  const start = changes.start ?? parseLocal(a.starts_at);
  if (!start) return { ok: false, motivo: 'Falta el día y la hora' };

  const sameTherapist = !changes.therapist || norm(changes.therapist) === norm(a.therapist);
  const moved = toLocal(start) !== a.starts_at || !sameTherapist || duration !== a.duration;
  let therapist = a.therapist;
  if (moved) {
    const wanted = changes.therapist ? findTherapist(s, changes.therapist) : null;
    if (changes.therapist && !wanted) return { ok: false, motivo: `No hay nadie en el equipo llamado ${changes.therapist}` };
    const current = a.therapist ? findTherapist(s, a.therapist) : null;
    const candidates = wanted ? [wanted] : [current, ...preferenceOrder(s, service)].filter((m, i, arr) => m && arr.indexOf(m) === i);
    const busy = await loadBusy(start, start, id);
    therapist = null;
    let why = 'No queda ningún abogado libre a esa hora';
    for (const m of candidates) {
      const r = await checkSlot(s, { member: m, start, duration, minStart: toLocal(start) !== a.starts_at ? minStart : null, excludeId: id, busy });
      if (r.ok) {
        therapist = m.nombre;
        break;
      }
      if (wanted || m === current) why = r.motivo;
    }
    if (!therapist) return { ok: false, motivo: why };
  }

  try {
    await query(
      `UPDATE appointments SET starts_at = $1, duration = $2, therapist = $3, service = $4, reason = $5, notes = $6, updated_at = $7,
         reminder_sent_at = CASE WHEN $8::boolean THEN NULL ELSE reminder_sent_at END WHERE id = $9`,
      [
        toLocal(start),
        duration,
        therapist,
        service,
        changes.reason !== undefined ? changes.reason || null : a.reason,
        changes.notes !== undefined ? changes.notes || null : a.notes,
        now(),
        toLocal(start) !== a.starts_at,
        id,
      ],
    );
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, motivo: `${therapist} ya tiene una cita a esa hora` };
    throw err;
  }
  const appt = await getPublicAppointment(id);
  if (moved) {
    emit.event(
      await addEvent({
        type: 'appointment',
        contactId: a.contact_id,
        text: a.starts_at
          ? `${actor.name} cambia la cita de ${appt.name ?? 'un contacto'} al ${shortWhen(appt)} con ${firstName(therapist)}`
          : `${actor.name} agenda a ${appt.name ?? 'un contacto'}: ${shortWhen(appt)} con ${firstName(therapist)}`,
      }),
    );
  }
  emit.appointmentUpdated(appt);
  pushMetrics();
  return { ok: true, appointment: appt, moved: moved && Boolean(a.starts_at), scheduled: !a.starts_at };
}

export function setStatus(id, status, actor) {
  return serialized(() => setStatusNow(id, status, actor));
}

async function setStatusNow(id, status, actor) {
  if (!['pendiente', 'confirmada', 'cancelada'].includes(status)) return { ok: false, motivo: 'Estado no válido' };
  const a = await getAppointment(id);
  if (!a) return { ok: false, motivo: 'No existe esa cita' };
  if (a.status === status) return { ok: true, appointment: await getPublicAppointment(id) };
  if (status === 'confirmada' && !a.starts_at) return { ok: false, motivo: 'Ponle día y hora antes de confirmarla' };
  // Volver a activar una cita cancelada: el hueco tiene que seguir libre.
  if (a.status === 'cancelada' && a.starts_at) {
    const s = getSettings();
    const r = await checkSlot(s, { member: findTherapist(s, a.therapist), start: parseLocal(a.starts_at), duration: a.duration, excludeId: id });
    if (!r.ok) return r;
  }
  try {
    await query('UPDATE appointments SET status = $1, updated_at = $2 WHERE id = $3', [status, now(), id]);
  } catch (err) {
    if (isOverlapError(err)) return { ok: false, motivo: `${a.therapist} ya tiene otra cita a esa hora` };
    throw err;
  }
  const appt = await getPublicAppointment(id);
  if (status === 'confirmada') {
    await moveStage(await getContact(a.contact_id), 'paciente');
    emit.event(await addEvent({ type: 'confirmed', contactId: a.contact_id, text: `${actor.name} confirma la cita de ${appt.name ?? 'un contacto'} (${shortWhen(appt)})` }));
  }
  if (status === 'cancelada') {
    emit.event(
      await addEvent({
        type: 'cancelled',
        contactId: a.contact_id,
        text: `${actor.name} cancela la cita de ${appt.name ?? 'un contacto'}${a.starts_at ? ` (${shortWhen(appt)})` : ''}`,
      }),
    );
  }
  emit.appointmentUpdated(appt);
  pushMetrics();
  return { ok: true, appointment: appt };
}

// ---------- Avisos al paciente por su canal ----------
function noticeText(kind, a, contact, s) {
  const en = isEnglish(contact.language);
  const name = firstName(a.name ?? contact.name);
  const w = when(a, contact.language);
  const d = parseLocal(a.starts_at);
  if (en) {
    const hi = `Hi${name ? ` ${name}` : ''}`;
    const rel = d && dayKey(d) === dayKey(new Date()) ? 'today' : 'tomorrow';
    return {
      reservada: `${hi}, this is ${s.clinica}: your appointment is booked for ${w}. We're at ${s.direccion}. If you can't make it, please let us know 24 hours ahead.`,
      pendiente: `${hi}, this is ${s.clinica}: we've pencilled in your appointment for ${w}. We'll confirm it shortly.`,
      confirmada: `${hi}, your appointment at ${s.clinica} on ${w} is confirmed. See you at ${s.direccion}.`,
      movida: `${hi}, we've moved your appointment: it's now on ${w}. If that doesn't suit you, just reply here and we'll find another time.`,
      cancelada: `${hi}, your appointment on ${w} has been cancelled. If you'd like another day, just write to us here.`,
      recordatorio: `${hi}, a reminder of your appointment at ${s.clinica} ${rel} at ${d ? timeOf(d) : ''}${a.therapist ? ` with ${a.therapist}` : ''}. If you can't come, please let us know here as soon as possible.`,
    }[kind];
  }
  const hi = `Hola${name ? `, ${name}` : ''}`;
  const rel = d && dayKey(d) === dayKey(new Date()) ? 'hoy' : 'mañana';
  return {
    reservada: `${hi}. Te escribimos de ${s.clinica}: tu cita queda reservada para el ${w}. Estamos en ${s.direccion}. Si no puedes venir, avísanos con 24 horas.`,
    pendiente: `${hi}. Te escribimos de ${s.clinica}: hemos apuntado tu cita para el ${w}. Te la confirmamos en breve.`,
    confirmada: `${hi}. Tu cita en ${s.clinica} del ${w} queda confirmada. Te esperamos en ${s.direccion}.`,
    movida: `${hi}. Hemos cambiado tu cita: ahora es el ${w}. Si no te va bien, dínoslo por aquí y buscamos otro hueco.`,
    cancelada: `${hi}. Tu cita del ${w} queda cancelada. Si quieres buscar otro día, escríbenos por aquí.`,
    recordatorio: `${hi}. Te recordamos tu cita en ${s.clinica} ${rel} a las ${d ? timeOf(d) : ''}${a.therapist ? ` con ${a.therapist}` : ''}. Si no puedes venir, avísanos por aquí cuanto antes.`,
  }[kind];
}

// Deja el aviso en la conversación (se ve en el panel) y lo manda por la web o WhatsApp.
export async function notifyPatient(id, kind, { author = 'recepcion', authorName = null } = {}) {
  const a = await getAppointment(id);
  if (!a) return { sent: false, reason: 'No existe esa cita' };
  const contact = await getContact(a.contact_id);
  const conv = await getConversationByContact(contact.id);
  if (!conv || !canMessage(contact)) return { sent: false, reason: 'Este paciente no tiene chat ni WhatsApp' };
  const text = noticeText(kind, a, contact, getSettings());
  if (!text) return { sent: false, reason: 'Aviso desconocido' };
  const msg = await addMessage({ conversationId: conv.id, author, authorName, text });
  emit.message(conv.id, msg);
  emit.conversation(await getFullConversation(conv.id));
  await sendThroughChannel(contact, text, { author, authorName });
  return { sent: true };
}

// Recordatorio el día antes (solo pacientes reales con web o WhatsApp).
export async function sendDueReminders() {
  const s = getSettings();
  if (!s.agenda.recordatorio) return;
  const rows = await all(
    `SELECT a.* FROM appointments a JOIN contacts c ON c.id = a.contact_id
     WHERE a.status = 'confirmada' AND a.reminder_sent_at IS NULL AND a.starts_at > $1 AND a.starts_at <= $2
       AND c.external_id NOT LIKE 'demo:%' AND c.channel IN ('web', 'whatsapp')`,
    [toLocal(new Date(Date.now() + 2 * 3600e3)), toLocal(new Date(Date.now() + 24 * 3600e3))],
  );
  for (const a of rows) {
    await query('UPDATE appointments SET reminder_sent_at = $1 WHERE id = $2', [now(), a.id]);
    // Si la reservó hace menos de 12 horas, no hace falta recordársela.
    if (parseLocal(a.starts_at) - new Date(a.created_at) < 12 * 3600e3) continue;
    try {
      const r = await notifyPatient(a.id, 'recordatorio', { author: 'ia' });
      if (r.sent) {
        emit.event(await addEvent({ type: 'reminder', contactId: a.contact_id, text: `Recordatorio enviado a ${a.name ?? 'un paciente'} (${shortWhen(a)})` }));
        emit.appointmentUpdated(await getPublicAppointment(a.id));
      }
    } catch (err) {
      emit.event(await addEvent({ type: 'error', contactId: a.contact_id, text: `No se pudo enviar el recordatorio: ${err.message}` }));
    }
  }
}
