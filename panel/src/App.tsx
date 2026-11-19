import { Component, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, bootstrap, dismissToast, logoutSocket, setState, useStore } from './store';
import { Icon } from './ui';
import Home from './views/Home';
import Inbox from './views/Inbox';
import Contacts from './views/Contacts';
import Board from './views/Board';
import Assistant from './views/Assistant';
import Agenda from './views/Agenda';
import { AppointmentDialogHost } from './appointments';
import { nowKey } from './agenda-utils';

export type Route = { view: 'inicio' | 'conversaciones' | 'agenda' | 'contactos' | 'tablero' | 'asistente'; id?: number };

function parse(path: string): Route {
  const [, , view, id] = path.split('/');
  const v = (['conversaciones', 'agenda', 'contactos', 'tablero', 'asistente'] as const).find((x) => x === view) ?? 'inicio';
  return { view: v, id: id ? Number(id) : undefined };
}

export function navigate(view: Route['view'], id?: number) {
  const path = `/panel/${view === 'inicio' ? '' : view}${id ? `/${id}` : ''}`;
  history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

const NAV: { view: Route['view']; label: string; icon: string }[] = [
  { view: 'inicio', label: 'Inicio', icon: 'home' },
  { view: 'conversaciones', label: 'Conversaciones', icon: 'inbox' },
  { view: 'agenda', label: 'Agenda', icon: 'calendar' },
  { view: 'contactos', label: 'Contactos', icon: 'users' },
  { view: 'tablero', label: 'Tablero', icon: 'board' },
  { view: 'asistente', label: 'Asistente', icon: 'spark' },
];

// Si una vista falla, se queda en esa vista con un aviso en vez de dejar todo el panel en blanco.
class ViewBoundary extends Component<{ children: ReactNode; resetKey: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidUpdate(prev: { resetKey: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null });
  }
  componentDidCatch(error: Error) { console.error('[panel]', error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page">
        <p className="empty">Esta sección no se ha podido mostrar. <button className="link" onClick={() => location.reload()}>Recargar</button></p>
      </div>
    );
  }
}

function Login() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      await api('/login', { body: { username: f.get('username'), password: f.get('password') } });
      await bootstrap();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login">
      <form className="login__card" onSubmit={submit}>
        <div className="brand brand--lg"><span className="brand__mark">C</span><span>CEA<em>Panel de la oficina</em></span></div>
        <label className="field">
          <span>Usuario</span>
          <input name="username" autoComplete="username" required autoFocus />
        </label>
        <label className="field">
          <span>Contraseña</span>
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="btn btn--primary btn--block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar al panel'}</button>
      </form>
    </main>
  );
}

function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <Icon name={t.kind === 'urgente' ? 'alert' : t.kind === 'cita' ? 'calendar' : 'check'} size={18} />
          <div className="toast__body">
            <strong>{t.title}</strong>
            <span>{t.body}</span>
          </div>
          {t.appointmentId ? (
            <button className="link" onClick={() => { navigate('agenda', t.appointmentId); dismissToast(t.id); }}>Ver</button>
          ) : t.contactId && (
            <button className="link" onClick={() => {
              const cv = (window as any).__findConv?.(t.contactId);
              if (cv) navigate('conversaciones', cv);
              dismissToast(t.id);
            }}>Ver</button>
          )}
          <button className="icon-btn" aria-label="Cerrar aviso" onClick={() => dismissToast(t.id)}><Icon name="x" size={14} /></button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const ready = useStore((s) => s.ready);
  const user = useStore((s) => s.user);
  const unread = useStore((s) => s.conversations.reduce((n, c) => n + (c.unread ? 1 : 0), 0));
  const pending = useStore((s) => s.appointments.filter((a) => a.status === 'pendiente' && (!a.starts_at || a.starts_at >= nowKey())).length);
  const connected = useStore((s) => s.connected);
  const wa = useStore((s) => s.wa.status);
  const conversations = useStore((s) => s.conversations);
  const [route, setRoute] = useState<Route>(() => parse(location.pathname));

  useEffect(() => {
    bootstrap();
    const on = () => setRoute(parse(location.pathname));
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  useEffect(() => {
    (window as any).__findConv = (contactId: number) => conversations.find((c) => c.contact_id === contactId)?.id;
  }, [conversations]);

  if (!ready) return <div className="splash">Cargando…</div>;
  if (!user) return <Login />;

  async function logout() {
    await api('/logout', { method: 'POST' });
    logoutSocket();
    setState({ user: null });
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand__mark">C</span><span>CEA<em>Consultoría Empresarial Aduanera</em></span></div>
        <nav aria-label="Secciones del panel">
          {NAV.map((n) => (
            <a key={n.view} href={`/panel/${n.view === 'inicio' ? '' : n.view}`}
              className={`nav-item${route.view === n.view ? ' is-active' : ''}`}
              aria-current={route.view === n.view ? 'page' : undefined}
              onClick={(e) => { e.preventDefault(); navigate(n.view); }}>
              <Icon name={n.icon} />
              <span>{n.label}</span>
              {n.view === 'conversaciones' && unread > 0 && <span className="count">{unread}</span>}
              {n.view === 'agenda' && pending > 0 && <span className="count count--accent" title="Citas por confirmar o sin hora">{pending}</span>}
            </a>
          ))}
        </nav>
        <div className="sidebar__foot">
          <div className="status-line">
            <span className={`dot${connected ? ' dot--on' : ''}`} /> {connected ? 'En directo' : 'Reconectando…'}
          </div>
          <div className="status-line">
            <span className={`dot${wa === 'conectado' ? ' dot--on' : ''}`} /> WhatsApp {wa === 'conectado' ? 'conectado' : 'sin conectar'}
          </div>
          <div className="me">
            <span className="me__name">{user.name}</span>
            <button className="icon-btn" onClick={logout} aria-label="Cerrar sesión" title="Cerrar sesión"><Icon name="logout" size={16} /></button>
          </div>
        </div>
      </aside>
      <main className="main">
        <ViewBoundary resetKey={`${route.view}/${route.id ?? ''}`}>
          {route.view === 'inicio' && <Home />}
          {route.view === 'conversaciones' && <Inbox selectedId={route.id} />}
          {route.view === 'agenda' && <Agenda selectedId={route.id} />}
          {route.view === 'contactos' && <Contacts selectedId={route.id} />}
          {route.view === 'tablero' && <Board />}
          {route.view === 'asistente' && <Assistant />}
        </ViewBoundary>
      </main>
      <Toasts />
      <AppointmentDialogHost />
    </div>
  );
}
