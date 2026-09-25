import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseTimeAsTimeValue } from '@dynatrace-sdk/units';
import { useDql } from '@dynatrace-sdk/react-hooks';
import { Button } from '@dynatrace/strato-components/buttons';
import { Flex } from '@dynatrace/strato-components/layouts';
import { Heading } from '@dynatrace/strato-components/typography';
import { DataTable, type DataTableColumnDef } from '@dynatrace/strato-components/tables';
import { TimeframeSelector } from '@dynatrace/strato-components/filters';
import { Select } from '@dynatrace/strato-components/forms';
import Colors from '@dynatrace/strato-design-tokens/colors';
import captureData from './data/capture.json';
import { TrackMap } from './TrackMap';
import { useLocalTelemetry } from './useLocalTelemetry';
import { type Driver, type Telemetry, finite, lapTime, number, summarize, driverKey, parseEvents, mergeTelemetry, applyLapResults, backfillIdentity } from './racing';
import './racing.css';
import './strato-theme.css';

// A captura é constante: o preenchimento de identidade roda uma vez, na carga.
const capture = backfillIdentity(parseEvents(captureData));
// O replay não consulta o Grail, então não há período para escolher — mas a
// gravação tem o seu, e escondê-lo fazia o modo parecer quebrado.
const captureWindow = (() => {
  if (!capture.length) return null;
  const times = capture.map(e => Date.parse(e.timestamp));
  const from = new Date(Math.min(...times)), to = new Date(Math.max(...times));
  const seconds = Math.round((to.getTime() - from.getTime()) / 1000);
  const hora = (d: Date) => d.toLocaleTimeString('pt-BR', {hour: '2-digit', minute: '2-digit'});
  return `${from.toLocaleDateString('pt-BR')} · ${hora(from)}–${hora(to)} · ${Math.floor(seconds / 60)}min${String(seconds % 60).padStart(2, '0')}`;
})();
const isLocal = window.location.hostname === 'localhost';
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
// sessão + volta + tempo, cada volta vira uma linha e o limite passa a valer
// milhares de voltas. `min(timestamp)` é o instante em que a volta fechou.
const LAPS = (fonte: string) => `fetch ${fonte}
| filter event.type == "racing.telemetry"
| filter isNotNull(last_lap_s) and last_lap_s > 0
| filter lap_invalidated == false
| filter isNull(track_name) or track_name == "Interlagos"
| summarize {
    timestamp = min(timestamp),
    driver_name = takeAny(driver_name),
    car_name = takeAny(car_name),
    company_name = takeAny(company_name)
  }, by: {\`rig.id\`, \`session.id\`, lap_number, last_lap_s}
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

// Uma linha por volta concluída. `lap_number` é a volta em que o carro ESTAVA
// quando o simulador informou o tempo, então a volta que fechou é a anterior.
const lapColumns: DataTableColumnDef<Telemetry>[] = [
  { id: 'lap', header: 'Volta', accessor: 'lap_number', alignment: 'right', minWidth: 70, sortType: 'number', cell: ({rowData}) => <>{finite(rowData.lap_number) ? number(rowData.lap_number - 1) : '—'}</> },
  { id: 'time', header: 'Tempo', accessor: 'last_lap_s', alignment: 'right', minWidth: 110, sortType: 'number', cell: ({rowData}) => <>{lapTime(rowData.last_lap_s)}</> },
  { id: 'driver', header: 'Piloto', accessor: 'driver_name', minWidth: 105 },
  { id: 'car', header: 'Carro utilizado', accessor: row => row.car_name ?? 'Não informado', minWidth: 160 },
  { id: 'company', header: 'Empresa', accessor: row => row.company_name ?? 'Não informada', minWidth: 115 },
  // Acessor de função, não a string 'rig.id': a tabela leria o ponto como
  // caminho aninhado (row.rig.id) e a coluna sairia vazia.
  { id: 'rig', header: 'Simulador', accessor: row => row['rig.id'], minWidth: 95 },
  { id: 'at', header: 'Concluída em', accessor: row => new Date(row.timestamp).toLocaleString('pt-BR'), alignment: 'right', minWidth: 160, sortType: 'number', sortAccessor: row => Date.parse(row.timestamp) },
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
  const [view, setView] = useState('ranking');
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
  const live = useDql<Telemetry>({ query: QUERY, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:bounds.from, defaultTimeframeEnd:bounds.to }, { enabled: liveEnabled });
  const liveOtel = useDql<Telemetry>({ query: QUERY_OTEL, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:bounds.from, defaultTimeframeEnd:bounds.to }, { enabled: liveEnabled });
  const liveLaps = useDql<Telemetry>({ query: QUERY_LAPS, maxResultRecords:5000, maxResultBytes:5000000, defaultTimeframeStart:lapBounds.from, defaultTimeframeEnd:lapBounds.to }, { enabled: liveEnabled });
  const liveLapsOtel = useDql<Telemetry>({ query: QUERY_LAPS_OTEL, maxResultRecords:5000, maxResultBytes:5000000, defaultTimeframeStart:lapBounds.from, defaultTimeframeEnd:lapBounds.to }, { enabled: liveEnabled });
  useEffect(() => {
    if (!playing || mode !== 'capture') return;
    const timer = window.setInterval(() => setCursor(v => Math.min(capture.length, v + 20)), 250);
    return () => window.clearInterval(timer);
  }, [playing, mode]);
  useEffect(() => { if (cursor >= capture.length) setPlaying(false); }, [cursor]);
  const janela = `${mode}|${timeframe.from}|${timeframe.to}`;
  const liveData = useUltimoResultado(live.data, janela);
  const liveOtelData = useUltimoResultado(liveOtel.data, janela);
  const liveLapsData = useUltimoResultado(liveLaps.data, janela);
  const liveLapsOtelData = useUltimoResultado(liveLapsOtel.data, janela);
  const events = useMemo(() => mode === 'stream' ? backfillIdentity(stream.events) : mode === 'capture' ? capture.slice(0, cursor) : backfillIdentity(mergeTelemetry(parseEvents(liveData?.records), parseEvents(liveOtelData?.records))), [mode, cursor, liveData, liveOtelData, stream.events]);
  const lapResults = useMemo(() => mode === 'live'
    ? mergeTelemetry(parseEvents(liveLapsData?.records), parseEvents(liveLapsOtelData?.records))
    : [], [mode, liveLapsData, liveLapsOtelData]);
  const drivers = useMemo(() => applyLapResults(summarize(events), lapResults), [events, lapResults]);
  const filtered = useMemo(() => selected === 'all' ? events : events.filter(e => driverKey(e) === selected), [events, selected]);
  // Em "Todos os pilotos" o card segue quem está na pista agora, não quem lidera:
  // o pódio e a classificação já respondem "quem é o mais rápido", e o painel ao
  // lado anuncia a última leitura recebida. `drivers` vem ordenado por melhor volta.
  const focus = selected === 'all'
    ? drivers.reduce<Driver | undefined>((recent, d) => !recent || Date.parse(d.timestamp) > Date.parse(recent.timestamp) ? d : recent, undefined)
    : drivers.find(d => d.key === selected);
  // Drill down: uma linha por volta, do piloto selecionado (ou de todos), dentro
  // do período escolhido. A mais recente primeiro.
  const laps = useMemo(() => (selected === 'all' ? lapResults : lapResults.filter(l => driverKey(l) === selected))
    .slice().sort((a,b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)), [lapResults, selected]);
  const best = drivers.find(d => d.best !== null);
  const peak = Math.max(0, ...events.map(e => finite(e.speed_kmh) ? e.speed_kmh : 0));
  const companies = useMemo(() => {
    const map = new Map<string, Driver>();
    for (const d of drivers) if (d.company_name && d.best !== null) {
      const previous = map.get(d.company_name);
      if (!previous || d.best < (previous.best ?? Infinity)) map.set(d.company_name, d);
    }
    return [...map.values()].sort((a,b) => a.best! - b.best!).slice(0,3);
  }, [drivers]);
  const liveLoading = live.isLoading || liveOtel.isLoading;
  const liveLapsLoading = liveLaps.isLoading || liveLapsOtel.isLoading;
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
  const changeMode = (value: string | null) => { if (value) { setMode(value); refresh(); setPlaying(false); setSelected('all'); if (value === 'capture') setCursor(0); } };

  return <main className="racing-app" style={{color: Colors.Text.Neutral.Default, background: Colors.Background.Base.Default}}>
    <header className="app-heading">
      <div className="identity"><img src="./assets/racing-logo.png" alt="Logo Dynatrace Hackathon Racing" /><div><span className="eyebrow">DYNATRACE · LIVE EXPERIENCE</span><Heading level={1}>Hackathon Racing</Heading><p>Da pista aos dados. Cada curva conta.</p></div></div>
      <div className="status-group">
      <div className="status"><span className={`status-dot ${(mode === 'stream' && stream.running) || (mode === 'live' && events.length) ? 'active' : ''}`}/>{mode === 'stream' ? stream.error ? 'Gerador desconectado' : stream.running ? 'Recebendo eventos do script' : events.length ? 'Simulação pausada ou concluída' : 'Pronto para iniciar' : mode === 'capture' ? 'Captura real do Automobilista 2' : liveLoading ? 'Consultando período' : events.length ? 'Dados do Grail' : 'Sem eventos no período'}</div>
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
        <Select aria-label="Fonte dos dados" value={mode} onChange={changeMode}><Select.Content>{isLocal && <Select.Option value="stream">Script · tempo real</Select.Option>}<Select.Option value="capture">Replay da captura</Select.Option><Select.Option value="live">Grail · histórico e ao vivo</Select.Option></Select.Content></Select>
        {mode === 'capture' && captureWindow && <span className="small-tag" aria-label="Período da gravação">{captureWindow}</span>}
        {mode === 'live' && <TimeframeSelector aria-label="Período dos eventos" value={timeframe} onChange={value => {if (value) {setTimeframe({from:value.from.value,to:value.to.value});refresh();setSelected('all');}}} />}
        <Select aria-label="Piloto e sessão" value={selected} onChange={v => setSelected(v ?? 'all')}><Select.Content><Select.Option value="all">Todos os pilotos</Select.Option>{drivers.map(d => <Select.Option key={d.key} value={d.key}>{d.driver_name} · {d['rig.id']}</Select.Option>)}</Select.Content></Select>
        {mode === 'live' && <Select aria-label="Detalhamento da tabela" value={view} onChange={v => setView(v ?? 'ranking')}><Select.Content><Select.Option value="ranking">Classificação · Top 10</Select.Option><Select.Option value="laps">Voltas registradas</Select.Option></Select.Content></Select>}
      </Flex>
      <Flex alignItems="center" gap={8}>
        {mode === 'stream' ? <><span className="muted">{stream.speed}× · demonstração local</span><Button variant="emphasized" loading={stream.busy} disabled={Boolean(stream.error)} onClick={() => {setSelected('all');void stream.command(stream.running ? 'pause' : !events.length || events.length >= stream.total ? 'start' : 'resume');}}>{stream.running ? 'Pausar' : !events.length ? 'Iniciar simulação' : events.length >= stream.total ? 'Repetir volta' : 'Continuar'}</Button><Button disabled={stream.busy || !events.length} onClick={() => {setSelected('all');void stream.command('reset');}}>Limpar pista</Button></> : mode === 'capture' ? <><span className="muted">Replay 4×</span><Button onClick={() => { if (cursor >= capture.length) setCursor(0); setPlaying(!playing); }} variant="emphasized">{playing ? 'Pausar replay' : !cursor || cursor === capture.length ? 'Reproduzir captura' : 'Continuar replay'}</Button><Button onClick={() => {setCursor(0);setPlaying(false);setSelected('all');}}>Limpar pista</Button></> : <Button onClick={() => { if (timeframe.to === 'now()') refresh(); else { void live.refetch(); void liveOtel.refetch(); void liveLaps.refetch(); void liveLapsOtel.refetch(); } }} loading={liveLoading}>Atualizar</Button>}
      </Flex>
    </section>
    {mode === 'stream' && stream.error && <div className="notice error" role="alert">O script local não está conectado. Execute <code>python replay_server.py</code> na raiz do repositório. A pista mantém os últimos dados recebidos até a conexão voltar.</div>}
    {mode === 'stream' && events.some(e => e.source === 'demo') && <div className="notice" role="status">Demonstração: piloto da captura + Bruno Lima / Dynatrace, Joãozinho / Bradesco e Agnes / Caixa simulados. Tempos e empresas desses três pilotos são dados de teste.</div>}
    {mode === 'live' && live.error && <div className="notice error" role="alert">Não foi possível consultar a telemetria: {live.error.message}. Verifique o acesso a business events e tente atualizar.</div>}
    {mode === 'live' && !liveLoading && !live.error && !events.length && <div className="notice" role="status">Nenhum evento racing.telemetry de Interlagos foi encontrado no período selecionado. Amplie o intervalo ou confira a ingestão. Os eventos do script local não são enviados ao Grail.</div>}
    {mode === 'live' && liveLaps.error && <div className="notice error" role="alert">Não foi possível consultar as voltas concluídas: {liveLaps.error.message}. O pódio "Disputa entre empresas" e a lista de voltas ficam vazios até isso ser resolvido.</div>}
    {mode === 'live' && !live.error && liveOtel.error && <div className="notice" role="status">A fonte OTel (logs do collector do rig) não respondeu: {liveOtel.error.message}. O painel segue mostrando os business events. Confira o escopo <code>storage:logs:read</code> e se o collector do rig está de pé.</div>}
    {mode === 'live' && events.length >= 10000 && <div className="notice">Exibindo os 10.000 eventos mais recentes. O mapa e os indicadores representam essa amostra.</div>}
    <div className="hero-grid">
      <section className="panel track-panel">
        <div className="panel-heading"><div><span className="eyebrow">AUTÓDROMO JOSÉ CARLOS PACE</span><Heading level={2}>Interlagos <span className="track-country">BR</span></Heading></div><span className="track-distance">4,295 <small>km</small></span></div>
        <div className="metric-tabs mixed-legend" aria-label="Legenda do mapa combinado"><span><i className="legend-dot speed_kmh"/>Velocidade</span><span><i className="legend-dot brake_pct"/>Frenagem</span><span><i className="legend-dot acceleration_g"/>Aceleração</span></div>
        <TrackMap events={filtered} carName={focus?.car_name} animate={mode === 'live'} />
        <div className="map-footer"><div><span className="eyebrow">MAPA DE CALOR COMBINADO</span><p className="muted">Azul: velocidade · vermelho: freio · verde: aceleração em g.<br/>Mistura por intensidade relativa. Cinza: sem dados.</p></div><span className="muted">{filtered.length ? `${number(filtered.length)} eventos recebidos` : 'Pista cinza · aguardando eventos'}</span></div>
        {mode === 'stream' && stream.running && <progress aria-label="Progresso da simulação" max={stream.total} value={events.length}/>}
        {playing && <progress aria-label="Progresso do replay" max={capture.length} value={cursor}/>}
      </section>
      <div className="driver-column">
        <section className="panel driver-card"><div className="panel-heading"><span className="eyebrow">{focus?.best ? 'PILOTO EM DESTAQUE' : 'PILOTO NA PISTA'}</span><span className="small-tag">{focus?.company_name ?? 'Empresa não informada'}</span></div><div className="driver-title"><span className="driver-avatar">{focus?.driver_name?.slice(0,2).toUpperCase() ?? '—'}</span><div><Heading level={2}>{focus?.driver_name ?? 'Aguardando piloto'}</Heading><p>{focus?.car_name ?? 'Carro não informado'}</p><p className="muted">Telemetria: Automobilista 2</p></div></div><div className="driver-bottom"><span>{focus?.['rig.id'] ?? 'Sem simulador'}</span><span>Posição na corrida <b>{number(focus?.lap_race_position)}</b></span></div></section>
        <section className="panel telemetry-panel"><div className="panel-heading"><Heading level={3}>Telemetria do piloto</Heading><span className="muted">{mode === 'live' ? 'Última leitura no período' : 'Dados de demonstração'}</span></div><div className="stats-grid"><Stat label="Velocidade" value={number(focus?.speed_kmh,1)} unit="km/h"/><Stat label="Aceleração" value={number(focus?.acceleration_g,2)} unit="g"/><Stat label="Marcha" value={focus?.gear === -1 ? 'R' : focus?.gear === 0 ? 'N' : number(focus?.gear)}/><Stat label="Frenagem" value={number(focus?.brake_pct)} unit="%"/><Stat label="Volta atual" value={number(focus?.lap_number)}/><Stat label="Tempo de volta" value={lapTime(focus?.lap_time_s)}/></div><div className="coordinate-row"><span>Posição na pista</span><code>X {number(focus?.pos_x,1)} <span> / </span> Y {number(focus?.pos_y,1)}</code></div><div className="coordinate-row"><span>Última volta registrada</span><strong>{lapTime(focus?.last_lap_s)}</strong></div></section>
      </div>
    </div>
    <div className="section-title"><Heading level={2}>Disputa entre empresas</Heading><span className="muted">Classificação pela melhor volta registrada</span></div>
    <section className="podium" aria-label="Ranking de empresas">{[0,1,2].map(i => <div className={`panel company place-${i+1}`} key={i}><span className="place">{String(i+1).padStart(2,'0')}</span><div><strong>{companies[i]?.company_name ?? 'Aguardando empresa'}</strong><p>{companies[i] ? companies[i].driver_name : 'Sem volta concluída associada'}</p></div><b>{lapTime(companies[i]?.best)}</b></div>)}</section>
    <section className="kpis"><div className="panel kpi"><div><span className="eyebrow">VELOCIDADE MÁXIMA</span><p>{mode === 'live' ? 'No período · até 10.000 eventos' : 'Nesta reprodução'}</p></div><strong>{events.length ? number(peak,1) : '—'} <small>km/h</small></strong><div className="kpi-line blue"/></div><div className="panel kpi"><div><span className="eyebrow">MELHOR VOLTA REGISTRADA</span><p>{best ? `${best.driver_name} · ${best.bestSource === 'simulator' ? 'informada pelo simulador' : 'calculada das voltas concluídas'}` : 'Aguardando uma volta concluída'}</p></div><strong>{lapTime(best?.best)}</strong><div className="kpi-line purple"/></div></section>
    {view === 'laps' && mode === 'live'
      ? <section className="panel leaderboard"><div className="panel-heading"><div><span className="eyebrow">DRILL DOWN</span><Heading level={2}>Voltas registradas</Heading></div><span className="small-tag">{number(laps.length)} {laps.length === 1 ? 'volta' : 'voltas'}</span></div><p className="muted">Todas as voltas válidas concluídas no período selecionado{selected === 'all' ? ', de todos os pilotos' : ', do piloto selecionado'}. Voltas invalidadas pelo simulador não entram. Use o seletor de período para ampliar o histórico.</p><DataTable data={laps} columns={lapColumns} fullWidth loading={liveLapsLoading} sortable><DataTable.Pagination defaultPageSize={20}/><DataTable.EmptyState>Nenhuma volta concluída no período selecionado.</DataTable.EmptyState></DataTable></section>
      : <section className="panel leaderboard"><div className="panel-heading"><div><span className="eyebrow">CLASSIFICAÇÃO</span><Heading level={2}>Top 10 pilotos</Heading></div><span className="small-tag">{drivers.length} {drivers.length === 1 ? 'participação' : 'participações'}</span></div><p className="muted">Melhores tempos registrados primeiro. Cálculo local exige início e fechamento da volta, sem invalidação nas amostras recebidas.</p><DataTable data={drivers.slice(0,10)} columns={columns} fullWidth sortable loading={mode === 'live' && liveLoading}><DataTable.EmptyState>Esperando os primeiros pilotos entrarem na pista.</DataTable.EmptyState></DataTable></section>}
    <footer className="page-footer"><span>Dynatrace Hackathon Racing</span><span>{mode === 'stream' ? 'Fonte: script local · captura e pilotos simulados identificados · sem ingestão' : mode === 'capture' ? 'Fonte: captura UDP real do Automobilista 2 · replay local, sem ingestão' : 'Fonte: Grail · racing.telemetry · período selecionado · intervalos até agora atualizam a cada 30 segundos'}</span></footer>
  </main>;
};
