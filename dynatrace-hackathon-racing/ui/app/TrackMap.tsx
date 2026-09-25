import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import Colors from '@dynatrace/strato-design-tokens/colors';
import track from './data/interlagos.json';
import { type Telemetry, mixedHeatColor, number, trackHeat, trails, sampleAt, advancePlayback, driverKey } from './racing';

// Fixed world-to-map transform shared by the reference and live samples.
const project = (x: number, y: number) => ({x: 54 + (y + 486) * .53, y: 40 + (x + 480) * .53});
// Sparse control points and Catmull-Rom curves eliminate the stepped GPS-like edge.
const nodes = track.filter((_, i) => i % 3 === 0);
const points = nodes.map(p => project(p[0],p[1]));
const at = (i: number) => points[(i + points.length) % points.length];
const segments = points.map((p, i) => {
  const prev = at(i-1), next = at(i+1), after = at(i+2);
  return `M${p.x},${p.y} C${p.x+(next.x-prev.x)/6},${p.y+(next.y-prev.y)/6} ${next.x-(after.x-p.x)/6},${next.y-(after.y-p.y)/6} ${next.x},${next.y}`;
});
const start = points[0];
const referencePoints = [0.12,0.28,0.43,0.59,0.73,0.89].map(t => Math.floor(t * points.length));

const PLAYBACK_STEP_MS = 50;
// Quanto o relógio de reprodução anda atrás da amostra mais nova. Precisa cobrir
// o intervalo entre consultas mais a latência de ingestão do Grail; abaixo disso
// a animação alcança o fim do bloco e trava até a próxima consulta chegar.
const PLAYBACK_TRAIL_MS = 8000;

// Caminha pelo bloco de amostras em tempo real; a regra de cada passo (e a
// ressincronização) está em advancePlayback, que é testada à parte.
function usePlaybackClock(oldest: number, newest: number, animate: boolean): number {
  const [at, setAt] = useState(newest);
  const clock = useRef(newest);
  useEffect(() => {
    if (!animate) return;
    const tick = () => {
      const next = advancePlayback(clock.current, oldest, newest, PLAYBACK_STEP_MS, PLAYBACK_TRAIL_MS);
      if (next === clock.current) return;
      clock.current = next;
      setAt(next);
    };
    tick();
    const timer = window.setInterval(tick, PLAYBACK_STEP_MS);
    return () => window.clearInterval(timer);
  }, [animate, oldest, newest]);
  return at;
}

// Os marcadores vivem à parte do TrackMap de propósito: o relógio muda de estado
// 20 vezes por segundo, e o mapa de calor tem ~156 gradientes que não devem ser
// redesenhados nesse ritmo.
function CarMarkers({events, animate}: {events: Telemetry[]; animate: boolean}) {
  const paths = useMemo(() => trails(events), [events]);
  const [oldest, newest] = useMemo(() => paths.length
    ? [Math.min(...paths.map(t => Date.parse(t[0].timestamp))), Math.max(...paths.map(t => Date.parse(t[t.length-1].timestamp)))]
    : [0, 0], [paths]);
  const clock = usePlaybackClock(oldest, newest, animate);
  // Só o Grail entrega em blocos. O script local e o replay da captura já chegam
  // amostra a amostra (e o replay corre a 4×), então ali a posição mais recente
  // já é contínua e um relógio de 1× só atrasaria o carro.
  const at = animate ? clock : newest;
  if (!paths.length) return null;
  return <>{paths.map(trail => {
    const car = sampleAt(trail, at);
    const point = project(car.pos_x!, car.pos_y!);
    return <g key={driverKey(car)} className="car-marker" transform={`translate(${point.x},${point.y})`}><circle className="marker-halo" r="12" fill="#1496ff" opacity=".18"/><circle r="5.5" fill="#fff" stroke="#172936" strokeWidth="2"/><title>{car.driver_name ?? 'Piloto'} · {car.company_name ?? 'Sem empresa'} · {number(car.speed_kmh,1)} km/h</title></g>;
  })}</>;
}

export function TrackMap({events, carName, animate = false}: {events: Telemetry[]; carName?: string | null; animate?: boolean}) {
  const id = useId().replace(/:/g,'');
  const colors = useMemo(() => {
    const speed = trackHeat(events, 'speed_kmh', nodes), brake = trackHeat(events, 'brake_pct', nodes), acceleration = trackHeat(events, 'acceleration_g', nodes);
    return speed.map((v,i) => mixedHeatColor(v,brake[i],acceleration[i]));
  }, [events]);
  // The viewBox is extended to the left (and anchored with xMin) to open room for the car
  // outside the track outline; the outline itself keeps its original place and scale.
  return <svg className="track-map" viewBox="-180 0 860 450" preserveAspectRatio="xMinYMid meet" role="img" aria-label="Mapa de Interlagos com velocidade em azul, frenagem em vermelho e aceleração em verde">
    <defs>{points.map((p,i) => <linearGradient key={i} id={`${id}-heat-${i}`} gradientUnits="userSpaceOnUse" x1={p.x} y1={p.y} x2={at(i+1).x} y2={at(i+1).y}><stop stopColor={colors[i] ?? 'transparent'}/><stop offset="1" stopColor={colors[(i+1)%colors.length] ?? colors[i] ?? 'transparent'}/></linearGradient>)}</defs>
    <path d={segments.join(' ')} fill="none" stroke={Colors.Charts.Categorical.Color05.Default} strokeOpacity=".12" strokeWidth="17" strokeLinecap="round"/>
    <path d={segments.join(' ')} fill="none" stroke={Colors.Charts.Categorical.Color05.Default} strokeOpacity=".75" strokeWidth="6" strokeLinecap="round"/>
    <g fill="none" strokeWidth="5" strokeLinecap="round">{segments.map((d,i) => colors[i] !== null && colors[(i+1)%colors.length] !== null ? <path key={i} d={d} stroke={`url(#${id}-heat-${i})`}/> : null)}</g>
    {referencePoints.map((index,i) => <g key={index}><circle cx={points[index].x} cy={points[index].y} r="4" fill="var(--dt-colors-background-base-default, #202132)" stroke="#e4d6fc" strokeWidth="1.5"/><text x={points[index].x+10} y={points[index].y-10} className="reference-label">{String(i+1).padStart(2,'0')}</text><title>Ponto de referência {i+1} · cores combinadas dos eventos recebidos</title></g>)}
    <g transform={`translate(${start.x},${start.y})`}><path d="M-10 -8 h20 v16 h-20z" fill="white"/><path d="M-10 -8h5v8h-5z M0 -8h5v8h-5z M-5 0h5v8h-5z M5 0h5v8h-5z" fill="#20262e"/><text x="-16" y="-19" className="map-label">LARGADA</text></g>
    <g className="event-car" transform="translate(-184 0)" aria-label={carName ?? 'Carro do simulador'}>
      <image href="./assets/porsche-911.png" x="4" y="346" width="146" height="82" preserveAspectRatio="xMidYMid meet"/>
      <text x="77" y="434" textAnchor="middle" fill="currentColor" fontSize="10" fontWeight="600">{carName ?? 'Carro não informado'}</text>
    </g>
    <CarMarkers events={events} animate={animate}/>
  </svg>;
}
