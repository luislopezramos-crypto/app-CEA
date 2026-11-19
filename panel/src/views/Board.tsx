import { useState, type DragEvent } from 'react';
import { api, apptWhen, useStore, type Contact, type Stage } from '../store';
import { nowKey } from '../agenda-utils';
import { Icon } from '../ui';
import { navigate } from '../App';
import { Avatar, ChannelBadge, STAGES, STAGE_LABEL, Tags, displayName, timeAgo } from '../ui';

const HINT: Record<Stage, string> = {
  nuevo: 'Ha escrito por primera vez',
  interesado: 'Ha contado su caso o preguntado precios',
  quiere_cita: 'Ha pedido cita y falta confirmarla o darle hora',
  paciente: 'Tiene cita confirmada o ya es cliente de la oficina',
};

function Card({ c }: { c: Contact }) {
  const flash = useStore((s) => s.flash[c.id]);
  const conv = useStore((s) => s.conversations.find((x) => x.contact_id === c.id));
  const next = useStore((s) => {
    const now = nowKey();
    return s.appointments
      .filter((a) => a.contact_id === c.id && a.status !== 'cancelada' && (!a.starts_at || a.starts_at >= now))
      .sort((a, b) => String(a.starts_at ?? '9').localeCompare(String(b.starts_at ?? '9')))[0];
  });
  const fresh = flash && Date.now() - flash < 2500;
  const open = () => (conv ? navigate('conversaciones', conv.id) : navigate('contactos', c.id));
  return (
    <article className={`kcard${fresh ? ' is-flash' : ''}`} draggable
      onDragStart={(e) => { e.dataTransfer.setData('text/plain', String(c.id)); e.dataTransfer.effectAllowed = 'move'; }}
      onClick={open}
      tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') open(); }}
      aria-label={`${displayName(c.name)}, ${STAGE_LABEL[c.stage]}`}>
      <header className="kcard__head">
        <Avatar name={c.name} id={c.id} size={28} />
        <strong>{displayName(c.name, c.phone_masked)}</strong>
        <ChannelBadge channel={c.channel} />
      </header>
      {c.reason && <p className="kcard__reason">{c.reason}</p>}
      {next && (
        <span className={`kcard__appt${next.status === 'pendiente' ? ' is-pending' : ''}`}>
          <Icon name="calendar" size={12} /> {next.starts_at ? apptWhen(next) : 'Sin hora'}{next.status === 'pendiente' ? ' · por confirmar' : ''}
        </span>
      )}
      <footer className="kcard__foot">
        <Tags tags={c.tags} max={2} />
        <span className="muted small">{timeAgo(c.last_message_at ?? c.updated_at)}</span>
      </footer>
    </article>
  );
}

export default function Board() {
  const contacts = useStore((s) => s.contacts);
  const [over, setOver] = useState<Stage | null>(null);

  async function drop(e: DragEvent, stage: Stage) {
    e.preventDefault();
    setOver(null);
    const id = Number(e.dataTransfer.getData('text/plain'));
    if (id) await api(`/contacts/${id}`, { method: 'PATCH', body: { stage } });
  }

  return (
    <div className="page page--board">
      <header className="page__head">
        <div>
          <h1>Tablero</h1>
          <p className="muted">Las tarjetas se mueven solas según la conversación. También puedes arrastrarlas.</p>
        </div>
      </header>
      <div className="board">
        {STAGES.map((stage) => {
          const cards = contacts.filter((c) => c.stage === stage)
            .sort((a, b) => String(b.last_message_at ?? b.updated_at).localeCompare(String(a.last_message_at ?? a.updated_at)));
          return (
            <section key={stage} className={`column column--${stage}${over === stage ? ' is-over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }} onDragLeave={() => setOver(null)} onDrop={(e) => drop(e, stage)}
              aria-label={STAGE_LABEL[stage]}>
              <header className="column__head">
                <span className="column__title"><span className={`stage-dot stage-dot--${stage}`} />{STAGE_LABEL[stage]}</span>
                <span className="column__count">{cards.length}</span>
              </header>
              <p className="column__hint">{HINT[stage]}</p>
              <div className="column__cards">
                {cards.map((c) => <Card key={c.id} c={c} />)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
