// El cerebro de la asistente: el mismo para la web y para WhatsApp.
import {
  addEvent,
  addMessage,
  findOrCreateContact,
  findOrCreateConversation,
  getContact,
  getConversation,
  getFullConversation,
  getMessages,
  getSettings,
  updateContact,
} from './db.js';
import { emit, pushMetrics } from './realtime.js';
import { moveStage } from './stage.js';
import { sendThroughChannel, setChannelTyping } from './channels/send.js';
import { fallbackTurn } from './fallback.js';
import { allowAiReply, allowPersonMessage, take, waitText } from './limits.js';
import {
  addDays,
  bookAppointment,
  checkSlot,
  dayKey,
  findService,
  findTherapist,
  minStartFor,
  minutesOf,
  parseLocal,
  preferenceOrder,
  requestAppointment,
  setStatus,
  startOfDay,
  suggestSlots,
  teamForPrompt,
  upcomingFor,
  updateAppointment,
  when,
} from './agenda.js';

export { moveStage, sendThroughChannel };
export const fullConversation = getFullConversation;

const s_assistantName = () => getSettings().asistente.nombre;

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const hasApiKey = () => Boolean(process.env.OPENROUTER_API_KEY?.trim());

async function setTyping(contact, conversationId, on) {
  emit.typing(conversationId, on);
  await setChannelTyping(contact, on);
}

// ---------- Prompt ----------
function guatemalaNow() {
  return new Intl.DateTimeFormat('es-ES', {
    timeZone: 'America/Guatemala',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date());
}

const dayLabel = (d) => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).replace(',', '');

// Los próximos 14 días con su fecha, para que el modelo no tenga que calcularlas.
function nextDays() {
  const today = startOfDay(new Date());
  return Array.from({ length: 15 }, (_, i) => {
    const d = addDays(today, i);
    return `- ${i === 0 ? 'hoy, ' : i === 1 ? 'mañana, ' : ''}${dayLabel(d)} = ${dayKey(d)}`;
  }).join('\n');
}

async function appointmentsFor(contact) {
  if (!contact.id) return 'ninguna';
  const list = await upcomingFor(contact.id);
  if (!list.length) return 'ninguna';
  return list
    .map((a) =>
      a.starts_at
        ? `#${a.id} ${when(a)} · ${a.service ?? 'cita'} · ${a.status === 'confirmada' ? 'confirmada' : 'por confirmar'}`
        : `#${a.id} petición sin hora («${a.preference}»), la recepción le dará hora`,
    )
    .join('; ');
}

