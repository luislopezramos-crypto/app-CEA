# Noray Fisioterapia · clínica atendida por IA

Demo completa de una clínica de fisioterapia (inventada) que atiende a sus pacientes con IA, de día y de noche:

- **Web de la clínica** (`/`): servicios, precios, equipo, horario, mutuas y opiniones, con un chat en el que el asistente contesta al momento.
- **Asistente** («Vera»): resuelve precios, horarios, tratamientos y mutuas; pregunta qué le pasa a la persona, desde cuándo y si es urgente; si quiere cita, **busca huecos libres en la agenda y la agenda él mismo** (con el fisio adecuado y respetando el turno de cada uno). También cambia o anula la cita si el paciente se lo pide. Nunca da diagnósticos y ante señales de alarma manda al 112. Contesta igual por la web y por WhatsApp, en el idioma del paciente.
- **Panel de la clínica** (`/panel`): Inicio, Conversaciones (con «Tomar el control»), **Agenda**, Contactos (etiquetas de la IA), Tablero (Nuevo · Interesado · Quiere cita · Paciente) y Asistente (configuración, horario de la agenda y conexión de WhatsApp por QR). Todo en directo, sin recargar. Los teléfonos salen ocultos (solo los 3 últimos números).

## La agenda

- **Vista de semana** (un día por columna) y **de día** (una columna por fisio, con sus horas de turno). Cada fisio tiene su color.
- **Agendar desde el panel**: pulsa un hueco libre o «Nueva cita». El formulario solo enseña las horas libres de ese día; sirve también para pacientes nuevos que llaman por teléfono.
- **Mover una cita**: arrástrala a otra hora (o a otro fisio, en la vista de día). Nunca deja solapar dos citas del mismo fisio ni poner una fuera de su turno.
- **Ficha de la cita**: confirmar, cambiar o cancelar, con aviso automático al paciente por WhatsApp o por el chat de la web.
- **Por agendar** y **Por confirmar**: las peticiones sin hora y las citas reservadas que falta confirmar.
- **Recordatorio** el día antes por el canal del paciente (se puede desactivar en Asistente → Agenda).
- En **Asistente → Agenda** se configuran el horario de apertura, el cambio de turno, la antelación mínima y si las citas que agenda Vera quedan confirmadas al momento o las confirma la recepción.

## La forma más fácil de arrancarla

Abre esta carpeta con Claude Code (o Codex, o Antigravity) y pídele: «Arranca esta app y dime cómo abrirla». Él instala lo que falte y te da la dirección para abrirla en el navegador.

Necesitas dos cosas tuyas: una **base de datos en Supabase** (gratis; los pasos están más abajo, en «Prepara tu base de datos en Supabase») y, para que el asistente conteste con IA de verdad, tu propia clave de OpenRouter (openrouter.ai/keys) en el archivo `.env`. Sin clave de OpenRouter también funciona, con respuestas de ejemplo.

## Arrancar a mano

Necesita Node 22.13 o superior.

```bash
npm install
```

```bash
cp .env.example .env
```

Abre `.env`, pon en `DATABASE_URL` la conexión con tu Supabase (ver abajo) y pega tu clave de OpenRouter en `OPENROUTER_API_KEY` (sin clave funciona igual, con respuestas de ejemplo por palabras clave). Pon cualquier texto largo en `SESSION_SECRET`.

```bash
npm start
```

- Web: http://localhost:3000
- Panel: http://localhost:3000/panel — el usuario y la contraseña de demo están en `.env.example` (`DEMO_USER` / `DEMO_PASSWORD`).

La primera vez que arranca con la base de datos vacía, carga sola los datos de ejemplo.

