import test from 'node:test';
import assert from 'node:assert/strict';
import { trackHeat, summarize, lapTime, parseEvents, mixedHeatColor, mergeTelemetry, applyLapResults, trails, sampleAt, advancePlayback } from '../ui/app/racing.ts';
const sample = {timestamp: '2026-09-19T00:00:00Z', driver_name:'Pilot', car_name:'Formula', 'rig.id':'1', 'session.id':'s1', speed_kmh:100, acceleration_g:1, gear:3, brake_pct:0, pos_x:0, pos_y:0, lap_time_s:10, best_lap_s:null, lap_number:1, lap_race_position:1};
test('average per spatial bin is independent of dwell count and ignores invalid positions', () => {
  assert.equal(trackHeat([sample, {...sample,speed_kmh:200}], 'speed_kmh',[[0,0]])[0],150);
  assert.deepEqual(trackHeat([{...sample,pos_x:null},{...sample,speed_kmh:NaN}], 'speed_kmh',[[0,0]]),[null]);
});
test('unvisited track stays neutral and distant samples cannot create heat', () => {
  assert.deepEqual(trackHeat([sample,{...sample,pos_x:9999}], 'speed_kmh',[[0,0],[100,100]]),[100,null]);
});
test('malformed events are dropped and missing values stay null', () => {
  assert.deepEqual(parseEvents([{timestamp:'bad'}]),[]);
  assert.equal(parseEvents([{timestamp:sample.timestamp}])[0].speed_kmh,null);
});
test('teleport and crash frames never become the peak speed', () => {
  assert.equal(parseEvents([{...sample,speed_kmh:579.4}])[0].speed_kmh,null);
  assert.equal(parseEvents([{...sample,speed_kmh:-5}])[0].speed_kmh,null);
  assert.equal(parseEvents([{...sample,speed_kmh:300.6}])[0].speed_kmh,300.6);
  assert.equal(summarize(parseEvents([{...sample,speed_kmh:300.6},{...sample,timestamp:'2026-09-19T00:00:01Z',speed_kmh:579.4}]))[0].peak,300.6);
});
test('curb and crash frames never become the reported g-force', () => {
  assert.equal(parseEvents([{...sample,acceleration_g:105.8}])[0].acceleration_g,null);
  assert.equal(parseEvents([{...sample,acceleration_g:3.23}])[0].acceleration_g,3.23);
});
// O nome do piloto e o carro chegam em pacotes UDP próprios, ~27s depois do
// primeiro quadro. Enquanto não chegam, os dois campos vêm nulos.
test('samples from before the name and car arrive belong to the same driver', () => {
  const warmup = {...sample, driver_name:null, car_name:null};
  const running = {...sample, timestamp:'2026-09-19T00:00:30Z'};
  assert.equal(trails([warmup, running]).length, 1, 'uma sessão é um carro só no mapa');
  const result = summarize([warmup, running]);
  assert.equal(result.length, 1);
  assert.equal(result[0].driver_name, 'Pilot');
  assert.equal(result[0].car_name, 'Formula');
});
test('different rigs and different sessions stay separate drivers', () => {
  assert.equal(trails([sample, {...sample,'rig.id':'2'}]).length, 2);
  assert.equal(trails([sample, {...sample,'session.id':'s2'}]).length, 2);
});
test('trails group by driver in time order and skip samples without a position', () => {
  const late = {...sample,timestamp:'2026-09-19T00:00:02Z',pos_x:20};
  const early = {...sample,timestamp:'2026-09-19T00:00:01Z',pos_x:10};
  const other = {...sample,'rig.id':'2',pos_x:99};
  const result = trails([late, early, {...sample,pos_x:null}, other]);
  assert.equal(result.length,2);
  assert.deepEqual(result[0].map(e => e.pos_x),[10,20]);
  assert.deepEqual(result[1].map(e => e.pos_x),[99]);
});
test('playback picks the last sample up to the clock, never the future', () => {
  const trail = [0,1,2,3].map(s => ({...sample,timestamp:`2026-09-19T00:00:0${s}Z`,pos_x:s}));
  const at = s => Date.parse(`2026-09-19T00:00:0${s}Z`);
  assert.equal(sampleAt(trail,at(2)).pos_x,2);
  assert.equal(sampleAt(trail,at(2)+500).pos_x,2);
  assert.equal(sampleAt(trail,at(0)-9000).pos_x,0);
  assert.equal(sampleAt(trail,at(9)).pos_x,3);
});
// Constantes reais do TrackMap: passo de 50 ms, rastro alvo de 8 s.
const STEP = 50, TRAIL = 8000;
test('playback advances one step at a time and never runs past the newest sample', () => {
  assert.equal(advancePlayback(1000, 0, 5000, STEP, TRAIL),1050);
  assert.equal(advancePlayback(4980, 0, 5000, STEP, TRAIL),5000);
  assert.equal(advancePlayback(5000, 0, 5000, STEP, TRAIL),5000);
});
test('playback resyncs when the clock falls outside the loaded block', () => {
  // Aba em segundo plano: o relógio ficou 60 s para trás e precisa voltar ao rastro.
  assert.equal(advancePlayback(40000, 0, 100000, STEP, TRAIL),92000);
  // Troca de período para trás: o relógio está no futuro do bloco.
  assert.equal(advancePlayback(500000, 0, 100000, STEP, TRAIL),92000);
  // Bloco mais curto que o rastro: não dá para recuar antes da primeira amostra.
  assert.equal(advancePlayback(999999, 95000, 100000, STEP, TRAIL),95000);
});
test('playback keeps up with a 5s refresh instead of drifting or stalling', () => {
  // Simula o regime real: consulta a cada 5 s, animação a 20 quadros por segundo.
  let newest = 100000, clock = newest, stalled = 0, resyncs = 0;
  for (let cycle = 0; cycle < 40; cycle++) {
    newest += 5000;
    for (let frame = 0; frame < 5000 / STEP; frame++) {
      const next = advancePlayback(clock, 0, newest, STEP, TRAIL);
      if (next === clock) stalled++;
      if (next < clock) resyncs++;
      clock = next;
    }
  }
  assert.equal(stalled,0,'o carro nunca deve congelar entre consultas');
  assert.equal(resyncs,0,'o regime estável não deve precisar de ressincronização');
  assert.ok(newest - clock <= TRAIL, `o atraso final (${newest-clock}ms) deve caber no rastro`);
});
test('unfinished or last laps never become validated best laps', () => {
  const result = summarize([{...sample,last_lap_s:104.015}]);
  assert.equal(result[0].best,null);
});
test('driver records retain best and latest metrics without mixing sessions', () => {
  const result = summarize([{...sample,timestamp:'2026-09-19T00:00:02Z',speed_kmh:60,best_lap_s:105}, {...sample,best_lap_s:104}, {...sample,'session.id':'s2',best_lap_s:110}]);
  assert.equal(result.length,2);
  assert.equal(result[0].best,104);
  assert.equal(result[0].speed_kmh,60);
});
test('lap formatting carries rounded milliseconds across minute boundaries', () => {
  assert.equal(lapTime(59.9999),'1:00.000');
  assert.equal(lapTime(104.015),'1:44.015');
  assert.equal(lapTime(null),'—');
});