export async function buildSystemPrompt(s, contact) {
  const servicios = s.servicios
    .map((x) => `- ${x.nombre} (${x.duracion}): Q${x.precio}. ${x.descripcion ?? ''}`)
    .join('\n');
  const horario = s.horario.map((h) => `- ${h.dias}: ${h.horas}`).join('\n');
  const faq = s.faq.map((f) => `- ${f.p} → ${f.r}`).join('\n');
  const known = [
    contact.name && `nombre: ${contact.name}`,
    contact.reason && `motivo: ${contact.reason}`,
    contact.since && `desde cuándo: ${contact.since}`,
    contact.urgency && `urgencia: ${contact.urgency}`,
    contact.tags?.length && `etiquetas: ${contact.tags.join(', ')}`,
    `etapa: ${contact.stage}`,
  ]
    .filter(Boolean)
    .join('; ');
  const pendiente = s.agenda?.citas_ia === 'pendiente';
  const citas = await appointmentsFor(contact);

  return `Eres ${s.asistente.nombre}, la asistente de ${s.clinica}, un despacho de asesoría aduanera en ${s.barrio} (${s.ciudad}). Atiendes a clientes por ${contact.channel === 'whatsapp' ? 'WhatsApp' : 'el chat de la web'}, de día y de noche.

Cómo hablas: ${s.asistente.tono}
Responde SIEMPRE en el idioma en el que te escribe la persona. Mensajes cortos (2–4 frases), sin markdown, sin listas largas: es un chat.

## Lo que haces
1. Resuelves dudas de precios, horarios, servicios y equipo con la información de abajo. Si un dato concreto no está ahí, dilo en una frase y sigue ayudando.
2. Si cuenta su caso (un trámite rechazado, una importación detenida, un ajuste de la aduana…), lo tomas como algo normal que la oficina atiende: preguntas con naturalidad, una cosa cada vez, qué mercancía es, en qué estado está el trámite y si tiene un plazo corriendo, y le ofreces la primera asesoría. Como mucho dos preguntas antes de ofrecer la cita: no hagas un interrogatorio.
3. Tú agendas las citas directamente en la agenda de la oficina. En cuanto quiera cita (aunque sea con otras palabras: "dame cita", "quiero que me atiendan", "resérvame"):
   - Si no sabes su nombre, pídeselo (una sola vez).
   - Llama a "ver_huecos" con lo que haya dicho (días, franja, hora aproximada, abogado si pide a alguien). Nunca digas un día u hora que no venga de "ver_huecos".
   - Si ya ha dicho cuándo le viene bien (un día, una franja, una hora o varias opciones como "martes o jueves por la tarde", "por las mañanas", "mañana a primera hora"), NO le preguntes cuál prefiere: en ese mismo turno reserva con "agendar_cita" el hueco "recomendado" que te da "ver_huecos" y díselo ("te he reservado el…; si te va mejor otra hora, dímelo"). Solo si no ha dicho nada de cuándo, ofrécele 2 o 3 huecos en una frase (sin listas) y reserva el que elija.
   - Servicio: "Primera asesoría aduanera" si es su primera vez; "Gestión de trámite aduanero" si ya es cliente; o el que pida (escrito ante la SAT, clasificación arancelaria, escritura…). Pasa a "agendar_cita" el abogado que te dio "ver_huecos".
   - Al reservar, dile día, hora y con quién${pendiente ? ', y que la oficina se la confirma en breve' : ''}, y que si no puede venir avise con 24 horas.
   - Si ya tiene cita y quiere cambiarla, busca huecos con "ver_huecos" y usa "cambiar_cita" (no le crees otra). Si quiere anularla, usa "cancelar_cita" y ofrécele otro día.
   - Solo si ningún hueco le encaja o pide que le llamen, usa "solicitar_cita" con su preferencia: la recepción le dará hora.
4. Tú resuelves la conversación entera. No le digas que le atenderá o le escribirá otra persona, salvo que pida expresamente hablar con alguien de la oficina.
5. Cada vez que aprendas algo de la persona, llama a "actualizar_contacto" (nombre, motivo, desde cuándo, urgencia y 1–4 etiquetas cortas como "Importación detenida", "Trámite rechazado", "Recurso SAT", "Clasificación arancelaria", "Escritura", "Urgente", "Precios"). Las etiquetas que mandes sustituyen a las anteriores: incluye las que sigan valiendo.
6. Usa "mover_etapa" con "interesado" si pregunta por un servicio, precio o cuenta su caso, o "paciente" si dice que ya es cliente de la oficina. Las citas mueven la tarjeta solas.

## Lo que NUNCA haces
- Nunca prometas un resultado ni un plazo exacto: eso lo define el abogado en la primera asesoría. Si te preguntan si el trámite se va a resolver o cuánto va a tardar, recoge los datos y ofrece la cita.
- Si el cliente dice que tiene un plazo legal corriendo (por ejemplo, pocos días para recurrir), márcalo urgente con "actualizar_contacto" y ofrece la cita más próxima.
- No inventes precios, huecos, nombres ni servicios.

## Ahora mismo
Fecha y hora en Ciudad de Guatemala: ${guatemalaNow()}.
Fechas de los próximos días (para las herramientas usa siempre el formato AAAA-MM-DD):
${nextDays()}
Lo que ya sabemos de esta persona: ${known}.
Sus citas: ${citas}.

## Información de la oficina
Dirección: ${s.direccion}
Horario:
${horario}
Servicios y precios:
${servicios}
Equipo:
${teamForPrompt(s)}
Preguntas frecuentes:
${faq}`;
}

