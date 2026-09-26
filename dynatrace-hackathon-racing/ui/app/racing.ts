export interface Telemetry {
  timestamp: string;
  driver_name: string | null;
  car_name: string | null;
  'rig.id': string;
  'session.id': string;
  'sample.id'?: string | null;
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
// O AMS2 emite quadros com velocidade impossível quando teletransporta o carro
// (voltar aos boxes, reiniciar a sessão) ou quando a física o lança numa batida.
// O coletor já descarta essas leituras, mas as sessões antigas no Grail ainda as
// têm: sem este corte, um único quadro define a "velocidade máxima" do painel.
export const MAX_SPEED_KMH = 400;
// Mesmo problema no acelerômetro: zebra alta, batida e reposicionamento geram
// picos de dezenas de g (105 g na captura real, contra 3,2 g de p99).
export const MAX_G = 10;
export function parseEvents(input: unknown): Telemetry[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item: unknown) => {
    if (!item || typeof item !== 'object') return [];
    const r = item as Record<string, unknown>;
    if (typeof r.timestamp !== 'string' || !Number.isFinite(Date.parse(r.timestamp))) return [];
    const num = (key: string) => finite(r[key]) ? r[key] : null;
    const str = (key: string) => typeof r[key] === 'string' ? r[key] : null;
    const speed = () => { const v = r.speed_kmh; return finite(v) && v >= 0 && v <= MAX_SPEED_KMH ? v : null; };
    const gforce = () => { const v = r.acceleration_g; return finite(v) && v >= 0 && v <= MAX_G ? v : null; };
    return [{timestamp:r.timestamp, driver_name:str('driver_name'), car_name:str('car_name'),
      'rig.id':str('rig.id') ?? 'unknown', 'session.id':str('session.id') ?? 'unknown', 'sample.id':str('sample.id'), company_name:str('company_name'), source:str('source'),
      speed_kmh:speed(), acceleration_g:gforce(), gear:num('gear'), brake_pct:num('brake_pct'),
      pos_x:num('pos_x'), pos_y:num('pos_y'), lap_time_s:num('lap_time_s'), best_lap_s:num('best_lap_s'),
      lap_invalidated:typeof r.lap_invalidated === 'boolean' ? r.lap_invalidated : null, last_lap_s:num('last_lap_s'), lap_number:num('lap_number'), lap_race_position:num('lap_race_position')}];
  });
}
// A mesma amostra pode chegar ao Grail por dois caminhos: bizevents (API direta)
// e logs (OTel Collector do rig). O coletor carimba sample.id igual nos dois, então
// basta manter a primeira ocorrência. Amostras sem sample.id são de execuções
// antigas e caem num fallback por piloto + instante, nunca colapsando umas nas outras.
export function mergeTelemetry(...sources: Telemetry[][]): Telemetry[] {
  const seen = new Set<string>();
  const merged: Telemetry[] = [];
  for (const source of sources) {
    for (const event of source) {
      const key = event['sample.id'] ?? `${event.timestamp}|${driverKey(event)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(event);
    }
  }
  return merged;
}

// Voltas concluídas chegam por uma consulta própria, agregada no Grail.
// A consulta de telemetria traz só os 10.000 eventos mais recentes — a ~60
// amostras/s por rig isso é menos de um minuto, e a transição de volta quase
// nunca cai nessa janela. Sem isto o pódio fica vazio mesmo com voltas feitas.
export function applyLapResults(drivers: Driver[], laps: Telemetry[]): Driver[] {
  const best = new Map<string, number>();
  for (const lap of laps) {
    if (!finite(lap.last_lap_s) || lap.last_lap_s <= 0) continue;
    const key = driverKey(lap);
    const atual = best.get(key);
    if (atual === undefined || lap.last_lap_s < atual) best.set(key, lap.last_lap_s);
  }
  if (!best.size) return drivers;
  return drivers.map(driver => {
    const registrada = best.get(driver.key);
    if (registrada === undefined) return driver;
    // O tempo informado pelo simulador continua tendo prioridade quando existe.
    if (driver.bestSource === 'simulator' && finite(driver.best) && driver.best <= registrada) return driver;
    return finite(driver.best) && driver.best <= registrada
      ? driver
      : { ...driver, best: registrada, bestSource: 'completed' as const };
  }).sort((a,b) => (a.best ?? Infinity) - (b.best ?? Infinity) || a.driver_name!.localeCompare(b.driver_name!));
}

export function lapTime(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return '—';
  const ms = Math.round(value * 1000);
  return `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
}
export const number = (v: number | null | undefined, digits = 0) => finite(v) ? v.toLocaleString('pt-BR', { maximumFractionDigits: digits }) : '—';
// Identidade de uma participação = simulador + sessão (o coletor gera uma
// session.id nova a cada reinício, que é como se separa um cliente do próximo).
// Piloto e carro NÃO entram na chave: eles chegam em pacotes UDP próprios, uns
// 27s depois do primeiro quadro de telemetria, e ficam nulos até lá. Com eles na
// chave, cada sessão virava dois pilotos — e dois carros parados no mapa.
export const driverKey = (r: Telemetry) => JSON.stringify([r['rig.id'], r['session.id']]);
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

// Nome do piloto e carro chegam em pacotes UDP próprios, uns 27s depois do
// primeiro quadro de telemetria, e vêm nulos até lá — 535 dos 7.236 quadros da
// captura real. Como a identidade é a sessão, esses quadros pertencem a alguém
// que o resto do bloco já identifica: preencher para trás evita que o painel
// fique em "Aguardando piloto" no começo de toda sessão (e nos primeiros
// segundos do replay da captura, onde o piloto é conhecido desde sempre).
export function backfillIdentity(events: Telemetry[]): Telemetry[] {
  const known = new Map<string, {driver_name: string | null; car_name: string | null}>();
  for (const event of events) {
    const entry = known.get(driverKey(event));
    if (!entry) known.set(driverKey(event), {driver_name: event.driver_name, car_name: event.car_name});
    else {
      entry.driver_name ??= event.driver_name;
      entry.car_name ??= event.car_name;
    }
  }
  return events.map(event => {
    if (event.driver_name && event.car_name) return event;
    const entry = known.get(driverKey(event));
    return entry ? {...event, driver_name: event.driver_name ?? entry.driver_name, car_name: event.car_name ?? entry.car_name} : event;
  });
}

// O Grail entrega um bloco de amostras por consulta, mas elas cobrem um
// intervalo contínuo de pista. Agrupar por piloto e percorrer o bloco em tempo
// real faz o carro deslizar no mapa, em vez de teletransportar uma vez por
// consulta. Amostras sem posição não entram: não há onde desenhá-las.
export function trails(events: Telemetry[]): Telemetry[][] {
  const byDriver = new Map<string, Telemetry[]>();
  for (const event of events) {
    if (!finite(event.pos_x) || !finite(event.pos_y)) continue;
    const key = driverKey(event);
    const trail = byDriver.get(key);
    if (trail) trail.push(event); else byDriver.set(key, [event]);
  }
  for (const trail of byDriver.values()) trail.sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  return [...byDriver.values()];
}

// O simulador repete o mesmo `last_lap_s` em todos os quadros até fechar uma
// volta nova — inclusive atravessando várias voltas, quando as seguintes não
// registram tempo — e o valor ainda sobrevive ao reinício do coletor, porque
// quem lembra é o jogo. Agrupar no Grail por sessão + tempo colapsa as
// repetições dentro de uma sessão; aqui some a repetição ENTRE sessões do mesmo
// piloto no mesmo simulador, que é a mesma volta física relistada. Fica a
// ocorrência mais antiga: o instante em que a volta de fato fechou.
export function dedupeLaps(laps: Telemetry[]): Telemetry[] {
  const primeira = new Map<string, Telemetry>();
  for (const lap of laps) {
    const key = JSON.stringify([lap['rig.id'], lap.driver_name, lap.last_lap_s]);
    const atual = primeira.get(key);
    if (!atual || Date.parse(lap.timestamp) < Date.parse(atual.timestamp)) primeira.set(key, lap);
  }
  return [...primeira.values()];
}

// O ranking do evento é por VOLTA, não por piloto: um piloto rápido pode ocupar
// várias posições, e agrupar por piloto reduzia o período inteiro a uma linha
// por pessoa. Da mais rápida para a mais lenta.
export function lapsByTime(laps: Telemetry[]): Telemetry[] {
  return laps
    .filter(lap => finite(lap.last_lap_s) && lap.last_lap_s > 0)
    .sort((a,b) => a.last_lap_s! - b.last_lap_s!);
}

// Pódio de empresas: a volta mais rápida de cada uma. Recebe as voltas já
// ordenadas por tempo, então a primeira ocorrência de cada empresa já é a
// melhor dela — sem passar por um "melhor de cada piloto" no meio, que era
// onde a volta certa se perdia quando o mesmo piloto tinha várias.
export function companyPodium(lapsSortedByTime: Telemetry[], size: number): Telemetry[] {
  const melhor = new Map<string, Telemetry>();
  for (const lap of lapsSortedByTime) {
    if (lap.company_name && !melhor.has(lap.company_name)) melhor.set(lap.company_name, lap);
  }
  return [...melhor.values()].slice(0, size);
}

// Janela de tempo que contém uma volta, para buscar as amostras dela no Grail.
// O registro da volta traz o instante em que ela FECHOU e quanto durou, então a
// volta é o intervalo que termina ali. A margem cobre as duas pontas: o
// fechamento é o primeiro quadro que reportou o tempo, não o cruzamento exato
// da linha. Devolve null quando o registro não tem duração utilizável.
export function lapWindow(lap: Telemetry, marginMs: number): {from: string; to: string} | null {
  const closed = Date.parse(lap.timestamp);
  if (!finite(lap.last_lap_s) || lap.last_lap_s <= 0 || !Number.isFinite(closed)) return null;
  return {
    from: new Date(closed - lap.last_lap_s * 1000 - marginMs).toISOString(),
    to: new Date(closed + marginMs).toISOString(),
  };
}

// Um passo do relógio de reprodução. Normalmente avança `step`, sem nunca
// passar da amostra mais nova. Ressincroniza quando o relógio saiu da janela
// coberta pelo bloco atual: troca de período, aba em segundo plano (o navegador
// congela os timers) ou uma pausa longa na telemetria. O alvo da
// ressincronização é `trail` atrás do fim, para sobrar pista a percorrer.
export function advancePlayback(clock: number, oldest: number, newest: number, step: number, trail: number): number {
  if (clock > newest || clock < Math.max(oldest, newest - 2 * trail)) return Math.max(oldest, newest - trail);
  return Math.min(newest, clock + step);
}

// Última amostra da trilha até o instante `at`. Busca binária porque isto roda
// a cada quadro da animação, sobre trilhas de até 10.000 pontos.
export function sampleAt(trail: Telemetry[], at: number): Telemetry {
  let low = 0, high = trail.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Date.parse(trail[middle].timestamp) <= at) low = middle; else high = middle - 1;
  }
  return trail[low];
}

