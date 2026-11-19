// Canal WhatsApp: conexión por QR con Baileys (como WhatsApp Web).
// No es la API oficial de Meta: úsalo con un volumen normal de mensajes.
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestWaWebVersion,
  isJidBroadcast,
  isJidGroup,
  isJidNewsletter,
  isJidStatusBroadcast,
  isLidUser,
  isPnUser,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { DATA_DIR } from '../db.js';
import { toPanel } from '../realtime.js';
import { maskPhone } from '../privacy.js';

const AUTH_DIR = join(DATA_DIR, 'wa-auth');
const logger = pino({ level: 'silent' });

let sock = null;
let onIncoming = null;
let state = { status: 'desconectado', qr: null, phone: null, error: null };
let starting = false;

function setState(patch) {
  state = { ...state, ...patch };
  toPanel('wa:status', publicState());
}

export function publicState() {
  return {
    status: state.status,
    qr: state.qr,
    phone_masked: maskPhone(state.phone),
    error: state.error,
  };
}

function textOf(message) {
  const m = message?.ephemeralMessage?.message ?? message?.viewOnceMessage?.message ?? message;
  return (
    m?.conversation ??
    m?.extendedTextMessage?.text ??
    m?.imageMessage?.caption ??
    m?.videoMessage?.caption ??
    (m?.audioMessage ? '[Nota de voz]' : null) ??
    (m?.imageMessage ? '[Imagen]' : null) ??
    null
  );
}

function phoneFrom(...jids) {
  const pn = jids.find((j) => j && isPnUser(j));
  return pn ? pn.split('@')[0].split(':')[0] : null;
}

export async function start({ onMessage } = {}) {
  if (onMessage) onIncoming = onMessage;
  if (starting || sock) return publicState();
  starting = true;
  setState({ status: 'conectando', error: null });
  try {
    const { state: auth, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    let version;
    try {
      ({ version } = await fetchLatestWaWebVersion());
    } catch {
      version = undefined;
    }
    sock = makeWASocket({
      auth,
      version,
      logger,
      browser: Browsers.macOS('Noray Panel'),
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      if (u.qr) {
        const qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 320 });
        setState({ status: 'qr', qr });
      }
      if (u.connection === 'open') {
        const me = sock?.user?.id ?? '';
        setState({ status: 'conectado', qr: null, phone: me.split('@')[0].split(':')[0], error: null });
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect?.error?.output?.statusCode;
        sock = null;
        if (code === DisconnectReason.loggedOut) {
          rmSync(AUTH_DIR, { recursive: true, force: true });
          setState({ status: 'desconectado', qr: null, phone: null });
        } else if (code === DisconnectReason.timedOut && state.status === 'qr') {
          // Nadie escaneó el código a tiempo: se para hasta que lo vuelvan a pedir.
          setState({ status: 'desconectado', qr: null, error: 'El código caducó. Pide uno nuevo para vincular el móvil.' });
        } else if (code === DisconnectReason.restartRequired || state.status !== 'desconectado') {
          // Reconexión automática (pasa justo después de escanear el QR).
          starting = false;
          setTimeout(() => start(), 1500);
          return;
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        const jid = msg.key.remoteJid;
        if (!jid || msg.key.fromMe) continue;
        if (isJidGroup(jid) || isJidBroadcast(jid) || isJidStatusBroadcast(jid) || isJidNewsletter(jid)) continue;
        if (!isPnUser(jid) && !isLidUser(jid)) continue;
        const text = textOf(msg.message);
        if (!text) continue;
        onIncoming?.({
          channel: 'whatsapp',
          externalId: jid,
          phone: phoneFrom(jid, msg.key.remoteJidAlt),
          pushName: msg.pushName ?? null,
          text,
        });
      }
    });
  } catch (err) {
    sock = null;
    setState({ status: 'error', error: String(err?.message ?? err) });
  } finally {
    starting = false;
  }
  return publicState();
}

export async function logout() {
  try {
    await sock?.logout();
  } catch {
    /* ya estaba cerrada */
  }
  sock = null;
  rmSync(AUTH_DIR, { recursive: true, force: true });
  setState({ status: 'desconectado', qr: null, phone: null, error: null });
  return publicState();
}

export const whatsapp = {
  async sendText(externalId, text) {
    if (!sock || state.status !== 'conectado') throw new Error('WhatsApp no está conectado');
    await sock.sendMessage(externalId, { text });
  },
  async typing(externalId, on) {
    if (!sock || state.status !== 'conectado') return;
    try {
      await sock.sendPresenceUpdate(on ? 'composing' : 'paused', externalId);
    } catch {
      /* no pasa nada */
    }
  },
};

export function hasSavedSession() {
  return existsSync(join(AUTH_DIR, 'creds.json'));
}
