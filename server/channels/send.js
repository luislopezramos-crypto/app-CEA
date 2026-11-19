// Envío por el canal de cada contacto (web o WhatsApp). Los contactos de ejemplo
// (prefijo demo:) y los que solo tienen teléfono no reciben nada.
import { web } from './web.js';
import { whatsapp } from './whatsapp.js';

export const isDemo = (contact) => String(contact.external_id).startsWith('demo:');
export const canMessage = (contact) => contact && (contact.channel === 'web' || contact.channel === 'whatsapp');

export async function sendThroughChannel(contact, text, meta) {
  if (isDemo(contact)) return;
  if (contact.channel === 'web') return web.sendText(contact.external_id, text, meta);
  if (contact.channel === 'whatsapp') return whatsapp.sendText(contact.external_id, text);
}

export async function setChannelTyping(contact, on) {
  if (isDemo(contact)) return;
  if (contact.channel === 'web') await web.typing(contact.external_id, on);
  if (contact.channel === 'whatsapp') await whatsapp.typing(contact.external_id, on);
}
