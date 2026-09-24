import React, { useEffect, useMemo, useState } from 'react';
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
import { type Driver, type Telemetry, finite, lapTime, number, summarize, driverKey, parseEvents, mergeTelemetry } from './racing';
import './racing.css';
import './strato-theme.css';

const capture = parseEvents(captureData);
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
const QUERY_OTEL = `fetch logs
| filter event.type == "racing.telemetry"
| filter isNull(track_name) or track_name == "Interlagos"
| fields ${FIELDS}
| sort timestamp desc
| limit 10000`;

const columns: DataTableColumnDef<Driver>[] = [
  { id: 'driver', header: 'Piloto', accessor: 'driver_name', minWidth: 105 },
  { id: 'source', header: 'Origem', accessor: row => row.source === 'demo' ? 'Simulado' : row.source === 'replay' ? 'Captura' : 'Telemetria', minWidth: 90 },
  { id: 'company', header: 'Empresa', accessor: row => row.company_name ?? 'Não informada', minWidth: 115 },
  { id: 'car', header: 'Carro utilizado', accessor: () => 'Porsche 911', minWidth: 120 },
  { id: 'best', header: 'Melhor volta', accessor: 'best', alignment: 'right', minWidth: 110, cell: ({rowData}) => <>{lapTime(rowData.best)}</> },
  { id: 'speed', header: 'km/h', accessor: 'speed_kmh', alignment: 'right', minWidth: 70, cell: ({rowData}) => <>{number(rowData.speed_kmh, 1)}</> },
  { id: 'accel', header: 'Aceleração (g)', accessor: 'acceleration_g', alignment: 'right', minWidth: 120, cell: ({rowData}) => <>{number(rowData.acceleration_g, 2)}</> },
  { id: 'gear', header: 'Marcha', accessor: 'gear', alignment: 'right', minWidth: 80 },
  { id: 'brake', header: 'Freio (%)', accessor: 'brake_pct', alignment: 'right', minWidth: 88 },
  { id: 'position', header: 'Posição X / Y', accessor: row => `${number(row.pos_x, 1)} / ${number(row.pos_y, 1)}`, alignment: 'right', minWidth: 125 },
  { id: 'lap', header: 'Volta', accessor: 'lap_number', alignment: 'right', minWidth: 70 },
  { id: 'time', header: 'Tempo atual', accessor: row => lapTime(row.lap_time_s), alignment: 'right', minWidth: 108 },
  { id: 'rank', header: 'Posição na corrida', accessor: 'lap_race_position', alignment: 'right', minWidth: 145 },
];

function Stat({label, value, unit}: {label: string; value: string; unit?: string}) {
  return <div className="stat"><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>;
}