// Ponto do traçado mais próximo da amostra, ou -1 se ela estiver longe demais
// da pista. O corte de distância evita que uma amostra perdida pinte um trecho.
export function nearestNode(x: number, y: number, nodes: number[][]): number {
  let best = -1, distance = 35 * 35;
  for (let i = 0; i < nodes.length; i++) {
    const d = (nodes[i][0] - x) ** 2 + (nodes[i][1] - y) ** 2;
    if (d < distance) { distance = d; best = i; }
  }
  return best;
}

// Recorta as amostras para a volta em si: da largada à largada. A janela que
// busca a volta no Grail tem margem nas duas pontas, então a reprodução
// começava com o carro já andando, antes da linha. Quem diz onde a volta começa
// é o cronômetro do próprio jogo: lap_time_s zera ao cruzar a linha e cresce
// até o tempo da volta. Andamos de trás para frente a partir do fechamento
// enquanto o cronômetro decresce; ele para de decrescer — ou some, porque o
// jogo não reportava tempo na volta anterior — exatamente na largada.
export function trimToLap(samples: Telemetry[], lapSeconds: number): Telemetry[] {
  // O fim da volta é o quadro de MAIOR cronômetro dentro da duração oficial —
  // não o último da janela, que já pertence à volta seguinte (cronômetro zerado).
  let end = -1, maior = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].lap_time_s;
    if (finite(t) && t <= lapSeconds + 0.5 && t > maior) { maior = t; end = i; }
  }
  if (end < 0) return samples;
  let start = end;
  while (start > 0) {
    const anterior = samples[start - 1].lap_time_s, atual = samples[start].lap_time_s;
    if (!finite(anterior) || !finite(atual) || anterior > atual) break;
    start--;
  }
  return samples.slice(start, end + 1);
}

