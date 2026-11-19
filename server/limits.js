// Límites de uso: que nadie pueda saturar la app ni gastar la IA (y la factura de OpenRouter)
// a base de mandar mensajes sin parar. Se cuentan en memoria: con una sola copia del
// servidor (como en Render) basta. Si se reinicia, los contadores empiezan de cero.

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

// Los números se pueden cambiar aquí. Una persona normal no se acerca a ninguno.
export const LIMITS = {
  // Chat de la web y WhatsApp, por persona (cada visitante de la web o cada número de WhatsApp).
  porPersonaMinuto: 8,
  porPersonaHora: 40,
  porPersonaDia: 80,
  // Chat de la web, por IP (aunque alguien cambie de navegador o borre sus datos, la IP es la misma).
  porIpHora: 60,
  porIpDia: 200,
  conversacionesNuevasPorIpHora: 5,
  conexionesAbiertasPorIp: 15,
  // Tope total de respuestas con IA de toda la clínica. Al pasarlo, Vera sigue contestando
  // con respuestas automáticas (sin coste) hasta que vuelve a haber cupo.
  iaPorHora: Number(process.env.LIMITE_IA_HORA) || 300,
  iaPorDia: Number(process.env.LIMITE_IA_DIA) || 1500,
  // «Pruébalo» en Asistente (panel), por usuario.
  vistaPreviaPorUsuarioHora: 60,
  // Inicio de sesión: intentos fallidos.
  loginFallidosPorIp15min: 10,
  loginFallidosPorUsuario15min: 5,
  // Peticiones al servidor por IP (panel y web juntos).
  peticionesPorIpMinuto: 300,
};

// ---------- Contadores ----------
const buckets = new Map(); // clave → { count, resetAt }

function bucket(key, windowMs) {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  return b;
}

// Comprueba varios límites a la vez y, solo si todos tienen cupo, los cuenta.
// rules: [[clave, máximo, ventana en ms], …] → { ok, retryMs }
export function take(rules) {
  const list = rules.map(([key, max, ms]) => ({ b: bucket(key, ms), max }));
  const full = list.filter(({ b, max }) => b.count >= max);
  if (full.length) return { ok: false, retryMs: Math.max(...full.map(({ b }) => b.resetAt - Date.now())) };
  for (const { b } of list) b.count += 1;
  return { ok: true };
}

// Solo mira si queda cupo (sin contar).
export function blocked(key, max, windowMs) {
  const b = bucket(key, windowMs);
  return b.count >= max ? { blocked: true, retryMs: b.resetAt - Date.now() } : { blocked: false };
}

export function count(key, windowMs) {
  bucket(key, windowMs).count += 1;
}

export function reset(key) {
  buckets.delete(key);
}

// Limpieza de contadores caducados para que la memoria no crezca.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 10 * MIN).unref();

export const waitText = (ms) => {
  const min = Math.max(1, Math.ceil(ms / MIN));
  if (min < 60) return `${min} ${min === 1 ? 'minuto' : 'minutos'}`;
  const h = Math.ceil(min / 60);
  return `${h} ${h === 1 ? 'hora' : 'horas'}`;
};

// ---------- IP de quien hace la petición ----------
// En Render las visitas llegan por Cloudflare, que pone la IP real en CF-Connecting-IP
// (y la sobrescribe si alguien intenta falsearla). Fuera de Render se usa la conexión directa.
const behindCloudflare = Boolean(process.env.RENDER) || process.env.TRUST_CLOUDFLARE_IP === 'true';
export function clientIp(headers = {}, remoteAddress = '') {
  const cf = headers['cf-connecting-ip'];
  if (behindCloudflare && typeof cf === 'string' && cf) return cf.trim();
  return String(remoteAddress || 'desconocida').replace(/^::ffff:/, '');
}

// ---------- Reglas concretas ----------
// Mensaje entrante de un paciente (web o WhatsApp).
export function allowPersonMessage(channel, externalId) {
  const id = `persona:${channel}:${externalId}`;
  return take([
    [`${id}:min`, LIMITS.porPersonaMinuto, MIN],
    [`${id}:hora`, LIMITS.porPersonaHora, HOUR],
    [`${id}:dia`, LIMITS.porPersonaDia, DAY],
  ]);
}

// Mensaje del chat de la web, por IP.
export function allowIpMessage(ip) {
  return take([
    [`ip:${ip}:msg:hora`, LIMITS.porIpHora, HOUR],
    [`ip:${ip}:msg:dia`, LIMITS.porIpDia, DAY],
  ]);
}

export function allowNewConversation(ip) {
  return take([[`ip:${ip}:nuevas:hora`, LIMITS.conversacionesNuevasPorIpHora, HOUR]]);
}

// Una respuesta con IA (cuenta para el tope de toda la clínica).
export function allowAiReply() {
  return take([
    ['ia:hora', LIMITS.iaPorHora, HOUR],
    ['ia:dia', LIMITS.iaPorDia, DAY],
  ]);
}

export function allowPreview(userId) {
  return take([[`vista-previa:${userId}`, LIMITS.vistaPreviaPorUsuarioHora, HOUR]]);
}

// ---------- Conexiones abiertas del chat por IP ----------
const openSockets = new Map();
export function openSocket(ip) {
  const n = (openSockets.get(ip) ?? 0) + 1;
  if (n > LIMITS.conexionesAbiertasPorIp) return false;
  openSockets.set(ip, n);
  return true;
}
export function closeSocket(ip) {
  const n = (openSockets.get(ip) ?? 1) - 1;
  if (n <= 0) openSockets.delete(ip);
  else openSockets.set(ip, n);
}

// ---------- Inicio de sesión ----------
const LOGIN_WINDOW = 15 * MIN;
export function loginBlocked(ip, username) {
  const a = blocked(`login:ip:${ip}`, LIMITS.loginFallidosPorIp15min, LOGIN_WINDOW);
  const b = blocked(`login:user:${username}`, LIMITS.loginFallidosPorUsuario15min, LOGIN_WINDOW);
  if (a.blocked || b.blocked) return { blocked: true, retryMs: Math.max(a.retryMs ?? 0, b.retryMs ?? 0) };
  return { blocked: false };
}
export function loginFailed(ip, username) {
  count(`login:ip:${ip}`, LOGIN_WINDOW);
  count(`login:user:${username}`, LOGIN_WINDOW);
}
export function loginSucceeded(username) {
  reset(`login:user:${username}`);
}

// ---------- Peticiones al servidor (middleware de Express) ----------
export function apiRateLimit(req, res, next) {
  const ip = clientIp(req.headers, req.socket.remoteAddress);
  const r = take([[`ip:${ip}:api:min`, LIMITS.peticionesPorIpMinuto, MIN]]);
  if (r.ok) return next();
  res.set('Retry-After', String(Math.ceil(r.retryMs / 1000)));
  res.status(429).json({ error: `Demasiadas peticiones seguidas. Espera ${waitText(r.retryMs)}.` });
}