test('completed clean lap is derived only at the finish and labeled', () => {
  const start = {...sample,lap_time_s:0.057,lap_invalidated:false};
  const finish = {...start,timestamp:'2026-09-19T00:01:44Z',lap_number:2,last_lap_s:104.015};
  assert.equal(summarize([start])[0].best,null);
  assert.equal(summarize([start,finish])[0].best,104.015);
  assert.equal(summarize([start,finish])[0].bestSource,'completed');
  assert.equal(summarize([{...start,lap_invalidated:true},finish])[0].best,null);
  assert.equal(summarize([{...start,lap_time_s:30},finish])[0].best,null);
  assert.equal(summarize([{...start,lap_invalidated:null},finish])[0].best,null);
});

test('mixed map preserves empty areas and distinguishes all three signals', () => {
  assert.equal(mixedHeatColor(null,null,null),null);
  assert.equal(mixedHeatColor(300,0,0),'rgb(52, 145, 255)');
  assert.equal(mixedHeatColor(0,100,0),'rgb(245, 69, 75)');
  assert.equal(mixedHeatColor(0,0,3),'rgb(51, 220, 125)');
  assert.notEqual(mixedHeatColor(250,50,2),mixedHeatColor(250,0,2));
});

test('the same sample arriving by bizevents and by otel is counted once', () => {
  const biz = {...sample, 'sample.id':'rig-01|s1|1'};
  const otel = {...biz};
  assert.equal(mergeTelemetry([biz],[otel]).length, 1);
  assert.equal(mergeTelemetry([biz],[{...otel,'sample.id':'rig-01|s1|2'}]).length, 2);
  // rigs diferentes geram sample.id diferente mesmo no mesmo instante
  assert.equal(mergeTelemetry([biz],[{...otel,'sample.id':'rig-02|s1|1'}]).length, 2);
});

