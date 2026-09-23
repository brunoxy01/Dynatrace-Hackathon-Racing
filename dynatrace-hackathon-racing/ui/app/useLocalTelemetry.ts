import { useCallback, useEffect, useState } from 'react';
import { parseEvents, type Telemetry } from './racing';

const endpoint = 'http://localhost:3001';
type Feed = { generation:number; cursor:number; events:unknown; running:boolean; total:number; emitted:number; speed:number };
function parseFeed(value: unknown): Feed {
  if (!value || typeof value !== 'object') throw new Error('Resposta inválida do gerador');
  const v = value as Record<string, unknown>;
  for (const key of ['generation','cursor','total','emitted','speed']) if (typeof v[key] !== 'number' || !Number.isFinite(v[key])) throw new Error('Resposta inválida do gerador');
  if (!Array.isArray(v.events) || typeof v.running !== 'boolean') throw new Error('Resposta inválida do gerador');
  return v as Feed;
}

export function useLocalTelemetry(enabled: boolean) {
  const [events, setEvents] = useState<Telemetry[]>([]);
  const [running, setRunning] = useState(false);
  const [total, setTotal] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true, generation = -1, cursor = 0;
    let timer: ReturnType<typeof setTimeout>;
    const abort = new AbortController();
    async function poll() {
      try {
        const response = await fetch(`${endpoint}/events?after=${cursor}&generation=${generation}`, { signal:abort.signal, cache:'no-store' });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const packet = parseFeed(await response.json() as unknown);
        if (!alive) return;
        const incoming = parseEvents(packet.events);
        const reset = generation !== packet.generation;
        generation = packet.generation; cursor = packet.cursor;
        if (reset || incoming.length) setEvents(old => reset ? incoming : [...old, ...incoming].slice(-10000));
        setRunning(packet.running);setTotal(packet.total);setSpeed(packet.speed);setError(null);
      } catch (e) {
        if (alive) {setError(e instanceof Error ? e.message : 'Gerador indisponível');setRunning(false);}
      } finally {
        if (alive) timer = setTimeout(() => {void poll();}, 200);
      }
    }
    void poll();
    return () => {alive=false;abort.abort();clearTimeout(timer);};
  }, [enabled,revision]);

  const command = useCallback(async (action:'start'|'pause'|'resume'|'reset') => {
    setBusy(true);
    try {
      const response = await fetch(`${endpoint}/${action}`, {method:'POST',headers:{'Content-Type':'application/json'}});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setRevision(v => v+1);
      if (action === 'start' || action === 'reset') setEvents([]);
    } catch(e) {setError(e instanceof Error ? e.message : 'Falha ao controlar gerador');}
    finally {setBusy(false);}
  }, []);
  return {events,running,total,speed,error,busy,command};
}
