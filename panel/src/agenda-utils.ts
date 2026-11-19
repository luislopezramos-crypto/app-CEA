// Fechas y cálculos de la agenda. Las horas de las citas van en hora local de la oficina: 'AAAA-MM-DDTHH:MM'.
import type { AgendaConfig, Appointment } from './store';

export const pad = (n: number) => String(n).padStart(2, '0');
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowKey = () => { const d = new Date(); return `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
export const parseDay = (k: string) => { const [y, m, d] = k.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
export const hmToMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
export const minToHm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const startMin = (a: Appointment) => hmToMin(a.starts_at!.slice(11, 16));

export const STATUS_LABEL: Record<Appointment['status'], string> = { pendiente: 'Por confirmar', confirmada: 'Confirmada', cancelada: 'Cancelada' };
export const TURNO_LABEL: Record<string, string> = { completo: 'Todo el día', mananas: 'Mañanas', tardes: 'Tardes' };

export const longDay = (d: Date) => d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

// «10:00 – 10:45»
export const timeRange = (a: Appointment) => {
  const s = startMin(a);
  return `${minToHm(s)} – ${minToHm(s + a.duration)}`;
};

export function memberColor(cfg: AgendaConfig | null, name: string | null) {
  return cfg?.team.find((m) => m.nombre === name)?.color ?? '#8a857a';
}

export const firstName = (n: string | null | undefined) => String(n ?? '').split(' ')[0];

// Citas que se solapan en una columna: se reparten en carriles, una al lado de otra.
export function layoutLanes(items: Appointment[]) {
  const sorted = [...items].sort((a, b) => startMin(a) - startMin(b) || b.duration - a.duration);
  const out = new Map<number, { lane: number; lanes: number }>();
  let cluster: Appointment[] = [];
  let clusterEnd = -1;
  let laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, laneEnds.length);
    cluster.forEach((a) => out.set(a.id, { lane: out.get(a.id)!.lane, lanes }));
    cluster = [];
    laneEnds = [];
  };
  for (const a of sorted) {
    const s = startMin(a);
    const e = s + a.duration;
    if (cluster.length && s >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= s);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(e); } else laneEnds[lane] = e;
    out.set(a.id, { lane, lanes: 1 });
    cluster.push(a);
    clusterEnd = Math.max(clusterEnd, e);
  }
  flush();
  return out;
}

// Horas que abarca la agenda (de la primera apertura al último cierre de la semana).
export function dayRange(cfg: AgendaConfig) {
  const open = cfg.apertura.filter(Boolean) as [string, string][];
  if (!open.length) return [8 * 60, 21 * 60];
  const a = Math.min(...open.map(([x]) => hmToMin(x)));
  const b = Math.max(...open.map(([, y]) => hmToMin(y)));
  return [Math.floor(a / 60) * 60, Math.ceil(b / 60) * 60];
}
