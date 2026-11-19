// Punto único para emitir en directo: al panel (sala "panel") y a cada visitante de la web.
import { publicContact, publicConversation, publicMessage } from './privacy.js';
import { getMetrics } from './db.js';

let io = null;
export function setIO(server) {
  io = server;
}

export function toPanel(event, payload) {
  io?.to('panel').emit(event, payload);
}

export function toVisitor(visitorId, event, payload) {
  io?.to(`visitor:${visitorId}`).emit(event, payload);
}

export const emit = {
  message: (conversationId, message) =>
    toPanel('message:new', { conversationId, message: publicMessage(message) }),
  conversation: (conv) => toPanel('conversation:updated', publicConversation(conv)),
  contact: (contact) => toPanel('contact:updated', publicContact(contact)),
  event: (ev) => toPanel('activity:new', ev),
  typing: (conversationId, typing) => toPanel('typing', { conversationId, typing }),
  // Las citas llegan ya en su forma pública (agenda.js → publicAppointment).
  appointment: (appt) => toPanel('appointment:new', appt),
  appointmentUpdated: (appt) => toPanel('appointment:updated', appt),
  agendaConfig: (config) => toPanel('agenda:config', config),
  metrics: (m) => toPanel('metrics:updated', m),
};

// Recalcula los números del día y los manda al panel, sin hacer esperar a quien lo pide.
export function pushMetrics() {
  getMetrics()
    .then((m) => emit.metrics(m))
    .catch((err) => console.error('[métricas]', err.message));
}
