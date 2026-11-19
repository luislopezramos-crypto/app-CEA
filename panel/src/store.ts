// Estado del panel y conexión en directo (Socket.IO). Sin librerías de estado.
import { useSyncExternalStore } from 'react';
import { io, Socket } from 'socket.io-client';

export type Stage = 'nuevo' | 'interesado' | 'quiere_cita' | 'paciente';
export type Channel = 'web' | 'whatsapp' | 'telefono';

export interface User { id: number; name: string; username: string; role: string }
export interface Metrics {
  messages: number; interested: number; newContacts: number; appointments: number;
  agendaToday: number; pendingAppointments: number;
  avgResponse: number | null; byHour: number[]; stages: Record<Stage, number>;
}
export interface Conversation {
  id: number; contact_id: number; channel: Channel; mode: 'ia' | 'humano'; handled_by: string | null;
  unread: number; last_message_at: string; name: string | null; tags: string[]; stage: Stage;
  urgency: string | null; last_text: string | null; last_author: string | null; phone_masked: string | null;
}
export interface Contact {
  id: number; name: string | null; channel: Channel; reason: string | null; since: string | null;
  urgency: string | null; tags: string[]; stage: Stage; summary: string | null; language: string | null;
  created_at: string; updated_at: string; conversation_id?: number; last_message_at?: string;
  message_count?: number; phone_masked: string | null;
}
export interface Message { id: number; conversation_id: number; author: 'paciente' | 'ia' | 'recepcion'; author_name: string | null; text: string; created_at: string }
export type AppointmentStatus = 'pendiente' | 'confirmada' | 'cancelada';
export interface Appointment {
  id: number; contact_id: number; name: string | null; contact_name: string | null; preference: string | null; reason: string | null;
  status: AppointmentStatus; created_at: string; updated_at: string | null;
  starts_at: string | null; duration: number; therapist: string | null; service: string | null;
  source: 'ia' | 'recepcion'; booked_by: string | null; notes: string | null; reminder_sent_at: string | null;
  channel: Channel; urgency: string | null; language: string | null; conversation_id: number | null; can_notify: boolean;
}
export interface TeamMember { nombre: string; rol: string; turno: 'completo' | 'mananas' | 'tardes'; color: string; ventanas: ([number, number] | null)[] }
export interface AgendaConfig {
  team: TeamMember[]; services: { nombre: string; minutos: number }[];
  apertura: ([string, string] | null)[]; cambio_turno: string; citas_ia: 'confirmada' | 'pendiente'; asistente: string;
}
// Formulario de cita (nueva o para cambiar una), que se abre desde cualquier pantalla.
export interface DialogState { appointmentId?: number; contactId?: number; requestId?: number; date?: string; time?: string; therapist?: string }
export interface Activity { id: number; type: string; contact_id: number | null; text: string; created_at: string }
export interface WaState { status: 'desconectado' | 'conectando' | 'qr' | 'conectado' | 'error'; qr: string | null; phone_masked: string | null; error: string | null }
export interface Toast { id: number; title: string; body: string; kind: 'cita' | 'urgente' | 'info'; contactId?: number; appointmentId?: number }

export interface State {
  ready: boolean;
  user: User | null;
  metrics: Metrics | null;
  conversations: Conversation[];
  contacts: Contact[];
  appointments: Appointment[];
  agenda: AgendaConfig | null;
  dialog: DialogState | null;
  apptFlash: Record<number, number>; // cita → marca de tiempo del último cambio
  events: Activity[];
  messages: Record<number, Message[]>;
  typing: Record<number, boolean>;
  wa: WaState;
  hasApiKey: boolean;
  demoRunning: boolean;
  clinic: { name: string; assistant: string };
  toasts: Toast[];
  flash: Record<number, number>; // contacto → marca de tiempo del último cambio (para resaltar)
  connected: boolean;
}

let state: State = {
  ready: false, user: null, metrics: null, conversations: [], contacts: [], appointments: [], agenda: null, dialog: null, apptFlash: {}, events: [],
  messages: {}, typing: {}, wa: { status: 'desconectado', qr: null, phone_masked: null, error: null },
  hasApiKey: false, demoRunning: false, clinic: { name: 'Consultoría Empresarial Aduanera', assistant: 'Ana' },
  toasts: [], flash: {}, connected: false,
};
const listeners = new Set<() => void>();

export function getState() { return state; }
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => sel(state));
}

// ---------- API ----------
export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(data?.error ?? `Error ${res.status}`), { status: res.status });
  return data as T;
}

// ---------- Sonido del aviso ----------
let audio: AudioContext | null = null;
export function chime() {
  try {
    audio ??= new AudioContext();
    const t = audio.currentTime;
    [660, 880].forEach((f, i) => {
      const o = audio!.createOscillator();
      const g = audio!.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.14);
      g.gain.exponentialRampToValueAtTime(0.12, t + i * 0.14 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.14 + 0.5);
      o.connect(g).connect(audio!.destination);
      o.start(t + i * 0.14);
      o.stop(t + i * 0.14 + 0.55);
    });
  } catch { /* sin audio */ }
}

