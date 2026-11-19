import { useEffect, useRef, useState, type FormEvent } from 'react';
import { api, pushToast, useStore } from '../store';
import { Icon, WhatsAppLogo } from '../ui';

interface Settings {
  clinica: string; ciudad: string; barrio: string; direccion: string;
  asistente: { nombre: string; tono: string; modelo: string };
  horario: { dias: string; horas: string }[];
  servicios: { nombre: string; duracion: string; precio: number; descripcion: string }[];
  mutuas: string[]; mutuas_nota: string;
  equipo: { nombre: string; rol: string; foco: string; turno?: 'completo' | 'mananas' | 'tardes' }[];
  agenda: {
    apertura: ([string, string] | null)[]; cambio_turno: string; citas_ia: 'confirmada' | 'pendiente';
    antelacion_horas: number; recordatorio: boolean;
  };
  faq: { p: string; r: string }[];
  [k: string]: unknown;
}

const WEEK = [[1, 'Lunes'], [2, 'Martes'], [3, 'Miércoles'], [4, 'Jueves'], [5, 'Viernes'], [6, 'Sábado'], [0, 'Domingo']] as const;

const MODELS = [
  ['anthropic/claude-haiku-5.5', 'Claude Haiku 5.5 · rápido y económico'],
  ['anthropic/claude-sonnet-5.5', 'Claude Sonnet 5.5 · más fino'],
  ['anthropic/claude-opus-5.5', 'Claude Opus 5.5 · el más capaz'],
];

function WhatsAppCard() {
  const wa = useStore((s) => s.wa);
  const [busy, setBusy] = useState(false);
  async function connect() {
    setBusy(true);
    try { await api('/whatsapp/connect', { method: 'POST' }); } finally { setBusy(false); }
  }
  async function logout() {
    if (!confirm('¿Desconectar WhatsApp? El asistente dejará de contestar por WhatsApp hasta que vuelvas a escanear el código.')) return;
    await api('/whatsapp/logout', { method: 'POST' });
  }
  return (
    <section className="card wa-card" id="whatsapp">
      <div className="card__head">
        <h2><WhatsAppLogo size={18} /> Conectar WhatsApp</h2>
        <span className={`pill${wa.status === 'conectado' ? ' pill--ok' : ''}`}>
          {{ desconectado: 'Sin conectar', conectando: 'Conectando…', qr: 'Esperando escaneo', conectado: 'Conectado', error: 'Error' }[wa.status]}
        </span>
      </div>
      {wa.status === 'conectado' ? (
        <div className="wa-connected">
          <p>El asistente contesta los WhatsApp que llegan al número <span className="mono">{wa.phone_masked}</span>, igual que en la web.</p>
          <button className="btn btn--ghost" onClick={logout}>Desconectar</button>
        </div>
      ) : wa.status === 'qr' && wa.qr ? (
        <div className="wa-qr">
          <img src={wa.qr} alt="Código QR para vincular WhatsApp" width={240} height={240} />
          <ol className="steps">
            <li>Abre WhatsApp en el móvil de la oficina.</li>
            <li>Toca <b>Ajustes</b> → <b>Dispositivos vinculados</b> → <b>Vincular un dispositivo</b>.</li>
            <li>Apunta la cámara a este código. Se renueva solo cada pocos segundos.</li>
          </ol>
        </div>
      ) : (
        <div className="wa-start">
          <p>Escanea un código QR con el móvil de la oficina y el asistente empezará a contestar los WhatsApp, de día y de noche.</p>
          {wa.error && <p className="form-error">{wa.error}</p>}
          <button className="btn btn--primary" onClick={connect} disabled={busy || wa.status === 'conectando'}>
            <Icon name="qr" size={15} /> {wa.status === 'conectando' ? 'Generando código…' : 'Mostrar código QR'}
          </button>
        </div>
      )}
      <p className="fineprint">La conexión funciona como WhatsApp Web (no es la API oficial de Meta). Úsala con el volumen normal de una oficina y sin envíos masivos.</p>
    </section>
  );
}

