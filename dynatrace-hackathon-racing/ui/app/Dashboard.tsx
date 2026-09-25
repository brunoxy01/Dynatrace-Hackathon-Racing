import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseTimeAsTimeValue } from '@dynatrace-sdk/units';
import { useDql } from '@dynatrace-sdk/react-hooks';
import { Button } from '@dynatrace/strato-components/buttons';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading } from '@dynatrace/strato-components/typography';
import { DataTable, type DataTableColumnDef } from '@dynatrace/strato-components/tables';
import { TimeframeSelector } from '@dynatrace/strato-components/filters';
import { Select } from '@dynatrace/strato-components/forms';
import { Tabs, Tab } from '@dynatrace/strato-components/navigation';
import Colors from '@dynatrace/strato-design-tokens/colors';
import { TrackMap } from './TrackMap';
import { useLocalTelemetry } from './useLocalTelemetry';
import { type Driver, type Telemetry, finite, lapTime, number, summarize, driverKey, parseEvents, mergeTelemetry, applyLapResults, backfillIdentity, lapWindow, dedupeLaps, rankDrivers } from './racing';
import './racing.css';
import './strato-theme.css';

const isLocal = window.location.hostname === 'localhost';
// As três telas do painel. O script local é uma quarta aba só em desenvolvimento:
// usa a mesma tela do ao vivo, alimentada pelo replay_server em vez do Grail.
const TABS = [
  {id: 'live', title: 'Ao vivo'},
  {id: 'history', title: 'Histórico'},
  {id: 'replay', title: 'Replay'},
  {id: 'stream', title: 'Script local'},
];
const FIELDS = `timestamp, source, driver_name, car_name, rig.id, session.id, sample.id, company_name, speed_kmh, acceleration_g, gear, brake_pct, pos_x, pos_y, lap_time_s, best_lap_s, last_lap_s, lap_invalidated, lap_number, lap_race_position`;
// Duas fontes independentes para a mesma telemetria: a API de business events
// (ams2_collector.py --sink bizevents) e os logs OTLP que o OTel Collector do rig
// entrega (--sink otlp). Queries separadas de propósito: se o pipeline OTel ainda
// não estiver de pé, a consulta de bizevents continua respondendo sozinha.
const QUERY = `fetch bizevents
| filter event.type == "racing.telemetry"
| filter isNull(track_name) or track_name == "Interlagos"
| fields ${FIELDS}
| sort timestamp desc
| limit 10000`;
// Voltas concluídas, agregadas no Grail em vez de recortadas pela janela de
// 10.000 amostras. O simulador repete o mesmo `last_lap_s` em TODOS os quadros
// da volta seguinte — a 20 Hz são ~2.000 linhas idênticas por volta, e sem o
// summarize o limite de 5.000 cobria só duas voltas e meia. Agrupando por
// sessão + tempo, cada volta vira uma linha e o limite passa a valer milhares
// de voltas. `min(timestamp)` é o instante em que a volta fechou.
// lap_number NÃO entra na chave: o simulador repete o mesmo `last_lap_s`
// enquanto não fecha uma volta nova, então agrupar por ele criava uma linha
// para cada volta em que o carro passou carregando o mesmo tempo.
const LAPS = (fonte: string) => `fetch ${fonte}
| filter event.type == "racing.telemetry"
| filter isNotNull(last_lap_s) and last_lap_s > 0
| filter lap_invalidated == false
| filter isNull(track_name) or track_name == "Interlagos"
| summarize {
    timestamp = min(timestamp),
    lap_number = min(lap_number),
    driver_name = takeAny(driver_name),
    car_name = takeAny(car_name),
    company_name = takeAny(company_name)
  }, by: {\`rig.id\`, \`session.id\`, last_lap_s}
| sort timestamp desc
| limit 5000`;
const QUERY_LAPS = LAPS('bizevents');
const QUERY_LAPS_OTEL = LAPS('logs');
const QUERY_OTEL = `fetch logs
| filter event.type == "racing.telemetry"
| filter isNull(track_name) or track_name == "Interlagos"
| fields ${FIELDS}
| sort timestamp desc
| limit 10000`;
// Amostras de UMA volta, para reproduzi-la no mapa. A volta é identificada pela
// sessão; a janela de tempo é que a recorta, indo do fechamento para trás pelo
// tempo da volta. A ~20 Hz, uma volta de 100s são ~2.000 amostras.
const LAP_SAMPLES = (fonte: string, rig: string, session: string) => `fetch ${fonte}
| filter event.type == "racing.telemetry"
| filter \`rig.id\` == "${rig}" and \`session.id\` == "${session}"
| fields ${FIELDS}
| sort timestamp asc
| limit 10000`;
// rig.id e session.id vêm do próprio Grail, não de digitação do usuário, mas
// entram concatenados numa consulta: lista branca em vez de confiar na origem.
const dqlSafe = (value: string) => value.replace(/[^A-Za-z0-9._:|-]/g, '');
// Margem nas duas pontas: o "fechamento" é o primeiro quadro que reportou o
// tempo, não o instante exato do cruzamento da linha.
const LAP_MARGIN_MS = 2000;

