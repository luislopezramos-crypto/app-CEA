// Datos de ejemplo para enseñar la app. `npm run seed` borra la base de datos de Supabase y la vuelve a llenar.
import './tz.js';
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { getDefaultSettings, loadSettings, one, pool, transaction } from './db.js';
import { addDays, shortWhen, startOfDay, toLocal, when } from './agenda.js';

// Accesos de demo al panel (cámbialos en .env antes de usarlo de verdad).
const USERS = [
  {
    username: process.env.DEMO_USER || 'recepcion',
    name: 'Sandra Patricia López Ramos',
    role: 'recepcion',
    password: process.env.DEMO_PASSWORD || 'cea-demo-2026',
  },
  {
    username: 'francisco',
    name: 'Francisco Adrián López Ramos',
    role: 'direccion',
    password: process.env.DEMO_PASSWORD || 'cea-demo-2026',
  },
];

// [nombre, canal, etapa, etiquetas, motivo, desde, urgencia, díasAtrás, minutosAtrás, diálogo, cita, modo]
// diálogo: p = cliente, a = asistente (IA), r = recepción. {cita} se cambia por el día y la hora reales.
// cita: texto = petición sin hora (la recepción la coloca); objeto = cita en la agenda (wd = día de la semana).
const P = [
  ['María José García', 'whatsapp', 'paciente', ['Importación rechazada'], 'Importación rechazada dos veces', 'Hace dos semanas', 'media', 0, 25,
    [['p', 'Hola buenas, me rechazaron la importación dos veces y no me dicen por qué'], ['a', 'Hola, lamento que le haya pasado eso. ¿Qué mercancía es y en qué aduana le rechazaron el trámite?'], ['p', 'Son repuestos para maquinaria. La aduana me pide unos documentos que no entiendo'], ['a', 'Gracias. Lo ideal es una primera asesoría aduanera (60 min, Q500) con el licenciado Francisco Adrián. Si quiere cita, dígame su nombre y qué días le vienen bien.'], ['p', 'María José García, el miércoles por la tarde'], ['a', 'Hecho, María José: le he reservado la primera asesoría aduanera el {cita}. Si no puede venir, avísenos con 24 horas.']],
    { wd: 3, time: '17:00', abogado: 'Francisco Adrián López Ramos', servicio: 'Primera asesoría aduanera', status: 'confirmada' }],
  ['Sergio Morales', 'web', 'interesado', ['Clasificación arancelaria', 'Precios'], 'Duda con la clasificación de sus textiles', 'Tres semanas', 'baja', 0, 48,
    [['p', '¿Cuánto cuesta la clasificación arancelaria?'], ['a', 'La clasificación arancelaria y valoración son Q800 (45 min). ¿Qué mercancía quiere clasificar, para orientarle?'], ['p', 'Importo textiles y me cobran distinto cada vez, creo que la partida está mal'], ['a', 'Entiendo. Eso lo revisa el licenciado Francisco Adrián, que trabaja mucho con importadores de textiles. ¿Le busco cita?'], ['p', 'Lo miro con mi agenda y les digo']]],
  ['Inmaculada Reyes', 'whatsapp', 'quiere_cita', ['Recurso ante la SAT', 'Ajuste aduanero'], 'Ajuste aduanero que quiere impugnar', 'Le llegó hace 3 días', 'media', 0, 75,
    [['p', 'Buenos días. Me llegó un ajuste de la aduana y me cobran más de lo que vale mi mercancía'], ['a', 'Buenos días, Inmaculada. Eso se impugna con un escrito ante la SAT. ¿Desde cuándo tiene la notificación?'], ['p', 'Hace tres días. Ya tengo todos los documentos'], ['a', 'Perfecto. ¿Qué días y a qué hora le viene mejor?'], ['p', 'Por las mañanas, que me lleva mi hija'], ['a', 'Le he reservado el {cita}. El licenciado prepara el escrito con sus documentos.']],
    { wd: 3, time: '10:00', abogado: 'Francisco Adrián López Ramos', servicio: 'Escrito o recurso ante la SAT', status: 'pendiente' }],
  ['Álex Ramírez', 'web', 'nuevo', [], null, null, null, 0, 95,
    [['p', 'Hola, ¿abren los sábados?'], ['a', 'Hola. Sí, los sábados de 8:00 a 12:00. ¿Le ayudo con algo más?']]],
  ['Cristina Fuentes', 'whatsapp', 'interesado', ['Asesoría mensual', 'Importador frecuente'], 'Importa todos los meses; busca acompañamiento', 'Importa cada mes', 'baja', 0, 130,
    [['p', 'Hola, importo todos los meses y cada vez es lo mismo: papeles, ajustes, vueltas. ¿Tienen algo para importadores frecuentes?'], ['a', 'Hola, Cristina. Sí: la asesoría mensual para importadores son Q3,500 al mes: revisamos sus importaciones y gestionamos sus trámites del mes. ¿Quiere que le busque una primera asesoría?'], ['p', '¿La primera asesoría también me explica cómo funciona el plan?'], ['a', 'Claro. El licenciado le explica el plan y revisa sus documentos. ¿Qué días le vienen bien?'], ['r', 'Hola Cristina, soy Sandra Patricia, de CEA. Le confirmo su cita por aquí y quedamos atentas a sus documentos.']],
    null, 'humano'],
  ['Jorge Vidal', 'web', 'paciente', ['Importación rechazada'], 'Importación rechazada; quiere cambiar su cita', 'Dos semanas', 'baja', 0, 170,
    [['p', 'Soy cliente del licenciado Francisco Adrián, ¿puedo cambiar mi cita del jueves al viernes?'], ['a', 'Claro, Jorge. Le he pasado la cita al {cita}. Si no puede venir, avísenos con 24 horas.']],
    { wd: 5, time: '09:00', abogado: 'Francisco Adrián López Ramos', servicio: 'Primera asesoría aduanera', status: 'confirmada' }],
  ['Rocío Cabrera', 'whatsapp', 'paciente', ['Contenedor retenido', 'Urgente'], 'Contenedor retenido en la aduana', 'Hace 5 días', 'media', 0, 210,
    [['p', 'Me retuvieron el contenedor en la aduana y me cobran almacenaje por cada día, ¿qué hago?'], ['a', 'Lamento lo del contenedor. ¿Tiene la notificación de la aduana a la mano?'], ['p', 'Sí, me la dieron el lunes'], ['a', 'Vale. Si la retención sigue, hay que presentar el escrito cuanto antes. Si quiere, le busco cita con el licenciado Francisco Adrián: dígame su nombre y cuándo le viene bien.'], ['p', 'Rocío Cabrera, mañana a primera hora si puede ser'], ['a', 'Hecho, Rocío: le he reservado el {cita}, a primera hora. Traiga la notificación y la factura comercial.']],
    { wd: 'manana', time: 'first', abogado: 'Francisco Adrián López Ramos', servicio: 'Primera asesoría aduanera', status: 'confirmada' }],
  ['Hugo Mendoza', 'web', 'interesado', ['Precios', 'Aseguradoras'], 'Pregunta por seguro', null, null, 0, 260,
    [['p', 'Tengo seguro, ¿me cubre la gestión?'], ['a', 'No trabajamos con aseguradoras: cada trámite se cotiza por separado. La primera asesoría aduanera son Q500 (60 min). ¿Qué trámite necesita?'], ['p', 'Una importación de repuestos que me rechazaron']]],
  ['Pilar Hernández', 'whatsapp', 'interesado', ['Trámite de terceros'], 'Trámite iniciado por otra persona', null, 'baja', 1, 60,
    [['p', 'Hola, mi trámite lo empezó otra persona y quedó a medias. ¿Ustedes lo pueden seguir?'], ['a', 'Hola, Pilar. Sí: gestionamos trámites iniciados por usted o por terceros, ante la aduana y la SAT. ¿Qué trámite es?'], ['p', 'Una importación de textiles de mi hijo, que vive fuera']]],
  ['Mario Estévez', 'web', 'paciente', ['Logística', 'Carga internacional'], 'Coordina carga de su exportación de café', 'Exporta cada mes', 'baja', 1, 180,
    [['p', '¿Me pueden coordinar la carga de mi exportación de café la semana que viene?'], ['a', 'Sí: le he reservado el {cita} para coordinar la carga. ¿Algo más?'], ['p', 'Nada más, gracias!']],
    { wd: 1, time: '17:00', abogado: 'Francisco Adrián López Ramos', servicio: 'Coordinación de carga internacional', status: 'confirmada' }],
  ['Nuria Chacón', 'whatsapp', 'quiere_cita', ['Ajuste aduanero', 'Urgente'], 'Ajuste con plazo corto para responder', 'Le llegó esta mañana', 'alta', 1, 320,
    [['p', 'Me llegó un ajuste de la aduana y tengo pocos días para responder, ¿me atienden hoy o mañana?'], ['a', 'Lo siento mucho. ¿Tiene la notificación a la mano y sabe cuántos días le quedan?'], ['p', 'Sí, me quedan pocos días'], ['a', 'Gracias. Si el plazo se vence, el ajuste queda firme, así que hay que actuar ya. Le busco cita lo antes posible: dígame su nombre y cuándo puede venir.'], ['p', 'Nuria Chacón, cuando sea, hoy o mañana'], ['a', 'Ahora mismo no me quedan huecos hoy ni mañana. He apuntado su petición como prioritaria y la recepción le hace un hueco en cuanto abra.']],
    'Hoy o mañana, lo antes posible'],
  ['David Cruz', 'web', 'nuevo', [], null, null, null, 1, 400,
    [['p', '¿Dónde están exactamente?'], ['a', 'Estamos en la 5a. Avenida A 13-48, Zona 9, Ciudad de Guatemala. ¿Le ayudo con algo más?']]],
  ['Elena Castillo', 'whatsapp', 'paciente', ['Escritura pública'], 'Escritura para su empresa', 'La necesita esta semana', 'baja', 2, 90,
    [['p', 'Hola licenciado! Ya tengo los documentos, ¿me reserva para el martes?'], ['a', 'Hola, Elena. Le he reservado el {cita}. ¡Hasta el martes!']],
    { wd: 2, time: '10:00', abogado: 'Francisco Adrián López Ramos', servicio: 'Escritura pública', status: 'confirmada' }],
  ['Andrea Santos', 'web', 'interesado', ['Importación rechazada', 'Precios'], 'Importación rechazada; pregunta el precio', 'Dos meses', 'baja', 2, 200,
    [['p', 'Trabajo importando repuestos y me rechazaron el trámite, ¿qué precio tiene la primera asesoría?'], ['a', 'La primera asesoría aduanera son Q500 (60 min) e incluye la revisión de sus documentos. ¿Desde cuándo le pasa?'], ['p', 'Un par de meses'], ['a', 'Gracias. ¿Le busco cita? Dígame su nombre y qué días le vienen bien.']]],
  ['Vicente Aguilar', 'whatsapp', 'nuevo', [], null, null, null, 2, 500,
    [['p', 'Buenas'], ['a', 'Hola, soy Ana, la asistente de Consultoría Empresarial Aduanera. ¿En qué le puedo ayudar?']]],
  ['Sophie Laurent', 'web', 'quiere_cita', ['Importación retenida'], 'Shipment held at customs', 'Three days', 'media', 3, 120,
    [['p', 'Hello! My shipment has been held at customs for three days. Can I book a consultation?'], ['a', "Hi! Sure. What's your name and when would suit you?"], ['p', 'Sophie Laurent, Friday afternoon'], ['a', "Thanks, Sophie. I've booked you in for {cita}; the office will confirm it shortly."]],
    { wd: 5, time: '16:30', abogado: 'Francisco Adrián López Ramos', servicio: 'Primera asesoría aduanera', status: 'pendiente' }],
  ['Raúl Morales', 'whatsapp', 'interesado', ['Clasificación arancelaria'], 'Duda con la partida de su mercancía', 'Una semana', 'baja', 3, 300,
    [['p', '¿Hacen clasificación arancelaria? Me cobran distinto cada vez por lo mismo'], ['a', 'Sí, la clasificación arancelaria y valoración son Q800 (45 min) y la define el abogado revisando la mercancía y sus documentos. ¿Desde cuándo le pasa?'], ['p', 'Una semana, desde la última importación']]],
  ['Carmen Vásquez', 'web', 'paciente', ['Importación rechazada'], 'Trámite resuelto', 'Resuelto', 'baja', 4, 150,
    [['p', 'Solo quería darles las gracias, ya quedó resuelto mi trámite'], ['a', '¡Qué alegría leerlo, Carmen! Se lo paso al licenciado Francisco Adrián. Aquí estamos para lo que necesite.']]],
  ['Iván López', 'whatsapp', 'nuevo', ['Precios'], null, null, null, 4, 420,
    [['p', '¿Tienen algún plan mensual?'], ['a', 'La asesoría mensual para importadores son Q3,500 al mes e incluye la revisión de sus importaciones y las gestiones del mes. ¿Qué importa usted, para orientarle?']]],
  ['Teresa Álvarez', 'whatsapp', 'interesado', ['Aduana Central'], 'Pregunta por trámites en la Aduana Central', null, 'media', 5, 200,
    [['p', 'Mi trámite es en la Aduana Central. ¿Ustedes gestionan ahí?'], ['a', 'Sí, gestionamos trámites ante la aduana y la SAT. ¿Qué trámite necesita, para que lo revise el abogado?'], ['p', 'Una importación de medicamentos que me piden permisos']]],
  ['Pablo Monroy', 'web', 'paciente', ['Logística'], 'Revisión de su expediente de importación', 'Resuelto', 'baja', 5, 600,
    [['p', '¿Tienen hueco con el licenciado la semana que viene para una revisión de mi expediente?'], ['a', 'Sí: le he reservado el {cita}.'], ['p', 'Perfecto, gracias']],
    { wd: 3, nextWeek: true, time: '17:30', abogado: 'Francisco Adrián López Ramos', servicio: 'Gestión de trámite aduanero', status: 'confirmada' }],
  ['Lorena Godínez', 'whatsapp', 'quiere_cita', ['Impugnación de ajuste'], 'Impugnación de un ajuste aduanero', 'Tres meses', 'media', 6, 100,
    [['p', 'Me aplicaron un ajuste y me cobran más de lo que vale mi mercancía, desde hace tres meses'], ['a', 'Lamento que le haya pasado eso. ¿Tiene la notificación del ajuste?'], ['p', 'Sí, la tengo en la oficina'], ['a', 'Gracias. Lo mejor es una primera asesoría aduanera con el licenciado Francisco Adrián. Dígame su nombre y cuándo le viene bien.'], ['p', 'Lorena Godínez. Lunes o miércoles a mediodía'], ['a', 'A mediodía no me quedan huecos esos días con el licenciado. He apuntado su petición y la recepción le busca hora.']],
    'Lunes o miércoles a mediodía'],
  ['Juan Ribera', 'web', 'nuevo', [], null, null, null, 6, 300,
    [['p', '¿Cómo se paga?'], ['a', 'Por trámite, según el servicio. Se paga por transferencia o en efectivo, al iniciar la gestión.']]],
];

