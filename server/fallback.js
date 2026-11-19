// Respuestas sin IA (cuando no hay clave de OpenRouter o el modelo falla): por palabras clave.
// Sirve para enseñar la app sin coste; con la clave puesta contesta el modelo.
// También agenda: entiende «el martes por la tarde», «mañana a primera hora», «la primera»…
import { findService, isEnglish, minStartFor, offerSlots, parsePreference, serviceText, slotForPreference, upcomingFor, when } from './agenda.js';

const norm = (s) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

const has = (t, words) => words.some((w) => t.includes(w));

const TAGS = [
  [['rechaz', 'denegado', 'no me lo aceptaron', 'no me lo aprobaron'], 'Trámite rechazado'],
  [['recurso', 'escrito', 'impugnacion', 'apelacion', 'revocatoria'], 'Recurso SAT'],
  [['importacion', 'importar', 'mercancia', 'mercaderia', 'contenedor', 'aduana'], 'Importación'],
  [['arancel', 'partida', 'clasificacion', 'valor en aduana'], 'Clasificación arancelaria'],
  [['escritura', 'poder', 'notario'], 'Escritura'],
  [['asesoria', 'consulta'], 'Asesoría'],
];
const MUTUAS = [];
const URGENT = ['urgente', 'plazo', 'vence', 'se vence', 'multa', 'retenida', 'retenido', 'detenida', 'detenido'];
const ENGLISH = ['hello', 'hi ', 'pain', 'price', 'appointment', 'how much', 'opening', 'insurance', 'thanks', 'could i', 'can i'];
const BOOK_WORDS = ['cita', 'reservar', 'reserva', 'hueco', 'turno', 'pedir hora', 'agendar', 'appointment', 'book'];

function serviceFor(s, contact) {
  const tags = contact.tags ?? [];
  const name = tags.includes('Recurso SAT')
    ? 'Escrito o recurso ante la SAT'
    : tags.includes('Escritura')
      ? 'Escritura pública'
      : contact.stage === 'paciente'
        ? 'Gestión de trámite aduanero'
        : 'Primera asesoría aduanera';
  return findService(s, name)?.nombre ?? s.servicios[0]?.nombre;
}

// «la primera», «el segundo», «3»…
function choiceIndex(t) {
  if (/\b(primer[oa]?|first|1)\b/.test(t)) return 0;
  if (/\b(segund[oa]|second|2)\b/.test(t)) return 1;
  if (/\b(tercer[oa]?|third|ultim[oa]|last|3)\b/.test(t)) return 2;
  return null;
}

const listEs = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} o ${items.at(-1)}` : items[0]);
const listEn = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} or ${items.at(-1)}` : items[0]);

function tagsFor(t, current = []) {
  const out = new Set(current);
  for (const [words, tag] of TAGS) if (has(t, words)) out.add(tag);
  for (const m of MUTUAS) if (t.includes(m)) out.add(`Mutua ${m === 'dkv' ? 'DKV' : m[0].toUpperCase() + m.slice(1)}`);
  return [...out].slice(-4);
}

