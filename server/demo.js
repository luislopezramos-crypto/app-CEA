// Modo demo: clientes simulados que escriben en directo por el mismo flujo real.
// Con clave de OpenRouter contesta el modelo; sin clave, las respuestas del guion
// (que reservan en huecos reales de la agenda en el momento).
import { getMessages, getConversationByContact, getSettings } from './db.js';
import { handleIncoming, hasApiKey } from './assistant.js';
import { minStartFor, offerSlots, parsePreference, slotForPreference, upcomingFor, when } from './agenda.js';

const slotArgs = (slot) => ({ fecha: slot.start.slice(0, 10), hora: slot.start.slice(11, 16), fisio: slot.therapist });

// Paso en el que el cliente dice cuándo le viene bien y el asistente reserva.
function book(text, { nombre, servicio, fisio, motivo, lang, reply }) {
  return {
    text,
    scripted: async () => {
      const s = getSettings();
      const minStart = minStartFor(s);
      const slot = (await slotForPreference(s, parsePreference(text), { servicio, fisio, minStart })) ?? (await offerSlots(s, { servicio, minStart }))[0];
      if (!slot) return { reply: 'Ahora mismo no me quedan huecos esos días. He apuntado su petición y la recepción le da hora.', tools: [['solicitar_cita', { nombre, preferencia: text, motivo }]] };
      return {
        reply: reply(when({ starts_at: slot.start, therapist: slot.therapist }, lang)),
        tools: [['agendar_cita', { nombre, servicio, motivo, ...slotArgs(slot) }]],
      };
    },
  };
}