// A telemetria recarrega rápido para o mapa acompanhar a pista. As voltas
// concluídas não precisam: uma volta em Interlagos leva ~100s, e cada ciclo
// completo custa quatro consultas ao Grail de até 10.000 registros.
const TELEMETRY_REFRESH_MS = 5000;
const LAPS_REFRESH_MS = 30000;

// sortType padrão do DataTable é 'text': sem marcar as colunas numéricas, 10
// viria antes de 9. Onde o accessor devolve texto formatado (tempos de volta,
// data), o sortAccessor entrega o valor cru para a ordenação.
const columns: DataTableColumnDef<Driver>[] = [
  { id: 'driver', header: 'Piloto', accessor: 'driver_name', minWidth: 105 },
  { id: 'source', header: 'Origem', accessor: row => row.source === 'demo' ? 'Simulado' : row.source === 'replay' ? 'Captura' : 'Telemetria', minWidth: 90 },
  { id: 'company', header: 'Empresa', accessor: row => row.company_name ?? 'Não informada', minWidth: 115 },
  { id: 'car', header: 'Carro utilizado', accessor: row => row.car_name ?? 'Não informado', minWidth: 120 },
  { id: 'best', header: 'Melhor volta', accessor: 'best', alignment: 'right', minWidth: 110, sortType: 'number', cell: ({rowData}) => <>{lapTime(rowData.best)}</> },
  { id: 'speed', header: 'km/h', accessor: 'speed_kmh', alignment: 'right', minWidth: 70, sortType: 'number', cell: ({rowData}) => <>{number(rowData.speed_kmh, 1)}</> },
  { id: 'accel', header: 'Aceleração (g)', accessor: 'acceleration_g', alignment: 'right', minWidth: 120, sortType: 'number', cell: ({rowData}) => <>{number(rowData.acceleration_g, 2)}</> },
  { id: 'gear', header: 'Marcha', accessor: 'gear', alignment: 'right', minWidth: 80, sortType: 'number' },
  { id: 'brake', header: 'Freio (%)', accessor: 'brake_pct', alignment: 'right', minWidth: 88, sortType: 'number' },
  { id: 'position', header: 'Posição X / Y', accessor: row => `${number(row.pos_x, 1)} / ${number(row.pos_y, 1)}`, alignment: 'right', minWidth: 125, disableSorting: true },
  { id: 'lap', header: 'Volta', accessor: 'lap_number', alignment: 'right', minWidth: 70, sortType: 'number' },
  { id: 'time', header: 'Tempo atual', accessor: row => lapTime(row.lap_time_s), alignment: 'right', minWidth: 108, sortType: 'number', sortAccessor: row => row.lap_time_s ?? -1 },
  { id: 'rank', header: 'Posição na corrida', accessor: 'lap_race_position', alignment: 'right', minWidth: 145, sortType: 'number' },
];

// Uma linha por volta concluída. Sem coluna de número da volta: o `lap_number`
// do simulador não identifica a volta que fechou — o mesmo tempo persiste por
// várias voltas e sobrevive ao reinício do coletor. O que identifica a volta é
// quem a fez, quanto durou e quando terminou.
const lapColumns: DataTableColumnDef<Telemetry>[] = [
  { id: 'at', header: 'Concluída em', accessor: row => new Date(row.timestamp).toLocaleString('pt-BR'), minWidth: 165, sortType: 'number', sortAccessor: row => Date.parse(row.timestamp) },
  { id: 'driver', header: 'Piloto', accessor: 'driver_name', minWidth: 130 },
  { id: 'time', header: 'Tempo', accessor: 'last_lap_s', alignment: 'right', minWidth: 105, sortType: 'number', cell: ({rowData}) => <>{lapTime(rowData.last_lap_s)}</> },
  { id: 'car', header: 'Carro', accessor: row => row.car_name ?? 'Não informado', minWidth: 160 },
  { id: 'company', header: 'Empresa', accessor: row => row.company_name ?? 'Não informada', minWidth: 130 },
  // Acessor de função, não a string 'rig.id': a tabela leria o ponto como
  // caminho aninhado (row.rig.id) e a coluna sairia vazia.
  { id: 'rig', header: 'Simulador', accessor: row => row['rig.id'], minWidth: 105 },
];