// Perfil da volta de referência: em cada ponto do traçado, o menor tempo de
// volta já decorrido ali. É o que permite dizer, no meio da volta, se o carro
// está na frente ou atrás do melhor tempo — o delta das transmissões de F1.
export function lapProfile(samples: Telemetry[], nodes: number[][]): (number | null)[] {
  const profile: (number | null)[] = nodes.map(() => null);
  for (const sample of samples) {
    if (!finite(sample.pos_x) || !finite(sample.pos_y) || !finite(sample.lap_time_s)) continue;
    const i = nearestNode(sample.pos_x, sample.pos_y, nodes);
    if (i < 0) continue;
    const atual = profile[i];
    if (atual === null || sample.lap_time_s < atual) profile[i] = sample.lap_time_s;
  }
  return profile;
}

// Diferença para a referência no ponto onde o carro está. Negativo = à frente.
// Perto da linha o mesmo ponto do traçado é visitado no começo E no fim da
// volta, e o carro que está fechando casaria com o instante da largada — um
// delta de uma volta inteira. Diferenças acima de meia volta de referência são
// isso, não desempenho, e viram "sem comparação" em vez de um número errado.
export function deltaToReference(sample: Telemetry | undefined, profile: (number | null)[], nodes: number[][], referenceSeconds: number): number | null {
  if (!sample || !finite(sample.pos_x) || !finite(sample.pos_y) || !finite(sample.lap_time_s)) return null;
  const i = nearestNode(sample.pos_x, sample.pos_y, nodes);
  if (i < 0) return null;
  const referencia = profile[i];
  if (referencia === null) return null;
  const delta = sample.lap_time_s - referencia;
  return Math.abs(delta) > referenceSeconds / 2 ? null : delta;
}

// Average per track segment. Distance cutoff prevents outliers from coloring the track.
export function trackHeat(events: Telemetry[], metric: Metric, nodes: number[][]) {
  const bins = nodes.map(() => ({sum:0,count:0}));
  for (const e of events) {
    if (!finite(e.pos_x) || !finite(e.pos_y) || !finite(e[metric])) continue;
    const best = nearestNode(e.pos_x, e.pos_y, nodes);
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
