import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, loadMessages, openAppointmentDialog, pushToast, setState, useStore, type Contact, type Conversation } from '../store';
import { ContactAppointments } from '../appointments';
import { navigate } from '../App';
import { Avatar, ChannelBadge, Icon, STAGES, STAGE_LABEL, Tags, clock, displayName, timeAgo } from '../ui';

type Filter = 'todas' | 'ia' | 'humano' | 'sin_leer';

function ConversationItem({ c, active }: { c: Conversation; active: boolean }) {
  const typing = useStore((s) => s.typing[c.id]);
  return (
    <button className={`conv${active ? ' is-active' : ''}${c.unread ? ' is-unread' : ''}`} onClick={() => navigate('conversaciones', c.id)}>
      <Avatar name={c.name} id={c.contact_id} size={40} />
      <span className="conv__body">
        <span className="conv__top">
          <span className="conv__name">{displayName(c.name, c.phone_masked)}</span>
          <span className="conv__time">{timeAgo(c.last_message_at)}</span>
        </span>
        <span className="conv__preview">
          <ChannelBadge channel={c.channel} />
          {typing ? <em className="typing-text">escribiendo…</em> : (
            <span className="conv__text">{c.last_author === 'ia' ? 'IA: ' : c.last_author === 'recepcion' ? 'Tú: ' : ''}{c.last_text}</span>
          )}
          {c.unread > 0 && <span className="count">{c.unread}</span>}
        </span>
        <span className="conv__meta">
          {c.mode === 'humano' && <span className="pill pill--human"><Icon name="hand" size={11} /> {c.handled_by}</span>}
          <Tags tags={c.tags} max={2} />
        </span>
      </span>
    </button>
  );
}

function ContactPanel({ contact }: { contact: Contact }) {
  async function setStage(stage: string) {
    await api(`/contacts/${contact.id}`, { method: 'PATCH', body: { stage } });
  }
  return (
    <aside className="profile">
      <div className="profile__head">
        <Avatar name={contact.name} id={contact.id} size={56} />
        <h3>{displayName(contact.name, contact.phone_masked)}</h3>
        <span className="muted small"><ChannelBadge channel={contact.channel} label /> {contact.phone_masked && <span className="mono">{contact.phone_masked}</span>}</span>
      </div>
      <dl className="facts">
        <div><dt>Qué le pasa</dt><dd>{contact.reason ?? <span className="muted">Aún no lo ha contado</span>}</dd></div>
        <div><dt>Desde cuándo</dt><dd>{contact.since ?? '—'}</dd></div>
        <div><dt>Urgencia</dt><dd>{contact.urgency ? <span className={`urgency urgency--${contact.urgency}`}>{contact.urgency}</span> : '—'}</dd></div>
        {contact.language && contact.language !== 'español' && <div><dt>Idioma</dt><dd>{contact.language}</dd></div>}
      </dl>
      <div className="profile__block">
        <span className="label">Etiquetas de la IA</span>
        {contact.tags.length ? <Tags tags={contact.tags} max={8} /> : <span className="muted small">Sin etiquetas todavía</span>}
      </div>
      <ContactAppointments contactId={contact.id} />
      <div className="profile__block">
        <label className="label" htmlFor="stage-select">Etapa</label>
        <select id="stage-select" className="select" value={contact.stage} onChange={(e) => setStage(e.target.value)}>
          {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
        </select>
      </div>
      <button className="btn btn--ghost btn--block" onClick={() => navigate('contactos', contact.id)}>Ver ficha completa</button>
    </aside>
  );
}

function Thread({ conv }: { conv: Conversation }) {
  const messages = useStore((s) => s.messages[conv.id]);
  const typing = useStore((s) => s.typing[conv.id]);
  const contact = useStore((s) => s.contacts.find((c) => c.id === conv.contact_id));
  const user = useStore((s) => s.user);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadMessages(conv.id).then((d) => {
      setState((s) => ({ contacts: s.contacts.some((c) => c.id === d.contact.id) ? s.contacts : [d.contact, ...s.contacts] }));
    });
  }, [conv.id]);
  // Al llegar mensajes nuevos con la conversación abierta, se marcan como leídos.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
    if (conv.unread) api(`/conversations/${conv.id}/messages`).catch(() => {});
  }, [messages?.length, typing]);

  const human = conv.mode === 'humano';
  async function takeover() {
    await api(`/conversations/${conv.id}/${human ? 'release' : 'takeover'}`, { method: 'POST' });
  }
  async function send(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setSending(true);
    try {
      await api(`/conversations/${conv.id}/messages`, { body: { text: t } });
      setText('');
    } catch (err: any) {
      pushToast({ kind: 'info', title: 'Mensaje no enviado', body: err.message });
    } finally {
      setSending(false);
    }
  }

  let lastDay = '';
  return (
    <div className="thread-wrap">
      <section className="thread">
        <header className="thread__head">
          <button className="icon-btn thread__back" aria-label="Volver a la bandeja" onClick={() => navigate('conversaciones')}><Icon name="back" /></button>
          <Avatar name={conv.name} id={conv.contact_id} size={36} />
          <div className="thread__who">
            <strong>{displayName(conv.name, conv.phone_masked)}</strong>
            <span className="muted small">
              {human ? <>Atiende <b>{conv.handled_by}</b></> : <>Atiende la IA</>} · {conv.channel === 'whatsapp' ? 'WhatsApp' : 'Chat de la web'}
            </span>
          </div>
          <button className="btn btn--ghost" onClick={() => openAppointmentDialog({ contactId: conv.contact_id })} title="Agendar una cita para esta persona">
            <Icon name="calendar" size={15} /> <span className="hide-sm">Agendar</span>
          </button>
          <button className={`btn ${human ? 'btn--ghost' : 'btn--primary'}`} onClick={takeover}>
            <Icon name={human ? 'bot' : 'hand'} size={15} /> {human ? 'Devolver a la IA' : 'Tomar el control'}
          </button>
        </header>
        <div className="thread__body">
          {!messages && <p className="empty">Cargando…</p>}
          {messages?.map((m) => {
            const day = new Date(m.created_at).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
            const showDay = day !== lastDay;
            lastDay = day;
            return (
              <div key={m.id} className="msg-row-wrap">
                {showDay && <div className="day-sep"><span>{day}</span></div>}
                <div className={`msg msg--${m.author}`}>
                  {m.author !== 'paciente' && (
                    <span className="msg__from">{m.author === 'ia' ? <><Icon name="bot" size={12} /> IA</> : <><Icon name="hand" size={12} /> {m.author_name}</>}</span>
                  )}
                  <p>{m.text}</p>
                  <time>{clock(m.created_at)}</time>
                </div>
              </div>
            );
          })}
          {typing && <div className="msg msg--ia msg--typing" aria-label="La IA está escribiendo"><span /><span /><span /></div>}
          <div ref={endRef} />
        </div>
        <form className="composer" onSubmit={send}>
          {!human && <p className="composer__hint">La IA está contestando (y agenda sola si piden cita). Si escribes, tomas el control de la conversación.</p>}
          <div className="composer__row">
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1}
              placeholder={`Escribe como ${user?.name.split(' ')[0]}, de recepción…`} aria-label="Mensaje"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
            <button className="btn btn--primary" disabled={sending || !text.trim()} aria-label="Enviar"><Icon name="send" size={16} /></button>
          </div>
        </form>
      </section>
      {contact && <ContactPanel contact={contact} />}
    </div>
  );
}

