import React, { useId, useMemo } from 'react';
import Colors from '@dynatrace/strato-design-tokens/colors';
import track from './data/interlagos.json';
import { type Metric, type Telemetry, finite, heatColor, metrics, number, trackHeat } from './racing';

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

export function TrackMap({events, metric}: {events: Telemetry[]; metric: Metric}) {
  const id = useId().replace(/:/g,'');
  const values = useMemo(() => trackHeat(events, metric, nodes), [events, metric]);
  const latest = useMemo(() => [...events].sort((a,b) => b.timestamp.localeCompare(a.timestamp)).find(e => finite(e.pos_x) && finite(e.pos_y)), [events]);
  const dot = latest && finite(latest.pos_x) && finite(latest.pos_y) ? project(latest.pos_x, latest.pos_y) : null;
  return <svg className="track-map" viewBox="0 0 680 450" role="img" aria-label={`Mapa de Interlagos com calor suave de ${metrics[metric].label.toLowerCase()} e seis pontos de referência`}>
    <defs>{points.map((p,i) => <linearGradient key={i} id={`${id}-heat-${i}`} gradientUnits="userSpaceOnUse" x1={p.x} y1={p.y} x2={at(i+1).x} y2={at(i+1).y}><stop stopColor={heatColor(values[i] ?? 0,metrics[metric].max)}/><stop offset="1" stopColor={heatColor(values[(i+1)%values.length] ?? values[i] ?? 0,metrics[metric].max)}/></linearGradient>)}</defs>
    <path d={segments.join(' ')} fill="none" stroke={Colors.Charts.Categorical.Color05.Default} strokeOpacity=".12" strokeWidth="17" strokeLinecap="round"/>
    <path d={segments.join(' ')} fill="none" stroke={Colors.Charts.Categorical.Color05.Default} strokeOpacity=".75" strokeWidth="6" strokeLinecap="round"/>
    <g fill="none" strokeWidth="5" strokeLinecap="round">{segments.map((d,i) => values[i] !== null && values[(i+1)%values.length] !== null ? <path key={i} d={d} stroke={`url(#${id}-heat-${i})`}/> : null)}</g>
    {referencePoints.map((index,i) => <g key={index}><circle cx={points[index].x} cy={points[index].y} r="4" fill="var(--dt-colors-background-base-default, #202132)" stroke="#e4d6fc" strokeWidth="1.5"/><text x={points[index].x+10} y={points[index].y-10} className="reference-label">{String(i+1).padStart(2,'0')}</text><title>Ponto de referência {i+1} · {number(values[index],1)} {metrics[metric].unit}</title></g>)}
    <g transform={`translate(${start.x},${start.y})`}><path d="M-10 -8 h20 v16 h-20z" fill="white"/><path d="M-10 -8h5v8h-5z M0 -8h5v8h-5z M-5 0h5v8h-5z M5 0h5v8h-5z" fill="#20262e"/><text x="-16" y="-19" className="map-label">LARGADA</text></g>
    {dot && <g className="car-marker" transform={`translate(${dot.x},${dot.y})`}><circle className="marker-halo" r="12" fill="#1496ff" opacity=".18"/><circle r="5.5" fill="#fff" stroke="#172936" strokeWidth="2"/><title>{latest?.driver_name ?? 'Piloto'} · {number(latest?.speed_kmh,1)} km/h</title></g>}
  </svg>;
}
