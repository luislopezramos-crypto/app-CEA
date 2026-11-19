// Piezas pequeñas compartidas por todas las vistas.
import type { ReactNode } from 'react';
import type { Channel, Stage } from './store';

export const STAGE_LABEL: Record<Stage, string> = {
  nuevo: 'Nuevo',
  interesado: 'Interesado',
  quiere_cita: 'Quiere cita',
  paciente: 'Cliente',
};
export const STAGES: Stage[] = ['nuevo', 'interesado', 'quiere_cita', 'paciente'];

const ICONS: Record<string, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z" />,
  inbox: <><path d="M4 13h4l1.5 3h5L16 13h4" /><path d="M5.5 5h13L21 13v6a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-6z" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.6-3.6 3.2-5.5 6.5-5.5s5.9 1.9 6.5 5.5" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.8c2 .7 3.2 2.4 3.5 5.2" /></>,
  board: <><rect x="3.5" y="4" width="5" height="16" rx="1" /><rect x="9.5" y="4" width="5" height="11" rx="1" /><rect x="15.5" y="4" width="5" height="7" rx="1" /></>,
  spark: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6.5 6.5 2.2 2.2M15.3 15.3l2.2 2.2M6.5 17.5l2.2-2.2M15.3 8.7l2.2-2.2" /></>,
  globe: <><circle cx="12" cy="12" r="8.5" /><path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.3 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.3-3.5-8.5S9.6 5.9 12 3.5z" /></>,
  send: <path d="M4 12 20 4l-6 16-2.5-6.5z" />,
  hand: <path d="M8 13V6.5a1.5 1.5 0 0 1 3 0V11m0-5.5V4.5a1.5 1.5 0 0 1 3 0V11m0-5a1.5 1.5 0 0 1 3 0v6.5m0-3a1.5 1.5 0 0 1 3 0V14a7 7 0 0 1-7 7h-1.2a6 6 0 0 1-4.6-2.2L4.3 15a1.6 1.6 0 0 1 2.4-2.1L8 14" />,
  bot: <><rect x="4.5" y="8" width="15" height="11" rx="3" /><path d="M12 8V4.5M9 13h.01M15 13h.01M9.5 16.5h5" /></>,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  chat: <path d="M5 18.5 3.5 21l.8-4A8 8 0 1 1 8 19.6z" />,
  user: <><circle cx="12" cy="8.5" r="4" /><path d="M4.5 20.5c.8-4 3.8-6 7.5-6s6.7 2 7.5 6" /></>,
  alert: <><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4.5M12 17.2h.01" /></>,
  play: <path d="M7 4.5v15l12-7.5z" />,
  logout: <><path d="M14 4.5h4a1.5 1.5 0 0 1 1.5 1.5v12a1.5 1.5 0 0 1-1.5 1.5h-4" /><path d="M10 16.5 5.5 12 10 7.5M5.5 12H15" /></>,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  back: <path d="M19 12H5M11 6l-6 6 6 6" />,
  prev: <path d="m14.5 6-6 6 6 6" />,
  next: <path d="m9.5 6 6 6-6 6" />,
  phone: <path d="M6.6 3.5h2.6l1.4 4-2 1.3a11 11 0 0 0 6.6 6.6l1.3-2 4 1.4v2.6a1.6 1.6 0 0 1-1.7 1.6A16 16 0 0 1 5 5.2a1.6 1.6 0 0 1 1.6-1.7z" />,
  bell: <><path d="M6.5 16.5V11a5.5 5.5 0 1 1 11 0v5.5l1.5 2h-14z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></>,
  edit: <><path d="M4.5 19.5h4l10-10-4-4-10 10z" /><path d="m13 7 4 4" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM18 14h2M14 18v2" /></>,
};

export function Icon({ name, size = 18, className }: { name: keyof typeof ICONS | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export function WhatsAppLogo({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z" />
    </svg>
  );
}

const CHANNEL_LABEL: Record<Channel, [string, string]> = {
  whatsapp: ['WhatsApp', 'WhatsApp'],
  web: ['Web', 'Chat de la web'],
  telefono: ['Teléfono', 'Reservó por teléfono o en recepción'],
};
export function ChannelBadge({ channel, label = false }: { channel: Channel; label?: boolean }) {
  return (
    <span className={`channel channel--${channel}`} title={CHANNEL_LABEL[channel]?.[1]}>
      {channel === 'whatsapp' ? <WhatsAppLogo size={14} /> : <Icon name={channel === 'telefono' ? 'phone' : 'globe'} size={14} />}
      {label && <span>{CHANNEL_LABEL[channel]?.[0]}</span>}
    </span>
  );
}

export function Tag({ children, urgent }: { children: ReactNode; urgent?: boolean }) {
  return <span className={`tag${urgent ? ' tag--urgent' : ''}`}>{children}</span>;
}

export function Tags({ tags, max = 3 }: { tags: string[]; max?: number }) {
  if (!tags?.length) return null;
  const shown = tags.slice(0, max);
  return (
    <span className="tags">
      {shown.map((t) => <Tag key={t} urgent={t === 'Urgente'}>{t}</Tag>)}
      {tags.length > max && <span className="tag tag--more">+{tags.length - max}</span>}
    </span>
  );
}

const PALETTE = ['#56685a', '#8a5a44', '#4d6275', '#7a6a3f', '#6b5470', '#3f6b66'];
export function Avatar({ name, id, size = 36 }: { name: string | null; id: number; size?: number }) {
  const initials = (name ?? '?').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  return (
    <span className="avatar" style={{ width: size, height: size, background: PALETTE[id % PALETTE.length], fontSize: size * 0.38 }}>
      {name ? initials : <Icon name="user" size={size * 0.5} />}
    </span>
  );
}

export function timeAgo(iso?: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 50) return 'ahora';
  if (diff < 3600) return `${Math.round(diff / 60)} min`;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d >= today) return d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d >= yesterday) return 'ayer';
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function formatSeconds(s: number | null) {
  if (s == null) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
}

export const displayName = (name: string | null, phone?: string | null) => name ?? (phone ? `Contacto ${phone}` : 'Visitante web');
