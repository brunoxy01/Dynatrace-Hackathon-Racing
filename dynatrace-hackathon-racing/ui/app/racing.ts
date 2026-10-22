export interface Telemetry {
  timestamp: string;
  driver_name: string | null;
  car_name: string | null;
  'rig.id': string;
  'session.id': string;
  'sample.id'?: string | null;
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
  // Só nas linhas de volta concluída (consulta LAPS): velocidade máxima DENTRO
  // da volta, calculada no Grail.
  top_speed_kmh?: number | null;
  // Só nas linhas de volta concluída: menor cronômetro entre os quadros que
  // carregam o tempo dela. ~0 s numa volta real; alto num reanúncio.
  lap_start_s?: number | null;
  // Setores da volta concluída (s), enviados pelo coletor a partir da v1.10.5.
  last_lap_s1?: number | null;
  last_lap_s2?: number | null;
  last_lap_s3?: number | null;
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
    const speed = (key = 'speed_kmh') => { const v = r[key]; return finite(v) && v >= 0 && v <= MAX_SPEED_KMH ? v : null; };
    const gforce = () => { const v = r.acceleration_g; return finite(v) && v >= 0 && v <= MAX_G ? v : null; };
    // O AMS2 manda pos_x=0,pos_y=0 antes do carro ter uma posição real na pista
    // (carregando, ainda nos boxes) — o nó do traçado mais perto da origem do
    // mundo fica a 115 unidades dali, então esse par exato nunca é um ponto
    // real de Interlagos. Sem este corte a bolinha do carro (e o mapa de
    // calor) desenhavam esse placeholder como se fosse telemetria de verdade.
    const posX = num('pos_x'), posY = num('pos_y');
    const semPosicaoReal = posX === 0 && posY === 0;
    return [{timestamp:r.timestamp, driver_name:str('driver_name'), car_name:str('car_name'),
      'rig.id':str('rig.id') ?? 'unknown', 'session.id':str('session.id') ?? 'unknown', 'sample.id':str('sample.id'), source:str('source'),
      speed_kmh:speed(), acceleration_g:gforce(), gear:num('gear'), brake_pct:num('brake_pct'),
      pos_x:semPosicaoReal ? null : posX, pos_y:semPosicaoReal ? null : posY, lap_time_s:num('lap_time_s'), best_lap_s:num('best_lap_s'),
      lap_invalidated:typeof r.lap_invalidated === 'boolean' ? r.lap_invalidated : null, last_lap_s:num('last_lap_s'), lap_number:num('lap_number'), lap_race_position:num('lap_race_position'), top_speed_kmh:speed('top_speed_kmh'),
      last_lap_s1:num('last_lap_s1'), last_lap_s2:num('last_lap_s2'), last_lap_s3:num('last_lap_s3'), lap_start_s:num('lap_start_s')}];
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
  const bySession = new Map<string, number>();
  // Mesmo rig + mesmo nome de piloto sobrevive a um reinício de sessão. Sem
  // isto, uma volta cuja linha representativa (após o dedupeLaps) ficou numa
  // sessão ANTERIOR nunca encontrava o piloto que está ao vivo agora numa
  // sessão nova — e "melhor volta registrada" e "piloto em destaque" ficavam
  // em branco mesmo com a volta certinha na tabela de classificação.
  const byDriver = new Map<string, number>();
  for (const lap of laps) {
    if (!finite(lap.last_lap_s) || lap.last_lap_s <= 0) continue;
    const sessionKey = driverKey(lap);
    const atualSessao = bySession.get(sessionKey);
    if (atualSessao === undefined || lap.last_lap_s < atualSessao) bySession.set(sessionKey, lap.last_lap_s);
    if (lap.driver_name) {
      const nameKey = JSON.stringify([lap['rig.id'], lap.driver_name]);
      const atualPiloto = byDriver.get(nameKey);
      if (atualPiloto === undefined || lap.last_lap_s < atualPiloto) byDriver.set(nameKey, lap.last_lap_s);
    }
  }
  if (!bySession.size && !byDriver.size) return drivers;
  return drivers.map(driver => {
    const porSessao = bySession.get(driver.key);
    const porPiloto = driver.driver_name ? byDriver.get(JSON.stringify([driver['rig.id'], driver.driver_name])) : undefined;
    const registrada = porSessao === undefined ? porPiloto : porPiloto === undefined ? porSessao : Math.min(porSessao, porPiloto);
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
// Tempo de setor: "24.653" abaixo de um minuto, "1:02.345" acima.
export function sectorTime(value: number | null | undefined): string {
  if (!finite(value) || value <= 0) return '—';
  return value < 60 ? value.toFixed(3) : lapTime(value);
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
// piloto no mesmo simulador, que é a mesma volta física relistada.
//
// Mesmo tempo NÃO basta para dizer que é a mesma volta: dois 1:41.120 do mesmo
// piloto em dias diferentes são duas voltas. O que separa é como o grupo de
// quadros começa (`lap_start_s`, o menor cronômetro do grupo): numa volta
// concluída de verdade, quem carrega o tempo dela são os quadros da volta
// seguinte, que começa na linha com o cronômetro em ~0 s; num reanúncio, o
// coletor reiniciado pegou o carro no meio de uma volta. Ficam todas as voltas
// reais; o reanúncio só aparece se a volta real não estiver no período. Linhas
// sem essa informação (dados antigos) seguem a regra anterior: fica a
// ocorrência mais antiga.
export const REANNOUNCE_MIN_CLOCK_S = 3;
export function dedupeLaps(laps: Telemetry[]): Telemetry[] {
  const grupos = new Map<string, Telemetry[]>();
  for (const lap of laps) {
    const key = JSON.stringify([lap['rig.id'], lap.driver_name, lap.last_lap_s]);
    const grupo = grupos.get(key);
    if (grupo) grupo.push(lap); else grupos.set(key, [lap]);
  }
  const voltas: Telemetry[] = [];
  for (const grupo of grupos.values()) {
    const reais = grupo.filter(l => finite(l.lap_start_s) && l.lap_start_s <= REANNOUNCE_MIN_CLOCK_S);
    if (reais.length) voltas.push(...reais);
    else voltas.push(grupo.reduce((a, b) => Date.parse(b.timestamp) < Date.parse(a.timestamp) ? b : a));
  }
  return voltas;
}

// O ranking do evento é por VOLTA, não por piloto: um piloto rápido pode ocupar
// várias posições, e agrupar por piloto reduzia o período inteiro a uma linha
// por pessoa. Da mais rápida para a mais lenta.
export function lapsByTime(laps: Telemetry[]): Telemetry[] {
  return laps
    .filter(lap => finite(lap.last_lap_s) && lap.last_lap_s > 0)
    .sort((a,b) => a.last_lap_s! - b.last_lap_s!);
}

// Pódio de pilotos: a volta mais rápida de cada um, agrupado por nome (não
// por driverKey) — um piloto que trocou de simulador ou reiniciou a sessão
// entre voltas continua sendo UMA pessoa só no pódio, igual ao lapConsistency
// já faz. Recebe as voltas já ordenadas por tempo, então a primeira
// ocorrência de cada piloto já é a melhor dele.
export function driverPodium(lapsSortedByTime: Telemetry[], size: number): Telemetry[] {
  const melhor = new Map<string, Telemetry>();
  for (const lap of lapsSortedByTime) {
    if (lap.driver_name && !melhor.has(lap.driver_name)) melhor.set(lap.driver_name, lap);
  }
  return [...melhor.values()].slice(0, size);
}

// Janela de tempo que contém uma volta, para buscar as amostras dela no Grail.
// O registro da volta traz o instante em que ela FECHOU e quanto durou, então a
// volta é o intervalo que termina ali. A margem cobre as duas pontas: o
// fechamento é o primeiro quadro que reportou o tempo, não o cruzamento exato
// da linha. Devolve null quando o registro não tem duração utilizável.
// As margens são assimétricas de propósito. O instante registrado é o primeiro
// quadro que REPORTOU o tempo, e ele pode chegar bem depois do cruzamento: o
// jogo carrega o último tempo entre sessões, então um coletor reiniciado
// re-anuncia uma volta antiga. Margem generosa ANTES garante que a largada
// caia dentro da janela; o recorte final acha o ponto exato.
export function lapWindow(lap: Telemetry, beforeMs: number, afterMs: number): {from: string; to: string} | null {
  const closed = Date.parse(lap.timestamp);
  if (!finite(lap.last_lap_s) || lap.last_lap_s <= 0 || !Number.isFinite(closed)) return null;
  return {
    from: new Date(closed - lap.last_lap_s * 1000 - beforeMs).toISOString(),
    to: new Date(closed + afterMs).toISOString(),
  };
}

// A volta recortada realmente começa na linha? Se o primeiro quadro já tem
// cronômetro andando, a largada ficou fora da janela buscada e a reprodução
// começaria no meio — melhor avisar do que mostrar a volta errada.
export function startsAtLine(samples: Telemetry[]): boolean {
  const primeiro = samples[0]?.lap_time_s;
  return finite(primeiro) && primeiro <= 1.5;
}

// Um passo do relógio de reprodução. Normalmente avança `step`, sem nunca
// passar da amostra mais nova. Ressincroniza quando o relógio saiu da janela
// coberta pelo bloco atual: troca de período, aba em segundo plano (o navegador
// congela os timers) ou uma pausa longa na telemetria. O alvo da
// ressincronização é `trail` atrás do fim, para sobrar pista a percorrer.
// Recarga da telemetria do Ao vivo. A consulta cobre só os últimos 2 minutos,
// então sai barata, e a troca de dados não aparece na tela.
export const TELEMETRY_REFRESH_MS = 2000;
// Quanto o relógio de reprodução do Ao vivo anda atrás da amostra mais nova. É a
// maior parcela do atraso jogo → mapa. Precisa cobrir o intervalo entre consultas
// MAIS a variação do atraso de ingestão no Grail (o rastro >= recarga + (atraso
// máx. − atraso mín.)); abaixo disso a animação alcança o fim do bloco e o carro
// para até a próxima consulta. Era 8s, dimensionado para a recarga antiga de 5s.
// As duas constantes ficam aqui, e não nos componentes, para o teste de regime
// usar os valores de verdade.
export const PLAYBACK_TRAIL_MS = 5000;

// ---------- Relógio do Ao vivo ----------
// O relógio anda em tempo real e precisa ficar SEMPRE atrás da amostra mais
// nova, senão alcança o fim dos dados e o carro (e o contador de tempo) para até
// a próxima consulta. Um atraso fixo não serve: a ingestão do Grail oscila, e
// 5 s às vezes não bastava. O atraso alvo sai do que foi medido nas últimas
// chegadas de dados: o maior atraso de ingestão visto mais o maior intervalo
// entre dois blocos novos, mais uma folga. Tudo relativo ao relógio do
// navegador, então uma diferença de horário entre o rig e o navegador se anula.
const LIVE_MARGIN_MS = 500;
export function liveDelay(lags: number[], gaps: number[]): number {
  const atraso = lags.length ? Math.max(...lags) : 0;
  const intervalo = Math.max(TELEMETRY_REFRESH_MS, ...gaps);
  return atraso + intervalo + LIVE_MARGIN_MS;
}

// Um passo do relógio do Ao vivo. Anda `elapsed` ms de tempo real, com o ritmo
// ajustado em no máximo ±8% para convergir ao alvo (agora − atraso): ajuste
// imperceptível, em vez de travar ou pular. Só salta direto para o alvo quando
// está longe demais (primeira carga, aba em segundo plano, troca de filtro).
export function stepLiveClock(clock: number, now: number, elapsed: number, oldest: number, newest: number, delay: number): number {
  if (!newest) return clock;
  const alvo = Math.min(newest, Math.max(oldest, now - delay));
  if (!clock || clock > newest || clock < oldest || Math.abs(alvo - clock) > 10000) return alvo;
  const ritmo = 1 + Math.max(-0.08, Math.min(0.08, (alvo - clock) / 5000));
  return Math.min(newest, Math.max(oldest, clock + elapsed * ritmo));
}

// Tempo de volta no instante `at`: o da amostra anterior mais o que passou
// desde ela. Entre duas amostras (100 ms a 10 Hz) o contador anda como relógio
// em vez de saltar. Sem amostra recente (mais de 1 s), não inventa tempo.
export function lapTimeAt(trail: Telemetry[], at: number): number | null {
  const s = sampleAt(trail, at);
  if (!finite(s.lap_time_s)) return null;
  const decorrido = at - Date.parse(s.timestamp);
  return decorrido >= 0 && decorrido <= 1000 ? s.lap_time_s + decorrido / 1000 : s.lap_time_s;
}

// Volta que acabou de ser concluída, no instante `at`: o painel do piloto mostra
// o tempo OFICIAL dela, parado, por até 1 minuto ou até a próxima volta fechar.
// A conclusão é o quadro em que last_lap_s muda E o cronômetro do jogo zera
// (ou o anterior já estava no tempo da volta). Sem essa checagem, um coletor
// reiniciado no meio da volta "reanuncia" o último tempo e o painel mostraria
// uma volta antiga como recém-concluída.
export const LAP_RESULT_HOLD_MS = 60000;
// O quadro i fecha uma volta? last_lap_s muda ali, e o cronômetro do jogo zera
// (ou o quadro anterior já estava no tempo da volta).
function fechaVolta(trail: Telemetry[], i: number): boolean {
  if (i <= 0) return false;
  const virada = trail[i], anterior = trail[i - 1], tempo = virada.last_lap_s;
  if (!finite(tempo) || tempo <= 0 || anterior.last_lap_s === tempo) return false;
  const zerou = finite(virada.lap_time_s) && virada.lap_time_s <= 3;
  const fechando = finite(anterior.lap_time_s) && Math.abs(anterior.lap_time_s - tempo) <= 1.5;
  return zerou || fechando;
}
export function recentLapResult(trail: Telemetry[], at: number, holdMs = LAP_RESULT_HOLD_MS): {seconds: number; completedAt: number} | null {
  if (!trail.length) return null;
  let i = trail.indexOf(sampleAt(trail, at));
  const tempo = trail[i].last_lap_s;
  if (!finite(tempo) || tempo <= 0) return null;
  while (i > 0 && trail[i - 1].last_lap_s === tempo) i--;
  if (!fechaVolta(trail, i)) return null;
  const completedAt = Date.parse(trail[i].timestamp);
  return at - completedAt <= holdMs ? {seconds: tempo, completedAt} : null;
}

// Velocidade máxima sem picos: a TERCEIRA maior amostra. Teleporte de reinício
// ou batida geram um ou dois quadros absurdos (ex.: 386 km/h num Porsche Cup);
// na reta, a velocidade de verdade se mantém por vários quadros a décimos do
// máximo, então a terceira maior é a mesma velocidade. Mesmo critério da
// consulta de voltas no Grail. Com menos de três amostras, fica o máximo.
export function topSpeedOf(samples: Telemetry[]): number | null {
  const v = samples.map(s => s.speed_kmh).filter((x): x is number => finite(x) && x >= 0 && x <= MAX_SPEED_KMH).sort((a, b) => b - a);
  return v.length >= 3 ? v[2] : v.length ? v[0] : null;
}

// Voltas concluídas dentro de uma trilha, no mesmo formato das linhas da
// consulta de voltas. Servem para a volta entrar no placar no instante em que a
// bolinha cruza a linha, sem esperar a próxima consulta ao Grail; quando ela
// chega, a linha do Grail (mesmo timestamp) prevalece.
export function lapCompletions(trail: Telemetry[]): Telemetry[] {
  const voltas: Telemetry[] = [];
  let inicio = 0;
  for (let i = 1; i < trail.length; i++) {
    if (trail[i].last_lap_s !== trail[i - 1].last_lap_s) {
      if (fechaVolta(trail, i)) {
        const v = trail[i];
        // Se o tempo oficial chegou um instante antes da linha, os primeiros
        // quadros com ele ainda vêm sem setores: pega do primeiro que tiver.
        let j = i;
        while (j < trail.length && trail[j].last_lap_s === v.last_lap_s && !finite(trail[j].last_lap_s1)) j++;
        const comSetores = j < trail.length && trail[j].last_lap_s === v.last_lap_s ? trail[j] : v;
        // Detectada pela virada do cronômetro na linha: é volta real (lap_start_s 0).
        voltas.push({...v, last_lap_s1: comSetores.last_lap_s1, last_lap_s2: comSetores.last_lap_s2, last_lap_s3: comSetores.last_lap_s3,
          top_speed_kmh: topSpeedOf(trail.slice(inicio, i)), lap_start_s: 0});
      }
      inicio = i;
    }
  }
  return voltas;
}

export function advancePlayback(clock: number, oldest: number, newest: number, step: number, trail: number): number {
  if (clock > newest || clock < Math.max(oldest, newest - 2 * trail)) return Math.max(oldest, newest - trail);
  return Math.min(newest, clock + step);
}

// Posição do carro no instante `at`, interpolada entre as duas amostras em volta
// dele. O relógio do mapa anda a cada 50 ms, mas o rig manda 10 amostras/s: sem
// interpolar, a bolinha ficava parada 100 ms e saltava para a amostra seguinte.
// Buraco maior que 1 s (box, pausa, teleporte de reinício) não é interpolado,
// para o carro não deslizar por fora da pista.
export function positionAt(trail: Telemetry[], at: number): {x: number; y: number} {
  const atual = sampleAt(trail, at);
  const i = trail.indexOf(atual), proxima = trail[i + 1];
  const t0 = Date.parse(atual.timestamp);
  if (!proxima || at <= t0) return {x: atual.pos_x!, y: atual.pos_y!};
  const t1 = Date.parse(proxima.timestamp);
  if (t1 - t0 > 1000 || t1 <= t0) return {x: atual.pos_x!, y: atual.pos_y!};
  const f = Math.min(1, (at - t0) / (t1 - t0));
  return {x: atual.pos_x! + (proxima.pos_x! - atual.pos_x!) * f, y: atual.pos_y! + (proxima.pos_y! - atual.pos_y!) * f};
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
// Os nós (a cada 3 pontos do traçado) ficam ~27m um do outro em mediana; um
// corte de 45 dá folga pra racing line real desviar um pouco da referência
// sem deixar de contar, sem abrir mão de rejeitar amostra fora da pista.
export function nearestNode(x: number, y: number, nodes: number[][]): number {
  let best = -1, distance = 45 * 45;
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
// Número de sequência da amostra no rig: o fim de `sample.id` ("rig|sessão|seq").
export function sampleSeq(e: Telemetry): number | null {
  const seq = Number(e['sample.id']?.split('|').pop());
  return Number.isInteger(seq) ? seq : null;
}

// Amostras de UMA sessão na ordem em que o rig as gerou. O timestamp do Grail
// não basta: voltas gravadas com a v1.10.0/1.10.1 do coletor saíram por 2 threads
// em paralelo e chegaram fora de ordem, e o timestamp passou a não acompanhar o
// cronômetro do jogo. O trimToLap anda para trás enquanto o cronômetro decresce;
// uma inversão no meio da volta o fazia parar ali, e o replay começava com mais
// de um minuto rodado. A sequência vem do próprio rig e é sempre crescente numa
// sessão. Sem sequência em alguma amostra (dado antigo), fica o timestamp.
export function inSampleOrder(samples: Telemetry[]): Telemetry[] {
  const porTempo = (a: Telemetry, b: Telemetry) => Date.parse(a.timestamp) - Date.parse(b.timestamp);
  if (!samples.every(e => sampleSeq(e) !== null)) return [...samples].sort(porTempo);
  return [...samples].sort((a, b) => sampleSeq(a)! - sampleSeq(b)! || porTempo(a, b));
}

function lapBounds(samples: Telemetry[], lapSeconds: number): [number, number] | null {
  // O fim da volta é o quadro de MAIOR cronômetro dentro da duração oficial —
  // não o último da janela, que já pertence à volta seguinte (cronômetro zerado).
  let end = -1, maior = -Infinity;
  for (let i = 0; i < samples.length; i++) {
    const t = samples[i].lap_time_s;
    if (finite(t) && t <= lapSeconds + 0.5 && t > maior) { maior = t; end = i; }
  }
  if (end < 0) return null;
  let start = end;
  while (start > 0) {
    const anterior = samples[start - 1].lap_time_s, atual = samples[start].lap_time_s;
    if (!finite(anterior) || !finite(atual) || anterior > atual) break;
    start--;
  }
  return [start, end];
}

export function trimToLap(samples: Telemetry[], lapSeconds: number): Telemetry[] {
  const limites = lapBounds(samples, lapSeconds);
  return limites ? samples.slice(limites[0], limites[1] + 1) : samples;
}

// Passagens pela linha de largada/chegada: a linha é o ponto 0 do traçado e o
// carro anda no sentido crescente, então cruzá-la é pular do fim do traçado para
// o começo (conferido na captura: 466 → 0, no mesmo quadro em que o cronômetro
// zera). Devolve o índice do primeiro quadro DEPOIS da linha. Quadros sem
// posição, ou longe da pista, são pulados sem quebrar a detecção.
export function lineCrossings(samples: Telemetry[], track: number[][]): number[] {
  const cruzamentos: number[] = [];
  let anterior = -1;
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const no = finite(s.pos_x) && finite(s.pos_y) ? nearestNode(s.pos_x, s.pos_y, track) : -1;
    if (no < 0) continue;
    if (anterior >= 0 && anterior - no > track.length / 2) cruzamentos.push(i);
    anterior = no;
  }
  return cruzamentos;
}

// A volta da linha de largada até a linha de chegada. O cronômetro do jogo acha
// QUAL volta é (trimToLap), mas não serve para cortar a largada: o AMS2 entrega
// o carro um pouco antes da linha, e nesse trecho o cronômetro pode já estar
// correndo — o replay começava ali, antes da linha. Quem decide o primeiro e o
// último quadro é a passagem pela linha mais próxima de cada ponta. Sem
// passagem por perto (posição ausente), fica o recorte do cronômetro.
export function trimToLineToLine(samples: Telemetry[], lapSeconds: number, track: number[][]): Telemetry[] {
  const limites = lapBounds(samples, lapSeconds);
  if (!limites) return samples;
  let [start, end] = limites;
  const meio = (start + end) / 2;
  const cruzamentos = lineCrossings(samples, track);
  const maisPerto = (alvo: number, candidatos: number[]) => candidatos.reduce<number | null>(
    (melhor, c) => melhor === null || Math.abs(c - alvo) < Math.abs(melhor - alvo) ? c : melhor, null);
  const largada = maisPerto(start, cruzamentos.filter(c => c < meio));
  const chegada = maisPerto(end + 1, cruzamentos.filter(c => c > meio));
  if (largada !== null) start = largada;
  if (chegada !== null) end = chegada - 1;
  return end > start ? samples.slice(start, end + 1) : samples.slice(limites[0], limites[1] + 1);
}

// O primeiro quadro está na linha de largada? Ponto 0 do traçado ou até ~90 m
// depois dele (10 pontos), o que cobre o espaçamento entre amostras a 10 Hz.
export function startsAtTrackLine(samples: Telemetry[], track: number[][]): boolean {
  const s = samples[0];
  if (!s || !finite(s.pos_x) || !finite(s.pos_y)) return false;
  const no = nearestNode(s.pos_x, s.pos_y, track);
  return no >= 0 && no <= 10;
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
//
// Uma volta só raramente acerta TODOS os 156 nós do traçado: em retas rápidas
// as amostras ficam mais espaçadas entre si, e a linha realmente percorrida
// nem sempre passa perto do nó de referência. Isso deixava buracos cinza
// espalhados pelo mapa mesmo em trechos cercados de dados reais dos dois
// lados — no "ao vivo"/"histórico" o problema se disfarça porque muitas voltas
// diferentes acabam cobrindo o traçado inteiro ao longo do tempo, mas numa
// única volta reproduzida (replay) os buracos aparecem.
//
// Um nó sem amostra própria agora herda, por interpolação, o valor dos nós
// vizinhos coloridos MAIS PRÓXIMOS nos dois sentidos — só quando os dois lados
// têm dado real dentro de MAX_GAP nós (~135-175m, nós a ~27-35m de distância
// entre si). Isso preenche lacunas pequenas sem inventar cor para trechos
// genuinamente não visitados nem deixar uma amostra isolada "pintar" o lado
// oposto do traçado.
//
// IMPORTANTE: medido contra uma volta real da captura, um SETOR inteiro pode
// ficar sem nenhuma amostra perto (ex.: ~900m/34 nós seguidos, quando a volta
// gravada termina antes de voltar à linha) — nenhum MAX_GAP razoável deveria
// bridgear isso, seria inventar dado para um quarto da pista. Esse cinza é
// esperado e correto, não um bug a perseguir aumentando o limite.
const MAX_GAP_NODES = 5;
export function trackHeat(events: Telemetry[], metric: Metric, nodes: number[][]) {
  const bins = nodes.map(() => ({sum:0,count:0}));
  for (const e of events) {
    if (!finite(e.pos_x) || !finite(e.pos_y) || !finite(e[metric])) continue;
    const best = nearestNode(e.pos_x, e.pos_y, nodes);
    if (best >= 0) {bins[best].sum += e[metric];bins[best].count++;}
  }
  const n = bins.length;
  const measured: (number | null)[] = bins.map(bin => bin.count ? bin.sum / bin.count : null);
  const filled = measured.slice();
  for (let i = 0; i < n; i++) {
    if (filled[i] !== null) continue;
    let leftIdx = -1, leftDist = -1;
    for (let d = 1; d <= MAX_GAP_NODES; d++) { const idx = (i - d + n * 2) % n; if (measured[idx] !== null) { leftIdx = idx; leftDist = d; break; } }
    let rightIdx = -1, rightDist = -1;
    for (let d = 1; d <= MAX_GAP_NODES; d++) { const idx = (i + d) % n; if (measured[idx] !== null) { rightIdx = idx; rightDist = d; break; } }
    // Precisa de dado real nos DOIS sentidos, em nós DISTINTOS — num traçado
    // minúsculo (ou nos testes), "os dois lados" podem acabar sendo o mesmo
    // único nó alcançado nas duas direções, o que não é uma lacuna cercada.
    if (leftIdx < 0 || rightIdx < 0 || leftIdx === rightIdx) continue;
    const total = leftDist + rightDist;
    filled[i] = (measured[leftIdx]! * rightDist + measured[rightIdx]! * leftDist) / total;
  }
  return filled.map((value, i) => {
    if (value === null) return null;
    let sum = 0, weight = 0;
    for (let offset = -2; offset <= 2; offset++) {
      const neighbor = filled[(i + offset + n * 2) % n];
      if (neighbor !== null) { const w = 3 - Math.abs(offset); sum += neighbor * w; weight += w; }
    }
    return sum / weight;
  });
}
export function heatColor(value: number, max: number) {
  const t = Math.max(0, Math.min(1, value / max));
  return `hsl(${210 - 210 * t}, 90%, 54%)`;
}

// Normalized contributions, with braking emphasized. No physical unit for this composite.
//
// Rollback a pedido (v1.4.4 tinha trocado "sem dado" por azul padrão, pra não
// dar impressão de telemetria perdida). Nó sem amostra nenhuma volta a ser
// null -> cinza no mapa, distinguível de "parado, sem frear, sem acelerar"
// (que continua azul, via o "sem total" abaixo).
export function mixedHeatColor(speed: number | null, brake: number | null, acceleration: number | null): string | null {
  if (speed === null && brake === null && acceleration === null) return null;
  const weights = [Math.max(0, brake ?? 0) / 35, Math.max(0, acceleration ?? 0) / 3.5, Math.max(0, speed ?? 0) / 320].map(v => v ** 3);
  const total = weights.reduce((a,b) => a+b,0);
  if (!total) return 'rgb(52, 145, 255)';
  const palette = [[245,69,75],[51,220,125],[52,145,255]];
  const channels = [0,1,2].map(channel => Math.round(weights.reduce((sum,w,i) => sum + w * palette[i][channel],0) / total));
  return `rgb(${channels.join(', ')})`;
}

// ---------------------------------------------------------------------------
// Dynatrace Intelligence: observações automáticas calculadas a partir do que
// o app já tem carregado (telemetria do período + voltas concluídas), sem
// nenhuma consulta nova ao Grail nem dependência de IA externa. Reaproveita a
// mesma numeração dos 6 pontos de referência já desenhados no mapa, para quem
// ler o insight conseguir achar o lugar.
// ---------------------------------------------------------------------------

const REFERENCE_FRACTIONS = [0.12, 0.28, 0.43, 0.59, 0.73, 0.89];

// Ponto de referência (1..6, mesmo rótulo do mapa) mais próximo de um índice
// de nó, contando o traçado como um círculo (o ponto 1 fica perto do fim e do
// começo do array ao mesmo tempo).
export function nearestReferencePoint(nodeIndex: number, nodeCount: number): number {
  let best = 0, bestDist = Infinity;
  REFERENCE_FRACTIONS.forEach((fraction, i) => {
    const ref = Math.floor(fraction * nodeCount);
    const direct = Math.abs(ref - nodeIndex);
    const distance = Math.min(direct, nodeCount - direct);
    if (distance < bestDist) { bestDist = distance; best = i; }
  });
  return best + 1;
}

export interface BrakingHotspot { referencePoint: number; avgBrakePct: number; }

// Trecho do traçado com a frenagem média mais forte no período. Mesmo binning
// por nó mais próximo do trackHeat, só que isolado na métrica de freio.
export function brakingHotspot(events: Telemetry[], nodes: number[][]): BrakingHotspot | null {
  const bins = nodes.map(() => ({ sum: 0, count: 0 }));
  for (const e of events) {
    if (!finite(e.pos_x) || !finite(e.pos_y) || !finite(e.brake_pct)) continue;
    const i = nearestNode(e.pos_x, e.pos_y, nodes);
    if (i >= 0) { bins[i].sum += e.brake_pct; bins[i].count++; }
  }
  let best = -1, bestAvg = -Infinity;
  bins.forEach((bin, i) => {
    if (!bin.count) return;
    const avg = bin.sum / bin.count;
    if (avg > bestAvg) { bestAvg = avg; best = i; }
  });
  return best < 0 ? null : { referencePoint: nearestReferencePoint(best, nodes.length), avgBrakePct: bestAvg };
}

export interface TopSpeed { speedKmh: number; referencePoint: number; driverName: string | null; }

// Maior velocidade válida do período (já passou pelo corte de teletransporte
// em parseEvents) e o ponto de referência mais próximo de onde ocorreu.
export function topSpeedLocation(events: Telemetry[], nodes: number[][]): TopSpeed | null {
  let best: Telemetry | null = null;
  for (const e of events) {
    if (!finite(e.speed_kmh) || !finite(e.pos_x) || !finite(e.pos_y)) continue;
    if (!best || e.speed_kmh > best.speed_kmh!) best = e;
  }
  if (!best) return null;
  const i = nearestNode(best.pos_x!, best.pos_y!, nodes);
  return i < 0 ? null : { speedKmh: best.speed_kmh!, referencePoint: nearestReferencePoint(i, nodes.length), driverName: best.driver_name ?? null };
}

export interface AccelerationHotspot { referencePoint: number; avgG: number; }

// Trecho do traçado com a aceleração média mais forte no período (mesmo
// binning por nó mais próximo do brakingHotspot, isolado na métrica de g).
export function accelerationHotspot(events: Telemetry[], nodes: number[][]): AccelerationHotspot | null {
  const bins = nodes.map(() => ({ sum: 0, count: 0 }));
  for (const e of events) {
    if (!finite(e.pos_x) || !finite(e.pos_y) || !finite(e.acceleration_g)) continue;
    const i = nearestNode(e.pos_x, e.pos_y, nodes);
    if (i >= 0) { bins[i].sum += e.acceleration_g; bins[i].count++; }
  }
  let best = -1, bestAvg = -Infinity;
  bins.forEach((bin, i) => {
    if (!bin.count) return;
    const avg = bin.sum / bin.count;
    if (avg > bestAvg) { bestAvg = avg; best = i; }
  });
  return best < 0 ? null : { referencePoint: nearestReferencePoint(best, nodes.length), avgG: bestAvg };
}

export interface DriverZone { driverName: string; referencePoint: number; avgValue: number; }

// Mesma lógica de brakingHotspot/accelerationHotspot, mas uma zona por
// piloto em vez de uma só global — para comparar onde CADA piloto freia ou
// acelera mais forte, não só o trecho mais puxado da pista como um todo.
function hotspotsByDriver(events: Telemetry[], nodes: number[][], metric: 'brake_pct' | 'acceleration_g'): DriverZone[] {
  const byDriver = new Map<string, { sum: number; count: number }[]>();
  for (const e of events) {
    const value = e[metric];
    if (!e.driver_name || !finite(e.pos_x) || !finite(e.pos_y) || !finite(value)) continue;
    const i = nearestNode(e.pos_x, e.pos_y, nodes);
    if (i < 0) continue;
    let bins = byDriver.get(e.driver_name);
    if (!bins) { bins = nodes.map(() => ({ sum: 0, count: 0 })); byDriver.set(e.driver_name, bins); }
    bins[i].sum += value; bins[i].count++;
  }
  const result: DriverZone[] = [];
  for (const [driverName, bins] of byDriver) {
    let best = -1, bestAvg = -Infinity;
    bins.forEach((bin, i) => {
      if (!bin.count) return;
      const avg = bin.sum / bin.count;
      if (avg > bestAvg) { bestAvg = avg; best = i; }
    });
    if (best >= 0) result.push({ driverName, referencePoint: nearestReferencePoint(best, nodes.length), avgValue: bestAvg });
  }
  return result.sort((a, b) => b.avgValue - a.avgValue);
}

export function brakingHotspotsByDriver(events: Telemetry[], nodes: number[][]): DriverZone[] { return hotspotsByDriver(events, nodes, 'brake_pct'); }
export function accelerationHotspotsByDriver(events: Telemetry[], nodes: number[][]): DriverZone[] { return hotspotsByDriver(events, nodes, 'acceleration_g'); }

export interface LapConsistency { driverName: string; stdDevSeconds: number; laps: number; }

// Desvio padrão do tempo de volta por piloto, menor primeiro (mais
// consistente). Exige pelo menos 2 voltas no período — desvio de uma volta só
// não diz nada. Agrupa por nome, não por sessão: o ponto é "este piloto",
// atravessando reinícios do coletor, igual ao applyLapResults.
export function lapConsistency(laps: Telemetry[]): LapConsistency[] {
  const byDriver = new Map<string, number[]>();
  for (const lap of laps) {
    if (!finite(lap.last_lap_s) || lap.last_lap_s <= 0 || !lap.driver_name) continue;
    const times = byDriver.get(lap.driver_name);
    if (times) times.push(lap.last_lap_s); else byDriver.set(lap.driver_name, [lap.last_lap_s]);
  }
  const result: LapConsistency[] = [];
  for (const [driverName, times] of byDriver) {
    if (times.length < 2) continue;
    const mean = times.reduce((a, b) => a + b, 0) / times.length;
    const variance = times.reduce((a, b) => a + (b - mean) ** 2, 0) / times.length;
    result.push({ driverName, stdDevSeconds: Math.sqrt(variance), laps: times.length });
  }
  return result.sort((a, b) => a.stdDevSeconds - b.stdDevSeconds);
}