// Clientes que vienen cada semana y reservaron por teléfono o en recepción.
// [nombre, abogado, días de la semana, hora, servicio, motivo, etiquetas]
const REGULARS = [
  ['Manuel Ortiz', 'Francisco Adrián López Ramos', [1, 3, 5], '09:00', 'Gestión de trámite aduanero', 'Importación de repuestos', ['Importador', 'Repuestos']],
  ['Amparo Cifuentes', 'Francisco Adrián López Ramos', [2, 4], '10:30', 'Escrito o recurso ante la SAT', 'Recurso por ajuste aduanero', ['Recurso ante la SAT', 'Ajuste aduanero']],
  ['Rosa Arévalo', 'Sandra Patricia López Ramos', [1, 4], '11:00', 'Asesoría mensual para importadores', 'Importación de textiles', ['Asesoría mensual', 'Importador frecuente']],
  ['Fernando Girón', 'Francisco Adrián López Ramos', [2, 4], '17:00', 'Coordinación de carga internacional', 'Exportación de café', ['Logística', 'Carga internacional']],
  ['Luis Herrera', 'Francisco Adrián López Ramos', [1, 3], '16:00', 'Clasificación arancelaria y valoración', 'Clasificación de maquinaria', ['Clasificación arancelaria']],
  ['Beatriz Salguero', 'Francisco Adrián López Ramos', [3, 5], '17:00', 'Gestión de trámite aduanero', 'Importación de medicamentos', ['Importador']],
  ['Josefina Mora', 'Francisco Adrián López Ramos', [1, 4], '12:00', 'Gestión de trámite aduanero', 'Importación de electrodomésticos', ['Importador']],
  ['Antonio Gálvez', 'Francisco Adrián López Ramos', [2, 4], '13:00', 'Logística de importación y exportación', 'Logística de importación de alimentos', ['Logística']],
  ['Silvia Navarro', 'Sandra Patricia López Ramos', [3, 6], '10:00', 'Asesoría mensual para importadores', 'Importación de plásticos', ['Asesoría mensual', 'Importador frecuente']],
  ['Enrique Pastor', 'Francisco Adrián López Ramos', [1, 3], '17:30', 'Impugnación de ajuste aduanero', 'Impugnación de ajuste', ['Impugnación de ajuste']],
  ['Francisco Beltrán', 'Francisco Adrián López Ramos', [5], '17:00', 'Escritura pública', 'Escritura para su empresa', ['Escritura pública']],
  ['Marisa Flores', 'Francisco Adrián López Ramos', [2], '11:00', 'Gestión de trámite aduanero', 'Importación de vehículos', ['Importador']],
];
// Clientes de las conversaciones que también vienen cada semana.
const SERIES = {
  'Jorge Vidal': ['Francisco Adrián López Ramos', [2, 5], '09:00', 'Primera asesoría aduanera'],
  'Mario Estévez': ['Francisco Adrián López Ramos', [1, 4], '17:00', 'Coordinación de carga internacional'],
  'Elena Castillo': ['Francisco Adrián López Ramos', [2], '10:00', 'Escritura pública'],
  'Carmen Vásquez': ['Francisco Adrián López Ramos', [1], '12:00', 'Gestión de trámite aduanero'],
};

