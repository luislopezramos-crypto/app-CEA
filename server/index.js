// Servidor: web de la clínica, API del panel, chat en directo, agenda y WhatsApp.
import './tz.js';
import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import bcrypt from 'bcryptjs';
import { createServer } from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from 'socket.io';

import {
  STAGES,
  addEvent,
  addMessage,
  checkDatabase,
  countUsers,
  findOrCreateContact,
  findUser,
  findWebContact,
  getContact,
  getConversation,
  getConversationByContact,
  getDefaultSettings,
  getMessages,
  getMetrics,
  getSettings,
  listContacts,
  listConversations,
  listEvents,
  loadSettings,
  markRead,
  saveSettings,
  setConversationMode,
  updateContact,
} from './db.js';
import {
  agendaConfig,
  bookAppointment,
  freeTimes,
  getAppointment,
  listAppointments,
  notifyPatient,
  parseLocal,
  sendDueReminders,
  setStatus,
  startOfDay,
  updateAppointment,
} from './agenda.js';
import { emit, pushMetrics, setIO } from './realtime.js';
import { publicContact, publicConversation, publicMessage } from './privacy.js';
import { fullConversation, handleIncoming, hasApiKey, moveStage, previewReply, sendThroughChannel } from './assistant.js';
import * as wa from './channels/whatsapp.js';
import {
  allowIpMessage,
  allowNewConversation,
  allowPreview,
  apiRateLimit,
  clientIp,
  closeSocket,
  loginBlocked,
  loginFailed,
  loginSucceeded,
  openSocket,
  waitText,
} from './limits.js';
import { isDemoRunning, runDemo } from './demo.js';
import { seed } from './seed.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

// Base de datos en Supabase: se comprueba que responde, se leen los ajustes y,
// si está vacía (sin usuarios del panel), se cargan los datos de ejemplo.
await checkDatabase();
if (!(await countUsers())) {
  console.log('Base de datos vacía: cargando datos de ejemplo…');
  await seed();
}
await loadSettings();

const app = express();
const http = createServer(app);
// maxHttpBufferSize: ningún mensaje del chat necesita más de 16 KB.
const io = new Server(http, { cors: { origin: false }, maxHttpBufferSize: 16_000 });
setIO(io);

// En Render (y otros alojamientos) la app va detrás de un proxy con HTTPS: así la
// cookie del panel sale marcada como segura cuando se entra por https.
app.set('trust proxy', 1);

if (!process.env.SESSION_SECRET) console.warn('Aviso: SESSION_SECRET no está en .env; las sesiones se pierden al reiniciar.');
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || randomBytes(32).toString('hex'),
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 1000 * 60 * 60 * 12 },
});
app.use(sessionMiddleware);
app.use(express.json({ limit: '200kb' }));
// Tope de peticiones por IP a la API (panel y web).
app.use('/api', apiRateLimit);

const requireUser = (req, res, next) => (req.session.user ? next() : res.status(401).json({ error: 'No has iniciado sesión' }));
const int = (v) => Number.parseInt(v, 10);

// ---------- Acceso ----------
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body ?? {};
  const user = String(username ?? '').trim().toLowerCase().slice(0, 60);
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  // Contra quien prueba contraseñas una tras otra: tras varios fallos, hay que esperar.
  const lock = loginBlocked(ip, user);
  if (lock.blocked) return res.status(429).json({ error: `Demasiados intentos fallidos. Espera ${waitText(lock.retryMs)} y vuelve a probar.` });
  const u = await findUser(user);
  if (!u || !bcrypt.compareSync(String(password ?? ''), u.password_hash)) {
    loginFailed(ip, user);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }
  loginSucceeded(user);
  req.session.regenerate(() => {
    req.session.user = { id: u.id, name: u.name, username: u.username, role: u.role };
    res.json(req.session.user);
  });
});
app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get('/api/me', (req, res) => (req.session.user ? res.json(req.session.user) : res.status(401).json(null)));