export default function Inbox({ selectedId }: { selectedId?: number }) {
  const conversations = useStore((s) => s.conversations);
  const [filter, setFilter] = useState<Filter>('todas');
  const [q, setQ] = useState('');
  const list = useMemo(() => conversations.filter((c) => {
    if (filter === 'ia' && c.mode !== 'ia') return false;
    if (filter === 'humano' && c.mode !== 'humano') return false;
    if (filter === 'sin_leer' && !c.unread) return false;
    if (q && !`${c.name ?? ''} ${c.tags.join(' ')} ${c.last_text ?? ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [conversations, filter, q]);
  const selected = conversations.find((c) => c.id === selectedId);

  return (
    <div className={`inbox${selected ? ' has-selection' : ''}`}>
      <section className="inbox__list">
        <header className="inbox__head">
          <h1>Conversaciones</h1>
          <label className="search">
            <Icon name="search" size={15} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar nombre, etiqueta o mensaje" aria-label="Buscar conversaciones" />
          </label>
          <div className="segmented" role="tablist" aria-label="Filtrar conversaciones">
            {([['todas', 'Todas'], ['sin_leer', 'Sin leer'], ['ia', 'IA'], ['humano', 'Recepción']] as [Filter, string][]).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'is-active' : ''} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </header>
        <div className="inbox__items">
          {list.map((c) => <ConversationItem key={c.id} c={c} active={c.id === selectedId} />)}
          {list.length === 0 && <p className="empty">No hay conversaciones con este filtro.</p>}
        </div>
      </section>
      {selected ? <Thread key={selected.id} conv={selected} /> : (
        <div className="inbox__placeholder">
          <Icon name="inbox" size={28} />
          <p>Elige una conversación. Las nuevas aparecen arriba en cuanto llegan.</p>
        </div>
      )}
    </div>
  );
}
