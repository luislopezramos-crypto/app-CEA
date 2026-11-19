import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type MouseEvent } from 'react';
import { api, apptWhen, openAppointmentDialog, pushToast, useStore, type Appointment, type TeamMember } from '../store';
import { navigate } from '../App';
import { Avatar, ChannelBadge, Icon, Tag, timeAgo } from '../ui';
import { StatusPill } from '../appointments';
import {
  TURNO_LABEL, addDays, dayKey, dayRange, firstName, hmToMin, layoutLanes, longDay, memberColor, minToHm,
  nowKey, parseDay, startMin, startOfWeek, timeRange,
} from '../agenda-utils';

type Mode = 'semana' | 'dia';
const PPM = 1.2; // píxeles por minuto: 15 min = 18 px
const SNAP = 15;

interface Column { key: string; date: Date; member: TeamMember | null; window: [number, number] | null }
interface DragInfo { id: number; duration: number; grab: number }

// ---------- Ficha de una cita ----------
function AppointmentDetail({ a, justMoved, onNotified }: { a: Appointment; justMoved: boolean; onNotified: () => void }) {
  const agenda = useStore((s) => s.agenda);
  const [notify, setNotify] = useState(true);
  const [busy, setBusy] = useState(false);
  const who = firstName(a.name) || 'la persona';
  const channelName = a.channel === 'whatsapp' ? 'WhatsApp' : 'el chat de la web';

  async function setStatus(status: 'confirmada' | 'cancelada') {
    if (status === 'cancelada' && !confirm(`¿Cancelar la cita de ${a.name ?? 'este cliente'}${a.starts_at ? ` (${apptWhen(a)})` : ''}?`)) return;
    setBusy(true);
    try {
      const r = await api<{ warning?: string }>(`/appointments/${a.id}/status`, { body: { status, notify: a.can_notify && notify } });
      pushToast({ kind: 'info', title: status === 'confirmada' ? 'Cita confirmada' : 'Cita cancelada', body: r.warning ?? (a.can_notify && notify ? `Aviso enviado a ${who}` : `${a.name ?? ''} · ${apptWhen(a)}`) });
    } catch (e: any) {
      pushToast({ kind: 'info', title: 'No se pudo cambiar la cita', body: e.message });
    } finally { setBusy(false); }
  }
  async function sendMoved() {
    try {
      await api(`/appointments/${a.id}/notify`, { body: { kind: 'movida' } });
      pushToast({ kind: 'info', title: 'Aviso enviado', body: `${a.name} sabe que su cita es el ${apptWhen(a)}` });
      onNotified();
    } catch (e: any) {
      pushToast({ kind: 'info', title: 'No se pudo avisar', body: e.message });
    }
  }

  return (
    <aside className="appt-detail" aria-label="Cita">
      <header className="appt-detail__top">
        <StatusPill status={a.status} />
        <button className="icon-btn" aria-label="Cerrar cita" onClick={() => navigate('agenda')}><Icon name="x" /></button>
      </header>
      <div className="appt-detail__who">
        <Avatar name={a.name} id={a.contact_id} size={44} />
        <div>
          <h2>{a.name ?? 'Cliente sin nombre'}</h2>
          <span className="muted small"><ChannelBadge channel={a.channel} label />{a.urgency === 'alta' && <Tag urgent>Urgente</Tag>}</span>
        </div>
      </div>
      {a.starts_at ? (
        <div className="appt-detail__when">
          <span className="appt-detail__day">{longDay(new Date(a.starts_at))}</span>
          <span className="appt-detail__time">{timeRange(a)} <span className="muted">· {a.duration} min</span></span>
        </div>
      ) : (
        <div className="appt-detail__when appt-detail__when--none">
          <span className="appt-detail__day">Sin hora todavía</span>
          <span className="muted">Pidió: «{a.preference}»</span>
        </div>
      )}
      <dl className="facts">
        {a.therapist && <div><dt>Abogado</dt><dd><span className="swatch" style={{ background: memberColor(agenda, a.therapist) }} /> {a.therapist}</dd></div>}
        <div><dt>Servicio</dt><dd>{a.service ?? '—'}</dd></div>
        {a.reason && <div><dt>Motivo</dt><dd>{a.reason}</dd></div>}
        {a.notes && <div><dt>Notas internas</dt><dd>{a.notes}</dd></div>}
      </dl>
      <p className="appt-detail__source">
        <Icon name={a.source === 'ia' ? 'bot' : 'hand'} size={13} />
        {a.source === 'ia' ? `La agendó ${a.booked_by ?? 'el asistente'} por ${a.channel === 'whatsapp' ? 'WhatsApp' : 'la web'}` : `La agendó ${a.booked_by ?? 'la recepción'}`} · {timeAgo(a.created_at)}
        {a.reminder_sent_at && <> · <Icon name="bell" size={12} /> recordatorio enviado</>}
      </p>

      {justMoved && a.can_notify && a.status !== 'cancelada' && (
        <div className="callout">
          <span>Has cambiado la hora. ¿Se lo dices a {who}?</span>
          <button className="btn btn--primary btn--sm" onClick={sendMoved}>Avisar por {a.channel === 'whatsapp' ? 'WhatsApp' : 'el chat'}</button>
        </div>
      )}

      <div className="appt-detail__actions">
        {!a.starts_at && a.status !== 'cancelada' && (
          <button className="btn btn--primary" onClick={() => openAppointmentDialog({ requestId: a.id })}><Icon name="calendar" size={15} /> Darle hora</button>
        )}
        {a.starts_at && a.status === 'pendiente' && (
          <button className="btn btn--primary" disabled={busy} onClick={() => setStatus('confirmada')}><Icon name="check" size={15} /> Confirmar cita</button>
        )}
        {a.starts_at && a.status !== 'cancelada' && (
          <button className="btn" onClick={() => openAppointmentDialog({ appointmentId: a.id })}><Icon name="edit" size={15} /> Cambiar</button>
        )}
        {a.status !== 'cancelada'
          ? <button className="btn btn--ghost btn--danger" disabled={busy} onClick={() => setStatus('cancelada')}>Cancelar cita</button>
          : a.starts_at && <button className="btn" disabled={busy} onClick={() => setStatus('confirmada')}>Recuperar cita</button>}
      </div>
      {a.can_notify && a.status !== 'cancelada' && a.starts_at && (
        <label className="check">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          <span>Avisar a {who} por {channelName} al confirmar o cancelar</span>
        </label>
      )}
      <div className="appt-detail__links">
        {a.conversation_id && <button className="link" onClick={() => navigate('conversaciones', a.conversation_id!)}>Abrir conversación <Icon name="arrow" size={12} /></button>}
        <button className="link" onClick={() => navigate('contactos', a.contact_id)}>Ver ficha <Icon name="arrow" size={12} /></button>
      </div>
    </aside>
  );
}