// ---------- Datos del panel ----------
app.get('/api/bootstrap', requireUser, async (req, res) => {
  const [metrics, conversations, contacts, appointments, events] = await Promise.all([
    getMetrics(),
    listConversations(),
    listContacts(),
    listAppointments(),
    listEvents(),
  ]);
  res.json({
    user: req.session.user,
    metrics,
    conversations: conversations.map(publicConversation),
    contacts: contacts.map(publicContact),
    appointments,
    agenda: agendaConfig(),
    events,
    whatsapp: wa.publicState(),
    hasApiKey: hasApiKey(),
    demoRunning: isDemoRunning(),
    clinic: { name: getSettings().clinica, assistant: getSettings().asistente.nombre },
  });
});

app.get('/api/conversations/:id/messages', requireUser, async (req, res) => {
  const conv = await getConversation(int(req.params.id));
  if (!conv) return res.status(404).json({ error: 'No existe' });
  await markRead(conv.id);
  emit.conversation(await fullConversation(conv.id));
  const [messages, contact] = await Promise.all([getMessages(conv.id), getContact(conv.contact_id)]);
  res.json({ messages: messages.map(publicMessage), contact: publicContact(contact) });
});

app.post('/api/conversations/:id/takeover', requireUser, async (req, res) => {
  const conv = await getConversation(int(req.params.id));
  if (!conv) return res.status(404).json({ error: 'No existe' });
  await setConversationMode(conv.id, 'humano', req.session.user.name);
  const contact = await getContact(conv.contact_id);
  emit.event(await addEvent({ type: 'takeover', contactId: contact.id, text: `${req.session.user.name} toma el control de la conversación con ${contact.name ?? 'un contacto'}` }));
  const full = await fullConversation(conv.id);
  emit.conversation(full);
  if (contact.channel === 'web') io.to(`visitor:${contact.external_id}`).emit('chat:agent', { name: req.session.user.name });
  res.json(publicConversation(full));
});

app.post('/api/conversations/:id/release', requireUser, async (req, res) => {
  const conv = await getConversation(int(req.params.id));
  if (!conv) return res.status(404).json({ error: 'No existe' });
  await setConversationMode(conv.id, 'ia', null);
  const contact = await getContact(conv.contact_id);
  emit.event(await addEvent({ type: 'release', contactId: contact.id, text: `${req.session.user.name} devuelve la conversación al asistente` }));
  const full = await fullConversation(conv.id);
  emit.conversation(full);
  if (contact.channel === 'web') io.to(`visitor:${contact.external_id}`).emit('chat:agent', { name: null });
  res.json(publicConversation(full));
});

app.post('/api/conversations/:id/messages', requireUser, async (req, res) => {
  const conv = await getConversation(int(req.params.id));
  const text = String(req.body?.text ?? '').trim().slice(0, 2000);
  if (!conv || !text) return res.status(400).json({ error: 'Falta el mensaje' });
  const contact = await getContact(conv.contact_id);
  // Escribir desde el panel toma el control automáticamente.
  if (conv.mode !== 'humano') {
    await setConversationMode(conv.id, 'humano', req.session.user.name);
    if (contact.channel === 'web') io.to(`visitor:${contact.external_id}`).emit('chat:agent', { name: req.session.user.name });
  }
  const msg = await addMessage({ conversationId: conv.id, author: 'recepcion', authorName: req.session.user.name, text });
  await markRead(conv.id);
  emit.message(conv.id, msg);
  emit.conversation(await fullConversation(conv.id));
  pushMetrics();
  try {
    await sendThroughChannel(contact, text, { author: 'recepcion', authorName: req.session.user.name });
  } catch (err) {
    return res.status(502).json({ error: `Guardado, pero no se pudo enviar: ${err.message}` });
  }
  res.json(publicMessage(msg));
});