function nameFrom(text) {
  const m =
    text.match(/(?:me llamo|soy|mi nombre es|my name is|i'm|i am)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)/i) ??
    text.match(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?)\s*[,.]/);
  return m ? m[1].trim() : null;
}

export async function fallbackTurn(messages, contact, s) {
  const patient = messages.filter((m) => m.author === 'paciente');
  const lastRaw = patient.at(-1)?.text ?? '';
  const t = norm(lastRaw);
  const lastBot = norm(messages.filter((m) => m.author !== 'paciente').at(-1)?.text ?? '');
  const tools = [];
  const precio = (n) => s.servicios.find((x) => norm(x.nombre).includes(n))?.precio;

  const en = isEnglish(contact.language) || (has(t, ENGLISH) && !has(t, ['hola']));
  const bookingContext =
    has(t, BOOK_WORDS) ||
    (lastBot.includes('nombre') && (lastBot.includes('cuando') || lastBot.includes('dia'))) ||
    lastBot.includes('te va bien') ||
    lastBot.includes('which suits you') ||
    lastBot.includes('your name') ||
    // «¿Te busco cita?» → «sí, porfa»
    (/busco cita|busque cita|book you/.test(lastBot) && /\b(si|vale|claro|venga|porfa|perfecto|yes|ok|sure|please)\b/.test(t));

  if (has(t, URGENT)) {
    tools.push(['actualizar_contacto', { urgencia: 'alta', motivo: lastRaw.slice(0, 120), etiquetas: tagsFor(t, contact.tags) }]);
    return {
      reply: en
        ? 'I understand this is urgent, so I have marked it as urgent. Which day suits you? I will look for the earliest slot with the lawyer.'
        : 'Entiendo la urgencia, lo marco como urgente. ¿Qué día te viene bien? Te busco el hueco más próximo con el abogado.',
      tools,
    };
  }

  if (en && !bookingContext) {
    return {
      reply: `Hi! I'm ${s.asistente.nombre}, the assistant at ${s.clinica}. A first customs consultation is Q${precio('asesoria')} (60 min). We're open ${s.horario[0].dias.toLowerCase()} ${s.horario[0].horas}. Tell me what procedure you need and since when, and I'll book you in.`,
      tools: [['actualizar_contacto', { idioma: 'inglés', etiquetas: tagsFor(t, contact.tags) }]],
    };
  }

  if (has(t, ['me lo van a aprobar', 'se va a resolver', 'cuanto tarda', 'cuanto va a tardar', 'me garantiza', 'seguro que'])) {
    return {
      reply: 'No puedo prometerte un resultado ni un plazo exacto por chat: eso lo define el abogado en la primera asesoría, viendo tus documentos. Si quieres, te busco cita.',
      tools,
    };
  }

  // ---------- Agenda ----------
  const minStart = minStartFor(s);
  const upcoming = contact.id ? (await upcomingFor(contact.id)).filter((a) => a.starts_at) : [];
  const pref = parsePreference(lastRaw);
  const first = (n) => String(n ?? '').split(' ')[0];
  const offerText = (offers, intro = '') => {
    const items = offers.map((o) => when({ starts_at: o.start, therapist: o.therapist }, contact.language));
    return en
      ? `${intro}I have ${listEn(items.map((x) => `${x}`))}. Which suits you?`
      : `${intro}Tengo libre ${listEs(items.map((x) => `el ${x}`))}. ¿Cuál te va bien?`;
  };

  if (upcoming.length && has(t, ['cancelar', 'anular', 'cancel'])) {
    tools.push(['cancelar_cita', {}]);
    return {
      reply: en
        ? `Done, I've cancelled your appointment on ${when(upcoming[0], 'en')}. Would you like me to find you another day?`
        : `Hecho, he anulado tu cita del ${when(upcoming[0])}. ¿Quieres que te busque otro día?`,
      tools,
    };
  }

  if (upcoming.length && has(t, ['cambiar', 'mover', 'pasar', 'otro dia', 'otra hora', 'en vez de', 'reschedule', 'move'])) {
    const servicio = upcoming[0].service ?? serviceFor(s, contact);
    const slot = pref.any ? await slotForPreference(s, pref, { servicio, minStart }) : null;
    if (slot) {
      tools.push(['cambiar_cita', { fecha: slot.start.slice(0, 10), hora: slot.start.slice(11, 16), fisio: slot.therapist }]);
      const w = when({ starts_at: slot.start, therapist: slot.therapist }, contact.language);
      return { reply: en ? `Done: I've moved your appointment to ${w}.` : `Hecho: te he pasado la cita al ${w}.`, tools };
    }
    const offers = await offerSlots(s, { servicio, minStart });
    if (offers.length) return { reply: offerText(offers, en ? 'Sure. ' : 'Claro. '), tools };
  }

  if (bookingContext) {
    const name = nameFrom(lastRaw) ?? contact.name;
    if (!name) {
      tools.push(['mover_etapa', { etapa: 'interesado' }]);
      return {
        reply: en ? "Sure, I'll find you a slot. What's your name, and which days or times suit you best?" : 'Claro, te busco hueco. ¿Me dices tu nombre y qué días o franja te vienen mejor?',
        tools,
      };
    }
    if (!contact.name) tools.push(['actualizar_contacto', { nombre: name }]);
    const servicio = serviceFor(s, contact);
    let slot = null;
    if (lastBot.includes('te va bien') || lastBot.includes('which suits you')) {
      const idx = choiceIndex(t);
      if (idx != null) slot = (await offerSlots(s, { servicio, minStart }))[idx] ?? null;
    }
    if (!slot && pref.any) slot = await slotForPreference(s, pref, { servicio, minStart });
    if (slot) {
      tools.push(['agendar_cita', { nombre: name, fecha: slot.start.slice(0, 10), hora: slot.start.slice(11, 16), fisio: slot.therapist, servicio, motivo: contact.reason ?? undefined }]);
      const w = when({ starts_at: slot.start, therapist: slot.therapist }, contact.language);
      const pending = s.agenda?.citas_ia === 'pendiente';
      return {
        reply: en
          ? `Done, ${first(name)}: you're booked for ${w}.${pending ? ' The clinic will confirm it shortly.' : ''} If you can't make it, please let us know 24 hours ahead.`
          : `Hecho, ${first(name)}: te he reservado ${serviceText(servicio)} el ${w}.${pending ? ' La clínica te la confirma en breve.' : ''} Si no puedes venir, avísanos con 24 horas.`,
        tools,
      };
    }
    const offers = await offerSlots(s, { servicio, minStart });
    if (!offers.length) {
      tools.push(['solicitar_cita', { nombre: name, preferencia: lastRaw.slice(0, 80) || 'Sin preferencia', motivo: contact.reason ?? undefined }]);
      return {
        reply: 'Ahora mismo no veo huecos libres en la agenda de los próximos días. He apuntado tu petición y la recepción te da hora.',
        tools,
      };
    }
    return { reply: offerText(offers, pref.any ? (en ? "I don't have anything then. " : 'Para eso no me queda hueco. ') : ''), tools };
  }

  if (has(t, ['mutua', 'seguro', ...MUTUAS])) {
    tools.push(['actualizar_contacto', { etiquetas: tagsFor(t, contact.tags) }]);
    tools.push(['mover_etapa', { etapa: 'interesado' }]);
    return {
      reply: `No trabajamos con aseguradoras; cada trámite se cotiza por separado. ¿Te busco cita?`,
      tools,
    };
  }

  if (has(t, ['precio', 'cuesta', 'cuanto', 'tarifa', 'vale la', 'quetzales'])) {
    tools.push(['actualizar_contacto', { etiquetas: tagsFor(t, [...contact.tags, 'Precios']) }]);
    tools.push(['mover_etapa', { etapa: 'interesado' }]);
    return {
      reply: `La primera asesoría son Q${precio('asesoria')} (60 min), la gestión de un trámite Q${precio('gestion de tramite')} y un escrito o recurso ante la SAT Q${precio('escrito o recurso')}. ¿Qué trámite necesita, para orientarte mejor?`,
      tools,
    };
  }

  if (has(t, ['horario', 'abr', 'cierr', 'a que hora', 'sabado', 'domingo'])) {
    return {
      reply: `Abrimos ${s.horario.map((h) => `${h.dias.toLowerCase()} de ${h.horas}`).slice(0, 2).join(' y ')}. Yo contesto a cualquier hora. ¿Quieres que te busque cita?`,
      tools,
    };
  }

  if (has(t, ['aduana', 'importacion', 'importar', 'mercancia', 'mercaderia', 'rechaz', 'sat', 'tramite', 'escritura', 'arancel'])) {
    tools.push(['actualizar_contacto', { motivo: lastRaw.slice(0, 120), etiquetas: tagsFor(t, contact.tags), urgencia: has(t, ['urgente', 'plazo', 'vence', 'multa']) ? 'media' : undefined }]);
    return {
      reply: 'Gracias por contármelo. Para orientarte: ¿qué mercancía es y en qué estado está el trámite?',
      tools,
    };
  }

  if (has(t, ['semana', 'dias', 'mes', 'ayer', 'desde', 'ano'])) {
    tools.push(['actualizar_contacto', { desde_cuando: lastRaw.slice(0, 60), urgencia: has(t, ['urgente', 'plazo', 'mucho']) ? 'media' : 'baja' }]);
    return {
      reply: 'Gracias por contármelo. Lo mejor es empezar con una primera asesoría (60 min), donde el abogado revisa tu caso y te explica el plan. ¿Te paso el precio o te busco cita directamente?',
      tools,
    };
  }

  if (has(t, ['gracias', 'perfecto', 'genial', 'vale'])) {
    return { reply: '¡A ti! Aquí estoy para lo que necesites, a cualquier hora.', tools };
  }

  return {
    reply: `Hola, soy ${s.asistente.nombre}, la asistente de ${s.clinica}. Te ayudo con precios, horarios y servicios, y te busco cita en la agenda. ¿Qué trámite necesita?`,
    tools,
  };
}