// Paso en el que el cliente pide cambiar la cita que acaba de reservar.
function move(text, { reply, lang }) {
  return {
    text,
    scripted: async (contact) => {
      const s = getSettings();
      const current = (await upcomingFor(contact.id)).find((a) => a.starts_at);
      if (!current) return { reply: 'No le encuentro ninguna cita. ¿Le busco una?', tools: [] };
      const pref = parsePreference(text);
      if (/misma hora|same time/.test(text.toLowerCase())) pref.hour = current.starts_at.slice(11, 16);
      // Primero con el mismo abogado; si no puede, con quien esté libre.
      const slot =
        (await slotForPreference(s, pref, { servicio: current.service, fisio: current.therapist, minStart: minStartFor(s) })) ??
        (await slotForPreference(s, pref, { servicio: current.service, minStart: minStartFor(s) }));
      if (!slot) return { reply: 'Ese día no me queda hueco a esa hora. ¿Le va bien otro?', tools: [] };
      return {
        reply: reply(when({ starts_at: slot.start, therapist: slot.therapist }, lang)),
        tools: [['cambiar_cita', slotArgs(slot)]],
      };
    },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const randomPhone = () => `502${Math.floor(10000000 + Math.random() * 89999999)}`;

const SCENARIOS = [
  {
    channel: 'whatsapp',
    pushName: 'Laura',
    steps: [
      {
        text: 'Hola, buenas tardes. Me rechazaron la importación dos veces y no me dicen por qué. ¿Me pueden ayudar?',
        reply: 'Hola, claro que sí. Lamento que le haya pasado eso. ¿Qué mercancía es y en qué aduana le rechazaron el trámite?',
        tools: [['actualizar_contacto', { motivo: 'Importación rechazada dos veces', etiquetas: ['Importación rechazada'], urgencia: 'media' }]],
      },
      {
        text: 'Son repuestos para maquinaria. La aduana me pide unos documentos que no entiendo',
        reply: 'Gracias por contármelo. Lo ideal es una primera asesoría aduanera (60 min, Q500), donde el licenciado revisa sus documentos y le explica el plan. ¿Le busco cita? Dígame su nombre y qué días le vienen bien.',
        tools: [['actualizar_contacto', { desde_cuando: 'Hace dos semanas', resumen: 'Importa repuestos; la aduana le pide documentos.' }]],
      },
      book('Laura Méndez. Me vendría bien el martes o el jueves por la tarde, a partir de las 15:00', {
        nombre: 'Laura Méndez',
        servicio: 'Primera asesoría aduanera',
        fisio: 'Francisco Adrián López Ramos',
        motivo: 'Importación rechazada dos veces',
        reply: (w) => `Hecho, Laura: le he reservado la primera asesoría aduanera el ${w}. Si no puede venir, avísenos con 24 horas.`,
      }),
      move('Uy, perdón, ¿me la puede pasar al viernes a la misma hora?', {
        reply: (w) => `Sin problema: se la he pasado al ${w}. ¿Necesita algo más?`,
      }),
      { text: 'Nada más, mil gracias!!', reply: '¡A usted, Laura! Quedamos a sus órdenes.', tools: [] },
    ],
  },
  {
    channel: 'web',
    steps: [
      {
        text: 'Buenas, ¿cuánto cuesta una clasificación arancelaria? No tengo seguro, pago yo',
        reply: 'Hola. La clasificación arancelaria y valoración son Q800 (45 min) y la primera asesoría aduanera Q500 (60 min). No trabajamos con aseguradoras: cada trámite se cotiza por separado. ¿Qué mercancía quiere clasificar, para orientarle?',
        tools: [['actualizar_contacto', { etiquetas: ['Precios', 'Clasificación arancelaria'] }], ['mover_etapa', { etapa: 'interesado' }]],
      },
      {
        text: 'Importo textiles y me cobran distinto cada vez. Creo que la partida está mal',
        reply: 'Entiendo. Eso lo revisa mejor el licenciado Francisco Adrián, que trabaja mucho con importadores de textiles. ¿Le impide despachar la mercancía o solo le cobran de más?',
        tools: [['actualizar_contacto', { motivo: 'Le cobran distinto cada vez por la clasificación de sus textiles', desde_cuando: 'Desde hace tres semanas', etiquetas: ['Textiles', 'Clasificación arancelaria'], urgencia: 'baja' }]],
      },
      {
        text: '¿Es la partida 6309? Un amigo dice que seguro es esa',
        reply: 'No se lo puedo decir por chat: la partida la define el abogado revisando la mercancía y sus documentos en la primera asesoría. Si quiere, le busco cita con el licenciado.',
        tools: [],
      },
      book('Vale, sí. Soy Diego Fuentes, el jueves por la tarde', {
        nombre: 'Diego Fuentes',
        servicio: 'Clasificación arancelaria y valoración',
        fisio: 'Francisco Adrián López Ramos',
        motivo: 'Clasificación de textiles',
        reply: (w) => `Hecho, Diego: le he reservado el ${w}. Traiga la factura comercial y el conocimiento de embarque, si los tiene.`,
      }),
    ],
  },
  {
    channel: 'whatsapp',
    pushName: 'Tom',
    steps: [
      {
        text: "Hi! I'm visiting Guatemala and my shipment is held at customs. Do you speak English? How much is a consultation?",
        reply: "Hi Tom! Yes, of course. A first customs consultation is Q500 (60 min). What goods are you importing, and which customs office is holding the shipment?",
        tools: [['actualizar_contacto', { nombre: 'Tom', motivo: 'Shipment held at customs', desde_cuando: 'Three days', etiquetas: ['Importación retenida'], idioma: 'inglés', urgencia: 'media' }]],
      },
      book("I'm Tom Baker. I can come tomorrow morning.", {
        nombre: 'Tom Baker',
        servicio: 'Primera asesoría aduanera',
        motivo: 'Mercancía retenida en aduana',
        lang: 'en',
        reply: (w) => `Done, Tom: you're booked for ${w}. Please bring the commercial invoice and the bill of lading, if you have them.`,
      }),
    ],
  },
  {
    channel: 'web',
    steps: [
      {
        text: 'Hola, la aduana me retuvo el contenedor y me dicen que cada día me cobran almacenaje. ¿Me pueden ver hoy?',
        reply: 'Lo que me cuenta hay que atenderlo hoy mismo, antes de que el almacenaje siga subiendo. Tráiganos la notificación de la aduana y presentamos el escrito hoy. La oficina abre a las 8:00; ¿a qué hora puede venir?',
        tools: [['actualizar_contacto', { motivo: 'Contenedor retenido, cobra almacenaje por día', urgencia: 'alta', etiquetas: ['Urgente', 'Contenedor retenido'] }]],
      },
    ],
  },
  {
    channel: 'whatsapp',
    pushName: 'Mariana',
    steps: [
      {
        text: 'Hola, importo todos los meses y cada vez es lo mismo: papeles, ajustes, vueltas. ¿Tienen algo para importadores frecuentes?',
        reply: 'Hola, sí: la asesoría mensual para importadores son Q3,500 al mes: revisamos sus importaciones, le contestamos sus consultas y gestionamos sus trámites del mes. ¿Quiere que le busque una primera asesoría para explicarle cómo funciona?',
        tools: [['actualizar_contacto', { motivo: 'Importa todos los meses; busca acompañamiento continuo', etiquetas: ['Asesoría mensual', 'Importador frecuente'], urgencia: 'baja' }]],
      },
      book('Sí por favor, soy Mariana Ortiz. Mejor por las mañanas, cualquier día', {
        nombre: 'Mariana Ortiz',
        servicio: 'Asesoría mensual para importadores',
        motivo: 'Importador frecuente, asesoría mensual',
        reply: (w) => `Hecho, Mariana: le he reservado la primera asesoría el ${w}. Traiga los documentos de su última importación, si los tiene.`,
      }),
    ],
  },
];

let running = false;
export const isDemoRunning = () => running;

async function waitForReply(contactId, after, timeoutMs) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const conv = await getConversationByContact(contactId);
    const last = conv && (await getMessages(conv.id)).at(-1);
    if (last && last.author !== 'paciente' && last.created_at > after) return true;
    if (conv && conv.mode !== 'ia') return false;
    await sleep(300);
  }
  return false;
}

async function runScenario(sc, delay) {
  await sleep(delay);
  const externalId = `demo:${Math.random().toString(36).slice(2, 10)}`;
  const phone = sc.channel === 'whatsapp' ? randomPhone() : null;
  for (const step of sc.steps) {
    const at = new Date().toISOString();
    const { contactId } = await handleIncoming({
      channel: sc.channel,
      externalId,
      phone,
      pushName: sc.pushName,
      text: step.text,
      scripted: step.scripted ?? { reply: step.reply, tools: step.tools },
    });
    const answered = await waitForReply(contactId, at, hasApiKey() ? 60000 : 8000);
    if (!answered) return; // recepción tomó el control: el guion se para
    await sleep(2500 + Math.random() * 2500); // el cliente lee y escribe
  }
}

export async function runDemo() {
  if (running) return false;
  running = true;
  const order = [...SCENARIOS].sort(() => Math.random() - 0.5).slice(0, 4);
  Promise.all(order.map((sc, i) => runScenario(sc, i * 5000)))
    .catch((e) => console.error('[demo]', e))
    .finally(() => {
      running = false;
    });
  return true;
}