app.patch('/api/contacts/:id', requireUser, async (req, res) => {
  let contact = await getContact(int(req.params.id));
  if (!contact) return res.status(404).json({ error: 'No existe' });
  const b = req.body ?? {};
  // Texto opcional: si viene, se limpia y se recorta; vacío = borrar el dato.
  const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) || null : undefined);
  if (b.urgency !== undefined && b.urgency !== null && b.urgency !== '' && !['baja', 'media', 'alta'].includes(b.urgency))
    return res.status(400).json({ error: 'La urgencia tiene que ser baja, media o alta' });
  if (b.stage !== undefined && !STAGES.includes(b.stage)) return res.status(400).json({ error: 'Etapa no válida' });
  if (typeof b.name === 'string' && !b.name.trim() && contact.name) return res.status(400).json({ error: 'El nombre no puede quedar vacío' });
  // El teléfono solo se escribe (nunca vuelve completo al panel). Vacío = no cambiarlo.
  let phone;
  if (typeof b.phone === 'string' && b.phone.trim()) {
    phone = b.phone.replace(/[^\d+]/g, '').slice(0, 20);
    if (phone.replace(/\D/g, '').length < 9) return res.status(400).json({ error: 'El teléfono tiene que tener al menos 9 cifras' });
  }

  const fields = {
    name: text(b.name, 80),
    reason: text(b.reason, 200),
    since: text(b.since, 80),
    summary: text(b.summary, 500),
    language: text(b.language, 30),
    urgency: b.urgency === undefined ? undefined : b.urgency || null,
    tags: Array.isArray(b.tags) ? [...new Set(b.tags.map((t) => String(t).trim().slice(0, 40)).filter(Boolean))].slice(0, 8) : undefined,
    phone,
  };
  const changed = Object.entries(fields).filter(([k, v]) => v !== undefined && JSON.stringify(v) !== JSON.stringify(contact[k]));

  if (b.stage && b.stage !== contact.stage) contact = await moveStage(contact, b.stage, { manual: true });
  if (changed.length) {
    contact = await updateContact(contact.id, Object.fromEntries(changed));
    emit.contact(contact);
    // Los cambios de etiquetas sueltas (quitar o añadir una) no llenan la actividad; editar la ficha, sí.
    if (changed.some(([k]) => k !== 'tags')) {
      emit.event(await addEvent({ type: 'contact', contactId: contact.id, text: `${req.session.user.name} edita la ficha de ${contact.name ?? 'un contacto'}` }));
    }
  }
  pushMetrics();
  res.json(publicContact(contact));
});

// ---------- Agenda ----------
const actorOf = (req) => ({ kind: 'recepcion', name: req.session.user.name });
const today0 = () => startOfDay(new Date());

// Avisa al paciente por su canal; si falla, la cita queda guardada igual.
async function tryNotify(req, id, kind) {
  try {
    const r = await notifyPatient(id, kind, { author: 'recepcion', authorName: req.session.user.name });
    return r.sent ? null : r.reason;
  } catch (err) {
    return `No se pudo enviar el aviso: ${err.message}`;
  }
}

app.get('/api/agenda/slots', requireUser, async (req, res) => {
  const date = parseLocal(String(req.query.date ?? ''));
  if (!date) return res.status(400).json({ error: 'Falta el día' });
  const duration = Math.min(240, Math.max(10, int(req.query.duration) || 45));
  const slots = await freeTimes(getSettings(), {
    date,
    therapist: req.query.therapist ? String(req.query.therapist) : null,
    service: req.query.service ? String(req.query.service) : null,
    duration,
    excludeId: int(req.query.exclude) || null,
    minStart: new Date(),
  });
  res.json({ slots });
});