// «jue 20 nov · 10:00 · Lucía»
export function apptWhen(a: Pick<Appointment, 'starts_at' | 'therapist'>) {
  if (!a.starts_at) return 'Sin hora';
  const d = new Date(a.starts_at);
  const day = d.toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' }).replace(/[,.]/g, '');
  return `${day} · ${a.starts_at.slice(11, 16)}${a.therapist ? ` · ${a.therapist.split(' ')[0]}` : ''}`;
}

export const openAppointmentDialog = (d: DialogState) => setState({ dialog: d });
export const closeAppointmentDialog = () => setState({ dialog: null });

let toastId = 1;
export function pushToast(t: Omit<Toast, 'id'>) {
  const id = toastId++;
  setState((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
  setTimeout(() => dismissToast(id), 9000);
}
export function dismissToast(id: number) {
  setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
}

// ---------- Carga y directo ----------
let socket: Socket | null = null;

const upsert = <T extends { id: number }>(list: T[], item: T, sortKey?: keyof T) => {
  const i = list.findIndex((x) => x.id === item.id);
  const next = i >= 0 ? list.map((x) => (x.id === item.id ? { ...x, ...item } : x)) : [item, ...list];
  if (sortKey) next.sort((a, b) => String(b[sortKey] ?? '').localeCompare(String(a[sortKey] ?? '')));
  return next;
};

export async function bootstrap() {
  try {
    const d = await api('/bootstrap');
    setState({ ready: true, ...d, wa: d.whatsapp });
    connectSocket();
  } catch (e: any) {
    setState({ ready: true, user: null });
  }
}

function connectSocket() {
  if (socket) return;
  socket = io({ path: '/socket.io', withCredentials: true });
  socket.on('connect', () => setState({ connected: true }));
  socket.on('disconnect', () => setState({ connected: false }));
  socket.io.on('reconnect', () => { void refresh(); });

  socket.on('message:new', ({ conversationId, message }: { conversationId: number; message: Message }) => {
    setState((s) => {
      const list = s.messages[conversationId];
      if (!list || list.some((m) => m.id === message.id)) return {};
      return { messages: { ...s.messages, [conversationId]: [...list, message] } };
    });
  });
  socket.on('conversation:updated', (c: Conversation) =>
    setState((s) => ({ conversations: upsert(s.conversations, c, 'last_message_at') })));
  socket.on('contact:updated', (c: Contact) =>
    setState((s) => {
      const prev = s.contacts.find((x) => x.id === c.id);
      const merged = { ...prev, ...c } as Contact;
      return {
        contacts: upsert(s.contacts, merged),
        conversations: s.conversations.map((cv) => cv.contact_id === c.id ? { ...cv, name: c.name, tags: c.tags, stage: c.stage, urgency: c.urgency } : cv),
        flash: { ...s.flash, [c.id]: Date.now() },
      };
    }));
  socket.on('activity:new', (ev: Activity) => {
    setState((s) => ({ events: [ev, ...s.events].slice(0, 40) }));
    if (ev.type === 'urgent') {
      chime();
      pushToast({ kind: 'urgente', title: 'Caso urgente', body: ev.text.replace(/^Caso urgente: /, ''), contactId: ev.contact_id ?? undefined });
    }
  });
  socket.on('typing', ({ conversationId, typing }: { conversationId: number; typing: boolean }) =>
    setState((s) => ({ typing: { ...s.typing, [conversationId]: typing } })));
  socket.on('appointment:new', (a: Appointment) => {
    setState((s) => ({ appointments: upsert(s.appointments, a), apptFlash: { ...s.apptFlash, [a.id]: Date.now() } }));
    // Las que agenda la propia recepción no avisan: ya lo está viendo.
    if (a.source === 'recepcion') return;
    chime();
    pushToast(a.starts_at
      ? { kind: 'cita', title: `${getState().agenda?.asistente ?? 'La IA'} agenda a ${a.name ?? 'un cliente'}`, body: `${apptWhen(a)}${a.status === 'pendiente' ? ' · por confirmar' : ''}`, appointmentId: a.id }
      : { kind: 'cita', title: `${a.name ?? 'Un cliente'} quiere cita`, body: a.preference ?? 'Sin hora: ponle hueco en la agenda', appointmentId: a.id });
  });
  socket.on('appointment:updated', (a: Appointment) =>
    setState((s) => ({ appointments: upsert(s.appointments, a), apptFlash: { ...s.apptFlash, [a.id]: Date.now() } })));
  socket.on('agenda:config', (agenda: AgendaConfig) => setState({ agenda }));
  socket.on('metrics:updated', (m: Metrics) => setState({ metrics: m }));
  socket.on('wa:status', (wa: WaState) => setState({ wa }));
  socket.on('demo:status', ({ running }: { running: boolean }) => setState({ demoRunning: running }));
}

export async function refresh() {
  const d = await api('/bootstrap');
  setState({ ...d, wa: d.whatsapp, messages: {} });
}

export async function loadMessages(conversationId: number) {
  const d = await api<{ messages: Message[]; contact: Contact }>(`/conversations/${conversationId}/messages`);
  setState((s) => ({ messages: { ...s.messages, [conversationId]: d.messages } }));
  return d;
}

export function logoutSocket() {
  socket?.disconnect();
  socket = null;
}
