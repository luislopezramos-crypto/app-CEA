// Piezas de citas que usan varias pantallas: el formulario para agendar o cambiar una cita,
// la etiqueta de estado y la lista de citas de un contacto.
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  api, apptWhen, closeAppointmentDialog, openAppointmentDialog, pushToast, setState, useStore,
  type Appointment, type DialogState,
} from './store';
import { navigate } from './App';
import { Avatar, ChannelBadge, Icon, displayName } from './ui';
import { STATUS_LABEL, dayKey, firstName, hmToMin, nowKey } from './agenda-utils';

export function StatusPill({ status }: { status: Appointment['status'] }) {
  return <span className={`status status--${status}`}>{STATUS_LABEL[status]}</span>;
}

// ---------- Citas de un contacto (bandeja y ficha) ----------
export function ContactAppointments({ contactId }: { contactId: number }) {
  const all = useStore((s) => s.appointments);
  const list = useMemo(() => all.filter((a) => a.contact_id === contactId && a.status !== 'cancelada'), [all, contactId]);
  const now = nowKey();
  const upcoming = list.filter((a) => !a.starts_at || a.starts_at >= now)
    .sort((a, b) => String(a.starts_at ?? '0').localeCompare(String(b.starts_at ?? '0')));
  const last = list.filter((a) => a.starts_at && a.starts_at < now).sort((a, b) => b.starts_at!.localeCompare(a.starts_at!))[0];
  return (
    <div className="profile__block">
      <div className="block-head">
        <span className="label">Citas</span>
        <button className="link" onClick={() => openAppointmentDialog({ contactId })}><Icon name="plus" size={13} /> Agendar</button>
      </div>
      {upcoming.length === 0 && <span className="muted small">Sin citas próximas{last ? ` · última: ${apptWhen(last)}` : ''}</span>}
      <ul className="mini-appts">
        {upcoming.slice(0, 4).map((a) => (
          <li key={a.id}>
            <button onClick={() => (a.starts_at ? navigate('agenda', a.id) : openAppointmentDialog({ requestId: a.id }))}>
              <span className="mini-appts__when"><Icon name="calendar" size={13} /> {a.starts_at ? apptWhen(a) : 'Sin hora'}</span>
              <span className="mini-appts__what">{a.starts_at ? a.service : `Pidió: ${a.preference}`}</span>
              <StatusPill status={a.status} />
            </button>
          </li>
        ))}
      </ul>
      {upcoming.length > 4 && <span className="muted small">y {upcoming.length - 4} más en la agenda</span>}
    </div>
  );
}

// ---------- Formulario de cita ----------
export function AppointmentDialogHost() {
  const dialog = useStore((s) => s.dialog);
  if (!dialog) return null;
  return <AppointmentDialog key={JSON.stringify(dialog)} init={dialog} />;
}

interface Slot { time: string; therapists: string[] }