function Preview({ settings }: { settings: Settings }) {
  const [history, setHistory] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [history.length, busy]);
  async function send(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    const h = [...history, { role: 'user' as const, content: text.trim() }];
    setHistory(h);
    setText('');
    setBusy(true);
    try {
      const r = await api('/assistant/preview', { body: { history: h, settings } });
      setHistory([...h, { role: 'assistant', content: r.reply }]);
    } catch (err: any) {
      setHistory([...h, { role: 'assistant', content: `(Error: ${err.message})` }]);
    } finally { setBusy(false); }
  }
  return (
    <section className="card preview">
      <div className="card__head">
        <h2>Pruébalo</h2>
        {history.length > 0 && <button className="link" onClick={() => setHistory([])}>Empezar de nuevo</button>}
      </div>
      <p className="muted small">Usa la configuración de esta página, aunque no la hayas guardado. Ve los huecos reales de la agenda, pero no crea contactos ni citas.</p>
      <div className="preview__body">
        {history.length === 0 && <p className="empty">Escribe como si fueras un cliente: «¿Cuánto cuesta la primera asesoría?»</p>}
        {history.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'msg--paciente' : 'msg--ia'}`}><p>{m.content}</p></div>
        ))}
        {busy && <div className="msg msg--ia msg--typing"><span /><span /><span /></div>}
        <div ref={endRef} />
      </div>
      <form className="composer composer--inline" onSubmit={send}>
        <div className="composer__row">
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un mensaje de prueba" aria-label="Mensaje de prueba" />
          <button className="btn btn--primary" disabled={busy} aria-label="Enviar"><Icon name="send" size={16} /></button>
        </div>
      </form>
    </section>
  );
}

export default function Assistant() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const hasApiKey = useStore((x) => x.hasApiKey);

  useEffect(() => { api('/settings').then((d) => { setS(d.settings); setSaved(JSON.stringify(d.settings)); }); }, []);
  if (!s) return <div className="page"><p className="empty">Cargando…</p></div>;
  const dirty = JSON.stringify(s) !== saved;

  const set = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const setAsis = (patch: Partial<Settings['asistente']>) => set({ asistente: { ...s.asistente, ...patch } });
  const setAgenda = (patch: Partial<Settings['agenda']>) => set({ agenda: { ...s.agenda, ...patch } });
  function updateRow<K extends 'horario' | 'servicios' | 'faq' | 'equipo'>(key: K, i: number, patch: Partial<Settings[K][number]>) {
    const list = [...(s![key] as any[])];
    list[i] = { ...list[i], ...patch };
    set({ [key]: list } as any);
  }
  const removeRow = (key: 'horario' | 'servicios' | 'faq' | 'equipo', i: number) => set({ [key]: (s[key] as any[]).filter((_, j) => j !== i) } as any);
  const addRow = (key: 'horario' | 'servicios' | 'faq' | 'equipo', row: object) => set({ [key]: [...(s[key] as any[]), row] } as any);

  async function save() {
    setSaving(true);
    try {
      const d = await api('/settings', { method: 'PUT', body: { settings: s } });
      setSaved(JSON.stringify(d.settings));
      pushToast({ kind: 'info', title: 'Asistente actualizado', body: 'Ya contesta con la nueva configuración, en la web y en WhatsApp.' });
    } catch (e: any) {
      pushToast({ kind: 'info', title: 'No se pudo guardar', body: e.message });
    } finally { setSaving(false); }
  }

  return (
    <div className="page page--assistant">
      <header className="page__head">
        <div>
          <h1>Asistente</h1>
          <p className="muted">Lo que sabe y cómo habla {s.asistente.nombre}. Contesta igual en la web y en WhatsApp, y nunca promete resultados ni plazos.</p>
        </div>
        <div className="page__actions">
          {dirty && <span className="muted small">Cambios sin guardar</span>}
          <button className="btn btn--primary" onClick={save} disabled={!dirty || saving}>{saving ? 'Guardando…' : 'Guardar cambios'}</button>
        </div>
      </header>

      <div className="assistant-grid">
        <div className="assistant-main">
          <section className="card">
            <div className="card__head"><h2>Identidad</h2></div>
            <div className="form-grid">
              <label className="field"><span>Nombre del asistente</span>
                <input value={s.asistente.nombre} onChange={(e) => setAsis({ nombre: e.target.value })} /></label>
              <label className="field"><span>Nombre de la oficina</span>
                <input value={s.clinica} onChange={(e) => set({ clinica: e.target.value })} /></label>
              <label className="field field--wide"><span>Cómo habla</span>
                <textarea rows={3} value={s.asistente.tono} onChange={(e) => setAsis({ tono: e.target.value })} /></label>
              <label className="field field--wide"><span>Dirección (sin número)</span>
                <input value={s.direccion} onChange={(e) => set({ direccion: e.target.value })} /></label>
              <label className="field field--wide"><span>Modelo de IA (OpenRouter)</span>
                <select className="select" value={s.asistente.modelo} onChange={(e) => setAsis({ modelo: e.target.value })}>
                  {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  {!MODELS.some(([v]) => v === s.asistente.modelo) && <option value={s.asistente.modelo}>{s.asistente.modelo}</option>}
                </select>
                {!hasApiKey && <small className="hint">Sin OPENROUTER_API_KEY en .env el asistente usa respuestas de ejemplo.</small>}
              </label>
            </div>
          </section>

          <section className="card">
            <div className="card__head"><h2>Servicios y precios</h2>
              <button className="link" onClick={() => addRow('servicios', { nombre: '', duracion: '45 min', precio: 0, descripcion: '' })}><Icon name="plus" size={13} /> Añadir servicio</button></div>
            <div className="rows">
              {s.servicios.map((x, i) => (
                <div key={i} className="row row--service">
                  <input aria-label="Servicio" value={x.nombre} onChange={(e) => updateRow('servicios', i, { nombre: e.target.value })} placeholder="Servicio" />
                  <input aria-label="Duración" value={x.duracion} onChange={(e) => updateRow('servicios', i, { duracion: e.target.value })} placeholder="Duración" />
                  <label className="money"><input aria-label="Precio en quetzales" type="number" min={0} value={x.precio} onChange={(e) => updateRow('servicios', i, { precio: Number(e.target.value) })} /><span>Q</span></label>
                  <input aria-label="Descripción" className="row__wide" value={x.descripcion} onChange={(e) => updateRow('servicios', i, { descripcion: e.target.value })} placeholder="Qué incluye" />
                  <button className="icon-btn" aria-label={`Quitar ${x.nombre}`} onClick={() => removeRow('servicios', i)}><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card__head"><h2>Horario</h2>
              <button className="link" onClick={() => addRow('horario', { dias: '', horas: '' })}><Icon name="plus" size={13} /> Añadir franja</button></div>
            <div className="rows">
              {s.horario.map((h, i) => (
                <div key={i} className="row row--two">
                  <input aria-label="Días" value={h.dias} onChange={(e) => updateRow('horario', i, { dias: e.target.value })} placeholder="Días" />
                  <input aria-label="Horas" value={h.horas} onChange={(e) => updateRow('horario', i, { horas: e.target.value })} placeholder="Horas" />
                  <button className="icon-btn" aria-label="Quitar franja" onClick={() => removeRow('horario', i)}><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="card" id="agenda">
            <div className="card__head"><h2>Agenda</h2><span className="muted small">Con esto {s.asistente.nombre} busca huecos y agenda</span></div>
            <div className="agenda-hours">
              {WEEK.map(([wd, label]) => {
                const day = s.agenda.apertura[wd];
                const setDay = (v: [string, string] | null) => {
                  const apertura = [...s.agenda.apertura];
                  apertura[wd] = v;
                  setAgenda({ apertura });
                };
                return (
                  <div key={wd} className={`agenda-hours__row${day ? '' : ' is-closed'}`}>
                    <label className="check check--inline"><input type="checkbox" checked={Boolean(day)} onChange={(e) => setDay(e.target.checked ? ['09:00', '14:00'] : null)} /> <span>{label}</span></label>
                    {day ? (
                      <span className="agenda-hours__times">
                        <input type="time" step={900} aria-label={`${label}: abre`} value={day[0]} onChange={(e) => setDay([e.target.value, day[1]])} />
                        <span className="muted">a</span>
                        <input type="time" step={900} aria-label={`${label}: cierra`} value={day[1]} onChange={(e) => setDay([day[0], e.target.value])} />
                      </span>
                    ) : <span className="muted small">Cerrado</span>}
                  </div>
                );
              })}
            </div>
            <div className="form-grid">
              <label className="field"><span>Cambio de turno (mañanas / tardes)</span>
                <input type="time" step={900} value={s.agenda.cambio_turno} onChange={(e) => setAgenda({ cambio_turno: e.target.value })} /></label>
              <label className="field"><span>Antelación mínima para reservar</span>
                <span className="suffix"><input type="number" min={0} max={72} value={s.agenda.antelacion_horas} onChange={(e) => setAgenda({ antelacion_horas: Number(e.target.value) })} /><span>horas</span></span></label>
              <label className="field field--wide"><span>Las citas que agenda {s.asistente.nombre}</span>
                <select className="select" value={s.agenda.citas_ia} onChange={(e) => setAgenda({ citas_ia: e.target.value as 'confirmada' | 'pendiente' })}>
                  <option value="confirmada">Quedan confirmadas al momento</option>
                  <option value="pendiente">Quedan reservadas y la recepción las confirma</option>
                </select></label>
            </div>
            <label className="check">
              <input type="checkbox" checked={s.agenda.recordatorio} onChange={(e) => setAgenda({ recordatorio: e.target.checked })} />
              <span>Recordar la cita el día antes por WhatsApp o por el chat de la web</span>
            </label>
            <p className="fineprint">El horario de cada persona del equipo (mañanas, tardes o todo el día) está en «Equipo». La duración de cada cita sale de la duración del servicio.</p>
          </section>

          <section className="card">
            <div className="card__head"><h2>Aseguradoras</h2></div>
            <label className="field"><span>Aseguradoras con las que trabajáis (separadas por comas)</span>
              <input value={s.mutuas.join(', ')} onChange={(e) => set({ mutuas: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></label>
            <label className="field"><span>Condiciones</span>
              <textarea rows={2} value={s.mutuas_nota} onChange={(e) => set({ mutuas_nota: e.target.value })} /></label>
          </section>

          <section className="card">
            <div className="card__head"><h2>Preguntas frecuentes</h2>
              <button className="link" onClick={() => addRow('faq', { p: '', r: '' })}><Icon name="plus" size={13} /> Añadir pregunta</button></div>
            <div className="rows">
              {s.faq.map((f, i) => (
                <div key={i} className="row row--faq">
                  <input aria-label="Pregunta" value={f.p} onChange={(e) => updateRow('faq', i, { p: e.target.value })} placeholder="Pregunta" />
                  <textarea aria-label="Respuesta" rows={2} value={f.r} onChange={(e) => updateRow('faq', i, { r: e.target.value })} placeholder="Respuesta" />
                  <button className="icon-btn" aria-label="Quitar pregunta" onClick={() => removeRow('faq', i)}><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <div className="card__head"><h2>Equipo</h2>
              <button className="link" onClick={() => addRow('equipo', { nombre: '', rol: '', foco: '', turno: 'completo' })}><Icon name="plus" size={13} /> Añadir persona</button></div>
            <div className="rows">
              {s.equipo.map((p, i) => (
                <div key={i} className="row row--team">
                  <input aria-label="Nombre" value={p.nombre} onChange={(e) => updateRow('equipo', i, { nombre: e.target.value })} placeholder="Nombre" />
                  <input aria-label="Puesto" value={p.rol} onChange={(e) => updateRow('equipo', i, { rol: e.target.value })} placeholder="Puesto" />
                  <input aria-label="Especialidad" value={p.foco} onChange={(e) => updateRow('equipo', i, { foco: e.target.value })} placeholder="Especialidad" />
                  <select className="select" aria-label="Turno en la agenda" value={p.turno ?? 'completo'} onChange={(e) => updateRow('equipo', i, { turno: e.target.value as 'completo' | 'mananas' | 'tardes' })}>
                    <option value="completo">Todo el día</option>
                    <option value="mananas">Mañanas</option>
                    <option value="tardes">Tardes</option>
                  </select>
                  <button className="icon-btn" aria-label="Quitar persona" onClick={() => removeRow('equipo', i)}><Icon name="x" size={14} /></button>
                </div>
              ))}
            </div>
          </section>

          <section className="card card--rules">
            <div className="card__head"><h2>Reglas fijas</h2></div>
            <ul className="rules">
              <li>Nunca promete resultados ni plazos: eso lo define el abogado en la primera asesoría.</li>
              <li>Ante un plazo por vencer o un trámite urgente, lo marca como urgente y busca cita lo antes posible.</li>
              <li>Pregunta qué trámite necesita, desde cuándo y si es urgente.</li>
              <li>Busca huecos libres en la agenda y agenda la cita; si ya tiene una, la cambia o la anula.</li>
              <li>Nunca ofrece un día u hora que no esté libre en la agenda.</li>
              <li>Contesta en el idioma en el que le escriben.</li>
            </ul>
          </section>
        </div>

        <div className="assistant-side">
          <WhatsAppCard />
          <Preview settings={s} />
        </div>
      </div>
    </div>
  );
}