// ---------- Herramientas ----------
export const tools = [
  {
    type: 'function',
    function: {
      name: 'actualizar_contacto',
      description: 'Guarda lo que la persona ha contado y le pone etiquetas.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          motivo: { type: 'string', description: 'Qué trámite necesita, en pocas palabras.' },
          desde_cuando: { type: 'string' },
          urgencia: { type: 'string', enum: ['baja', 'media', 'alta'] },
          etiquetas: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          idioma: { type: 'string' },
          resumen: { type: 'string', description: 'Una frase para la recepción.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mover_etapa',
      description: 'Mueve la tarjeta de la persona en el tablero.',
      parameters: {
        type: 'object',
        properties: { etapa: { type: 'string', enum: ['interesado', 'quiere_cita', 'paciente'] } },
        required: ['etapa'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ver_huecos',
      description: 'Busca huecos libres en la agenda de la oficina. Devuelve días, horas y abogado reales que puedes ofrecer.',
      parameters: {
        type: 'object',
        properties: {
          desde: { type: 'string', description: 'Primer día a buscar, AAAA-MM-DD. Por defecto, hoy.' },
          hasta: { type: 'string', description: 'Último día, AAAA-MM-DD. Si quiere un día concreto, el mismo que "desde".' },
          franja: { type: 'string', enum: ['mañana', 'tarde', 'cualquiera'] },
          hora: { type: 'string', description: 'Hora aproximada que prefiere, HH:MM en 24 h.' },
          fisio: { type: 'string', description: 'Solo si pide a alguien concreto del equipo.' },
          servicio: { type: 'string', description: 'Nombre del servicio, como en la lista de servicios.' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'agendar_cita',
      description: 'Reserva la cita en la agenda, en un hueco que haya salido en ver_huecos.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          fecha: { type: 'string', description: 'AAAA-MM-DD' },
          hora: { type: 'string', description: 'HH:MM en 24 h' },
          servicio: { type: 'string' },
          fisio: { type: 'string', description: 'El abogado que dio ver_huecos para esa hora.' },
          motivo: { type: 'string', description: 'Qué trámite necesita, en pocas palabras.' },
        },
        required: ['fecha', 'hora'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cambiar_cita',
      description: 'Cambia de día u hora una cita que ya tiene esta persona (la próxima, o la de cita_id).',
      parameters: {
        type: 'object',
        properties: {
          fecha: { type: 'string', description: 'AAAA-MM-DD' },
          hora: { type: 'string', description: 'HH:MM en 24 h' },
          fisio: { type: 'string' },
          cita_id: { type: 'integer' },
        },
        required: ['fecha', 'hora'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cancelar_cita',
      description: 'Anula una cita que ya tiene esta persona (la próxima, o la de cita_id).',
      parameters: {
        type: 'object',
        properties: { cita_id: { type: 'integer' }, motivo: { type: 'string' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'solicitar_cita',
      description: 'Solo si ningún hueco le encaja o pide que le llamen: deja una petición sin hora para que la recepción la coloque en la agenda.',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string' },
          preferencia: { type: 'string', description: 'Cuándo le viene bien.' },
          motivo: { type: 'string' },
        },
        required: ['nombre', 'preferencia'],
      },
    },
  },
];

// El modelo a veces manda listas, objetos o nada: todo se convierte en texto o se ignora.
function asText(v) {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) return v.map(asText).filter(Boolean).join(', ') || undefined;
  if (typeof v === 'object') return Object.values(v).map(asText).filter(Boolean).join(', ') || undefined;
  const t = String(v).trim();
  return t || undefined;
}
const asHour = (v) => {
  const m = String(asText(v) ?? '').match(/^(\d{1,2})(?:[:.h](\d{2}))?/);
  if (!m || Number(m[1]) > 23 || Number(m[2] ?? 0) > 59) return undefined;
  return `${m[1].padStart(2, '0')}:${m[2] ?? '00'}`;
};
const asDate = (v) => {
  const t = asText(v);
  return t && /^\d{4}-\d{1,2}-\d{1,2}$/.test(t) ? parseLocal(t) : null;
};

const slotOut = (x) => {
  const d = parseLocal(x.start);
  return { fecha: x.start.slice(0, 10), dia: dayLabel(d), hora: x.start.slice(11, 16), fisio: x.therapist };
};

function defaultService(s, contact) {
  const name = contact?.stage === 'paciente' ? 'Gestión de trámite aduanero' : 'Primera asesoría aduanera';
  return findService(s, name)?.nombre ?? s.servicios[0]?.nombre;
}

// ver_huecos: igual para conversaciones reales y para la vista previa.
async function findSlots(s, contact, args) {
  const desde = asDate(args.desde) ?? new Date();
  const hasta = asDate(args.hasta);
  const opts = {
    desde,
    hasta: hasta && hasta >= startOfDay(desde) ? hasta : null,
    franja: asText(args.franja),
    hora: asHour(args.hora),
    fisio: asText(args.fisio),
    servicio: asText(args.servicio) ?? defaultService(s, contact),
    minStart: minStartFor(s),
  };
  const r = await suggestSlots(s, opts);
  if (r.error) return { ok: false, motivo: r.error };
  if (r.slots.length) {
    return {
      ok: true,
      servicio: r.service,
      duracion_min: r.duration,
      recomendado: slotOut(r.slots[0]),
      huecos: r.slots.slice(0, 8).map(slotOut),
      instruccion:
        'Si la persona ya dijo cuándo le viene bien, reserva ahora el "recomendado" con agendar_cita (mismo servicio y abogado) sin preguntarle. Si no dijo nada, ofrécele 2 o 3 en una sola frase, sin listas.',
    };
  }
  // Nada con esas condiciones: alternativas en los días siguientes, sin franja ni hora.
  const alt = await suggestSlots(s, { ...opts, desde: opts.hasta ? addDays(opts.hasta, 1) : desde, hasta: null, franja: null, hora: null });
  return {
    ok: true,
    huecos: [],
    alternativas: (alt.slots ?? []).slice(0, 4).map(slotOut),
    instruccion: 'No hay huecos con esas condiciones. Díselo y ofrécele alguna de las alternativas.',
  };
}

async function alternativesNear(s, contact, start, servicio, fisio) {
  const alt = await suggestSlots(s, { desde: startOfDay(start), servicio: servicio ?? defaultService(s, contact), fisio, minStart: minStartFor(s), maxDays: 2, perDay: 3 });
  return (alt.slots ?? []).slice(0, 4).map(slotOut);
}

export async function applyTool(contactId, name, rawArgs) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  let contact = await getContact(contactId);
  const s = getSettings();
  const actor = { kind: 'ia', name: s.asistente.nombre };

  if (name === 'actualizar_contacto') {
    const list = Array.isArray(args.etiquetas) ? args.etiquetas : typeof args.etiquetas === 'string' ? args.etiquetas.split(',') : null;
    const tags = list ? [...new Set(list.map(asText).filter(Boolean))].slice(0, 6) : undefined;
    const urgency = ['baja', 'media', 'alta'].includes(args.urgencia) ? args.urgencia : undefined;
    let finalTags = tags;
    if (urgency === 'alta') finalTags = [...new Set([...(tags ?? contact.tags), 'Urgente'])];
    const before = contact.tags.join('|');
    contact = await updateContact(contactId, {
      name: asText(args.nombre),
      reason: asText(args.motivo),
      since: asText(args.desde_cuando),
      urgency,
      tags: finalTags,
      language: asText(args.idioma),
      summary: asText(args.resumen),
    });
    emit.contact(contact);
    if (finalTags && finalTags.join('|') !== before) {
      const added = finalTags.filter((t) => !before.split('|').includes(t));
      if (added.length)
        emit.event(await addEvent({ type: 'tag', contactId, text: `La IA etiqueta a ${contact.name ?? 'un contacto'}: ${added.join(', ')}` }));
    }
    if (urgency === 'alta' && contact.urgency === 'alta' && !before.includes('Urgente'))
      emit.event(await addEvent({ type: 'urgent', contactId, text: `Caso urgente: ${contact.name ?? 'contacto sin nombre'}` }));
    if (contact.stage === 'nuevo' && (args.motivo || tags?.length)) contact = await moveStage(contact, 'interesado');
    return { ok: true };
  }
  if (name === 'mover_etapa') {
    await moveStage(contact, asText(args.etapa));
    return { ok: true };
  }
  if (name === 'ver_huecos') return findSlots(s, contact, args);

  if (name === 'agendar_cita') {
    const who = asText(args.nombre) ?? contact.name;
    if (!who) return { ok: false, falta: 'el nombre', instruccion: 'Pídele el nombre con naturalidad y vuelve a llamar a agendar_cita.' };
    const day = asText(args.fecha);
    const hour = asHour(args.hora);
    const start = day && hour ? parseLocal(`${day}T${hour}`) : null;
    if (!start) return { ok: false, falta: 'el día y la hora', instruccion: 'Busca huecos con ver_huecos y usa uno de ellos.' };
    const servicio = asText(args.servicio) ?? defaultService(s, contact);
    const r = await bookAppointment({
      contactId,
      start,
      therapist: asText(args.fisio),
      service: servicio,
      reason: asText(args.motivo),
      status: s.agenda.citas_ia === 'pendiente' ? 'pendiente' : 'confirmada',
      actor,
      name: who,
      minStart: minStartFor(s),
    });
    if (!r.ok) {
      const fisio = asText(args.fisio);
      // Si pidió a alguien concreto: sus huecos y quién más está libre a esa misma hora.
      const others = [];
      if (fisio) {
        for (const m of preferenceOrder(s, servicio).filter((x) => x !== findTherapist(s, fisio))) {
          const free = await checkSlot(s, { member: m, start, duration: minutesOf(findService(s, servicio)?.duracion), minStart: minStartFor(s) });
          if (free.ok) others.push(m.nombre);
        }
      }
      return {
        ok: false,
        motivo: r.motivo,
        alternativas: await alternativesNear(s, contact, start, servicio, fisio),
        ...(others.length ? { libres_a_esa_hora: others } : {}),
        instruccion: 'Ese hueco no está libre. Díselo y ofrécele alguna de las alternativas (o, si le da igual el fisio, a esa hora con quien esté libre).',
      };
    }
    const a = r.appointment;
    return {
      ok: true,
      cita: { id: a.id, cuando: when(a), servicio: a.service, duracion_min: a.duration, estado: a.status },
      instruccion:
        a.status === 'pendiente'
          ? 'Dile día, hora y con quién, que queda reservada y que la clínica se la confirma en breve. Si aún no lo has hecho, guarda su motivo y etiquetas con actualizar_contacto.'
          : 'Confírmale día, hora y con quién, y recuérdale que avise con 24 horas si no puede venir. Si aún no lo has hecho, guarda su motivo y etiquetas con actualizar_contacto.',
    };
  }

  if (name === 'cambiar_cita' || name === 'cancelar_cita') {
    const list = await upcomingFor(contactId);
    const id = Number(args.cita_id);
    const target = (id && list.find((a) => a.id === id)) || list.find((a) => a.starts_at) || list[0];
    if (!target) return { ok: false, motivo: 'Esta persona no tiene ninguna cita próxima.', instruccion: 'Si quiere cita, búscale hueco con ver_huecos y usa agendar_cita.' };
    if (name === 'cancelar_cita') {
      const r = await setStatus(target.id, 'cancelada', actor);
      if (!r.ok) return r;
      return { ok: true, cancelada: target.starts_at ? when(target) : 'la petición sin hora', instruccion: 'Confírmale que queda anulada y ofrécele buscar otro día.' };
    }
    const day = asText(args.fecha);
    const hour = asHour(args.hora);
    const start = day && hour ? parseLocal(`${day}T${hour}`) : null;
    if (!start) return { ok: false, falta: 'el día y la hora nuevos', instruccion: 'Busca huecos con ver_huecos.' };
    const r = await updateAppointment(target.id, { start, therapist: asText(args.fisio) }, actor, { minStart: minStartFor(s) });
    if (!r.ok)
      return {
        ok: false,
        motivo: r.motivo,
        alternativas: await alternativesNear(s, contact, start, target.service),
        instruccion: 'Ese hueco no está libre. Díselo y ofrécele alguna de las alternativas.',
      };
    return { ok: true, cita: { id: r.appointment.id, cuando: when(r.appointment), estado: r.appointment.status }, instruccion: 'Confírmale el nuevo día, hora y con quién.' };
  }

  if (name === 'solicitar_cita') {
    const who = asText(args.nombre) ?? contact.name;
    const preference = asText(args.preferencia);
    if (!who || !preference) {
      return { ok: false, falta: !who ? 'el nombre' : 'cuándo le viene bien', instruccion: 'Pídeselo al paciente con naturalidad y vuelve a llamar a solicitar_cita.' };
    }
    const r = await requestAppointment({ contactId, name: who, preference, reason: asText(args.motivo), actor });
    return { ok: true, aviso: r.updated ? 'Petición actualizada.' : 'La recepción ha recibido la petición y le dará hora.' };
  }
  return { ok: false, error: 'Herramienta desconocida' };
}

// En la vista previa de «Asistente» los huecos son reales, pero no se guarda nada.
async function applyPreviewTool(s, name, rawArgs) {
  const args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {};
  const fake = { stage: 'nuevo' };
  if (name === 'ver_huecos') return findSlots(s, fake, args);
  if (name === 'agendar_cita') {
    const day = asText(args.fecha);
    const hour = asHour(args.hora);
    const start = day && hour ? parseLocal(`${day}T${hour}`) : null;
    if (!start) return { ok: false, falta: 'el día y la hora', instruccion: 'Busca huecos con ver_huecos.' };
    const servicio = asText(args.servicio) ?? defaultService(s, fake);
    const members = args.fisio ? [findTherapist(s, asText(args.fisio))].filter(Boolean) : preferenceOrder(s, servicio);
    const svc = findService(s, servicio);
    const duration = svc ? minutesOf(svc.duracion) : 45;
    let member = null;
    for (const m of members) {
      if ((await checkSlot(s, { member: m, start, duration, minStart: minStartFor(s) })).ok) {
        member = m;
        break;
      }
    }
    if (!member) return { ok: false, motivo: 'Ese hueco no está libre', alternativas: await alternativesNear(s, fake, start, servicio) };
    return { ok: true, vista_previa: true, cita: { cuando: when({ starts_at: `${day}T${hour}`, therapist: member.nombre }), servicio }, instruccion: 'Confírmale día, hora y con quién.' };
  }
  if (name === 'cambiar_cita' || name === 'cancelar_cita') return { ok: false, motivo: 'En la vista previa esta persona no tiene citas.' };
  return { ok: true, vista_previa: true };
}

// ---------- Llamada al modelo ----------
async function callModel(model, messages, { allowTools = true } = {}) {
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'X-Title': 'Clinica Fisio IA (demo)',
    },
    body: JSON.stringify({ model, messages, tools, tool_choice: allowTools ? 'auto' : 'none', temperature: 0.4, max_tokens: 600 }),
  });
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  return data.choices?.[0]?.message;
}

async function historyFor(conversationId) {
  return (await getMessages(conversationId))
    .slice(-30)
    .map((m) => ({
      role: m.author === 'paciente' ? 'user' : 'assistant',
      content: m.author === 'recepcion' ? `[Recepción${m.author_name ? `, ${m.author_name}` : ''}] ${m.text}` : m.text,
    }));
}

async function aiTurn(conversationId, contactId) {
  const settings = getSettings();
  const messages = [
    { role: 'system', content: await buildSystemPrompt(settings, await getContact(contactId)) },
    ...(await historyFor(conversationId)),
  ];
  let partial = ''; // texto que el modelo escribe junto a las herramientas
  for (let round = 0; round < 6; round++) {
    const msg = await callModel(settings.asistente.modelo, messages);
    if (!msg) break;
    if (msg.tool_calls?.length) {
      if (msg.content?.trim()) partial = msg.content.trim();
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* argumentos rotos: se ignoran */
        }
        const result = await applyTool(contactId, call.function.name, args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
      continue;
    }
    if (msg.content?.trim()) return msg.content.trim();
    break;
  }
  if (partial) return partial;
  // El modelo solo usó herramientas: se le pide la respuesta al paciente, sin herramientas.
  const last = await callModel(settings.asistente.modelo, messages, { allowTools: false });
  return last?.content?.trim() || null;
}

// ---------- Entrada de mensajes (web, WhatsApp y demo) ----------
const queues = new Map(); // una respuesta cada vez por conversación
const timers = new Map();

export async function handleIncoming({ channel, externalId, text, phone = null, pushName = null, scripted = null }) {
  // Límite por persona (los pacientes simulados de la demo no cuentan).
  if (!scripted) {
    const lim = allowPersonMessage(channel, externalId);
    if (!lim.ok) {
      console.warn(`[límites] mensajes bloqueados de ${channel}:${String(externalId).slice(0, 8)}… durante ${waitText(lim.retryMs)}`);
      return { blocked: true, retryMs: lim.retryMs };
    }
  }
  const { contact, created } = await findOrCreateContact({ channel, externalId, phone, name: null });
  if (phone && !contact.phone) await updateContact(contact.id, { phone });
  const conv = await findOrCreateConversation(contact);
  const message = await addMessage({ conversationId: conv.id, author: 'paciente', text });

  if (created) {
    emit.event(
      await addEvent({
        type: 'contact',
        contactId: contact.id,
        text: `Nuevo contacto por ${channel === 'whatsapp' ? 'WhatsApp' : 'la web'}${pushName ? ` (${pushName})` : ''}`,
      }),
    );
  }
  emit.contact(await getContact(contact.id));
  emit.message(conv.id, message);
  emit.conversation(await fullConversation(conv.id));
  pushMetrics();

  if ((await getConversation(conv.id)).mode !== 'ia') return { conversationId: conv.id, contactId: contact.id };

  // Junta mensajes seguidos (la gente escribe en varios trozos) y contesta una vez.
  clearTimeout(timers.get(conv.id));
  timers.set(
    conv.id,
    setTimeout(() => {
      const prev = queues.get(conv.id) ?? Promise.resolve();
      const next = prev.then(() => reply(conv.id, contact.id, scripted)).catch((e) => console.error(e));
      queues.set(conv.id, next);
    }, scripted ? 300 : 900),
  );
  return { conversationId: conv.id, contactId: contact.id };
}

async function reply(conversationId, contactId, scripted) {
  if ((await getConversation(conversationId)).mode !== 'ia') return;
  let contact = await getContact(contactId);
  await setTyping(contact, conversationId, true);
  let text = null;
  try {
    const aiBudget = hasApiKey() ? allowAiReply() : { ok: false };
    if (hasApiKey() && !aiBudget.ok) {
      // Tope de IA de la clínica alcanzado: contesta sin IA (gratis) y se avisa al panel una vez por hora.
      if (take([['aviso:tope-ia', 1, 3600e3]]).ok)
        emit.event(await addEvent({ type: 'error', text: `Se ha llegado al tope de respuestas con IA. ${s_assistantName()} contesta con respuestas automáticas durante ${waitText(aiBudget.retryMs ?? 0)}.` }));
    }
    if (hasApiKey() && aiBudget.ok) {
      try {
        text = await aiTurn(conversationId, contactId);
      } catch (err) {
        console.error('[asistente] reintento tras error:', err.message);
        text = await aiTurn(conversationId, contactId);
      }
      // Sin texto del modelo: contesta por palabras clave en vez de dejar al paciente sin respuesta.
      if (!text) text = (await fallbackTurn(await getMessages(conversationId), await getContact(contactId), getSettings())).reply;
    } else {
      // Sin clave (o sin cupo de IA): respuestas guionizadas (demo) o por palabras clave.
      // El guion de la demo puede calcular su respuesta en el momento (p. ej. con huecos reales).
      const turn =
        (typeof scripted === 'function' ? await scripted(await getContact(contactId)) : scripted) ??
        (await fallbackTurn(await getMessages(conversationId), await getContact(contactId), getSettings()));
      await new Promise((r) => setTimeout(r, scripted ? 1100 : 700));
      for (const [name, args] of turn.tools ?? []) await applyTool(contactId, name, args);
      text = turn.reply;
    }
  } catch (err) {
    console.error('[asistente]', err.message);
    try {
      text = (await fallbackTurn(await getMessages(conversationId), await getContact(contactId), getSettings())).reply;
    } catch {
      text = 'Perdona, se me ha cortado la conexión un momento. ¿Me lo repites?';
    }
    emit.event(await addEvent({ type: 'error', contactId, text: `La asistente no pudo responder: ${err.message.slice(0, 120)}` }));
  }
  contact = await getContact(contactId);
  await setTyping(contact, conversationId, false);
  // Si la recepción tomó el control mientras pensaba, la IA se calla.
  if (!text || (await getConversation(conversationId)).mode !== 'ia') return;
  const msg = await addMessage({ conversationId, author: 'ia', text });
  emit.message(conversationId, msg);
  emit.conversation(await fullConversation(conversationId));
  pushMetrics();
  try {
    await sendThroughChannel(contact, text, { author: 'ia' });
  } catch (err) {
    emit.event(await addEvent({ type: 'error', contactId, text: `No se pudo enviar por ${contact.channel}: ${err.message}` }));
  }
}

// Para la vista previa de «Asistente»: una respuesta sin guardar nada.
export async function previewReply(history, settingsOverride) {
  const settings = settingsOverride ?? getSettings();
  const fakeContact = { channel: 'web', stage: 'nuevo', tags: [] }; // sin id: no tiene citas
  if (!hasApiKey() || !allowAiReply().ok) {
    const msgs = history.map((h) => ({ author: h.role === 'user' ? 'paciente' : 'ia', text: h.content }));
    return (await fallbackTurn(msgs, fakeContact, settings)).reply;
  }
  const messages = [{ role: 'system', content: await buildSystemPrompt(settings, fakeContact) }, ...history];
  for (let round = 0; round < 5; round++) {
    const msg = await callModel(settings.asistente.modelo, messages);
    if (msg?.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* argumentos rotos */
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(await applyPreviewTool(settings, call.function.name, args)) });
      }
      continue;
    }
    if (msg?.content?.trim()) return msg.content.trim();
    break;
  }
  const last = await callModel(settings.asistente.modelo, messages, { allowTools: false });
  return last?.content?.trim() || (await fallbackTurn([], fakeContact, settings)).reply;
}