function at(daysAgo, minutesAgo) {
  const d = new Date();
  const startToday = new Date();
  startToday.setHours(0, 5, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  d.setMinutes(d.getMinutes() - minutesAgo);
  if (daysAgo === 0 && d < startToday) return startToday;
  return d;
}

// Próximo día de la semana (siempre a partir de mañana); «manana» = mañana, o el lunes si mañana es domingo.
function nextDate(wd, nextWeek = false) {
  const today = startOfDay(new Date());
  if (wd === 'manana') {
    const d = addDays(today, 1);
    return d.getDay() === 0 ? addDays(d, 1) : d;
  }
  let diff = (wd - today.getDay() + 7) % 7;
  if (diff === 0) diff = 7;
  return addDays(today, diff + (nextWeek ? 7 : 0));
}

const DURATION = {};
function duration(settings, servicio) {
  if (!DURATION[servicio]) {
    const svc = settings.servicios.find((x) => x.nombre === servicio);
    const n = [...String(svc?.duracion ?? '').matchAll(/(\d+)\s*min/g)].map((m) => Number(m[1])).at(-1);
    DURATION[servicio] = n || 45;
  }
  return DURATION[servicio];
}

// Inserta muchas filas de una vez (en bloques), para no hacer cientos de viajes a Supabase.
async function insertMany(client, table, cols, rows) {
  for (let i = 0; i < rows.length; i += 300) {
    const chunk = rows.slice(i, i + 300);
    const params = [];
    const values = chunk.map((r) => `(${r.map((v) => `$${params.push(v)}`).join(', ')})`);
    await client.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values.join(', ')}`, params);
  }
}

export async function seed() {
  const settings = getDefaultSettings();
  const users = USERS.map((u) => [u.username, u.name, u.role, bcrypt.hashSync(u.password, 10)]);

  await transaction(async (db) => {
    // Vacía las tablas y deja los contadores de id en 1.
    await db.query('TRUNCATE events, appointments, messages, conversations, contacts, users, settings CASCADE');
    for (const t of ['users', 'contacts', 'conversations', 'messages', 'events', 'appointments'])
      await db.query(`SELECT setval(pg_get_serial_sequence('public.${t}', 'id'), 1, false)`);
    await db.query('INSERT INTO settings (key, value) VALUES ($1, $2::jsonb)', ['clinic', JSON.stringify(settings)]);
    await insertMany(db, 'users', ['username', 'name', 'role', 'password_hash'], users);

    const insContact = async (row) =>
      (
        await db.query(
          `INSERT INTO contacts (name, channel, external_id, phone, reason, since, urgency, tags, stage, summary, language, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13) RETURNING id`,
          row,
        )
      ).rows[0].id;
    const appts = [];
    const requests = [];
    const msgRows = [];
    const events = [];
    const insEvent = (type, contactId, text, createdAt) => events.push([type, contactId, text, createdAt]);

    // Ocupación por abogado y día, para no solapar citas al generar los datos.
    const busy = new Map();
    const taken = new Set();
    function addAppointment({ contactId, name, reason, status, createdAt, start, servicio, abogado, source, bookedBy }) {
      const dur = duration(settings, servicio);
      const key = `${abogado}|${toLocal(start).slice(0, 10)}`;
      const a = start.getHours() * 60 + start.getMinutes();
      const list = busy.get(key) ?? [];
      if (taken.has(`${contactId}|${toLocal(start)}`) || list.some(([x, y]) => a < y && x < a + dur)) return null;
      list.push([a, a + dur]);
      busy.set(key, list);
      taken.add(`${contactId}|${toLocal(start)}`);
      appts.push([contactId, name, null, reason, status, createdAt, toLocal(start), dur, abogado, servicio, source, bookedBy, createdAt]);
      return { starts_at: toLocal(start), therapist: abogado };
    }

    const contactIds = {};
    for (const [i, [name, channel, stage, tags, reason, since, urgency, daysAgo, minutesAgo, dialog, appt, mode]] of P.entries()) {
      const start = at(daysAgo, minutesAgo + dialog.length * 2);
      const phone = channel === 'whatsapp' ? `502${String(10000000 + ((i + 3) * 7919321) % 89999999)}` : null;
      const english = /^(Sophie)/.test(name);
      let tMsg = new Date(start);
      const msgs = dialog.map(([who, text], k) => {
        // El cliente tarda 1–3 min en contestar; la IA, unos segundos.
        tMsg = new Date(tMsg.getTime() + (who === 'p' ? (k === 0 ? 0 : 60000 + ((i * 37 + k * 53) % 120000)) : who === 'a' ? 3000 + ((i + k) % 5) * 1200 : 240000));
        return [who, text, tMsg.toISOString()];
      });
      const last = msgs.at(-1)[2];
      const contactId = await insContact([
        name, channel, `demo:seed-${i}`, phone, reason, since, urgency, JSON.stringify(tags), stage,
        reason ? `${reason}${since ? ` · ${since}` : ''}` : null, english ? 'inglés' : 'español', start.toISOString(), last,
      ]);
      contactIds[name] = contactId;

      // Cita en la agenda reservada por la IA durante la conversación.
      let booked = null;
      const bookedAt = msgs.findLast((m) => m[1].includes('{cita}'))?.[2] ?? last;
      if (appt && typeof appt === 'object') {
        const day = nextDate(appt.wd, appt.nextWeek);
        const open = settings.agenda.apertura[day.getDay()];
        const time = appt.time === 'first' ? open[0] : appt.time;
        const [h, m] = time.split(':').map(Number);
        const when0 = new Date(day);
        when0.setHours(h, m, 0, 0);
        booked = addAppointment({ contactId, name, reason, status: appt.status, createdAt: bookedAt, start: when0, servicio: appt.servicio, abogado: appt.abogado, source: 'ia', bookedBy: settings.asistente.nombre });
        if (booked) {
          insEvent('appointment', contactId, `${settings.asistente.nombre} agenda a ${name}: ${shortWhen(booked)} con ${appt.abogado.split(' ')[0]}${appt.status === 'pendiente' ? ' (por confirmar)' : ''}`, bookedAt);
        }
      }
      const fill = (text) => (booked ? text.replace('{cita}', when(booked, english ? 'en' : 'es')) : text);

      const unread = msgs.at(-1)[0] === 'p' ? 1 : 0;
      const conv = await db.query(
        'INSERT INTO conversations (contact_id, channel, mode, handled_by, unread, last_message_at, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
        [contactId, channel, mode ?? 'ia', mode === 'humano' ? 'Sandra Patricia López Ramos' : null, unread, last, start.toISOString()],
      );
      const convId = conv.rows[0].id;
      for (const [who, text, ts] of msgs)
        msgRows.push([convId, who === 'p' ? 'paciente' : who === 'a' ? 'ia' : 'recepcion', who === 'r' ? 'Sandra Patricia López Ramos' : null, fill(text), ts]);

      insEvent('contact', contactId, `Nuevo contacto por ${channel === 'whatsapp' ? 'WhatsApp' : 'la web'}`, start.toISOString());
      if (tags.length) insEvent('tag', contactId, `La IA etiqueta a ${name}: ${tags.join(', ')}`, msgs[Math.min(1, msgs.length - 1)][2]);
      if (typeof appt === 'string') {
        // Petición sin hora: queda «por agendar» para la recepción.
        requests.push([contactId, name, appt, reason, 'pendiente', 'ia', settings.asistente.nombre, last, last]);
        insEvent('appointment', contactId, `${name} pide cita sin hora · ${appt}`, last);
      }
      if (urgency === 'alta') insEvent('urgent', contactId, `Caso urgente: ${name}`, msgs[0][2]);
    }

    // Clientes habituales: contactos que reservaron por teléfono (sin chat).
    for (const [i, [name, abogado, days, time, servicio, reason, tags]] of REGULARS.entries()) {
      const created = at(25 + (i % 10), 30 * i);
      contactIds[name] = await insContact([
        name, 'telefono', `demo:tel-${i}`, `502${String(10000000 + ((i + 11) * 6151) % 79999999)}`, reason, null, 'baja', JSON.stringify(tags), 'paciente',
        `${reason} · viene ${days.length} ${days.length === 1 ? 'vez' : 'veces'} por semana`, 'español', created.toISOString(), created.toISOString(),
      ]);
      SERIES[name] = [abogado, days, time, servicio, reason];
    }

    // Gestiones de cada semana: desde hace dos semanas hasta dentro de tres.
    const today = startOfDay(new Date());
    const seriesCreated = at(21, 0).toISOString();
    for (const [name, [abogado, days, time, servicio, reason]] of Object.entries(SERIES)) {
      const contactId = contactIds[name];
      if (!contactId) continue;
      for (let k = -14; k <= 21; k++) {
        const day = addDays(today, k);
        if (!days.includes(day.getDay())) continue;
        const [h, m] = time.split(':').map(Number);
        const start = new Date(day);
        start.setHours(h, m, 0, 0);
        addAppointment({ contactId, name, reason: reason ?? null, status: 'confirmada', createdAt: seriesCreated, start, servicio, abogado, source: 'recepcion', bookedBy: 'Sandra Patricia López Ramos' });
      }
    }

    await insertMany(db, 'messages', ['conversation_id', 'author', 'author_name', 'text', 'created_at'], msgRows);
    await insertMany(
      db,
      'appointments',
      ['contact_id', 'name', 'preference', 'reason', 'status', 'created_at', 'starts_at', 'duration', 'therapist', 'service', 'source', 'booked_by', 'updated_at'],
      appts,
    );
    await insertMany(db, 'appointments', ['contact_id', 'name', 'preference', 'reason', 'status', 'source', 'booked_by', 'created_at', 'updated_at'], requests);
    await insertMany(db, 'events', ['type', 'contact_id', 'text', 'created_at'], events);
  });

  await loadSettings();
  // Los contactos de ejemplo llevan el prefijo demo: y nunca reciben nada por WhatsApp ni por la web.
  const n = (await one('SELECT COUNT(*) AS n FROM appointments')).n;
  console.log(`Datos de ejemplo cargados en Supabase: ${P.length + REGULARS.length} contactos, ${n} citas, ${USERS.length} usuarios del panel.`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await seed();
  await pool.end();
}