app.post('/api/appointments', requireUser, async (req, res) => {
  const b = req.body ?? {};
  let contactId = int(b.contact_id);
  // Cliente nuevo que llama o viene en persona: se crea el contacto (canal «teléfono»).
  if (!contactId && typeof b.new_contact?.name === 'string' && b.new_contact.name.trim()) {
    const phone = String(b.new_contact.phone ?? '').replace(/[^\d+]/g, '').slice(0, 20) || null;
    const { contact } = await findOrCreateContact({ channel: 'telefono', externalId: `tel:${randomUUID()}`, phone, name: b.new_contact.name.trim().slice(0, 80) });
    contactId = contact.id;
    emit.event(await addEvent({ type: 'contact', contactId, text: `${req.session.user.name} añade a ${contact.name} (por teléfono)` }));
    emit.contact(contact);
  }
  if (!contactId || !(await getContact(contactId))) return res.status(400).json({ error: 'Elige un paciente' });
  const start = parseLocal(String(b.starts_at ?? ''));
  if (!start) return res.status(400).json({ error: 'Elige día y hora' });
  const r = await bookAppointment({
    contactId,
    start,
    duration: b.duration,
    therapist: b.therapist || null,
    service: b.service || null,
    reason: typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) || null : null,
    notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) || null : null,
    status: b.status === 'pendiente' ? 'pendiente' : 'confirmada',
    actor: actorOf(req),
    requestId: int(b.request_id) || null,
    minStart: today0(),
  });
  if (!r.ok) return res.status(409).json({ error: r.motivo });
  const warning = b.notify ? await tryNotify(req, r.appointment.id, r.appointment.status === 'pendiente' ? 'pendiente' : 'reservada') : null;
  res.json({ appointment: r.appointment, warning });
});

app.patch('/api/appointments/:id', requireUser, async (req, res) => {
  const b = req.body ?? {};
  const before = await getAppointment(int(req.params.id));
  if (!before) return res.status(404).json({ error: 'No existe esa cita' });
  const start = b.starts_at !== undefined ? parseLocal(String(b.starts_at)) : null;
  if (b.starts_at !== undefined && !start) return res.status(400).json({ error: 'Elige día y hora' });
  const r = await updateAppointment(
    before.id,
    {
      start,
      therapist: b.therapist || null,
      duration: b.duration,
      service: b.service,
      reason: typeof b.reason === 'string' ? b.reason.trim().slice(0, 200) : undefined,
      notes: typeof b.notes === 'string' ? b.notes.trim().slice(0, 500) : undefined,
    },
    actorOf(req),
    { minStart: today0() },
  );
  if (!r.ok) return res.status(409).json({ error: r.motivo });
  let appointment = r.appointment;
  if (b.status && b.status !== appointment.status) {
    const st = await setStatus(appointment.id, b.status, actorOf(req));
    if (!st.ok) return res.status(409).json({ error: st.motivo });
    appointment = st.appointment;
  }
  let warning = null;
  if (b.notify && (r.moved || r.scheduled)) warning = await tryNotify(req, appointment.id, r.moved ? 'movida' : appointment.status === 'pendiente' ? 'pendiente' : 'reservada');
  res.json({ appointment, moved: r.moved, warning });
});

app.post('/api/appointments/:id/status', requireUser, async (req, res) => {
  const status = String(req.body?.status ?? '');
  const r = await setStatus(int(req.params.id), status, actorOf(req));
  if (!r.ok) return res.status(r.motivo === 'No existe esa cita' ? 404 : 409).json({ error: r.motivo });
  let warning = null;
  if (req.body?.notify && (status === 'confirmada' || status === 'cancelada')) warning = await tryNotify(req, r.appointment.id, status);
  res.json({ appointment: r.appointment, warning });
});

app.post('/api/appointments/:id/notify', requireUser, async (req, res) => {
  const kind = ['reservada', 'confirmada', 'movida', 'cancelada', 'recordatorio'].includes(req.body?.kind) ? req.body.kind : 'movida';
  if (!(await getAppointment(int(req.params.id)))) return res.status(404).json({ error: 'No existe esa cita' });
  const warning = await tryNotify(req, int(req.params.id), kind);
  if (warning) return res.status(409).json({ error: warning });
  res.json({ ok: true });
});

// ---------- Asistente ----------
app.get('/api/settings', requireUser, (req, res) => res.json({ settings: getSettings(), hasApiKey: hasApiKey() }));

