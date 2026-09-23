export interface Telemetry {
  timestamp: string;
  driver_name: string | null;
  car_name: string | null;
  'rig.id': string;
  'session.id': string;
  company_name?: string | null;
  source?: string | null;
  speed_kmh: number | null;
  acceleration_g: number | null;
  gear: number | null;
  brake_pct: number | null;
  pos_x: number | null;
  pos_y: number | null;
  lap_time_s: number | null;
  best_lap_s: number | null;
  last_lap_s?: number | null;
  lap_invalidated?: boolean | null;
  lap_number: number | null;
  lap_race_position: number | null;
}

export type Metric = 'speed_kmh' | 'brake_pct' | 'acceleration_g';
export const metrics: Record<Metric, { label: string; unit: string; max: number }> = {
  speed_kmh: { label: 'Velocidade', unit: 'km/h', max: 320 },
  brake_pct: { label: 'Frenagem', unit: '%', max: 100 },
  acceleration_g: { label: 'Aceleração', unit: 'g', max: 5 },
};
export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function parseEvents(input: unknown): Telemetry[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    if (typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp))) return [];
    const num = (key: string) => finite(r[key]) ? r[key] : null;
    const str = (key: string) => typeof r[key] === 'string' ? r[key] : null;
    return [{timestamp:r.timestamp, driver_name:str('driver_name'), car_name:str('car_name'),
      'rig.id':str('rig.id') ?? 'unknown', 'session.id':str('session.id') ?? 'unknown', company_name:str('company_name'), source:str('source'),
      speed_kmh:num('speed_kmh'), acceleration_g:num('acceleration_g'), gear:num('gear'), brake_pct:num('brake_pct'),
      pos_x:num('pos_x'), pos_y:num('pos_y'), lap_time_s:num('lap_time_s'), best_lap_s:num('best_lap_s'),
      lap_invalidated:typeof r.lap_invalidated === 'boolean' ? r.lap_invalidated : null, last_lap_s:num('last_lap_s'), lap_number:num('lap_number'), lap_race_position:num('lap_race_position')}];
  });
}
export function lapTime(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return '—';
  const ms = Math.round(value * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export const number = (v: number | null | undefined, digits = 0) => finite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: digits }) : '—';
export const driverKey = (r: Telemetry) => JSON.stringify([r.driver_name, r['rig.id'], r['session.id'], r.car_name]);
export interface Driver extends Telemetry { key: string; best: number | null; peak: number; bestSource: 'simulator' | 'completed' | null; }
export function summarize(events: Telemetry[]): Driver[] {
  const drivers = new Map<string, Driver>();
  const laps = new Map<string, {number:number | null; started:boolean; clean:boolean}>();
  for (const event of [...events].sort((a,b) => a.timestamp.localeCompare(b.timestamp))) {
    if (!event.driver_name) continue;
    const key = driverKey(event);
    const previous = drivers.get(key);
    const lap = laps.get(key);
    const completed = lap && finite(lap.number) && event.lap_number === lap.number + 1 && lap.started && lap.clean && finite(event.last_lap_s) && event.last_lap_s > 0 ? event.last_lap_s : null;
    const official = finite(event.best_lap_s) && event.best_lap_s > 0 ? event.best_lap_s : null;
    const best = official ?? completed;
    const bestSource = best !== null && best <= (previous?.best ?? Infinity) ? official !== null ? 'simulator' : 'completed' : previous?.bestSource ?? null;
    const sameLap = lap?.number === event.lap_number;
    laps.set(key, {number:event.lap_number, started:(sameLap && lap.started) || (finite(event.lap_time_s) && event.lap_time_s <= 1), clean:(sameLap ? lap.clean : true) && event.lap_invalidated === false});
    drivers.set(key, { ...event, key, bestSource, last_lap_s:event.last_lap_s ?? previous?.last_lap_s, best: best === null ? previous?.best ?? null : Math.min(previous?.best ?? Infinity, best), peak: Math.max(previous?.peak ?? 0, event.speed_kmh ?? 0) });
  }
  return [...drivers.values()].sort((a,b) => (a.best ?? Infinity) - (b.best ?? Infinity) || a.driver_name!.localeCompare(b.driver_name!));
}

// Average per track segment. Distance cutoff prevents outliers from coloring the track.
export function trackHeat(events: Telemetry[], metric: Metric, nodes: number[][]) {
  const bins = nodes.map(() => ({sum:0,count:0}));
  for (const e of events) {
    if (!finite(e.pos_x) || !finite(e.pos_y) || !finite(e[metric])) continue;
    let best = -1, distance = 35 * 35;
    for (let i=0; i<nodes.length; i++) {
      const d = (nodes[i][0]-e.pos_x)**2 + (nodes[i][1]-e.pos_y)**2;
      if (d < distance) {distance=d;best=i;}
    }
    if (best >= 0) {bins[best].sum += e[metric];bins[best].count++;}
  }
  return bins.map((bin,i) => {
    if (!bin.count) return null;
    let sum=0, weight=0;
    for (let offset=-2;offset<=2;offset++) {
      const neighbor = bins[(i+offset+bins.length*2)%bins.length];
      if (neighbor.count) { const w=3-Math.abs(offset);sum+=neighbor.sum/neighbor.count*w;weight+=w; }
    }
    return sum/weight;
  });
}
export function heatColor(value: number, max: number) {
  const t = Math.max(0, Math.min(1, value / max));
  return `hsl(${210 - 210 * t}, 90%, 54%)`;
}

// Normalized contributions, with braking emphasized. No physical unit for this composite.
export function mixedHeatColor(speed: number | null, brake: number | null, acceleration: number | null): string | null {
  if (speed === null && brake === null && acceleration === null) return null;
  const weights = [Math.max(0, brake ?? 0) / 35, Math.max(0, acceleration ?? 0) / 3.5, Math.max(0, speed ?? 0) / 320].map(v => v ** 3);
  const total = weights.reduce((a,b) => a+b,0);
  if (!total) return 'rgb(52, 145, 255)';
  const palette = [[245,69,75],[51,220,125],[52,145,255]];
  const channels = [0,1,2].map(channel => Math.round(weights.reduce((sum,w,i) => sum + w * palette[i][channel],0) / total));
  return `rgb(${channels.join(', ')})`;
}