// Tela 2: ranking do período, um piloto por linha, melhor tempo primeiro.
type Ranked = Telemetry & {position: number};
const rankColumns: DataTableColumnDef<Ranked>[] = [
  { id: 'position', header: '#', accessor: 'position', alignment: 'right', minWidth: 55, sortType: 'number', cell: ({rowData}) => <>{String(rowData.position).padStart(2, '0')}</> },
  { id: 'driver', header: 'Piloto', accessor: 'driver_name', minWidth: 150 },
  { id: 'time', header: 'Melhor volta', accessor: 'last_lap_s', alignment: 'right', minWidth: 120, sortType: 'number', cell: ({rowData}) => <>{lapTime(rowData.last_lap_s)}</> },
  { id: 'company', header: 'Empresa', accessor: row => row.company_name ?? 'Não informada', minWidth: 140 },
  { id: 'car', header: 'Carro', accessor: row => row.car_name ?? 'Não informado', minWidth: 170 },
  { id: 'rig', header: 'Simulador', accessor: row => row['rig.id'], minWidth: 105 },
];

// A janela deslizante recalcula o timeframe absoluto a cada 30s. Para o cache do
// useDql isso é uma query NOVA, então `data` volta a ser undefined até a resposta
// chegar — e o painel inteiro pisca (mapa cinza, KPIs em "—", pódio vazio) a cada
// ciclo. Aqui seguramos o último resultado enquanto o próximo não chega. Uma
// resposta vazia de verdade não é undefined, então períodos sem dados continuam
// zerando o painel corretamente. Trocar de período ou de modo limpa na hora.
function useUltimoResultado<T>(atual: T | undefined, chave: string): T | undefined {
  const guardado = useRef<{chave: string; valor: T | undefined}>({chave, valor: undefined});
  if (guardado.current.chave !== chave) guardado.current = {chave, valor: undefined};
  if (atual !== undefined) guardado.current.valor = atual;
  return guardado.current.valor;
}

function Stat({label, value, unit}: {label: string; value: string; unit?: string}) {
  return <div className="stat"><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;
}

