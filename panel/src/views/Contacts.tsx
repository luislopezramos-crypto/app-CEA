import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, apptWhen, loadMessages, pushToast, setState, useStore, type Appointment, type Contact, type Stage } from '../store';
import { nowKey } from '../agenda-utils';
import { ContactAppointments } from '../appointments';
import { navigate } from '../App';
import { Avatar, ChannelBadge, Icon, STAGES, STAGE_LABEL, Tags, clock, displayName, timeAgo } from '../ui';

const URGENCIES = [['', 'Sin indicar'], ['baja', 'Baja'], ['media', 'Media'], ['alta', 'Alta']] as const;

// Ventana para cambiar los datos de la ficha. El teléfono no se muestra entero (privacidad):
// solo se puede escribir uno nuevo.
function EditContact({ contact, onClose }: { contact: Contact; onClose: () => void }) {
  const [form, setForm] = useState({
    name: contact.name ?? '',
    phone: '',
    reason: contact.reason ?? '',
    since: contact.since ?? '',
    urgency: contact.urgency ?? '',
    stage: contact.stage as Stage,
    language: contact.language ?? '',
    summary: contact.summary ?? '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Escribe el nombre.');
    setBusy(true);
    try {
      const { phone, ...rest } = form;
      const updated = await api<Contact>(`/contacts/${contact.id}`, { method: 'PATCH', body: phone.trim() ? form : rest });
      setState((s) => ({ contacts: s.contacts.map((c) => (c.id === updated.id ? { ...c, ...updated } : c)) }));
      pushToast({ kind: 'info', title: 'Contacto guardado', body: updated.name ?? 'Ficha actualizada', contactId: updated.id });
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="modal__card" role="dialog" aria-modal="true" aria-labelledby="contact-form-title" onSubmit={submit}>
        <header className="modal__head">
          <h2 id="contact-form-title">Editar contacto</h2>
          <button type="button" className="icon-btn" aria-label="Cerrar" onClick={onClose}><Icon name="x" /></button>
        </header>
        <div className="appt-form__body">
          <div className="form-grid">
            <label className="field"><span>Nombre</span>
              <input value={form.name} onChange={set('name')} maxLength={80} autoFocus required /></label>
            <label className="field"><span>Teléfono {contact.phone_masked && <span className="muted">(ahora {contact.phone_masked})</span>}</span>
              <input value={form.phone} onChange={set('phone')} inputMode="tel" maxLength={20}
                placeholder={contact.phone_masked ? 'Escribe uno nuevo para cambiarlo' : 'Añadir teléfono'} /></label>
            <label className="field field--wide"><span>Qué le pasa</span>
              <input value={form.reason} onChange={set('reason')} maxLength={200} placeholder="En pocas palabras, sin diagnóstico" /></label>
            <label className="field"><span>Desde cuándo</span>
              <input value={form.since} onChange={set('since')} maxLength={80} placeholder="Por ejemplo: hace dos semanas" /></label>
            <label className="field"><span>Idioma</span>
              <input value={form.language} onChange={set('language')} maxLength={30} list="contact-languages" placeholder="español" />
              <datalist id="contact-languages"><option value="español" /><option value="inglés" /><option value="francés" /></datalist></label>
            <div className="field"><span>Urgencia</span>
              <div className="segmented" role="radiogroup" aria-label="Urgencia">
                {URGENCIES.map(([v, label]) => (
                  <button type="button" key={v} role="radio" aria-checked={form.urgency === v} className={form.urgency === v ? 'is-active' : ''}
                    onClick={() => setForm((f) => ({ ...f, urgency: v }))}>{label}</button>
                ))}
              </div>
            </div>
            <label className="field"><span>Etapa</span>
              <select className="select" value={form.stage} onChange={set('stage')}>
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select></label>
            <label className="field field--wide"><span>Resumen para la recepción</span>
              <textarea rows={3} value={form.summary} onChange={set('summary')} maxLength={500} placeholder="Lo importante de este cliente en una o dos frases" /></label>
          </div>
          {contact.channel === 'whatsapp' && form.phone.trim() && (
            <p className="muted small">Los mensajes de WhatsApp siguen yendo al número desde el que escribe; este teléfono es solo para la ficha.</p>
          )}
          {error && <p className="form-error" role="alert">{error}</p>}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancelar</button>
          <button className="btn btn--primary" disabled={busy}>{busy ? 'Guardando…' : 'Guardar cambios'}</button>
        </footer>
      </form>
    </div>
  );
}

function Detail({ contact }: { contact: Contact }) {
  const messages = useStore((s) => (contact.conversation_id ? s.messages[contact.conversation_id] : undefined));
  const [newTag, setNewTag] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (contact.conversation_id) loadMessages(contact.conversation_id); }, [contact.conversation_id]);

  const patch = (body: object) => api(`/contacts/${contact.id}`, { method: 'PATCH', body });
  function addTag(e: FormEvent) {
    e.preventDefault();
    const t = newTag.trim();
    if (!t || contact.tags.includes(t)) return;
    patch({ tags: [...contact.tags, t] });
    setNewTag('');
  }

  return (
    <aside className="detail" aria-label="Ficha del contacto">
      <header className="detail__head">
        <button className="icon-btn" aria-label="Cerrar ficha" onClick={() => navigate('contactos')}><Icon name="x" /></button>
        <Avatar name={contact.name} id={contact.id} size={52} />
        <div>
          <h2>{displayName(contact.name, contact.phone_masked)}</h2>
          <span className="muted small"><ChannelBadge channel={contact.channel} label /> {contact.phone_masked && <span className="mono">{contact.phone_masked}</span>} · desde {timeAgo(contact.created_at)}</span>
          <button className="btn btn--sm detail__edit" onClick={() => setEditing(true)}><Icon name="edit" size={14} /> Editar</button>
        </div>
      </header>
      {editing && <EditContact contact={contact} onClose={() => setEditing(false)} />}
      {contact.summary && <p className="detail__summary">{contact.summary}</p>}
      <dl className="facts facts--grid">
        <div><dt>Qué le pasa</dt><dd>{contact.reason ?? '—'}</dd></div>
        <div><dt>Desde cuándo</dt><dd>{contact.since ?? '—'}</dd></div>
        <div><dt>Urgencia</dt><dd>{contact.urgency ? <span className={`urgency urgency--${contact.urgency}`}>{contact.urgency}</span> : '—'}</dd></div>
        <div><dt>Etapa</dt><dd>
          <select className="select select--sm" value={contact.stage} onChange={(e) => patch({ stage: e.target.value })} aria-label="Etapa">
            {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </dd></div>
      </dl>
      <ContactAppointments contactId={contact.id} />
      <div className="detail__tags">
        <span className="label">Etiquetas</span>
        <div className="tags tags--edit">
          {contact.tags.map((t) => (
            <span key={t} className={`tag${t === 'Urgente' ? ' tag--urgent' : ''}`}>
              {t}
              <button aria-label={`Quitar ${t}`} onClick={() => patch({ tags: contact.tags.filter((x) => x !== t) })}><Icon name="x" size={10} /></button>
            </span>
          ))}
          <form onSubmit={addTag} className="tag-add">
            <input value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Añadir etiqueta" aria-label="Nueva etiqueta" />
          </form>
        </div>
      </div>
      <div className="detail__conv">
        <div className="card__head">
          <span className="label">Conversación</span>
          {contact.conversation_id && <button className="link" onClick={() => navigate('conversaciones', contact.conversation_id)}>Abrir en la bandeja <Icon name="arrow" size={12} /></button>}
        </div>
        <div className="mini-thread">
          {!contact.conversation_id && <p className="muted small">Sin conversación: reservó por teléfono o en recepción.</p>}
          {messages?.map((m) => (
            <div key={m.id} className={`msg msg--${m.author} msg--mini`}>
              <p>{m.text}</p>
              <time>{clock(m.created_at)}</time>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

export default function Contacts({ selectedId }: { selectedId?: number }) {
  const contacts = useStore((s) => s.contacts);
  const flash = useStore((s) => s.flash);
  const appointments = useStore((s) => s.appointments);
  // Próxima cita de cada contacto.
  const next = useMemo(() => {
    const now = nowKey();
    const out: Record<number, Appointment> = {};
    for (const a of appointments) {
      if (!a.starts_at || a.status === 'cancelada' || a.starts_at < now) continue;
      if (!out[a.contact_id] || a.starts_at < out[a.contact_id].starts_at!) out[a.contact_id] = a;
    }
    return out;
  }, [appointments]);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const [channel, setChannel] = useState<'todos' | 'web' | 'whatsapp' | 'telefono'>('todos');

  const allTags = useMemo(() => {
    const count = new Map<string, number>();
    contacts.forEach((c) => c.tags.forEach((t) => count.set(t, (count.get(t) ?? 0) + 1)));
    return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  }, [contacts]);

  const list = contacts.filter((c) =>
    (!tag || c.tags.includes(tag)) &&
    (channel === 'todos' || c.channel === channel) &&
    (!q || `${c.name ?? ''} ${c.reason ?? ''} ${c.tags.join(' ')}`.toLowerCase().includes(q.toLowerCase())));
  const selected = contacts.find((c) => c.id === selectedId);

  return (
    <div className={`contacts${selected ? ' has-detail' : ''}`}>
      <div className="page">
        <header className="page__head">
          <div>
            <h1>Contactos</h1>
            <p className="muted">Se crean solos con lo que cuenta cada persona (o al agendar a alguien que llama por teléfono). Las etiquetas las pone la IA.</p>
          </div>
          <span className="pill">{contacts.length} contactos</span>
        </header>
        <div className="toolbar">
          <label className="search">
            <Icon name="search" size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar por nombre o motivo" aria-label="Buscar contactos" />
          </label>
          <div className="segmented" aria-label="Canal">
            {(['todos', 'web', 'whatsapp', 'telefono'] as const).map((c) => (
              <button key={c} className={channel === c ? 'is-active' : ''} aria-pressed={channel === c} onClick={() => setChannel(c)}>
                {{ todos: 'Todos', web: 'Web', whatsapp: 'WhatsApp', telefono: 'Teléfono' }[c]}
              </button>
            ))}
          </div>
        </div>
        <div className="tag-filter" aria-label="Filtrar por etiqueta">
          {allTags.map(([t, n]) => (
            <button key={t} className={`chip${tag === t ? ' is-active' : ''}`} aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
              {t} <span>{n}</span>
            </button>
          ))}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Nombre</th><th>Qué le pasa</th><th>Etiquetas</th><th>Etapa</th><th>Próxima cita</th><th>Teléfono</th><th>Último mensaje</th></tr>
            </thead>
            <tbody>
              {list.map((c) => (
                <tr key={c.id} className={`${c.id === selectedId ? 'is-selected' : ''}${flash[c.id] && Date.now() - flash[c.id] < 2500 ? ' is-flash' : ''}`}
                  onClick={() => navigate('contactos', c.id)} tabIndex={0}
                  onKeyDown={(e) => { if (e.key === 'Enter') navigate('contactos', c.id); }}>
                  <td><span className="cell-name"><Avatar name={c.name} id={c.id} size={28} /> {displayName(c.name)} <ChannelBadge channel={c.channel} /></span></td>
                  <td className="cell-reason">{c.reason ?? <span className="muted">—</span>}</td>
                  <td><Tags tags={c.tags} max={2} /></td>
                  <td><span className={`stage stage--${c.stage}`}>{STAGE_LABEL[c.stage]}</span></td>
                  <td className="muted nowrap">{next[c.id] ? apptWhen(next[c.id]) : '—'}</td>
                  <td className="mono muted">{c.phone_masked ?? '—'}</td>
                  <td className="muted">{timeAgo(c.last_message_at ?? c.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length === 0 && <p className="empty">Nadie coincide con el filtro.</p>}
        </div>
      </div>
      {selected && <Detail key={selected.id} contact={selected} />}
    </div>
  );
}

