import { useState, type CSSProperties } from 'react';
import { api, apptWhen, openAppointmentDialog, pushToast, setState, useStore, type Appointment } from '../store';
import { navigate } from '../App';
import { ChannelBadge, Icon, STAGES, STAGE_LABEL, Tag, formatSeconds, timeAgo } from '../ui';
import { StatusPill } from '../appointments';
import { dayKey, firstName, memberColor, nowKey, timeRange } from '../agenda-utils';

function HourBars({ data }: { data: number[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const nowH = new Date().getHours();
  const first = Math.min(8, data.findIndex((n) => n > 0) === -1 ? 8 : data.findIndex((n) => n > 0));
  const hours = data.map((n, h) => ({ h, n })).slice(first, Math.max(nowH + 1, 22));
  const max = Math.max(4, ...hours.map((x) => x.n));
  return (
    <figure className="bars" aria-label="Mensajes por hora de hoy">
      <div className="bars__plot">
        {hours.map(({ h, n }) => (
          <div key={h} className={`bars__col${h === nowH ? ' is-now' : ''}`}
            onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover(null)}>
            <div className="bars__bar" style={{ height: `${(n / max) * 100}%` }} />
            {hover === h && <div className="bars__tip" role="tooltip"><strong>{n}</strong> mensajes · {h}:00–{h + 1}:00</div>}
          </div>
        ))}
      </div>
      <div className="bars__axis">
        {hours.map(({ h }) => <span key={h}>{h % 3 === 0 ? `${h}h` : ''}</span>)}
      </div>
      <table className="sr-only">
        <caption>Mensajes por hora</caption>
        <tbody>{hours.map(({ h, n }) => <tr key={h}><th>{h}:00</th><td>{n}</td></tr>)}</tbody>
      </table>
    </figure>
  );
}

// Una cita de hoy: hora, cliente, abogado y estado.
function TodayRow({ a }: { a: Appointment }) {
  const agenda = useStore((s) => s.agenda);
  const done = `${a.starts_at!.slice(0, 11)}${timeRange(a).slice(-5)}` < nowKey();
  return (
    <li>
      <button className={`today${done ? ' is-done' : ''}`} onClick={() => navigate('agenda', a.id)} style={{ '--c': memberColor(agenda, a.therapist) } as CSSProperties}>
        <span className="today__time">{a.starts_at!.slice(11, 16)}</span>
        <span className="today__main">
          <span className="today__who"><strong>{a.name}</strong>{a.source === 'ia' && <Icon name="bot" size={12} />}</span>
          <span className="muted small">{a.service} · {firstName(a.therapist)}</span>
        </span>
        {a.status === 'pendiente' ? <StatusPill status="pendiente" /> : <span className="today__dur muted small">{a.duration} min</span>}
      </button>
    </li>
  );
}

// Una cita por confirmar o sin hora.
function PendingRow({ a }: { a: Appointment }) {
  async function confirm() {
    try {
      await api(`/appointments/${a.id}/status`, { body: { status: 'confirmada', notify: a.can_notify } });
    } catch (e: any) {
      pushToast({ kind: 'info', title: 'No se pudo confirmar', body: e.message });
    }
  }
  return (
    <li className="appt">
      <div className="appt__main">
        <div className="appt__who">
          <ChannelBadge channel={a.channel} />
          <strong>{a.name ?? 'Sin nombre'}</strong>
          {a.urgency === 'alta' && <Tag urgent>Urgente</Tag>}
        </div>
        <span className="appt__pref"><Icon name="calendar" size={14} /> {a.starts_at ? `${apptWhen(a)} · ${a.service}` : `Sin hora · pidió «${a.preference}»`}</span>
        {a.reason && <span className="appt__reason">{a.reason}</span>}
      </div>
      <div className="appt__side">
        <span className="muted small">{timeAgo(a.created_at)}</span>
        <div className="appt__actions">
          {a.conversation_id && <button className="btn btn--ghost btn--sm" onClick={() => navigate('conversaciones', a.conversation_id!)}>Chat</button>}
          {a.starts_at
            ? <button className="btn btn--primary btn--sm" onClick={confirm}>Confirmar</button>
            : <button className="btn btn--primary btn--sm" onClick={() => openAppointmentDialog({ requestId: a.id })}>Darle hora</button>}
        </div>
      </div>
    </li>
  );
}

const greeting = () => { const h = new Date().getHours(); return h < 6 ? 'Buenas noches' : h < 14 ? 'Buenos días' : h < 21 ? 'Buenas tardes' : 'Buenas noches'; };

export default function Home() {
  const m = useStore((s) => s.metrics);
  const appts = useStore((s) => s.appointments);
  const [tab, setTab] = useState<'hoy' | 'pendientes'>('hoy');
  const events = useStore((s) => s.events);
  const demoRunning = useStore((s) => s.demoRunning);
  const hasApiKey = useStore((s) => s.hasApiKey);
  const user = useStore((s) => s.user);
  const now = nowKey();
  const todayKey = dayKey(new Date());
  const pending = appts.filter((a) => a.status === 'pendiente' && (!a.starts_at || a.starts_at >= now))
    .sort((a, b) => Number(Boolean(a.starts_at)) - Number(Boolean(b.starts_at)) || String(a.starts_at).localeCompare(String(b.starts_at)));
  const todayList = appts.filter((a) => a.starts_at?.startsWith(todayKey) && a.status !== 'cancelada')
    .sort((a, b) => a.starts_at!.localeCompare(b.starts_at!));
  const nextUp = todayList.find((a) => a.starts_at! >= now);
  const today = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  async function demo() {
    setState({ demoRunning: true });
    const r = await api('/demo', { method: 'POST' });
    if (!r.started) pushToast({ kind: 'info', title: 'La demo ya está en marcha', body: 'Espera a que terminen las conversaciones.' });
    setTimeout(() => setState({ demoRunning: false }), 45000);
  }

  if (!m) return null;
  const tiles = [
    { label: 'Mensajes hoy', value: m.messages, note: 'entre web y WhatsApp', icon: 'chat' },
    { label: 'Personas interesadas', value: m.interested, note: `${m.newContacts} contactos nuevos hoy`, icon: 'users' },
    { label: 'Citas hoy en la agenda', value: m.agendaToday, note: `${m.appointments} agendadas hoy · ${pending.length} por confirmar`, icon: 'calendar' },
    { label: 'Tiempo de respuesta', value: formatSeconds(m.avgResponse), note: 'media de hoy', icon: 'clock' },
  ];

  return (
    <div className="page">
      <header className="page__head">
        <div>
          <p className="eyebrow">{today}</p>
          <h1>{greeting()}, {user?.name.split(' ')[0]}</h1>
        </div>
        <div className="page__actions">
          {!hasApiKey && <span className="pill" title="Añade OPENROUTER_API_KEY en .env para que conteste el modelo">Respuestas de ejemplo</span>}
          <button className="btn btn--primary" onClick={demo} disabled={demoRunning}>
            <Icon name="play" size={14} /> {demoRunning ? 'Clientes escribiendo…' : 'Simular clientes'}
          </button>
        </div>
      </header>

      <section className="stats" aria-label="Números del día">
        {tiles.map((t) => (
          <div key={t.label} className="stat">
            <span className="stat__label"><Icon name={t.icon} size={15} /> {t.label}</span>
            <span className="stat__value">{t.value}</span>
            <span className="stat__note">{t.note}</span>
          </div>
        ))}
      </section>

      <div className="home-grid">
        <section className="card">
          <div className="card__head">
            <div className="segmented" role="tablist" aria-label="Citas">
              <button role="tab" aria-selected={tab === 'hoy'} className={tab === 'hoy' ? 'is-active' : ''} onClick={() => setTab('hoy')}>Citas de hoy · {todayList.length}</button>
              <button role="tab" aria-selected={tab === 'pendientes'} className={tab === 'pendientes' ? 'is-active' : ''} onClick={() => setTab('pendientes')}>Por confirmar · {pending.length}</button>
            </div>
            <button className="link" onClick={() => navigate('agenda')}>Abrir la agenda <Icon name="arrow" size={12} /></button>
          </div>
          {tab === 'hoy' ? (
            todayList.length === 0 ? <p className="empty">Hoy no hay citas en la agenda.</p> : (
              <>
                {nextUp && <p className="next-up"><Icon name="clock" size={14} /> Siguiente: <b>{nextUp.name}</b> a las {nextUp.starts_at!.slice(11, 16)} con {firstName(nextUp.therapist)}</p>}
                <ul className="today-list">{todayList.map((a) => <TodayRow key={a.id} a={a} />)}</ul>
              </>
            )
          ) : (
            pending.length === 0 ? <p className="empty">No hay citas por confirmar ni peticiones sin hora.</p> : (
              <ul className="appt-list">{pending.slice(0, 8).map((a) => <PendingRow key={a.id} a={a} />)}</ul>
            )
          )}
        </section>

        <section className="card">
          <div className="card__head"><h2>Mensajes por hora</h2><span className="muted small">hoy</span></div>
          <HourBars data={m.byHour} />
          <div className="funnel">
            {STAGES.map((s) => (
              <button key={s} className="funnel__step" onClick={() => navigate('tablero')}>
                <span className="funnel__n">{m.stages[s] ?? 0}</span>
                <span className="funnel__label">{STAGE_LABEL[s]}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="card card--activity">
          <div className="card__head"><h2>En directo</h2><span className="live"><span className="dot dot--on" /> actividad</span></div>
          <ol className="activity">
            {events.slice(0, 12).map((e) => (
              <li key={e.id} className={`activity__item activity__item--${e.type}`}>
                <span className="activity__dot" />
                <span className="activity__text">{e.text}</span>
                <span className="activity__time">{timeAgo(e.created_at)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
