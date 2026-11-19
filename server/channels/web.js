// Canal web: el visitante está en la sala "visitor:<id>" de Socket.IO.
import { toVisitor } from '../realtime.js';

export const web = {
  async sendText(externalId, text, meta = {}) {
    toVisitor(externalId, 'chat:message', { author: meta.author ?? 'ia', authorName: meta.authorName ?? null, text, created_at: new Date().toISOString() });
  },
  async typing(externalId, on) {
    toVisitor(externalId, 'chat:typing', { typing: on });
  },
};
