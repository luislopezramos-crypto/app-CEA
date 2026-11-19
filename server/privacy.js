// Todo lo que sale hacia el panel pasa por aquí: el teléfono completo y el
// identificador de WhatsApp (que lleva el número) nunca salen del servidor.

export function maskPhone(phone) {
  if (!phone) return null;
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length < 3) return '•••';
  return `••• ••• ${digits.slice(-3)}`;
}

function publicTags(tags) {
  if (Array.isArray(tags)) return tags;
  try {
    return JSON.parse(tags || '[]');
  } catch {
    return [];
  }
}

export function publicContact(c) {
  if (!c) return c;
  const { phone, external_id, ...rest } = c;
  return { ...rest, tags: publicTags(c.tags), phone_masked: maskPhone(phone) };
}

export function publicConversation(cv) {
  if (!cv) return cv;
  const { phone, external_id, ...rest } = cv;
  return {
    ...rest,
    tags: cv.tags !== undefined ? publicTags(cv.tags) : undefined,
    phone_masked: maskPhone(phone),
  };
}

// Por si un paciente escribe su número en el chat: se enmascara en el panel.
export function maskPhonesInText(text) {
  if (!text) return text;
  return text.replace(/(\+?\d[\d\s.-]{7,}\d)/g, (m) => {
    const digits = m.replace(/\D/g, '');
    return digits.length >= 9 ? maskPhone(digits) : m;
  });
}

export function publicMessage(m) {
  return m ? { ...m, text: maskPhonesInText(m.text) } : m;
}