function AppointmentDialog({ init }: { init: DialogState }) {
  const agenda = useStore((s) => s.agenda);
  const contacts = useStore((s) => s.contacts);
  const appointments = useStore((s) => s.appointments);
  const existing = init.appointmentId ? appointments.find((a) => a.id === init.appointmentId) : undefined;
  const request = init.requestId ? appointments.find((a) => a.id === init.requestId) : undefined;
  const editing = Boolean(existing?.starts_at);
  const lockedContact = existing?.contact_id ?? request?.contact_id ?? init.contactId ?? null;

  const [contactId, setContactId] = useState<number | null>(lockedContact);
  const [query, setQuery] = useState('');
  const [newPatient, setNewPatient] = useState<{ name: string; phone: string } | null>(null);
  const contact = contacts.find((c) => c.id === contactId);
  const services = agenda?.services ?? [];
  const minutesFor = (name: string) => services.find((x) => x.nombre === name)?.minutos ?? 45;
  const initialService = existing?.service ?? request?.service
    ?? (contact?.stage === 'paciente' ? 'Gestión de trámite aduanero' : 'Primera asesoría aduanera');
  const [service, setService] = useState(services.some((x) => x.nombre === initialService) ? initialService : services[0]?.nombre ?? '');
  const [therapist, setTherapist] = useState(existing?.therapist ?? init.therapist ?? '');
  const [date, setDate] = useState(existing?.starts_at?.slice(0, 10) ?? init.date ?? dayKey(new Date()));
  const [time, setTime] = useState(existing?.starts_at?.slice(11, 16) ?? init.time ?? '');
  const [duration, setDuration] = useState(existing?.duration ?? minutesFor(service));
  const [reason, setReason] = useState(existing?.reason ?? request?.reason ?? contact?.reason ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [status, setStatus] = useState<'confirmada' | 'pendiente'>(existing?.status === 'pendiente' ? 'pendiente' : 'confirmada');
  const [notify, setNotify] = useState(true);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const firstField = useRef<HTMLInputElement | HTMLSelectElement | null>(null);

  useEffect(() => {
    firstField.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeAppointmentDialog(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Horas libres del día elegido (cada 15 min), según abogado, servicio y duración.
  useEffect(() => {
    let alive = true;
    setSlots(null);
    const q = new URLSearchParams({ date, duration: String(duration || 45) });
    if (therapist) q.set('therapist', therapist);
    if (service) q.set('service', service);
    if (existing) q.set('exclude', String(existing.id));
    api<{ slots: Slot[] }>(`/agenda/slots?${q}`)
      .then((d) => { if (alive) setSlots(d.slots); })
      .catch(() => { if (alive) setSlots([]); });
    return () => { alive = false; };
  }, [date, therapist, duration, service, existing?.id]);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts.filter((c) => c.name).slice(0, 6);
    return contacts.filter((c) => (c.name ?? '').toLowerCase().includes(q)).slice(0, 6);
  }, [contacts, query]);

  const timeFree = !time || !slots || slots.some((x) => x.time === time);
  const canNotify = existing ? existing.can_notify : Boolean(contact?.conversation_id && contact.channel !== 'telefono');
  const channelName = (existing?.channel ?? contact?.channel) === 'whatsapp' ? 'WhatsApp' : 'el chat de la web';
  const morning = (slots ?? []).filter((x) => hmToMin(x.time) < hmToMin(agenda?.cambio_turno ?? '15:00'));
  const afternoon = (slots ?? []).filter((x) => hmToMin(x.time) >= hmToMin(agenda?.cambio_turno ?? '15:00'));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!contactId && !newPatient?.name.trim()) return setError('Elige un cliente o añade uno nuevo.');
    if (!time) return setError('Elige una hora libre.');
    const body = {
      starts_at: `${date}T${time}`, therapist: therapist || null, service, duration, reason, notes, status,
      notify: canNotify && notify,
    };
    setBusy(true);
    try {
      const r = editing
        ? await api<{ appointment: Appointment; warning?: string }>(`/appointments/${existing!.id}`, { method: 'PATCH', body })
        : await api<{ appointment: Appointment; warning?: string }>('/appointments', {
          body: { ...body, contact_id: contactId, new_contact: contactId ? undefined : newPatient, request_id: request?.id },
        });
      setState((s) => ({ apptFlash: { ...s.apptFlash, [r.appointment.id]: Date.now() } }));
      closeAppointmentDialog();
      pushToast({
        kind: 'info',
        title: editing ? 'Cita cambiada' : 'Cita agendada',
        body: `${r.appointment.name ?? 'Cliente'} · ${apptWhen(r.appointment)}${r.warning ? ` · ${r.warning}` : notify && canNotify ? ' · aviso enviado' : ''}`,
        appointmentId: r.appointment.id,
      });
      if (location.pathname.startsWith('/panel/agenda')) navigate('agenda', r.appointment.id);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const TimeChips = ({ list, label }: { list: Slot[]; label: string }) => list.length ? (
    <div className="times__group">
      <span className="times__label">{label}</span>
      <div className="times__chips">
        {list.map((x) => (
          <button type="button" key={x.time} className={`time-chip${x.time === time ? ' is-active' : ''}`} aria-pressed={x.time === time}
            title={therapist ? undefined : `Libre: ${x.therapists.join(', ')}`} onClick={() => setTime(x.time)}>{x.time}</button>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <div className="modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) closeAppointmentDialog(); }}>
      <form className="modal__card appt-form" role="dialog" aria-modal="true" aria-labelledby="appt-form-title" onSubmit={submit}>
        <header className="modal__head">
          <h2 id="appt-form-title">{editing ? 'Cambiar cita' : 'Agendar cita'}</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={closeAppointmentDialog}><Icon name="x" /></button>
        </header>

        <div className="appt-form__body">
          <div className="field">
            <span>Cliente</span>
            {contact ? (
              <div className="picked">
                <Avatar name={contact.name} id={contact.id} size={30} />
                <span className="picked__name">{displayName(contact.name, contact.phone_masked)}</span>
                <ChannelBadge channel={contact.channel} />
                {!lockedContact && <button type="button" className="link" onClick={() => setContactId(null)}>Cambiar</button>}
              </div>
            ) : newPatient ? (
              <div className="new-patient">
                <input ref={(el) => { firstField.current = el; }} value={newPatient.name} onChange={(e) => setNewPatient({ ...newPatient, name: e.target.value })} placeholder="Nombre y apellidos" aria-label="Nombre del cliente nuevo" />
                <input value={newPatient.phone} onChange={(e) => setNewPatient({ ...newPatient, phone: e.target.value })} placeholder="Teléfono (opcional)" aria-label="Teléfono" inputMode="tel" />
                <button type="button" className="link" onClick={() => setNewPatient(null)}>Buscar en contactos</button>
              </div>
            ) : (
              <div className="combo">
                <input ref={(el) => { firstField.current = el; }} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca por nombre" aria-label="Buscar cliente" />
                <ul className="combo__list">
                  {matches.map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => setContactId(c.id)}>
                        <Avatar name={c.name} id={c.id} size={24} /> <span>{displayName(c.name, c.phone_masked)}</span> <ChannelBadge channel={c.channel} />
                        {c.reason && <span className="muted small combo__reason">{c.reason}</span>}
                      </button>
                    </li>
                  ))}
                  <li>
                    <button type="button" className="combo__new" onClick={() => setNewPatient({ name: query.trim(), phone: '' })}>
                      <Icon name="plus" size={14} /> {query.trim() ? <>Cliente nuevo: «{query.trim()}»</> : 'Cliente nuevo (llama o viene en persona)'}
                    </button>
                  </li>
                </ul>
              </div>
            )}
            {request?.preference && <small className="hint">Pidió por {request.channel === 'whatsapp' ? 'WhatsApp' : 'la web'}: «{request.preference}»</small>}
          </div>

          <div className="form-grid">
            <label className="field"><span>Servicio</span>
              <select className="select" value={service} onChange={(e) => { setService(e.target.value); setDuration(minutesFor(e.target.value)); }}>
                {services.map((x) => <option key={x.nombre} value={x.nombre}>{x.nombre} · {x.minutos} min</option>)}
              </select>
            </label>
            <label className="field"><span>Abogado</span>
              <select className="select" value={therapist} onChange={(e) => setTherapist(e.target.value)}>
                <option value="">El primero libre</option>
                {agenda?.team.map((m) => <option key={m.nombre} value={m.nombre}>{m.nombre}</option>)}
              </select>
            </label>
            <label className="field"><span>Día</span>
              <input type="date" value={date} min={dayKey(new Date())} onChange={(e) => e.target.value && setDate(e.target.value)} required />
            </label>
            <label className="field"><span>Duración</span>
              <span className="suffix"><input type="number" min={10} max={240} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} /><span>min</span></span>
            </label>
          </div>

          <div className="field">
            <span>Hora {time && <b className="times__picked">{time}</b>}</span>
            <div className="times" aria-live="polite">
              {!slots && <span className="muted small">Buscando huecos…</span>}
              {slots && slots.length === 0 && <span className="muted small">No hay huecos libres ese día{therapist ? ` con ${firstName(therapist)}` : ''}. Prueba otro día{therapist ? ' u otro abogado' : ''}.</span>}
              <TimeChips list={morning} label="Mañana" />
              <TimeChips list={afternoon} label="Tarde" />
            </div>
            {time && slots && !timeFree && <small className="form-error">A las {time} no hay nadie libre{therapist ? ` (${firstName(therapist)})` : ''}. Elige otra hora.</small>}
          </div>

          <div className="form-grid">
            <label className="field"><span>Motivo</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Qué le pasa, en pocas palabras" /></label>
            <div className="field"><span>Estado</span>
              <div className="segmented" role="radiogroup" aria-label="Estado de la cita">
                {(['confirmada', 'pendiente'] as const).map((st) => (
                  <button type="button" key={st} role="radio" aria-checked={status === st} className={status === st ? 'is-active' : ''} onClick={() => setStatus(st)}>{STATUS_LABEL[st]}</button>
                ))}
              </div>
            </div>
            <label className="field field--wide"><span>Notas internas</span>
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Solo las ve la oficina (documentos del trámite, lo que debe traer el cliente…)" /></label>
          </div>

          {canNotify && (
            <label className="check">
              <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              <span>Avisar a {firstName(existing?.name ?? contact?.name) || 'la persona'} por {channelName}{editing ? ' si cambia el día o la hora' : ''}</span>
            </label>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={closeAppointmentDialog}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy || !time || !timeFree}>{busy ? 'Guardando…' : editing ? 'Guardar cambios' : 'Agendar cita'}</button>
        </footer>
      </form>
    </div>
  );
}