Para desarrollar el panel con recarga en caliente: `npm run dev` (abre http://localhost:5173/panel).

## Enseñarla

1. Abre la web y el panel en dos ventanas, una al lado de la otra.
2. Escribe en el chat de la web: «Me duele la espalda desde hace dos semanas», luego «quiero pedir cita, soy …» y un día («el jueves por la tarde»). En el panel verás llegar la conversación, crearse el contacto con etiquetas, moverse la tarjeta, sonar el aviso y **aparecer la cita en la Agenda**. Prueba después «pásamela al viernes» o «anúlala».
3. En **Inicio**, pulsa **Simular pacientes**: entran 4 conversaciones (web y WhatsApp, una en inglés y un caso urgente), las citas se agendan solas y una paciente cambia la suya de día.
4. En **Conversaciones**, pulsa **Tomar el control** y contesta: el mensaje llega al chat de la web como «Paula, de recepción» y la IA se calla hasta que pulses **Devolver a la IA**.
5. En **Agenda**, pulsa un hueco libre para agendar a alguien que llama por teléfono, o arrastra una cita a otra hora.
6. En **Asistente**, cambia un precio y pruébalo en «Pruébalo» antes de guardar (ve los huecos reales de la agenda, pero no reserva).

`npm run seed` vuelve a dejar los datos de ejemplo como al principio (contactos, conversaciones y unas 150 citas repartidas desde hace dos semanas hasta dentro de tres). **Ojo: borra lo que haya en la base de datos de Supabase.**

## Prepara tu base de datos en Supabase

1. Crea una cuenta y un proyecto en [supabase.com](https://supabase.com) (el plan gratuito sirve). Elige la región más cercana (por ejemplo, Frankfurt).
2. En el proyecto, abre **SQL Editor**, pega todo el contenido de `supabase/migrations/20261118190000_esquema_clinica.sql` y pulsa **Run**. Crea las tablas, la seguridad y el usuario `clinica_app` con el que entra la app.
3. En el mismo SQL Editor, dale una contraseña a ese usuario (inventa una larga, solo letras y números):
   ```sql
   alter role clinica_app with login password 'pon-aqui-una-contraseña-larga';
   ```
4. Pulsa **Connect** (arriba en el proyecto) → **Session pooler** y copia el servidor (algo como `aws-1-eu-central-1.pooler.supabase.com`) y el id del proyecto (el texto que va después de `postgres.`).
5. En tu `.env`:
   ```
   DATABASE_URL=postgresql://clinica_app.<id-del-proyecto>:<la-contraseña-del-paso-3>@<servidor-del-pooler>:5432/postgres
   ```

Con eso, `npm start` ya se conecta y, como la base de datos está vacía, carga los datos de ejemplo.

## Publicarla en internet (Render)

En [render.com](https://render.com), crea un **Web Service** desde tu repositorio de GitHub (región Frankfurt, para estar cerca de Supabase):

- Build Command: `npm ci --include=dev && npm run build`
- Start Command: `node --disable-warning=ExperimentalWarning server/index.js`
- Variables de entorno: `DATABASE_URL`, `OPENROUTER_API_KEY`, `SESSION_SECRET` (un texto largo y aleatorio), `NODE_VERSION=24` y `TZ=Europe/Madrid`.

En el plan gratuito la app se duerme tras 15 minutos sin visitas y la sesión de WhatsApp se pierde al publicar una versión nueva.

## Límites de uso

Para que nadie pueda saturar la app ni gastar la IA sin control, hay topes por persona, por IP y para toda la clínica (respuestas con IA por hora y por día), además de un bloqueo temporal tras varias contraseñas falsas. Están todos en `server/limits.js`. Conviene además poner un límite de gasto a la clave en OpenRouter.

## Base de datos (Supabase)

Los datos (contactos, conversaciones, mensajes, citas, actividad, ajustes del asistente y usuarios del panel) viven en **Supabase**.

- **Conexión**: `DATABASE_URL` en `.env`. La app entra con su propio usuario de base de datos (`clinica_app`), por una conexión cifrada que comprueba el certificado de Supabase (`certs/supabase-ca-2021.crt`).
- **Esquema**: `supabase/migrations/`. Las tablas son las mismas que antes; las horas de las citas van en hora de Valencia.
- **Seguridad**: todas las tablas tienen RLS. Con la clave pública de Supabase no se puede leer ni escribir nada; solo el servidor de la app.
- **Citas sin solapes**: además de las comprobaciones de la app, la propia base de datos rechaza que un fisio tenga dos citas activas a la vez.
- `npm run migrar-sqlite` copia una base antigua en SQLite (`data/clinic.db`, de versiones anteriores de la app) a Supabase tal cual (mismos ids y fechas). Borra antes lo que haya en Supabase.

## WhatsApp

En **Asistente → Conectar WhatsApp**, pulsa «Mostrar código QR» y escanéalo desde WhatsApp → Ajustes → Dispositivos vinculados. A partir de ahí el asistente contesta los WhatsApp de ese número. Usa la librería Baileys (como WhatsApp Web): no es la API oficial de Meta, así que conviene un volumen normal de mensajes y nada de envíos masivos. La sesión se guarda en `data/wa-auth` y se reconecta sola al arrancar.

## Cómo está hecho

| Carpeta | Qué hay |
|---|---|
| `server/` | Express + Socket.IO + Supabase (Postgres, con `pg`). `db.js` es la conexión y todas las consultas. `assistant.js` es el cerebro común de web y WhatsApp (prompt, OpenRouter con herramientas `actualizar_contacto`, `mover_etapa`, `ver_huecos`, `agendar_cita`, `cambiar_cita`, `cancelar_cita`, `solicitar_cita`). `agenda.js` calcula los huecos libres, reserva sin solapes, avisa al paciente y manda los recordatorios. `fallback.js` contesta (y agenda) sin clave. `privacy.js` oculta los teléfonos. `demo.js` simula pacientes. `seed.js` crea los datos de ejemplo. `clinic.json` es la ficha de la clínica (con el turno de cada fisio y el horario de la agenda). |
| `web/` | La web pública (HTML estático) y `widget.js`, el chat. |
| `panel/` | El panel en React + Vite; `npm run build` lo compila en `server/public/panel`. |
| `data/` | La sesión de WhatsApp y la copia de la antigua base SQLite (fuera de git). |
| `supabase/` | El esquema de la base de datos (migraciones). |

El modelo por defecto es `anthropic/claude-haiku-5.5` en OpenRouter y se cambia desde **Asistente**.