export const Dashboard = () => {
  const [mode, setMode] = useState(isLocal ? 'stream' : 'live');
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState('all');
  const [filtroEmpresa, setFiltroEmpresa] = useState('all');
  const [filtroRig, setFiltroRig] = useState('all');
  const [timeframe, setTimeframe] = useState({from:'now()-7d',to:'now()'});
  const [queryTime, setQueryTime] = useState(Date.now());
  const [lapsTime, setLapsTime] = useState(Date.now());
  const refresh = () => {setQueryTime(Date.now());setLapsTime(Date.now());};
  const bounds = useMemo(() => ({from:parseTimeAsTimeValue(timeframe.from, queryTime)?.absoluteDate, to:parseTimeAsTimeValue(timeframe.to, queryTime)?.absoluteDate}), [timeframe, queryTime]);
  const lapBounds = useMemo(() => ({from:parseTimeAsTimeValue(timeframe.from, lapsTime)?.absoluteDate, to:parseTimeAsTimeValue(timeframe.to, lapsTime)?.absoluteDate}), [timeframe, lapsTime]);
  useEffect(() => {
    if (mode !== 'live' || timeframe.to !== 'now()') return;
    const telemetria = window.setInterval(() => setQueryTime(Date.now()), TELEMETRY_REFRESH_MS);
    const voltas = window.setInterval(() => setLapsTime(Date.now()), LAPS_REFRESH_MS);
    return () => {window.clearInterval(telemetria);window.clearInterval(voltas);};
  }, [mode,timeframe.to]);
  const stream = useLocalTelemetry(mode === 'stream');
  const liveEnabled = mode === 'live' && Boolean(bounds.from && bounds.to);
  // A lista de voltas alimenta tanto o drill down do modo ao vivo quanto a
  // escolha da volta a reproduzir, então vale nos dois modos.
  const periodEnabled = mode !== 'stream' && Boolean(lapBounds.from && lapBounds.to);
  const live = useDql<Telemetry>({ query: QUERY, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:bounds.from, defaultTimeframeEnd:bounds.to }, { enabled: liveEnabled });
  const liveOtel = useDql<Telemetry>({ query: QUERY_OTEL, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:bounds.from, defaultTimeframeEnd:bounds.to }, { enabled: liveEnabled });
  const liveLaps = useDql<Telemetry>({ query: QUERY_LAPS, maxResultRecords:5000, maxResultBytes:5000000, defaultTimeframeStart:lapBounds.from, defaultTimeframeEnd:lapBounds.to }, { enabled: periodEnabled });
  const liveLapsOtel = useDql<Telemetry>({ query: QUERY_LAPS_OTEL, maxResultRecords:5000, maxResultBytes:5000000, defaultTimeframeStart:lapBounds.from, defaultTimeframeEnd:lapBounds.to }, { enabled: periodEnabled });

  // Volta escolhida para reproduzir. A janela sai do próprio registro: fecha em
  // `timestamp`, dura `last_lap_s`.
  const [replayLap, setReplayLap] = useState<Telemetry | null>(null);
  const replay = useMemo(() => {
    const janela = replayLap && lapWindow(replayLap, LAP_MARGIN_MS);
    if (!replayLap || !janela) return null;
    return {
      ...janela,
      biz: LAP_SAMPLES('bizevents', dqlSafe(replayLap['rig.id']), dqlSafe(replayLap['session.id'])),
      otel: LAP_SAMPLES('logs', dqlSafe(replayLap['rig.id']), dqlSafe(replayLap['session.id'])),
    };
  }, [replayLap]);
  const replayEnabled = mode === 'replay' && replay !== null;
  const lapBiz = useDql<Telemetry>({ query: replay?.biz ?? QUERY, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:replay?.from, defaultTimeframeEnd:replay?.to }, { enabled: replayEnabled });
  const lapOtel = useDql<Telemetry>({ query: replay?.otel ?? QUERY_OTEL, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:replay?.from, defaultTimeframeEnd:replay?.to }, { enabled: replayEnabled });
  const lapSamples = useMemo(() => replayEnabled
    ? backfillIdentity(mergeTelemetry(parseEvents(lapBiz.data?.records), parseEvents(lapOtel.data?.records)))
        .sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp))
    : [], [replayEnabled, lapBiz.data, lapOtel.data]);
  // Passo tirado das próprias amostras: reproduz em 1× tanto num rig a 20 Hz
  // quanto a 60 Hz, sem depender da frequência configurada no jogo.
  const replayStep = lapSamples.length > 1
    ? Math.max(20, (Date.parse(lapSamples[lapSamples.length-1].timestamp) - Date.parse(lapSamples[0].timestamp)) / lapSamples.length)
    : 50;
  useEffect(() => { if (lapSamples.length) { setCursor(0); setPlaying(true); } }, [lapSamples]);
  useEffect(() => {
    if (!playing || mode !== 'replay' || !lapSamples.length) return;
    const timer = window.setInterval(() => setCursor(v => Math.min(lapSamples.length, v + 1)), replayStep);
    return () => window.clearInterval(timer);
  }, [playing, mode, lapSamples, replayStep]);
  useEffect(() => { if (mode === 'replay' && lapSamples.length && cursor >= lapSamples.length) setPlaying(false); }, [cursor, mode, lapSamples.length]);
  const janela = `${mode}|${timeframe.from}|${timeframe.to}`;
  const liveData = useUltimoResultado(live.data, janela);
  const liveOtelData = useUltimoResultado(liveOtel.data, janela);
  const liveLapsData = useUltimoResultado(liveLaps.data, janela);
  const liveLapsOtelData = useUltimoResultado(liveLapsOtel.data, janela);
  const events = useMemo(() => mode === 'stream' ? backfillIdentity(stream.events) : mode === 'replay' ? lapSamples.slice(0, cursor) : backfillIdentity(mergeTelemetry(parseEvents(liveData?.records), parseEvents(liveOtelData?.records))), [mode, cursor, lapSamples, liveData, liveOtelData, stream.events]);
  const lapResults = useMemo(() => mode === 'stream'
    ? []
    : dedupeLaps(mergeTelemetry(parseEvents(liveLapsData?.records), parseEvents(liveLapsOtelData?.records))), [mode, liveLapsData, liveLapsOtelData]);
  // No replay, o seletor de piloto lista quem correu no PERÍODO — isso vem das
  // voltas, não da telemetria já reproduzida, que é de um piloto só.
  const lapDrivers = useMemo(() => {
    const porPiloto = new Map<string, Telemetry>();
    for (const lap of lapResults) if (!porPiloto.has(driverKey(lap))) porPiloto.set(driverKey(lap), lap);
    return [...porPiloto.values()];
  }, [lapResults]);
  const drivers = useMemo(() => applyLapResults(summarize(events), lapResults), [events, lapResults]);
  // No replay o seletor de piloto filtra a TABELA de voltas; o mapa mostra a
  // volta escolhida inteira, senão trocar o filtro depois de dar play apagaria
  // o carro da pista.
  const filtered = useMemo(() => mode === 'replay' || selected === 'all' ? events : events.filter(e => driverKey(e) === selected), [mode, events, selected]);
  // Em "Todos os pilotos" o card segue quem está na pista agora, não quem lidera:
  // o pódio e a classificação já respondem "quem é o mais rápido", e o painel ao
  // lado anuncia a última leitura recebida. `drivers` vem ordenado por melhor volta.
  const focus = selected === 'all'
    ? drivers.reduce<Driver | undefined>((recent, d) => !recent || Date.parse(d.timestamp) > Date.parse(recent.timestamp) ? d : recent, undefined)
    : drivers.find(d => d.key === selected);
  // Drill down: uma linha por volta, do piloto selecionado (ou de todos), dentro
  // do período escolhido. A mais recente primeiro.
  const laps = useMemo(() => lapResults
    .filter(l => selected === 'all' || driverKey(l) === selected)
    .filter(l => filtroEmpresa === 'all' || (l.company_name ?? 'Não informada') === filtroEmpresa)
    .filter(l => filtroRig === 'all' || l['rig.id'] === filtroRig)
    .sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)), [lapResults, selected, filtroEmpresa, filtroRig]);
  const ranking = useMemo<Ranked[]>(() => rankDrivers(lapResults).map((d,i) => ({...d, position: i+1})), [lapResults]);
  const opcoesEmpresa = useMemo(() => [...new Set(lapResults.map(l => l.company_name ?? 'Não informada'))].sort(), [lapResults]);
  const opcoesRig = useMemo(() => [...new Set(lapResults.map(l => l['rig.id']))].sort(), [lapResults]);
  const best = drivers.find(d => d.best !== null);
  const peak = Math.max(0, ...events.map(e => finite(e.speed_kmh) ? e.speed_kmh : 0));
  // O pódio sai das voltas do período, não da telemetria recente: a janela de
  // amostras cobre menos de um minuto por rig e quase nunca contém uma volta.
  const empresas = useMemo(() => {
    const map = new Map<string, Telemetry>();
    for (const lap of ranking) if (lap.company_name) {
      const previous = map.get(lap.company_name);
      if (!previous || lap.last_lap_s! < previous.last_lap_s!) map.set(lap.company_name, lap);
    }
    return [...map.values()].sort((a,b) => a.last_lap_s! - b.last_lap_s!).slice(0,3);
  }, [ranking]);
  const liveLoading = live.isLoading || liveOtel.isLoading;
  const liveLapsLoading = liveLaps.isLoading || liveLapsOtel.isLoading;
  const lapLoading = lapBiz.isLoading || lapOtel.isLoading;
  // Ticker próprio: o "sem telemetria há Ns" precisa subir sozinho entre as
  // reexecuções da consulta, que só acontecem a cada 30s.
  const [tick, setTick] = useState(0);
  const pulsing = mode === 'live' && timeframe.to === 'now()';
  useEffect(() => {
    if (!pulsing) return;
    const timer = window.setInterval(() => setTick(v => v + 1), 5000);
    return () => window.clearInterval(timer);
  }, [pulsing]);
  // Pulso de tempo real. Calculado a cada render de propósito: depende de
  // Date.now(), então memorizar por `tick` só esconderia a dependência real.
  // São 10.000 iterações no pior caso, abaixo de um milissegundo.
  const pulse = ((): {fresh:number; rigs:number; silentFor:number|null} | null => {
    void tick;
    if (!pulsing) return null;
    const now = Date.now(), window = 60000;
    let newest = 0, fresh = 0;
    const rigs = new Set<string>();
    for (const e of events) {
      const at = Date.parse(e.timestamp);
      if (at > newest) newest = at;
      if (now - at <= window) { fresh++; rigs.add(e['rig.id']); }
    }
    return { fresh, rigs: rigs.size, silentFor: newest ? Math.round((now - newest) / 1000) : null };
  })();
  const changeMode = (value: string) => {
    setMode(value); refresh(); setPlaying(false); setCursor(0); setReplayLap(null);
    setSelected('all'); setFiltroEmpresa('all'); setFiltroRig('all');
  };
  // Colunas do replay: a ação de reproduzir vem antes dos dados da volta.
  const replayColumns = useMemo<DataTableColumnDef<Telemetry>[]>(() => [
    { id: 'play', header: 'Replay', minWidth: 118, disableSorting: true,
      cell: ({rowData}) => <Button onClick={() => setReplayLap(rowData)}>Reproduzir</Button> },
    ...lapColumns,
  ], []);
  const abas = TABS.filter(t => t.id !== 'stream' || isLocal);
  const abaAtual = Math.max(0, abas.findIndex(t => t.id === mode));

  const mapa = (legenda: string, progresso?: React.ReactNode) => <section className="panel track-panel">
    <div className="panel-heading"><div><span className="eyebrow">AUTÓDROMO JOSÉ CARLOS PACE</span><Heading level={2}>Interlagos <span className="track-country">BR</span></Heading></div><span className="track-distance">4,295 <small>km</small></span></div>
    <div className="metric-tabs mixed-legend" aria-label="Legenda do mapa combinado"><span><i className="legend-dot speed_kmh"/>Velocidade</span><span><i className="legend-dot brake_pct"/>Frenagem</span><span><i className="legend-dot acceleration_g"/>Aceleração</span></div>
    <TrackMap events={filtered} carName={focus?.car_name} animate={mode === 'live'} />
    <div className="map-footer"><div><span className="eyebrow">MAPA DE CALOR COMBINADO</span><p className="muted">Azul: velocidade · vermelho: freio · verde: aceleração em g.<br/>Mistura por intensidade relativa. Cinza: sem dados.</p></div><span className="muted">{filtered.length ? `${number(filtered.length)} eventos recebidos` : legenda}</span></div>
    {progresso}
  </section>;

  const painelDoPiloto = (subtitulo: string) => <div className="driver-column">
    <section className="panel driver-card"><div className="panel-heading"><span className="eyebrow">{focus?.best ? 'PILOTO EM DESTAQUE' : 'PILOTO NA PISTA'}</span><span className="small-tag">{focus?.company_name ?? 'Empresa não informada'}</span></div><div className="driver-title"><span className="driver-avatar">{focus?.driver_name?.slice(0,2).toUpperCase() ?? '—'}</span><div><Heading level={2}>{focus?.driver_name ?? 'Aguardando piloto'}</Heading><p>{focus?.car_name ?? 'Carro não informado'}</p><p className="muted">Telemetria: Automobilista 2</p></div></div><div className="driver-bottom"><span>{focus?.['rig.id'] ?? 'Sem simulador'}</span><span>Posição na corrida <b>{number(focus?.lap_race_position)}</b></span></div></section>
    <section className="panel telemetry-panel"><div className="panel-heading"><Heading level={3}>Telemetria do piloto</Heading><span className="muted">{subtitulo}</span></div><div className="stats-grid"><Stat label="Velocidade" value={number(focus?.speed_kmh,1)} unit="km/h"/><Stat label="Aceleração" value={number(focus?.acceleration_g,2)} unit="g"/><Stat label="Marcha" value={focus?.gear === -1 ? 'R' : focus?.gear === 0 ? 'N' : number(focus?.gear)}/><Stat label="Frenagem" value={number(focus?.brake_pct)} unit="%"/><Stat label="Volta atual" value={number(focus?.lap_number)}/><Stat label="Tempo de volta" value={lapTime(focus?.lap_time_s)}/></div><div className="coordinate-row"><span>Posição na pista</span><code>X {number(focus?.pos_x,1)} <span> / </span> Y {number(focus?.pos_y,1)}</code></div><div className="coordinate-row"><span>Última volta registrada</span><strong>{lapTime(focus?.last_lap_s)}</strong></div></section>
  </div>;

  const indicadores = <section className="kpis">
    <div className="panel kpi"><div><span className="eyebrow">VELOCIDADE MÁXIMA</span><p>{mode === 'live' ? 'No período · até 10.000 eventos' : 'Nesta reprodução'}</p></div><strong>{events.length ? number(peak,1) : '—'} <small>km/h</small></strong><div className="kpi-line blue"/></div>
    <div className="panel kpi"><div><span className="eyebrow">MELHOR VOLTA REGISTRADA</span><p>{best ? `${best.driver_name} · ${best.bestSource === 'simulator' ? 'informada pelo simulador' : 'calculada das voltas concluídas'}` : 'Aguardando uma volta concluída'}</p></div><strong>{lapTime(best?.best)}</strong><div className="kpi-line purple"/></div>
  </section>;

  // ---------- Tela 1: ao vivo (e o script local, que é a mesma tela) ----------
  const telaAoVivo = <>
    {mode === 'stream' && stream.error && <div className="notice error" role="alert">O script local não está conectado. Execute <code>python replay_server.py</code> na raiz do repositório. A pista mantém os últimos dados recebidos até a conexão voltar.</div>}
    {mode === 'live' && live.error && <div className="notice error" role="alert">Não foi possível consultar a telemetria: {live.error.message}. Verifique o acesso a business events e tente atualizar.</div>}
    {mode === 'live' && !liveLoading && !live.error && !events.length && <div className="notice" role="status">Nenhum evento racing.telemetry de Interlagos foi encontrado no período selecionado. Amplie o intervalo ou confira a ingestão.</div>}
    {mode === 'live' && !live.error && liveOtel.error && <div className="notice" role="status">A fonte OTel (logs do collector do rig) não respondeu: {liveOtel.error.message}. O painel segue mostrando os business events.</div>}
    {mode === 'live' && events.length >= 10000 && <div className="notice">Exibindo os 10.000 eventos mais recentes. O mapa e os indicadores representam essa amostra.</div>}
    <div className="hero-grid">
      {mapa('Pista cinza · aguardando eventos', mode === 'stream' && stream.running ? <progress aria-label="Progresso da simulação" max={stream.total} value={events.length}/> : undefined)}
      {painelDoPiloto(mode === 'live' ? 'Última leitura no período' : 'Dados de demonstração')}
    </div>
    {indicadores}
    <section className="panel leaderboard"><div className="panel-heading"><div><span className="eyebrow">CLASSIFICAÇÃO</span><Heading level={2}>Top 10 pilotos</Heading></div><span className="small-tag">{drivers.length} {drivers.length === 1 ? 'participação' : 'participações'}</span></div><p className="muted">Quem está na pista agora, pela melhor volta já registrada na sessão.</p><DataTable data={drivers.slice(0,10)} columns={columns} fullWidth sortable loading={mode === 'live' && liveLoading}><DataTable.EmptyState>Esperando os primeiros pilotos entrarem na pista.</DataTable.EmptyState></DataTable></section>
  </>;

  // ---------- Tela 2: histórico ----------
  const telaHistorico = <>
    {liveLaps.error && <div className="notice error" role="alert">Não foi possível consultar as voltas concluídas: {liveLaps.error.message}</div>}
    <section className="panel leaderboard"><div className="panel-heading"><div><span className="eyebrow">CLASSIFICAÇÃO</span><Heading level={2}>Top 10 pilotos</Heading></div><span className="small-tag">{number(ranking.length)} {ranking.length === 1 ? 'piloto' : 'pilotos'}</span></div><p className="muted">Ranking pela menor volta válida concluída no período selecionado. Cada piloto aparece uma vez, com o seu melhor tempo.</p><DataTable data={ranking.slice(0,10)} columns={rankColumns} fullWidth sortable loading={liveLapsLoading}><DataTable.EmptyState>Nenhuma volta concluída no período selecionado.</DataTable.EmptyState></DataTable></section>
    <div className="section-title"><Heading level={2}>Disputa entre empresas</Heading><span className="muted">Classificação pela melhor volta registrada</span></div>
    <section className="podium" aria-label="Ranking de empresas">{[0,1,2].map(i => <div className={`panel company place-${i+1}`} key={i}><span className="place">{String(i+1).padStart(2,'0')}</span><div><strong>{empresas[i]?.company_name ?? 'Aguardando empresa'}</strong><p>{empresas[i] ? empresas[i].driver_name : 'Sem volta concluída associada'}</p></div><b>{lapTime(empresas[i]?.last_lap_s)}</b></div>)}</section>
  </>;

  // ---------- Tela 3: replay ----------
  const telaReplay = <>
    {!replayLap && <div className="notice" role="status">Escolha o período e clique em <b>Reproduzir</b> na volta que quiser ver. Ela roda no mapa em tempo real, com a telemetria do piloto ao lado.</div>}
    {liveLaps.error && <div className="notice error" role="alert">Não foi possível listar as voltas: {liveLaps.error.message}</div>}
    {replayLap && !lapLoading && !lapSamples.length && <div className="notice error" role="alert">A volta foi listada, mas as amostras dela não voltaram do Grail. O período de retenção pode já ter expirado para esse intervalo.</div>}
    <div className="hero-grid">
      {mapa('Pista cinza · escolha uma volta abaixo', playing ? <progress aria-label="Progresso do replay" max={lapSamples.length} value={cursor}/> : undefined)}
      {painelDoPiloto('Quadro atual da volta')}
    </div>
    <section className="panel leaderboard">
      <div className="panel-heading"><div><span className="eyebrow">VOLTAS DO PERÍODO</span><Heading level={2}>Voltas registradas</Heading></div><span className="small-tag">{number(laps.length)} {laps.length === 1 ? 'volta' : 'voltas'}</span></div>
      <Flex alignItems="center" gap={8} flexWrap="wrap">
        <span className="muted">Filtrar por</span>
        <Select aria-label="Filtrar por piloto" value={selected} onChange={v => setSelected(v ?? 'all')}><Select.Content><Select.Option value="all">Todos os pilotos</Select.Option>{lapDrivers.map(l => <Select.Option key={driverKey(l)} value={driverKey(l)}>{l.driver_name ?? 'Piloto sem nome'}</Select.Option>)}</Select.Content></Select>
        <Select aria-label="Filtrar por empresa" value={filtroEmpresa} onChange={v => setFiltroEmpresa(v ?? 'all')}><Select.Content><Select.Option value="all">Todas as empresas</Select.Option>{opcoesEmpresa.map(e => <Select.Option key={e} value={e}>{e}</Select.Option>)}</Select.Content></Select>
        <Select aria-label="Filtrar por simulador" value={filtroRig} onChange={v => setFiltroRig(v ?? 'all')}><Select.Content><Select.Option value="all">Todos os simuladores</Select.Option>{opcoesRig.map(r => <Select.Option key={r} value={r}>{r}</Select.Option>)}</Select.Content></Select>
      </Flex>
      <DataTable data={laps} columns={replayColumns} fullWidth loading={liveLapsLoading} sortable><DataTable.Pagination defaultPageSize={20}/><DataTable.EmptyState>Nenhuma volta concluída no período selecionado. Amplie o intervalo.</DataTable.EmptyState></DataTable>
    </section>
  </>;

  const corpo: Record<string, React.ReactNode> = {live: telaAoVivo, stream: telaAoVivo, history: telaHistorico, replay: telaReplay};

  return <main className="racing-app" style={{color: Colors.Text.Neutral.Default, background: Colors.Background.Base.Default}}>
    <header className="app-heading">
      <div className="identity"><img src="./assets/racing-logo.png" alt="Logo Dynatrace Hackathon Racing" /><div><span className="eyebrow">DYNATRACE · LIVE EXPERIENCE</span><Heading level={1}>Hackathon Racing</Heading><p>Da pista aos dados. Cada curva conta.</p></div></div>
      <div className="status-group">
        {mode !== 'stream' && <TimeframeSelector aria-label="Período dos eventos" value={timeframe} onChange={value => {if (value) {setTimeframe({from:value.from.value,to:value.to.value});refresh();setSelected('all');setReplayLap(null);setCursor(0);setPlaying(false);}}} />}
        <div className="status"><span className={`status-dot ${(mode === 'stream' && stream.running) || (mode === 'live' && events.length) ? 'active' : ''}`}/>{mode === 'stream' ? stream.error ? 'Gerador desconectado' : stream.running ? 'Recebendo eventos do script' : events.length ? 'Simulação pausada ou concluída' : 'Pronto para iniciar' : mode === 'replay' ? replayLap ? `${lapTime(replayLap.last_lap_s)} de ${replayLap.driver_name ?? 'piloto'}` : 'Escolha uma volta para reproduzir' : mode === 'history' ? `${number(ranking.length)} piloto(s) no período` : liveLoading ? 'Consultando período' : events.length ? 'Dados do Grail' : 'Sem eventos no período'}</div>
        {pulse && <div className="status live-pulse" role="status" aria-live="polite" title="Amostras recebidas no último minuto">
          <span className={`status-dot ${pulse.fresh ? 'active beating' : ''}`}/>
          {pulse.fresh
            ? `Ao vivo · ${number(pulse.fresh)} amostras/min · ${pulse.rigs} ${pulse.rigs === 1 ? 'simulador' : 'simuladores'}`
            : pulse.silentFor === null ? 'Aguardando telemetria ao vivo' : `Sem telemetria há ${number(pulse.silentFor)}s`}
        </div>}
      </div>
    </header>
    <section className="toolbar" aria-label="Controles da corrida">
      <Flex alignItems="center" gap={12} flexWrap="wrap">
        {mode === 'live' && <Select aria-label="Piloto e sessão" value={selected} onChange={v => setSelected(v ?? 'all')}><Select.Content><Select.Option value="all">Todos os pilotos</Select.Option>{drivers.map(d => <Select.Option key={d.key} value={d.key}>{d.driver_name ?? 'Piloto sem nome'} · {d['rig.id']}</Select.Option>)}</Select.Content></Select>}
      </Flex>
      <Flex alignItems="center" gap={8}>
        {mode === 'stream' ? <><span className="muted">{stream.speed}× · demonstração local</span><Button variant="emphasized" loading={stream.busy} disabled={Boolean(stream.error)} onClick={() => {setSelected('all');void stream.command(stream.running ? 'pause' : !events.length || events.length >= stream.total ? 'start' : 'resume');}}>{stream.running ? 'Pausar' : !events.length ? 'Iniciar simulação' : events.length >= stream.total ? 'Repetir volta' : 'Continuar'}</Button><Button disabled={stream.busy || !events.length} onClick={() => {setSelected('all');void stream.command('reset');}}>Limpar pista</Button></>
          : mode === 'replay' ? <>{replayLap && <span className="muted">{lapLoading ? 'Carregando a volta…' : `${number(lapSamples.length)} amostras · 1×`}</span>}<Button variant="emphasized" disabled={!lapSamples.length} onClick={() => { if (cursor >= lapSamples.length) setCursor(0); setPlaying(!playing); }}>{playing ? 'Pausar' : cursor && cursor < lapSamples.length ? 'Continuar' : 'Reproduzir de novo'}</Button><Button disabled={!replayLap} onClick={() => {setReplayLap(null);setCursor(0);setPlaying(false);}}>Limpar pista</Button></>
          : <Button onClick={() => { if (timeframe.to === 'now()') refresh(); else { void live.refetch(); void liveOtel.refetch(); void liveLaps.refetch(); void liveLapsOtel.refetch(); } }} loading={liveLoading || liveLapsLoading}>Atualizar</Button>}
      </Flex>
    </section>
    <Tabs selectedIndex={abaAtual} onChange={i => changeMode(abas[i].id)}>
      {abas.map(aba => <Tab key={aba.id} title={aba.title}>{mode === aba.id ? corpo[aba.id] : null}</Tab>)}
    </Tabs>
    <footer className="page-footer"><span>Dynatrace Hackathon Racing</span><span>{mode === 'stream' ? 'Fonte: script local · sem ingestão' : mode === 'replay' ? 'Fonte: Grail · uma volta reproduzida em tempo real a partir das amostras gravadas' : 'Fonte: Grail · racing.telemetry · período selecionado'}</span></footer>
  </main>;
};