test('samples without sample.id never collapse into each other', () => {
  const a = {...sample};
  const b = {...sample, timestamp:'2026-09-19T00:00:01Z'};
  const other = {...sample, 'rig.id':'2'};
  assert.equal(mergeTelemetry([a],[b]).length, 2);
  assert.equal(mergeTelemetry([a],[other]).length, 2);
  assert.equal(mergeTelemetry([a],[{...a}]).length, 1);
  // uma fonte vazia nao interfere na outra
  assert.equal(mergeTelemetry([a,b],[]).length, 2);
  assert.equal(mergeTelemetry([],[a,b]).length, 2);
});

test('completed laps come from their own query, not from the recent-samples window', () => {
  // A janela de 10.000 amostras cobre menos de uma volta com 3 rigs, então a
  // transição de volta quase nunca cai nela e o summarize sozinho dá best=null.
  const semTransicao = summarize([{...sample, lap_number:2, lap_time_s:30, last_lap_s:104.015, lap_invalidated:false}]);
  assert.equal(semTransicao[0].best, null);

  const volta = {...sample, last_lap_s:104.015, lap_invalidated:false};
  const comResultado = applyLapResults(semTransicao, [volta]);
  assert.equal(comResultado[0].best, 104.015);
  assert.equal(comResultado[0].bestSource, 'completed');
});

test('lap results keep the fastest time and never worsen an existing best', () => {
  const base = summarize([{...sample, best_lap_s:99.5}]);
  assert.equal(base[0].best, 99.5);
  // um resultado mais lento não pode substituir o tempo do simulador
  assert.equal(applyLapResults(base, [{...sample, last_lap_s:120}])[0].best, 99.5);
  // um mais rápido, sim
  assert.equal(applyLapResults(base, [{...sample, last_lap_s:95}])[0].best, 95);
  // entre várias voltas, fica a melhor
  const d = summarize([sample]);
  assert.equal(applyLapResults(d, [{...sample,last_lap_s:110},{...sample,last_lap_s:102},{...sample,last_lap_s:107}])[0].best, 102);
});

test('lap results of one driver never leak into another', () => {
  const dois = summarize([sample, {...sample, driver_name:'Outro', 'rig.id':'2'}]);
  const comVolta = applyLapResults(dois, [{...sample, last_lap_s:101}]);
  const porNome = Object.fromEntries(comVolta.map(d => [d.driver_name, d.best]));
  assert.equal(porNome['Pilot'], 101);
  assert.equal(porNome['Outro'], null);
});

test('podium ordering follows the times brought by the lap query', () => {
  const tres = summarize([
    {...sample, driver_name:'A', 'rig.id':'1'},
    {...sample, driver_name:'B', 'rig.id':'2'},
    {...sample, driver_name:'C', 'rig.id':'3'},
  ]);
  const ordenado = applyLapResults(tres, [
    {...sample, driver_name:'A', 'rig.id':'1', last_lap_s:105},
    {...sample, driver_name:'B', 'rig.id':'2', last_lap_s:99},
    {...sample, driver_name:'C', 'rig.id':'3', last_lap_s:112},
  ]);
  assert.deepEqual(ordenado.map(d => d.driver_name), ['B','A','C']);
});