export const Dashboard = () => {
  const [mode, setMode] = useState(isLocal ? 'stream' : 'live');
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState('all');
  const [timeframe, setTimeframe] = useState({from:'now()-7d',to:'now()'});
  const [queryTime, setQueryTime] = useState(Date.now());
  const bounds = useMemo(() => ({from:parseTimeAsTimeValue(timeframe.from, queryTime)?.absoluteDate, to:parseTimeAsTimeValue(timeframe.to, queryTime)?.absoluteDate}), [timeframe, queryTime]);
  useEffect(() => {if (mode !== 'live' || timeframe.to !== 'now()') return; const timer = window.setInterval(() => setQueryTime(Date.now()), 30000); return () => window.clearInterval(timer);}, [mode,timeframe.to]);
  const stream = useLocalTelemetry(mode === 'stream');
  const liveEnabled = mode === 'live' && Boolean(bounds.from && bounds.to);
  const live = useDql<Telemetry>({ query: QUERY, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:bounds.from, defaultTimeframeEnd:bounds.to }, { enabled: liveEnabled });
  const liveOtel = useDql<Telemetry>({ query: QUERY_OTEL, maxResultRecords:10000, maxResultBytes:10000000, defaultTimeframeStart:bounds.from, defaultTimeframeEnd:bounds.to }, { enabled: liveEnabled });
  useEffect(() => {
    if (!playing || mode !== 'capture') return;
    const timer = window.setInterval(() => setCursor(v => Math.min(capture.length, v + 20)), 250);
    return () => window.clearInterval(timer);
  }, [playing, mode]);
  useEffect(() => { if (cursor >= capture.length) setPlaying(false); }, [cursor]);
  const events = useMemo(() => mode === 'stream' ? stream.events : mode === 'capture' ? capture.slice(0, cursor) : mergeTelemetry(parseEvents(live.data?.records), parseEvents(liveOtel.data?.records)), [mode, cursor, live.data, liveOtel.data, stream.events]);
  const drivers = useMemo(() => summarize(events), [events]);
  const filtered = useMemo(() => selected === 'all' ? events : events.filter(e => driverKey(e) === selected), [events, selected]);
  const focus = selected === 'all' ? drivers[0] : drivers.find(d => d.key === selected);
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
  const changeMode = (value: string | null) => { if (value) { setMode(value); setQueryTime(Date.now()); setPlaying(false); setSelected('all'); if (value === 'capture') setCursor(0); } };

  return <main className="racing-app" style={{color: Colors.Text.Neutral.Default, background: Colors.Background.Base.Default}}>
    <header className="app-heading">
      <div className="identity"><img src="./assets/racing-logo.png" alt="Logo Dynatrace Hackathon Racing" /><div><span className="eyebrow">DYNATRACE · LIVE EXPERIENCE</span><Heading level={1}>Hackathon Racing</Heading><p>Da pista aos dados. Cada curva conta.</p></div></div>
      <div className="status"><span className={`status-dot ${(mode === 'stream' && stream.running) || (mode === 'live' && events.length) ? 'active' : ''}`}/>{mode === 'stream' ? stream.error ? 'Gerador desconectado' : stream.running ? 'Recebendo eventos do script' : events.length ? 'Simulação pausada ou concluída' : 'Pronto para iniciar' : mode === 'capture' ? 'Captura real · 19 set 2026' : liveLoading ? 'Consultando período' : events.length ? 'Dados do Grail' : 'Sem eventos no período'}</div>
    </header>
    <section className="toolbar" aria-label="Controles da corrida">
      <Flex alignItems="center" gap={12} flexWrap="wrap">
        <Select aria-label="Fonte dos dados" value={mode} onChange={changeMode}><Select.Content>{isLocal && <Select.Option value="stream">Script · tempo real</Select.Option>}<Select.Option value="capture">Replay da captura</Select.Option><Select.Option value="live">Grail · histórico e ao vivo</Select.Option></Select.Content></Select>
        {mode === 'live' && <TimeframeSelector aria-label="Período dos eventos" value={timeframe} onChange={value => {if (value) {setTimeframe({from:value.from.value,to:value.to.value});setQueryTime(Date.now());setSelected('all');}}} />}
        <Select aria-label="Piloto e sessão" value={selected} onChange={v => setSelected(v ?? 'all')}><Select.Content><Select.Option value="all">Todos os pilotos</Select.Option>{drivers.map(d => <Select.Option key={d.key} value={d.key}>{d.driver_name} · {d['rig.id']}</Select.Option>)}</Select.Content></Select>
      </Flex>
      <Flex alignItems="center" gap={8}>
        {mode === 'stream' ? <><span className="muted">{stream.speed}× · demonstração local</span><Button variant="emphasized" loading={stream.busy} disabled={Boolean(stream.error)} onClick={() => {setSelected('all');void stream.command(stream.running ? 'pause' : !events.length || events.length >= stream.total ? 'start' : 'resume');}}>{stream.running ? 'Pausar' : !events.length ? 'Iniciar simulação' : events.length >= stream.total ? 'Repetir volta' : 'Continuar'}</Button><Button disabled={stream.busy || !events.length} onClick={() => {setSelected('all');void stream.command('reset');}}>Limpar pista</Button></> : mode === 'capture' ? <><span className="muted">Replay 4×</span><Button onClick={() => { if (cursor >= capture.length) setCursor(0); setPlaying(!playing); }} variant="emphasized">{playing ? 'Pausar replay' : !cursor || cursor === capture.length ? 'Reproduzir captura' : 'Continuar replay'}</Button><Button onClick={() => {setCursor(0);setPlaying(false);setSelected('all');}}>Limpar pista</Button></> : <Button onClick={() => { if (timeframe.to === 'now()') setQueryTime(Date.now()); else { void live.refetch(); void liveOtel.refetch(); } }} loading={liveLoading}>Atualizar</Button>}
      </Flex>
    </section>
    {mode === 'stream' && stream.error && <div className="notice error" role="alert">O script local não está conectado. Execute <code>python replay_server.py</code> na raiz do repositório. A pista mantém os últimos dados recebidos até a conexão voltar.</div>}
    {mode === 'stream' && events.some(e => e.source === 'demo') && <div className="notice" role="status">Demonstração: piloto da captura + Bruno Lima / Dynatrace, Joãozinho / Bradesco e Agnes / Caixa simulados. Tempos e empresas desses três pilotos são dados de teste.</div>}
    {mode === 'live' && live.error && <div className="notice error" role="alert">Não foi possível consultar a telemetria: {live.error.message}. Verifique o acesso a business events e tente atualizar.</div>}
    {mode === 'live' && !liveLoading && !live.error && !events.length && <div className="notice" role="status">Nenhum evento racing.telemetry de Interlagos foi encontrado no período selecionado. Amplie o intervalo ou confira a ingestão. Os eventos do script local não são enviados ao Grail.</div>}
    {mode === 'live' && !live.error && liveOtel.error && <div className="notice" role="status">A fonte OTel (logs do collector do rig) não respondeu: {liveOtel.error.message}. O painel segue mostrando os business events. Confira o escopo <code>storage:logs:read</code> e se o collector do rig está de pé.</div>}
    {mode === 'live' && events.length >= 10000 && <div className="notice">Exibindo os 10.000 eventos mais recentes. O mapa e os indicadores representam essa amostra.</div>}
    <div className="hero-grid">
      <section className="panel track-panel">
        <div className="panel-heading"><div><span className="eyebrow">AUTÓDROMO JOSÉ CARLOS PACE</span><Heading level={2}>Interlagos <span className="track-country">BR</span></Heading></div><span className="track-distance">4,295 <small>km</small></span></div>
        <div className="metric-tabs mixed-legend" aria-label="Legenda do mapa combinado"><span><i className="legend-dot speed_kmh"/>Velocidade</span><span><i className="legend-dot brake_pct"/>Frenagem</span><span><i className="legend-dot acceleration_g"/>Aceleração</span></div>
        <TrackMap events={filtered} />
        <div className="map-footer"><div><span className="eyebrow">MAPA DE CALOR COMBINADO</span><p className="muted">Azul: velocidade · vermelho: freio · verde: aceleração em g.<br/>Mistura por intensidade relativa. Cinza: sem dados.</p></div><span className="muted">{filtered.length ? `${number(filtered.length)} eventos recebidos` : 'Pista cinza · aguardando eventos'}</span></div>
        {mode === 'stream' && stream.running && <progress aria-label="Progresso da simulação" max={stream.total} value={events.length}/>}
        {playing && <progress aria-label="Progresso do replay" max={capture.length} value={cursor}/>}
      </section>
      <div className="driver-column">
        <section className="panel driver-card"><div className="panel-heading"><span className="eyebrow">{focus?.best ? 'PILOTO EM DESTAQUE' : 'PILOTO NA PISTA'}</span><span className="small-tag">{focus?.company_name ?? 'Empresa não informada'}</span></div><div className="driver-title"><span className="driver-avatar">{focus?.driver_name?.slice(0,2).toUpperCase() ?? '—'}</span><div><Heading level={2}>{focus?.driver_name ?? 'Aguardando piloto'}</Heading><p>Porsche 911</p><p className="muted">Telemetria: {focus?.car_name ?? 'aguardando identificação do simulador'}</p></div></div><div className="driver-bottom"><span>{focus?.['rig.id'] ?? 'Sem simulador'}</span><span>Posição na corrida <b>{number(focus?.lap_race_position)}</b></span></div></section>
        <section className="panel telemetry-panel"><div className="panel-heading"><Heading level={3}>Telemetria do piloto</Heading><span className="muted">{mode === 'live' ? 'Última leitura no período' : 'Dados de demonstração'}</span></div><div className="stats-grid"><Stat label="Velocidade" value={number(focus?.speed_kmh,1)} unit="km/h"/><Stat label="Aceleração" value={number(focus?.acceleration_g,2)} unit="g"/><Stat label="Marcha" value={focus?.gear === -1 ? 'R' : focus?.gear === 0 ? 'N' : number(focus?.gear)}/><Stat label="Frenagem" value={number(focus?.brake_pct)} unit="%"/><Stat label="Volta atual" value={number(focus?.lap_number)}/><Stat label="Tempo de volta" value={lapTime(focus?.lap_time_s)}/></div><div className="coordinate-row"><span>Posição na pista</span><code>X {number(focus?.pos_x,1)} <span> / </span> Y {number(focus?.pos_y,1)}</code></div><div className="coordinate-row"><span>Última volta registrada</span><strong>{lapTime(focus?.last_lap_s)}</strong></div></section>
      </div>
    </div>
    <div className="section-title"><Heading level={2}>Disputa entre empresas</Heading><span className="muted">Classificação pela melhor volta registrada</span></div>
    <section className="podium" aria-label="Ranking de empresas">{[0,1,2].map(i => <div className={`panel company place-${i+1}`} key={i}><span className="place">{String(i+1).padStart(2,'0')}</span><div><strong>{companies[i]?.company_name ?? 'Aguardando empresa'}</strong><p>{companies[i] ? companies[i].driver_name : 'Sem volta concluída associada'}</p></div><b>{lapTime(companies[i]?.best)}</b></div>)}</section>
    <section className="kpis"><div className="panel kpi"><div><span className="eyebrow">VELOCIDADE MÁXIMA</span><p>{mode === 'live' ? 'No período · até 10.000 eventos' : 'Nesta reprodução'}</p></div><strong>{events.length ? number(peak,1) : '—'} <small>km/h</small></strong><div className="kpi-line blue"/></div><div className="panel kpi"><div><span className="eyebrow">MELHOR VOLTA REGISTRADA</span><p>{best ? `${best.driver_name} · ${best.bestSource === 'simulator' ? 'informada pelo simulador' : 'calculada das voltas concluídas'}` : 'Aguardando uma volta concluída'}</p></div><strong>{lapTime(best?.best)}</strong><div className="kpi-line purple"/></div></section>
    <section className="panel leaderboard"><div className="panel-heading"><div><span className="eyebrow">CLASSIFICAÇÃO</span><Heading level={2}>Top 10 pilotos</Heading></div><span className="small-tag">{drivers.length} {drivers.length === 1 ? 'participação' : 'participações'}</span></div><p className="muted">Melhores tempos registrados primeiro. Cálculo local exige início e fechamento da volta, sem invalidação nas amostras recebidas.</p><DataTable data={drivers.slice(0,10)} columns={columns} fullWidth loading={mode === 'live' && liveLoading}><DataTable.EmptyState>Esperando os primeiros pilotos entrarem na pista.</DataTable.EmptyState></DataTable></section>
    <footer className="page-footer"><span>Dynatrace Hackathon Racing</span><span>{mode === 'stream' ? 'Fonte: script local · captura e pilotos simulados identificados · sem ingestão' : mode === 'capture' ? 'Fonte: captura UDP real do Automobilista 2 · replay local, sem ingestão' : 'Fonte: Grail · racing.telemetry · período selecionado · intervalos até agora atualizam a cada 30 segundos'}</span></footer>
  </main>;
};