// ---------- Pendientes ----------
function Queue() {
  const appointments = useStore((s) => s.appointments);
  const now = nowKey();
  const toPlace = appointments.filter((a) => !a.starts_at && a.status === 'pendiente')
    .sort((a, b) => (b.urgency === 'alta' ? 1 : 0) - (a.urgency === 'alta' ? 1 : 0) || a.created_at.localeCompare(b.created_at));
  const toConfirm = appointments.filter((a) => a.starts_at && a.status === 'pendiente' && a.starts_at >= now)
    .sort((a, b) => a.starts_at!.localeCompare(b.starts_at!));
  return (
    <aside className="agenda-side" aria-label="Pendientes">
      <section>
        <h2>Por agendar {toPlace.length > 0 && <span className="count count--accent">{toPlace.length}</span>}</h2>
        <p className="muted small">Pidieron cita sin hora. Dales un hueco.</p>
        {toPlace.length === 0 && <p className="queue-empty">Nada pendiente.</p>}
        <ul className="queue">
          {toPlace.map((a) => (
            <li key={a.id} className="queue__item">
              <div className="queue__main">
                <span className="queue__who"><ChannelBadge channel={a.channel} /> <strong>{a.name ?? 'Sin nombre'}</strong>{a.urgency === 'alta' && <Tag urgent>Urgente</Tag>}</span>
                <span className="muted small">Pidió: {a.preference}</span>
              </div>
              <button className="btn btn--primary btn--sm" onClick={() => openAppointmentDialog({ requestId: a.id })}>Darle hora</button>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2>Por confirmar {toConfirm.length > 0 && <span className="count">{toConfirm.length}</span>}</h2>
        <p className="muted small">Reservadas en la agenda, a falta de que las confirméis.</p>
        {toConfirm.length === 0 && <p className="queue-empty">Todo confirmado.</p>}
        <ul className="queue">
          {toConfirm.map((a) => (
            <li key={a.id}>
              <button className="queue__item queue__item--link" onClick={() => navigate('agenda', a.id)}>
                <div className="queue__main">
                  <span className="queue__who"><ChannelBadge channel={a.channel} /> <strong>{a.name}</strong></span>
                  <span className="muted small">{apptWhen(a)} · {a.service}</span>
                </div>
                <Icon name="next" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

// ---------- Agenda ----------
export default function Agenda({ selectedId }: { selectedId?: number }) {
  const agenda = useStore((s) => s.agenda);
  const appointments = useStore((s) => s.appointments);
  const apptFlash = useStore((s) => s.apptFlash);
  const selected = appointments.find((a) => a.id === selectedId);
  const [mode, setMode] = useState<Mode>(() => (window.matchMedia('(max-width: 820px)').matches ? 'dia' : 'semana'));
  const [anchor, setAnchor] = useState<Date>(() => (selected?.starts_at ? parseDay(selected.starts_at) : new Date()));
  const [hidden, setHidden] = useState<string[]>([]);
  const [showCancelled, setShowCancelled] = useState(false);
  const [hover, setHover] = useState<{ col: string; min: number } | null>(null);
  const [ghost, setGhost] = useState<{ col: string; min: number; duration: number } | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const [, tick] = useState(0);
  const drag = useRef<DragInfo | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // La línea de «ahora» se mueve sola.
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const weekStart = startOfWeek(anchor);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart.getTime()]);

  // Al abrir una cita de otra semana (desde un aviso o la bandeja), la agenda salta a ese día.
  useEffect(() => {
    if (!selected?.starts_at) return;
    const d = parseDay(selected.starts_at);
    const inView = mode === 'semana' ? weekDays.some((x) => dayKey(x) === dayKey(d)) : dayKey(anchor) === dayKey(d);
    if (!inView) setAnchor(d);
  }, [selectedId, selected?.starts_at, mode]);

  const [rangeStart, rangeEnd] = agenda ? dayRange(agenda) : [480, 1260];

  // Al entrar, la vista baja hasta la hora actual.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const now = new Date();
    const m = now.getHours() * 60 + now.getMinutes();
    el.scrollTop = m > rangeStart && m < rangeEnd ? Math.max(0, (m - rangeStart - 60) * PPM) : 0;
  }, [mode]);

  if (!agenda) return <div className="page"><p className="empty">Cargando agenda…</p></div>;

  const team = agenda.team.filter((m) => !hidden.includes(m.nombre));
  const clinicWindow = (d: Date): [number, number] | null => {
    const o = agenda.apertura[d.getDay()];
    return o ? [hmToMin(o[0]), hmToMin(o[1])] : null;
  };
  const visible = appointments.filter((a) => a.starts_at && (showCancelled || a.status !== 'cancelada') && !hidden.includes(a.therapist ?? ''));
  const hasDay = (d: Date) => visible.some((a) => a.starts_at!.startsWith(dayKey(d)));

  const columns: Column[] = mode === 'semana'
    ? weekDays.filter((d) => clinicWindow(d) || hasDay(d)).map((d) => ({
      key: dayKey(d), date: d, member: null,
      window: team.length === 1 ? team[0].ventanas[d.getDay()] : clinicWindow(d),
    }))
    : team.map((m) => ({ key: m.nombre, date: anchor, member: m, window: m.ventanas[anchor.getDay()] }));

  const itemsFor = (col: Column) => visible.filter((a) => a.starts_at!.startsWith(dayKey(col.date)) && (!col.member || a.therapist === col.member.nombre));

  const today = dayKey(new Date());
  const nowMin = new Date().getHours() * 60 + new Date().getMinutes();
  const hours = Array.from({ length: (rangeEnd - rangeStart) / 60 + 1 }, (_, i) => rangeStart + i * 60);
  const height = (rangeEnd - rangeStart) * PPM;

  const title = mode === 'semana'
    ? `${weekDays[0].getDate()}${weekDays[0].getMonth() !== weekDays[5].getMonth() ? ` de ${weekDays[0].toLocaleDateString('es-ES', { month: 'long' })}` : ''} – ${weekDays[5].toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}`
    : longDay(anchor);
  const weekCount = visible.filter((a) => a.status !== 'cancelada' && weekDays.some((d) => a.starts_at!.startsWith(dayKey(d)))).length;

  const minAt = (e: { clientY: number }, el: HTMLElement, grab = 0) => {
    const y = e.clientY - el.getBoundingClientRect().top;
    const m = Math.floor((y / PPM - grab) / SNAP) * SNAP + rangeStart;
    return Math.min(Math.max(m, rangeStart), rangeEnd - SNAP);
  };

  function onColumnClick(e: MouseEvent<HTMLDivElement>, col: Column) {
    if (e.target !== e.currentTarget) return;
    const min = minAt(e, e.currentTarget);
    openAppointmentDialog({ date: dayKey(col.date), time: minToHm(min), therapist: col.member?.nombre });
  }
  function onColumnMove(e: MouseEvent<HTMLDivElement>, col: Column) {
    if (e.target !== e.currentTarget) { if (hover) setHover(null); return; }
    const min = minAt(e, e.currentTarget);
    if (hover?.col !== col.key || hover.min !== min) setHover({ col: col.key, min });
  }
  function onDragStart(e: DragEvent<HTMLButtonElement>, a: Appointment) {
    const rect = e.currentTarget.getBoundingClientRect();
    drag.current = { id: a.id, duration: a.duration, grab: Math.floor((e.clientY - rect.top) / PPM / SNAP) * SNAP };
    e.dataTransfer.setData('text/plain', String(a.id));
    e.dataTransfer.effectAllowed = 'move';
  }
  function onDragOver(e: DragEvent<HTMLDivElement>, col: Column) {
    if (!drag.current) return;
    e.preventDefault();
    const min = minAt(e, e.currentTarget, drag.current.grab);
    if (ghost?.col !== col.key || ghost.min !== min) setGhost({ col: col.key, min, duration: drag.current.duration });
  }
  async function onDrop(e: DragEvent<HTMLDivElement>, col: Column) {
    e.preventDefault();
    const info = drag.current;
    drag.current = null;
    setGhost(null);
    if (!info) return;
    const a = appointments.find((x) => x.id === info.id);
    const min = minAt(e, e.currentTarget, info.grab);
    const startsAt = `${dayKey(col.date)}T${minToHm(min)}`;
    if (!a || (a.starts_at === startsAt && (!col.member || col.member.nombre === a.therapist))) return;
    try {
      await api(`/appointments/${a.id}`, { method: 'PATCH', body: { starts_at: startsAt, therapist: col.member?.nombre ?? a.therapist } });
      setMoved(a.id);
      navigate('agenda', a.id);
    } catch (err: any) {
      pushToast({ kind: 'info', title: 'No se puede mover ahí', body: err.message });
    }
  }

  const step = (n: number) => setAnchor(addDays(anchor, mode === 'semana' ? 7 * n : n));
  const toggle = (name: string) => setHidden((h) => (h.includes(name) ? h.filter((x) => x !== name) : [...h, name]));

  return (
    <div className={`agenda${selected ? ' has-detail' : ''}`}>
      <div className="agenda__main">
        <header className="agenda__head">
          <div className="agenda__title">
            <h1>Agenda</h1>
            <p className="muted">{mode === 'semana' ? `${weekCount} citas esta semana` : `${visible.filter((a) => a.status !== 'cancelada' && a.starts_at!.startsWith(dayKey(anchor))).length} citas este día`} · Pulsa un hueco para agendar o arrastra una cita para moverla.</p>
          </div>
          <button className="btn btn--primary" onClick={() => openAppointmentDialog({ date: dayKey(anchor) < today ? today : dayKey(anchor) })}>
            <Icon name="plus" size={15} /> Nueva cita
          </button>
        </header>

        <div className="agenda__bar">
          <div className="agenda__nav">
            <button className="icon-btn icon-btn--box" aria-label={mode === 'semana' ? 'Semana anterior' : 'Día anterior'} onClick={() => step(-1)}><Icon name="prev" /></button>
            <button className="btn btn--sm" onClick={() => setAnchor(new Date())}>Hoy</button>
            <button className="icon-btn icon-btn--box" aria-label={mode === 'semana' ? 'Semana siguiente' : 'Día siguiente'} onClick={() => step(1)}><Icon name="next" /></button>
            <span className="agenda__range">{title}</span>
          </div>
          <div className="segmented" role="tablist" aria-label="Vista">
            {([['semana', 'Semana'], ['dia', 'Día']] as [Mode, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={mode === k} className={mode === k ? 'is-active' : ''} onClick={() => setMode(k)}>{l}</button>
            ))}
          </div>
        </div>
        <div className="agenda__team" aria-label="Equipo">
          {agenda.team.map((m) => (
            <button key={m.nombre} className={`chip chip--member${hidden.includes(m.nombre) ? ' is-off' : ''}`} aria-pressed={!hidden.includes(m.nombre)}
              onClick={() => toggle(m.nombre)} title={`${m.rol} · ${TURNO_LABEL[m.turno]}`} style={{ '--c': m.color } as CSSProperties}>
              <span className="swatch" /> {m.nombre} <span>{TURNO_LABEL[m.turno]}</span>
            </button>
          ))}
          <label className="check check--inline">
            <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} /> <span>Ver canceladas</span>
          </label>
        </div>

        <div className="cal" ref={scrollRef} style={{ '--cols': columns.length } as CSSProperties}>
          <div className="cal__head">
            <div className="cal__corner" />
            {columns.map((col) => {
              const isToday = dayKey(col.date) === today;
              const n = itemsFor(col).filter((a) => a.status !== 'cancelada').length;
              return mode === 'semana' ? (
                <button key={col.key} className={`cal__colhead${isToday ? ' is-today' : ''}`} onClick={() => { setAnchor(col.date); setMode('dia'); }}
                  title="Ver el día por persona del equipo">
                  <span className="cal__dow">{col.date.toLocaleDateString('es-ES', { weekday: 'short' }).replace('.', '')}</span>
                  <span className="cal__dom">{col.date.getDate()}</span>
                  <span className="cal__n">{n ? `${n} citas` : col.window ? 'libre' : 'cerrado'}</span>
                </button>
              ) : (
                <div key={col.key} className="cal__colhead cal__colhead--member" style={{ '--c': col.member!.color } as CSSProperties}>
                  <span className="cal__member"><span className="swatch" /> {col.member!.nombre}</span>
                  <span className="cal__n">{col.window ? `${minToHm(col.window[0])}–${minToHm(col.window[1])} · ${n} citas` : 'No atiende hoy'}</span>
                </div>
              );
            })}
          </div>

          <div className="cal__body" style={{ height }}>
            <div className="cal__gutter" aria-hidden="true">
              {hours.map((h) => <span key={h} style={{ top: (h - rangeStart) * PPM }}>{minToHm(h)}</span>)}
            </div>
            {columns.map((col) => {
              const items = itemsFor(col);
              const lanes = layoutLanes(items);
              const isToday = dayKey(col.date) === today;
              const closed: [number, number][] = col.window
                ? [[rangeStart, col.window[0]], [col.window[1], rangeEnd]].filter(([a, b]) => b > a) as [number, number][]
                : [[rangeStart, rangeEnd]];
              return (
                <div key={col.key} className={`cal__col${isToday ? ' is-today' : ''}`}
                  style={{ backgroundSize: `100% ${60 * PPM}px` }}
                  onClick={(e) => onColumnClick(e, col)} onMouseMove={(e) => onColumnMove(e, col)} onMouseLeave={() => setHover(null)}
                  onDragOver={(e) => onDragOver(e, col)} onDragLeave={(e) => { if (e.target === e.currentTarget) setGhost(null); }} onDrop={(e) => onDrop(e, col)}>
                  {closed.map(([a, b]) => (
                    <div key={a} className="cal__closed" style={{ top: (a - rangeStart) * PPM, height: (b - a) * PPM }}>
                      {!col.window && a === rangeStart && <span>{mode === 'dia' ? 'No atiende' : 'Cerrado'}</span>}
                    </div>
                  ))}
                  {isToday && nowMin >= rangeStart && nowMin <= rangeEnd && <div className="cal__now" style={{ top: (nowMin - rangeStart) * PPM }} />}
                  {hover?.col === col.key && !ghost && (
                    <div className="cal__hover" style={{ top: (hover.min - rangeStart) * PPM, height: SNAP * PPM * 2 }}><Icon name="plus" size={12} /> {minToHm(hover.min)}</div>
                  )}
                  {ghost?.col === col.key && (
                    <div className="cal__ghost" style={{ top: (ghost.min - rangeStart) * PPM, height: ghost.duration * PPM }}>{minToHm(ghost.min)}</div>
                  )}
                  {items.map((a) => {
                    const s = startMin(a);
                    const { lane, lanes: n } = lanes.get(a.id)!;
                    const past = `${a.starts_at!.slice(0, 10)}T${minToHm(s + a.duration)}` < nowKey();
                    const fresh = apptFlash[a.id] && Date.now() - apptFlash[a.id] < 3000;
                    const h = a.duration * PPM;
                    return (
                      <button key={a.id}
                        className={`ev ev--${a.status}${past ? ' is-past' : ''}${a.id === selectedId ? ' is-selected' : ''}${fresh ? ' is-flash' : ''}`}
                        style={{ top: (s - rangeStart) * PPM + 1, height: h - 2, left: `calc(${(lane / n) * 100}% + 2px)`, width: `calc(${100 / n}% - 4px)`, '--c': memberColor(agenda, a.therapist) } as CSSProperties}
                        draggable={a.status !== 'cancelada'} onDragStart={(e) => onDragStart(e, a)} onDragEnd={() => { drag.current = null; setGhost(null); }}
                        onClick={(e) => { e.stopPropagation(); navigate('agenda', a.id); }}
                        aria-label={`${a.name}, ${timeRange(a)}, ${a.therapist}, ${a.status}`}>
                        <span className="ev__time">{minToHm(s)}{h > 30 && `–${minToHm(s + a.duration)}`}{a.source === 'ia' && <Icon name="bot" size={11} />}</span>
                        <span className="ev__name">{a.name}</span>
                        {h > 48 && <span className="ev__meta">{mode === 'semana' ? `${firstName(a.therapist)} · ` : ''}{a.service}</span>}
                        {a.status === 'pendiente' && h > 34 && <span className="ev__flag">Por confirmar</span>}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {selected
        ? <AppointmentDetail key={selected.id} a={selected} justMoved={moved === selected.id} onNotified={() => setMoved(null)} />
        : <Queue />}
    </div>
  );
}