function validSettings(s) {
  const okAgenda =
    s?.agenda === undefined ||
    (typeof s.agenda === 'object' &&
      Array.isArray(s.agenda.apertura) &&
      s.agenda.apertura.length === 7 &&
      s.agenda.apertura.every((d) => d === null || (Array.isArray(d) && d.length === 2 && d.every((x) => /^\d{1,2}:\d{2}$/.test(x)))));
  return (
    s && typeof s === 'object' && typeof s.clinica === 'string' && s.asistente && typeof s.asistente.nombre === 'string' &&
    Array.isArray(s.servicios) && Array.isArray(s.horario) && Array.isArray(s.faq) && Array.isArray(s.mutuas) && Array.isArray(s.equipo) && okAgenda
  );
}
app.put('/api/settings', requireUser, async (req, res) => {
  const s = req.body?.settings;
  if (!validSettings(s)) return res.status(400).json({ error: 'Faltan campos del asistente' });
  await saveSettings(s);
  io.to('panel').emit('settings:updated', s);
  emit.agendaConfig(agendaConfig());
  emit.event(await addEvent({ type: 'settings', text: `${req.session.user.name} actualiza la configuración del asistente` }));
  res.json({ settings: getSettings() });
});
app.post('/api/settings/reset', requireUser, async (req, res) => {
  const s = getDefaultSettings();
  await saveSettings(s);
  io.to('panel').emit('settings:updated', s);
  emit.agendaConfig(agendaConfig());
  res.json({ settings: getSettings() });
});
app.post('/api/assistant/preview', requireUser, async (req, res) => {
  const lim = allowPreview(req.session.user.id);
  if (!lim.ok) return res.status(429).json({ error: `Has hecho muchas pruebas seguidas. Espera ${waitText(lim.retryMs)}.` });
  const history = (req.body?.history ?? [])
    .filter((h) => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string')
    .slice(-20);
  const s = validSettings(req.body?.settings) ? { ...getSettings(), ...req.body.settings } : undefined;
  try {
    res.json({ reply: await previewReply(history, s) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------- WhatsApp ----------
const onWhatsApp = (m) => handleIncoming(m).catch((err) => console.error('[whatsapp]', err));
app.get('/api/whatsapp', requireUser, (req, res) => res.json(wa.publicState()));
app.post('/api/whatsapp/connect', requireUser, async (req, res) => res.json(await wa.start({ onMessage: onWhatsApp })));
app.post('/api/whatsapp/logout', requireUser, async (req, res) => res.json(await wa.logout()));

// ---------- Demo ----------
app.post('/api/demo', requireUser, async (req, res) => {
  const started = await runDemo();
  if (started) emit.event(await addEvent({ type: 'demo', text: 'Modo demo: entran pacientes simulados' }));
  io.to('panel').emit('demo:status', { running: true });
  res.json({ started });
});

// ---------- Comprobación de salud (Render la usa para saber si la app está viva) ----------
app.get('/healthz', async (req, res) => {
  try {
    await checkDatabase();
    res.json({ ok: true });
  } catch (err) {
    res.status(503).json({ ok: false, error: 'Sin conexión con la base de datos' });
  }
});

// ---------- Público: datos para el widget ----------
const VISITOR_RE = /^[a-z0-9-]{12,64}$/i;
app.get('/api/public/clinic', (req, res) => {
  const s = getSettings();
  res.json({ clinic: s.clinica, assistant: s.asistente.nombre });
});
app.get('/api/public/chat', async (req, res) => {
  const visitor = String(req.query.visitor ?? '');
  if (!VISITOR_RE.test(visitor)) return res.json({ messages: [], agent: null });
  const c = await findWebContact(visitor);
  if (!c) return res.json({ messages: [], agent: null });
  const conv = await getConversationByContact(c.id);
  res.json({
    messages: conv ? (await getMessages(conv.id)).map(({ author, author_name, text, created_at }) => ({ author, authorName: author_name, text, created_at })) : [],
    agent: conv?.mode === 'humano' ? conv.handled_by : null,
  });
});

// ---------- Sockets ----------
io.engine.use(sessionMiddleware);
// Visitantes de la web que ya tienen conversación (para no contar dos veces una conversación nueva).
const knownVisitors = new Set();
const busyText = (ms) => `Has escrito muchos mensajes seguidos. Espera ${waitText(ms)} y vuelve a escribirnos, por favor.`;

io.on('connection', (socket) => {
  const user = socket.request.session?.user;
  if (user) socket.join('panel');
  const ip = clientIp(socket.handshake.headers, socket.handshake.address);

  // Demasiadas conexiones abiertas desde la misma IP: se corta (el panel no cuenta).
  if (!user) {
    if (!openSocket(ip)) {
      socket.emit('chat:error', { error: 'Hay demasiadas conexiones abiertas desde tu red. Cierra alguna pestaña y vuelve a intentarlo.' });
      return socket.disconnect(true);
    }
    socket.on('disconnect', () => closeSocket(ip));
  }

  let visitorId = null;
  socket.on('chat:join', ({ visitorId: id } = {}) => {
    if (!VISITOR_RE.test(String(id))) return;
    visitorId = String(id);
    socket.join(`visitor:${visitorId}`);
  });
  socket.on('chat:send', async ({ text } = {}) => {
    if (!visitorId) return;
    const clean = String(text ?? '').trim().slice(0, 1500);
    if (!clean) return;
    try {
      // Límite por IP (aunque cambie de navegador o borre sus datos).
      const byIp = allowIpMessage(ip);
      if (!byIp.ok) return socket.emit('chat:error', { error: busyText(byIp.retryMs) });
      // Conversaciones nuevas desde la misma IP.
      if (!knownVisitors.has(visitorId)) {
        if (!(await findWebContact(visitorId))) {
          const fresh = allowNewConversation(ip);
          if (!fresh.ok) return socket.emit('chat:error', { error: `Se han abierto muchas conversaciones nuevas desde tu conexión. Espera ${waitText(fresh.retryMs)}, por favor.` });
        }
        if (knownVisitors.size > 50_000) knownVisitors.clear();
        knownVisitors.add(visitorId);
      }
      // Límite por persona (dentro de handleIncoming).
      const r = await handleIncoming({ channel: 'web', externalId: visitorId, text: clean });
      if (r.blocked) return socket.emit('chat:error', { error: busyText(r.retryMs) });
      // Eco a otras pestañas del mismo visitante.
      socket.to(`visitor:${visitorId}`).emit('chat:message', { author: 'paciente', text: clean, created_at: new Date().toISOString() });
    } catch (err) {
      console.error('[chat web]', err);
      socket.emit('chat:error', { error: 'No hemos podido guardar tu mensaje. Inténtalo de nuevo en un momento.' });
    }
  });
});


// Si algo falla al hablar con la base de datos, el panel recibe un error claro en vez de colgarse.
app.use('/api', (err, req, res, next) => {
  console.error('[api]', req.method, req.originalUrl, err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Algo ha fallado en el servidor. Inténtalo de nuevo en un momento.' });
});

// ---------- Archivos estáticos ----------
const panelDist = join(root, 'server', 'public', 'panel');
if (existsSync(panelDist)) {
  app.use('/panel', express.static(panelDist));
  app.get(/^\/panel(\/.*)?$/, (req, res) => res.sendFile(join(panelDist, 'index.html')));
} else {
  app.get(/^\/panel(\/.*)?$/, (req, res) =>
    res.redirect(`http://localhost:${process.env.PANEL_DEV_PORT || 5173}${req.originalUrl}`),
  );
}
app.use(express.static(join(root, 'web'), { extensions: ['html'] }));

http.listen(PORT, () => {
  console.log(`\n  Web de la clínica:  http://localhost:${PORT}`);
  console.log(`  Panel:              http://localhost:${PORT}/panel`);
  console.log(`  IA:                 ${hasApiKey() ? 'OpenRouter (' + getSettings().asistente.modelo + ')' : 'sin clave → respuestas de ejemplo'}\n`);
  if (wa.hasSavedSession()) wa.start({ onMessage: onWhatsApp });
});

// Recordatorios de cita el día antes (cada 5 minutos se mira si toca alguno).
setInterval(() => sendDueReminders().catch((e) => console.error('[recordatorios]', e)), 5 * 60 * 1000);
setTimeout(() => sendDueReminders().catch((e) => console.error('[recordatorios]', e)), 15 * 1000);

// Evita que una excepción suelta tire el servidor durante una demo.
process.on('unhandledRejection', (e) => console.error('[sin capturar]', e));
