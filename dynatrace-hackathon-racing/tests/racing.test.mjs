import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { trackHeat, summarize, lapTime, parseEvents, mixedHeatColor, mergeTelemetry, applyLapResults, trails, sampleAt, advancePlayback, PLAYBACK_TRAIL_MS, inSampleOrder, sampleSeq, sectorTime, trimToLineToLine, startsAtTrackLine, lineCrossings, positionAt, stepLiveClock, liveDelay, lapTimeAt, recentLapResult, topSpeedOf, lapCompletions, TELEMETRY_REFRESH_MS, backfillIdentity, lapWindow, dedupeLaps, lapsByTime, driverPodium, trimToLap, startsAtLine, lapProfile, deltaToReference, nearestReferencePoint, brakingHotspot, accelerationHotspot, topSpeedLocation, lapConsistency, brakingHotspotsByDriver, accelerationHotspotsByDriver, activeDrivers } from '../ui/app/racing.ts';
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
test('lap top speed is parsed with the same teleport cut as live speed', () => {
  assert.equal(parseEvents([{...sample,top_speed_kmh:297.2}])[0].top_speed_kmh,297.2);
  assert.equal(parseEvents([{...sample,top_speed_kmh:579.4}])[0].top_speed_kmh,null);
  assert.equal(parseEvents([sample])[0].top_speed_kmh,null);
});
test('curb and crash frames never become the reported g-force', () => {
  assert.equal(parseEvents([{...sample,acceleration_g:105.8}])[0].acceleration_g,null);
  assert.equal(parseEvents([{...sample,acceleration_g:3.23}])[0].acceleration_g,3.23);
});
// O AMS2 manda pos_x=0,pos_y=0 antes do carro ter posição real (carregando,
// nos boxes) - Interlagos nunca passa perto da origem do mundo, então esse
// par exato vira "sem posição", igual a não ter mandado nada.
test('the (0,0) placeholder position before the car spawns is treated as no position', () => {
  assert.equal(parseEvents([{...sample,pos_x:0,pos_y:0}])[0].pos_x,null);
  assert.equal(parseEvents([{...sample,pos_x:0,pos_y:0}])[0].pos_y,null);
});
test('a real sample on an axis still counts, only the exact (0,0) pair is dropped', () => {
  assert.equal(parseEvents([{...sample,pos_x:0,pos_y:42}])[0].pos_y,42);
  assert.equal(parseEvents([{...sample,pos_x:-12,pos_y:0}])[0].pos_x,-12);
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
// As cinco linhas que apareceram na tela para DUAS voltas reais: o mesmo tempo
// relistado a cada volta em que o carro passou, e de novo após o coletor
// reiniciar (sessão nova).
const registradas = [
  {...sample, 'rig.id':'rig-teste', driver_name:'plinioaugusto01', 'session.id':'s2', last_lap_s:143.067, timestamp:'2026-09-25T11:11:03Z'},
  {...sample, 'rig.id':'rig-teste', driver_name:'plinioaugusto01', 'session.id':'s1', last_lap_s:97.400,  timestamp:'2026-09-25T11:00:57Z'},
  {...sample, 'rig.id':'rig-teste', driver_name:'plinioaugusto01', 'session.id':'s1', last_lap_s:143.067, timestamp:'2026-09-25T11:07:41Z'},
  {...sample, 'rig.id':'rig-teste', driver_name:'plinioaugusto01', 'session.id':'s1', last_lap_s:97.400,  timestamp:'2026-09-25T11:07:15Z'},
  {...sample, 'rig.id':'rig-teste', driver_name:'plinioaugusto01', 'session.id':'s1', last_lap_s:143.067, timestamp:'2026-09-25T11:08:59Z'},
];
test('a lap time relisted across laps and sessions counts once', () => {
  const unicas = dedupeLaps(registradas);
  assert.equal(unicas.length, 2);
  assert.deepEqual(unicas.map(l => l.last_lap_s).sort((a,b) => a-b), [97.400, 143.067]);
  // Fica o instante em que a volta fechou de verdade, não a relistagem tardia.
  assert.equal(unicas.find(l => l.last_lap_s === 143.067).timestamp, '2026-09-25T11:07:41Z');
});
test('same lap time by different drivers or rigs stays separate', () => {
  const outro = {...registradas[0], driver_name:'Outro'};
  const outroRig = {...registradas[0], 'rig.id':'rig-02'};
  assert.equal(dedupeLaps([registradas[0], outro, outroRig]).length, 3);
});
test('ranking is one row per lap, fastest first, not one per driver', () => {
  const rivais = [...registradas, {...sample, 'rig.id':'rig-02', driver_name:'Ana', last_lap_s:95.1, timestamp:'2026-09-25T11:05:00Z'}];
  const rank = lapsByTime(dedupeLaps(rivais));
  // Duas voltas do Plinio + uma da Ana: o piloto rápido ocupa mais de uma linha.
  assert.deepEqual(rank.map(l => [l.driver_name, l.last_lap_s]),
    [['Ana', 95.1], ['plinioaugusto01', 97.4], ['plinioaugusto01', 143.067]]);
});
test('ranking drops laps without a usable time', () => {
  assert.equal(lapsByTime([{...sample, last_lap_s:null}, {...sample, last_lap_s:0}]).length, 0);
});
test('driver podium takes the fastest lap of each driver, not the first one listed', () => {
  // O caso relatado: o Bruno tem uma volta lenta e uma média antes da rápida.
  // O pódio tem de mostrar a mais rápida dele, não a primeira na lista.
  const voltas = lapsByTime([
    {...sample, driver_name:'Bruno', last_lap_s:143.0},
    {...sample, driver_name:'Plinio', last_lap_s:97.4},
    {...sample, driver_name:'Bruno', last_lap_s:120.0},
    {...sample, driver_name:'Ana', last_lap_s:110.0},
    {...sample, driver_name:null, last_lap_s:90.0},
  ]);
  const podio = driverPodium(voltas, 3);
  assert.deepEqual(podio.map(l => [l.driver_name, l.last_lap_s]),
    [['Plinio', 97.4], ['Ana', 110.0], ['Bruno', 120.0]]);
});
test('activeDrivers keeps every pilot with fresh telemetry, not just the most recent one', () => {
  // 2+ simuladores ao mesmo tempo: os dois devem ganhar cartão, não só quem
  // mandou a amostra mais nova.
  const agora = Date.parse('2026-09-19T00:01:00Z');
  const drivers = [
    {...sample, driver_name:'Bruno', timestamp:'2026-09-19T00:00:55Z'},
    {...sample, driver_name:'Plinio', timestamp:'2026-09-19T00:00:50Z'},
    {...sample, driver_name:'Velho', timestamp:'2026-09-18T23:58:00Z'},
  ];
  const ativos = activeDrivers(drivers, agora, 60000);
  assert.deepEqual(ativos.map(d => d.driver_name), ['Bruno', 'Plinio']);
});
test('activeDrivers sorts the most recently seen pilot first', () => {
  const agora = Date.parse('2026-09-19T00:01:00Z');
  const drivers = [
    {...sample, driver_name:'Plinio', timestamp:'2026-09-19T00:00:50Z'},
    {...sample, driver_name:'Bruno', timestamp:'2026-09-19T00:00:58Z'},
  ];
  assert.deepEqual(activeDrivers(drivers, agora, 60000).map(d => d.driver_name), ['Bruno', 'Plinio']);
});
test('the lap window ends at the close and reaches back one lap time', () => {
  // A volta fechou às 00:01:44 e durou 104,015s. A margem é assimétrica: folga
  // antes, porque o instante registrado pode chegar depois do cruzamento.
  const lap = {...sample, timestamp:'2026-09-19T00:01:44.000Z', last_lap_s:104.015};
  assert.deepEqual(lapWindow(lap, 30000, 3000), {
    from:'2026-09-18T23:59:29.985Z',
    to:'2026-09-19T00:01:47.000Z',
  });
  // Sem margem, a janela dura exatamente o tempo da volta.
  const exata = lapWindow(lap, 0, 0);
  assert.equal((Date.parse(exata.to) - Date.parse(exata.from)) / 1000, 104.015);
});
test('laps without a usable duration produce no window', () => {
  assert.equal(lapWindow({...sample, last_lap_s:null}, 30000, 3000), null);
  assert.equal(lapWindow({...sample, last_lap_s:0}, 30000, 3000), null);
  assert.equal(lapWindow({...sample, timestamp:'nao é data', last_lap_s:90}, 30000, 3000), null);
});
test('the name and car learned later fill in the start of the same session', () => {
  const warmup = {...sample, driver_name:null, car_name:null};
  const named = {...sample, timestamp:'2026-09-19T00:00:30Z'};
  const [first] = backfillIdentity([warmup, named]);
  assert.equal(first.driver_name, 'Pilot');
  assert.equal(first.car_name, 'Formula');
  // O painel precisa do nome já na primeira amostra revelada pelo replay.
  assert.equal(summarize(backfillIdentity([warmup, named]).slice(0,1))[0].driver_name, 'Pilot');
});
test('backfill never borrows a name from another session', () => {
  const nameless = {...sample, 'rig.id':'2', driver_name:null, car_name:null};
  const [, outro] = backfillIdentity([sample, nameless]);
  assert.equal(outro.driver_name, null);
  assert.equal(outro.car_name, null);
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
test('the live trail survives the live refresh with uneven Grail ingestion', () => {
  // Regime do Ao vivo: consulta a cada TELEMETRY_REFRESH_MS e a amostra mais nova chegando com
  // 1 a 3,5 s de atraso, variando a cada consulta. Sequência fixa, não aleatória,
  // para o teste ser reproduzível; inclui o pior salto (1 s → 3,5 s).
  const atrasos = [1000, 3500, 1200, 2800, 1000, 3500, 2000, 3000, 1500, 3500];
  let now = 100000, newest = now - atrasos[0], clock = Math.max(0, newest - PLAYBACK_TRAIL_MS);
  let stalled = 0, resyncs = 0, maiorAtraso = 0;
  for (let cycle = 0; cycle < 60; cycle++) {
    for (let frame = 0; frame < TELEMETRY_REFRESH_MS / STEP; frame++) {
      const next = advancePlayback(clock, 0, newest, STEP, PLAYBACK_TRAIL_MS);
      if (next === clock) stalled++;
      if (next < clock) resyncs++;
      clock = next;
      now += STEP;
      maiorAtraso = Math.max(maiorAtraso, now - clock);
    }
    newest = now - atrasos[cycle % atrasos.length];
  }
  assert.equal(stalled, 0, 'o carro nunca deve congelar entre consultas');
  assert.equal(resyncs, 0, 'o regime estável não deve precisar de ressincronização');
  assert.ok(maiorAtraso <= PLAYBACK_TRAIL_MS + 3500, `atraso jogo → mapa (${maiorAtraso}ms) acima do esperado`);
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
  // Rollback a pedido: nó sem dado nenhum volta a ser null/cinza, distinto
  // de "parado, sem frear, sem acelerar" (que é dado real e continua azul).
  assert.equal(mixedHeatColor(null,null,null),null);
  assert.equal(mixedHeatColor(0,0,0),'rgb(52, 145, 255)');
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

// A janela buscada no Grail tem margem nas duas pontas: começa antes da largada
// e termina depois. O recorte precisa deixar só a volta.
const quadro = (t, x, y) => ({...sample, lap_time_s:t, pos_x:x, pos_y:y, timestamp:`2026-09-19T00:00:${String(Math.floor(t)+10).padStart(2,'0')}Z`});
test('lap trimming starts at the line, not before it', () => {
  const janela = [
    // cauda da volta anterior: o jogo ainda não reportava cronômetro
    {...quadro(0, -20, 0), lap_time_s:null}, {...quadro(0, -10, 0), lap_time_s:null},
    quadro(0.05, 0, 0), quadro(30, 100, 0), quadro(60, 200, 0), quadro(89.9, 5, 0),
    // já é a volta seguinte: cronômetro zerou
    quadro(0.04, 0, 0), quadro(1.2, 10, 0),
  ];
  const volta = trimToLap(janela, 90);
  assert.equal(volta.length, 4, 'só os quadros da volta');
  assert.equal(volta[0].lap_time_s, 0.05, 'começa na largada, não antes');
  assert.equal(volta[volta.length-1].lap_time_s, 89.9, 'termina ao fechar, não na volta seguinte');
});
test('lap trimming leaves samples alone when there is no usable timer', () => {
  const cegos = [{...sample, lap_time_s:null}, {...sample, lap_time_s:null}];
  assert.equal(trimToLap(cegos, 90).length, 2);
});
test('delta is zero against the reference lap itself and blank at the line', () => {
  const nodes = [[0,0],[100,0],[200,0]];
  const referencia = [quadro(0.0, 0, 0), quadro(30, 100, 0), quadro(60, 200, 0)];
  const perfil = lapProfile(referencia, nodes);
  assert.deepEqual(perfil, [0, 30, 60]);
  // mesmo ponto, mesmo tempo -> sem diferença
  assert.equal(deltaToReference(quadro(30, 100, 0), perfil, nodes, 90), 0);
  // dois segundos atrás do líder no mesmo ponto
  assert.equal(deltaToReference(quadro(32, 100, 0), perfil, nodes, 90), 2);
  // dois segundos à frente
  assert.equal(deltaToReference(quadro(28, 100, 0), perfil, nodes, 90), -2);
  // fechando a volta sobre a largada: casaria com o instante zero e daria uma
  // volta inteira de diferença — não há comparação a fazer ali
  assert.equal(deltaToReference(quadro(89.5, 0, 0), perfil, nodes, 90), null);
  // fora da pista: sem ponto de referência
  assert.equal(deltaToReference(quadro(30, 9999, 9999), perfil, nodes, 90), null);
});

test('a window holding more than one lap still picks the right one', () => {
  // Com folga de 30s antes, a janela pega a cauda da volta anterior e o começo
  // da seguinte. O recorte tem de ficar com a volta do meio, a de 90s.
  const janela = [
    quadro(140, -50, 0), quadro(142, -30, 0),          // fim da volta anterior, mais lenta
    quadro(0.06, 0, 0), quadro(45, 150, 0), quadro(89.8, 3, 0),  // a volta pedida
    quadro(0.05, 0, 0), quadro(2.5, 20, 0),            // começo da seguinte
  ];
  const volta = trimToLap(janela, 90);
  assert.equal(volta.length, 3);
  assert.equal(volta[0].lap_time_s, 0.06);
  assert.equal(volta[volta.length-1].lap_time_s, 89.8);
  assert.equal(startsAtLine(volta), true);
});
test('a lap whose start fell outside the window is flagged, not faked', () => {
  // O coletor reiniciado reanuncia uma volta antiga: o trecho gravado começa
  // com o cronômetro já andando e não há largada ali.
  const parcial = [quadro(38, 120, 0), quadro(60, 200, 0), quadro(89.9, 4, 0)];
  const volta = trimToLap(parcial, 90);
  assert.equal(volta.length, 3, 'reproduz o que existe');
  assert.equal(startsAtLine(volta), false, 'mas avisa que não começa na linha');
});
test('startsAtLine needs a real timer reading', () => {
  assert.equal(startsAtLine([]), false);
  assert.equal(startsAtLine([{...sample, lap_time_s:null}]), false);
});

test('a lap recorded under an earlier session still counts as the current driver\'s best', () => {
  // dedupeLaps mantém a OCORRÊNCIA MAIS ANTIGA de uma volta: se o piloto
  // reiniciou a sessão depois de bater aquele tempo, a linha da volta aponta
  // para a sessão velha, não para a sessão ao vivo agora.
  const voltaNaSessaoVelha = {...sample, 'session.id':'sessao-antiga', last_lap_s:101};
  const pilotoNaSessaoNova = summarize([{...sample, 'session.id':'sessao-nova'}]);
  assert.equal(pilotoNaSessaoNova[0].best, null);
  const comResultado = applyLapResults(pilotoNaSessaoNova, [voltaNaSessaoVelha]);
  assert.equal(comResultado[0].best, 101);
  assert.equal(comResultado[0].bestSource, 'completed');
});

test('matching by driver name never merges two different rigs or a renamed driver', () => {
  const doisRigs = summarize([
    {...sample, 'rig.id':'rig-01', 'session.id':'nova-1'},
    {...sample, 'rig.id':'rig-02', 'session.id':'nova-2'},
  ]);
  const comVoltas = applyLapResults(doisRigs, [
    {...sample, 'rig.id':'rig-01', 'session.id':'velha-1', last_lap_s:90},
    // mesmo rig.id, nome diferente: nao e' o mesmo piloto, nao deve casar
    {...sample, 'rig.id':'rig-02', 'session.id':'velha-2', driver_name:'Outro', last_lap_s:70},
  ]);
  const porRig = Object.fromEntries(comVoltas.map(d => [d['rig.id'], d.best]));
  assert.equal(porRig['rig-01'], 90);
  assert.equal(porRig['rig-02'], null);
});

test('trackHeat bridges a short gap flanked by real data on both sides', () => {
  // Nós em linha, bem afastados entre si (e um array grande o bastante para o
  // outro lado do círculo não "vazar" por perto): a posição de cada evento é
  // colocada EXATAMENTE sobre o nó-alvo, então a distância de corte do
  // nearestNode não interfere — isola só a lógica de preenchimento de lacuna.
  const nodes = Array.from({length: 12}, (_, i) => [i * 10, 0]);
  const evento = (i, valor) => ({...sample, pos_x: nodes[i][0], pos_y: nodes[i][1], speed_kmh: valor});
  // nó 1 fica sem amostra própria, entre o nó 0 (100) e o nó 2 (200)
  const resultado = trackHeat([evento(0,100), evento(2,200)], 'speed_kmh', nodes);
  assert.equal(resultado[1], 150); // (100*1 + 200*1) / 2, distancia 1 dos dois lados
  // um nó do lado oposto do círculo, sem NENHUM dado real por perto nos dois
  // sentidos (mais de MAX_GAP_NODES em qualquer direção), continua cinza
  assert.equal(resultado[6], null);
});

test('trackHeat never bridges a gap wider than the tolerance, even with data on both ends', () => {
  const nodes = Array.from({length: 16}, (_, i) => [i * 10, 0]);
  const evento = (i, valor) => ({...sample, pos_x: nodes[i][0], pos_y: nodes[i][1], speed_kmh: valor});
  // nós 0 e 13 coloridos, nós 1..12 (lacuna de 12 nós, maior que 2x o limite
  // de 5) devem TODOS continuar cinza — nenhum ponto no meio tem dado real
  // perto o bastante dos dois lados. É este caso real que a captura expõe: um
  // setor inteiro sem amostra nenhuma perto, e nenhum MAX_GAP razoável deveria
  // bridgear isso.
  const resultado = trackHeat([evento(0,100), evento(13,200)], 'speed_kmh', nodes);
  for (let i = 1; i <= 12; i++) assert.equal(resultado[i], null, `nó ${i} deveria continuar cinza`);
});

test('trackHeat keeps a two-node track behaving like before: no wraparound bridging', () => {
  // Com só 2 nós, "os dois lados" do nó sem dado caem no MESMO nó ao
  // contornar o círculo — não é uma lacuna cercada por dados DISTINTOS, então
  // o comportamento de sempre (nó sem amostra própria fica cinza) continua.
  assert.deepEqual(trackHeat([sample,{...sample,pos_x:9999}], 'speed_kmh',[[0,0],[100,100]]),[100,null]);
});

test('two simulators streaming at the same time both show up as independent cars', () => {
  // O evento precisa disto de verdade: quando a telemetria de dois rigs
  // comecar a bater ao mesmo tempo, os dois pilotos tem que aparecer na
  // pista. Simula exatamente o que CarMarkers faz: agrupa por trilha, acha a
  // janela [oldest,newest] do bloco inteiro e amostra cada carro nela.
  const rigA = [0,1,2].map(s => ({...sample, 'rig.id':'rig-01', 'session.id':'sessao-a',
    driver_name:'Bruno', timestamp:`2026-09-19T00:00:0${s}Z`, pos_x:s, pos_y:0}));
  const rigB = [0,1,2].map(s => ({...sample, 'rig.id':'rig-02', 'session.id':'sessao-b',
    driver_name:'Agnes', timestamp:`2026-09-19T00:00:0${s}Z`, pos_x:100+s, pos_y:0}));
  const paths = trails([...rigA, ...rigB]);
  assert.equal(paths.length, 2, 'dois rigs concorrentes têm que virar duas trilhas, não uma só');

  const oldest = Math.min(...paths.map(t => Date.parse(t[0].timestamp)));
  const newest = Math.max(...paths.map(t => Date.parse(t[t.length-1].timestamp)));
  const posicoes = paths.map(trail => sampleAt(trail, newest).pos_x).sort((a,b) => a-b);
  assert.deepEqual(posicoes, [2, 102], 'cada carro aparece na SUA própria posição mais recente, não na do outro');
});

test('a rig lagging behind another still renders at its own latest known position', () => {
  // Um rig pode ficar alguns segundos atrás do outro por latência de rede —
  // o relógio compartilhado (newest do bloco inteiro) não pode fazer o carro
  // atrasado desaparecer nem pular pra uma posição que ele nunca reportou.
  const adiantado = [0,1,2,3,4].map(s => ({...sample, 'rig.id':'rig-01', 'session.id':'a',
    timestamp:`2026-09-19T00:00:0${s}Z`, pos_x:s, pos_y:0}));
  const atrasado = [0,1].map(s => ({...sample, 'rig.id':'rig-02', 'session.id':'b',
    timestamp:`2026-09-19T00:00:0${s}Z`, pos_x:200+s, pos_y:0}));
  const paths = trails([...adiantado, ...atrasado]);
  const newest = Math.max(...paths.map(t => Date.parse(t[t.length-1].timestamp))); // t=4, do rig adiantado
  const porRig = Object.fromEntries(paths.map(trail => [trail[0]['rig.id'], sampleAt(trail, newest).pos_x]));
  assert.equal(porRig['rig-01'], 4);   // acompanha o relógio até onde tem dado
  assert.equal(porRig['rig-02'], 201); // fica na ÚLTIMA posição real dele, não pula nem desaparece
});

// -------------------- Dynatrace Intelligence --------------------

test('nearestReferencePoint wraps around the circular track', () => {
  const n = 156;
  // ponto 1 fica em floor(0.12*156)=18; indice 0 (a largada) é mais perto do
  // ponto 6 (floor(0.89*156)=138, distância circular 156-138=18) do que do 1
  // (distância 18 também) — empate resolvido pelo primeiro encontrado (ponto 1).
  assert.equal(nearestReferencePoint(18, n), 1);
  assert.equal(nearestReferencePoint(138, n), 6);
  assert.equal(nearestReferencePoint(0, n), 1); // distância 18 para o 1, 18 para o 6: fica com o 1 (primeiro)
});

test('brakingHotspot finds the node with the strongest average braking', () => {
  const nodes = [[0,0],[50,0],[100,0]];
  const evento = (i, brake) => ({...sample, pos_x: nodes[i][0], pos_y: nodes[i][1], brake_pct: brake});
  const resultado = brakingHotspot([evento(0,20), evento(1,90), evento(1,80), evento(2,10)], nodes);
  assert.equal(resultado.avgBrakePct, 85); // média do nó 1: (90+80)/2
  assert.equal(resultado.referencePoint, nearestReferencePoint(1, nodes.length));
});

test('brakingHotspot returns null without any usable sample', () => {
  const nodes = [[0,0],[50,0]];
  assert.equal(brakingHotspot([{...sample, brake_pct:null}], nodes), null);
  assert.equal(brakingHotspot([{...sample, pos_x:null}], nodes), null);
});

test('topSpeedLocation picks the single fastest valid sample, ignoring invalid ones', () => {
  const nodes = [[0,0],[50,0]];
  const resultado = topSpeedLocation([
    {...sample, pos_x:0, pos_y:0, speed_kmh:120, driver_name:'Lento'},
    {...sample, pos_x:50, pos_y:0, speed_kmh:310, driver_name:'Rápido'},
    {...sample, pos_x:50, pos_y:0, speed_kmh:null},
  ], nodes);
  assert.equal(resultado.speedKmh, 310);
  assert.equal(resultado.referencePoint, nearestReferencePoint(1, nodes.length));
  assert.equal(resultado.driverName, 'Rápido');
});

test('accelerationHotspot finds the node with the strongest average acceleration', () => {
  const nodes = [[0,0],[50,0],[100,0]];
  const evento = (i, g) => ({...sample, pos_x: nodes[i][0], pos_y: nodes[i][1], acceleration_g: g});
  const resultado = accelerationHotspot([evento(0,0.5), evento(2,2.5), evento(2,3.1), evento(1,1)], nodes);
  assert.ok(Math.abs(resultado.avgG - 2.8) < 1e-9); // média do nó 2: (2.5+3.1)/2
  assert.equal(resultado.referencePoint, nearestReferencePoint(2, nodes.length));
});

test('accelerationHotspot returns null without any usable sample', () => {
  const nodes = [[0,0],[50,0]];
  assert.equal(accelerationHotspot([{...sample, acceleration_g:null}], nodes), null);
});

test('brakingHotspotsByDriver ranks each driver by their own strongest zone', () => {
  const nodes = [[0,0],[50,0],[100,0]];
  const evento = (driver, i, brake) => ({...sample, driver_name: driver, pos_x: nodes[i][0], pos_y: nodes[i][1], brake_pct: brake});
  const resultado = brakingHotspotsByDriver([
    evento('Forte', 0, 95), evento('Forte', 1, 10),
    evento('Suave', 2, 40),
  ], nodes);
  assert.deepEqual(resultado.map(r => r.driverName), ['Forte', 'Suave']);
  assert.equal(resultado[0].referencePoint, nearestReferencePoint(0, nodes.length));
  assert.equal(resultado[0].avgValue, 95);
  assert.equal(resultado[1].avgValue, 40);
});

test('brakingHotspotsByDriver ignores samples without a driver name', () => {
  const nodes = [[0,0],[50,0]];
  assert.deepEqual(brakingHotspotsByDriver([{...sample, driver_name:null, brake_pct:90}], nodes), []);
});

test('accelerationHotspotsByDriver ranks each driver by their own strongest zone', () => {
  const nodes = [[0,0],[50,0]];
  const evento = (driver, i, g) => ({...sample, driver_name: driver, pos_x: nodes[i][0], pos_y: nodes[i][1], acceleration_g: g});
  const resultado = accelerationHotspotsByDriver([evento('A', 0, 3), evento('B', 1, 1.5)], nodes);
  assert.deepEqual(resultado.map(r => r.driverName), ['A', 'B']);
});

test('lapConsistency ranks drivers by standard deviation, drops single-lap drivers', () => {
  const lap = (driver, t) => ({...sample, driver_name: driver, last_lap_s: t, lap_invalidated: false});
  const resultado = lapConsistency([
    lap('Constante', 100), lap('Constante', 100.2), lap('Constante', 99.9),
    lap('Inconsistente', 90), lap('Inconsistente', 110),
    lap('UmaSoVolta', 95),
  ]);
  assert.deepEqual(resultado.map(r => r.driverName), ['Constante', 'Inconsistente']);
  assert.equal(resultado[0].laps, 3);
  assert.ok(resultado[0].stdDevSeconds < resultado[1].stdDevSeconds);
});

test('lapConsistency ignores laps without a usable time or driver name', () => {
  const lap = (driver, t) => ({...sample, driver_name: driver, last_lap_s: t, lap_invalidated: false});
  const resultado = lapConsistency([
    lap(null, 100), lap(null, 101),
    lap('Piloto', 0), lap('Piloto', -5),
    lap('Piloto', 100), lap('Piloto', 101),
  ]);
  assert.equal(resultado.length, 1);
  assert.equal(resultado[0].driverName, 'Piloto');
  assert.equal(resultado[0].laps, 2);
});

test('replay keeps the rig order when batches reached Grail out of order', () => {
  // Volta de 10 quadros (cronômetro 0..9 s) cujo lote do meio chegou ANTES: os
  // timestamps do Grail ficam fora da ordem do cronômetro.
  const chegada = [0, 1, 2, 6, 7, 3, 4, 5, 8, 9];
  const amostras = chegada.map((seq, i) => ({...sample, 'sample.id':`rig|s1|${seq + 100}`, lap_time_s:seq,
    timestamp:new Date(Date.UTC(2026, 9, 20, 0, 0, i)).toISOString()}));
  const porTempo = [...amostras].sort((a,b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  assert.equal(trimToLap(porTempo, 9)[0].lap_time_s, 3, 'por timestamp o recorte parava no meio da volta');
  const volta = trimToLap(inSampleOrder(amostras), 9);
  assert.deepEqual(volta.map(e => e.lap_time_s), [0,1,2,3,4,5,6,7,8,9]);
});
test('samples without a sequence fall back to timestamp order', () => {
  assert.equal(sampleSeq({...sample, 'sample.id':'rig|s1|42'}), 42);
  assert.equal(sampleSeq(sample), null);
  const a = {...sample, timestamp:'2026-09-19T00:00:02Z'}, b = {...sample, timestamp:'2026-09-19T00:00:01Z'};
  assert.deepEqual(inSampleOrder([a, b]), [b, a]);
});

test('sector times read as seconds below a minute and m:ss above', () => {
  assert.equal(sectorTime(24.653), '24.653');
  assert.equal(sectorTime(57.54), '57.540');
  assert.equal(sectorTime(62.345), '1:02.345');
  assert.equal(sectorTime(null), '—');
  assert.equal(parseEvents([{...sample, last_lap_s1:24.653, last_lap_s2:57.54, last_lap_s3:21.822}])[0].last_lap_s3, 21.822);
});

// Traçado real de Interlagos: o ponto 0 é a linha de largada/chegada.
const INTERLAGOS = JSON.parse(readFileSync(new URL('../ui/app/data/interlagos.json', import.meta.url), 'utf8'));
// Quadros andando pelos pontos do traçado, um a cada 100 ms. `cronometro(i)`
// devolve o lap_time_s do quadro i (ou null).
function voltaSintetica(nos, cronometro) {
  return nos.map((no, i) => ({...sample, pos_x:INTERLAGOS[no][0], pos_y:INTERLAGOS[no][1], lap_time_s:cronometro(i),
    timestamp:new Date(Date.UTC(2026, 9, 20, 0, 0, 0) + i * 100).toISOString()}));
}
const range = (a, b) => Array.from({length: b - a + 1}, (_, i) => a + i);
const N = INTERLAGOS.length;
test('replay starts at the start line even when the game clock already runs before it', () => {
  // O AMS2 entrega o carro 27 pontos antes da linha com o cronômetro já
  // correndo; ele só zera na linha de CHEGADA, ao fim da volta seguinte.
  const nos = [...range(N - 27, N - 1), ...range(0, N - 1), ...range(0, 20)];
  const fimDaVolta = 27 + N - 1;
  const amostras = voltaSintetica(nos, i => i <= fimDaVolta ? +(i * 0.1).toFixed(1) : +((i - fimDaVolta - 1) * 0.1).toFixed(1));
  assert.equal(trimToLap(amostras, fimDaVolta * 0.1)[0].pos_x, INTERLAGOS[N - 27][0], 'pelo cronômetro, começava antes da linha');
  const volta = trimToLineToLine(amostras, fimDaVolta * 0.1, INTERLAGOS);
  assert.equal(volta.length, N);
  assert.deepEqual([volta[0].pos_x, volta[0].pos_y], INTERLAGOS[0]);
  assert.deepEqual([volta.at(-1).pos_x, volta.at(-1).pos_y], INTERLAGOS[N - 1]);
  assert.ok(startsAtTrackLine(volta, INTERLAGOS));
  assert.ok(!startsAtTrackLine(amostras, INTERLAGOS));
});
test('replay starts at the line when the clock only starts a few frames after it', () => {
  // Como na captura real: sem cronômetro antes da linha, e ele só aparece
  // alguns quadros depois de cruzá-la.
  const nos = [...range(N - 27, N - 1), ...range(0, N - 1), ...range(0, 20)];
  const fimDaVolta = 27 + N - 1;
  const amostras = voltaSintetica(nos, i => i < 30 ? null : i <= fimDaVolta ? +((i - 30) * 0.1).toFixed(1) : +((i - fimDaVolta - 1) * 0.1).toFixed(1));
  const volta = trimToLineToLine(amostras, (fimDaVolta - 30) * 0.1, INTERLAGOS);
  assert.deepEqual([volta[0].pos_x, volta[0].pos_y], INTERLAGOS[0]);
  assert.deepEqual([volta.at(-1).pos_x, volta.at(-1).pos_y], INTERLAGOS[N - 1]);
});
test('without positions the replay falls back to the game clock cut', () => {
  const amostras = voltaSintetica(range(0, 50), i => i < 10 ? null : +((i - 10) * 0.1).toFixed(1)).map(e => ({...e, pos_x:null, pos_y:null}));
  assert.deepEqual(lineCrossings(amostras, INTERLAGOS), []);
  assert.equal(trimToLineToLine(amostras, 4, INTERLAGOS)[0].lap_time_s, 0);
});

test('live marker glides between 10 Hz samples instead of jumping', () => {
  const t0 = Date.UTC(2026, 9, 20);
  const trilha = [0, 100, 200, 1500].map((ms, i) => ({...sample, pos_x:i * 10, pos_y:0, timestamp:new Date(t0 + ms).toISOString()}));
  assert.deepEqual(positionAt(trilha, t0 + 50), {x:5, y:0});
  assert.deepEqual(positionAt(trilha, t0 + 100), {x:10, y:0});
  // Buraco de 1,3 s: não interpola, o carro fica na última posição conhecida.
  assert.deepEqual(positionAt(trilha, t0 + 800), {x:20, y:0});
  assert.deepEqual(positionAt(trilha, t0 + 9000), {x:30, y:0});
});

// Regime real do Ao vivo, quadro a quadro (60 fps): recarga a cada 2 s com
// latência de consulta variável, e a amostra mais nova chegando com atraso de
// ingestão oscilando entre 1 e 3,5 s, com um pico de 5 s no meio. O relógio
// mede as chegadas como o liveClock.ts faz e deve rodar como relógio: sem
// travar no fim dos dados, sem pular, com ritmo sempre perto de 1×.
test('live clock runs like a clock through uneven Grail ingestion', () => {
  const atrasos = [1000, 3500, 1200, 2800, 1000, 3500, 2000, 5000, 1500, 3000, 1100, 3400];
  const latencias = [300, 900, 400, 1200, 350, 800];
  const lags = [], gaps = [];
  let agora = 1_000_000, clock = 0, newest = 0, ultimaChegada = 0, proximaConsulta = agora, consulta = 0;
  let travadas = 0, pulos = 0, menorRitmo = Infinity, maiorRitmo = 0;
  for (let quadro = 0; quadro < 60 * 120; quadro++) {          // 2 minutos
    if (agora >= proximaConsulta) {
      const chegaEm = agora + latencias[consulta % latencias.length];
      const novoNewest = chegaEm - atrasos[consulta % atrasos.length];
      proximaConsulta += 2000; consulta++;
      // a resposta é aplicada quando chega
      pendente.push({chegaEm, novoNewest});
    }
    while (pendente.length && pendente[0].chegaEm <= agora) {
      const {novoNewest} = pendente.shift();
      if (novoNewest > newest) {
        lags.push(agora - novoNewest); if (lags.length > 15) lags.shift();
        if (ultimaChegada) { gaps.push(agora - ultimaChegada); if (gaps.length > 15) gaps.shift(); }
        ultimaChegada = agora; newest = novoNewest;
      }
    }
    const antes = clock;
    clock = stepLiveClock(clock, agora, 16, 0, newest, liveDelay(lags, gaps));
    if (agora > 1_020_000 && antes) {                            // depois de 20 s de aquecimento
      const ritmo = (clock - antes) / 16;
      if (clock === antes) travadas++;
      if (ritmo > 1.2) pulos++;
      menorRitmo = Math.min(menorRitmo, ritmo); maiorRitmo = Math.max(maiorRitmo, ritmo);
    }
    agora += 16;
  }
  assert.equal(travadas, 0, 'o relógio não deve encostar no fim dos dados');
  assert.equal(pulos, 0, 'o relógio não deve pular');
  assert.ok(menorRitmo >= 0.92 - 1e-9 && maiorRitmo <= 1.08 + 1e-9, `ritmo fora de ±8%: ${menorRitmo.toFixed(3)}–${maiorRitmo.toFixed(3)}`);
});
const pendente = [];
test('live clock resyncs straight to the target when far away', () => {
  assert.equal(stepLiveClock(0, 100000, 16, 50000, 99000, 5000), 95000);       // primeira carga
  assert.equal(stepLiveClock(60000, 100000, 16, 50000, 99000, 5000), 95000);   // aba em segundo plano
  assert.equal(stepLiveClock(120000, 100000, 16, 50000, 99000, 5000), 95000);  // relógio além dos dados
});
test('lap timer advances between samples like a clock', () => {
  const t0 = Date.UTC(2026, 9, 20);
  const trilha = [0, 100, 200].map((ms, i) => ({...sample, lap_time_s:10 + i * 0.1, timestamp:new Date(t0 + ms).toISOString()}));
  assert.equal(lapTimeAt(trilha, t0 + 50).toFixed(3), '10.050');
  assert.equal(lapTimeAt(trilha, t0 + 150).toFixed(3), '10.150');
  assert.equal(lapTimeAt(trilha, t0 + 5000).toFixed(3), '10.200', 'sem amostra recente não inventa tempo');
});

// Fim de volta: 1:41.940. O último quadro da volta tem o cronômetro em 101,9 s;
// no quadro seguinte o jogo zera o cronômetro e anuncia o tempo oficial.
function fimDeVolta() {
  const t0 = Date.UTC(2026, 9, 20);
  const quadros = [];
  for (let i = 0; i <= 20; i++) quadros.push({...sample, lap_time_s:99.9 + i * 0.1, last_lap_s:104.46, timestamp:new Date(t0 + i * 100).toISOString()});
  for (let i = 0; i < 800; i++) quadros.push({...sample, lap_time_s:0.04 + i * 0.1, last_lap_s:101.94, timestamp:new Date(t0 + 2100 + i * 100).toISOString()});
  return {t0, quadros};
}
test('the official lap time is held in the driver panel right after the line', () => {
  const {t0, quadros} = fimDeVolta();
  assert.equal(recentLapResult(quadros, t0 + 1500), null, 'antes da linha, o contador corre');
  assert.deepEqual(recentLapResult(quadros, t0 + 2100), {seconds:101.94, completedAt:t0 + 2100});
  assert.equal(recentLapResult(quadros, t0 + 2100 + 59000).seconds, 101.94, 'fica cravado por até 1 minuto');
  assert.equal(recentLapResult(quadros, t0 + 2100 + 61000), null, 'depois de 1 minuto volta o contador');
});
test('a lap time re-announced mid-lap is not shown as just completed', () => {
  const t0 = Date.UTC(2026, 9, 20);
  // Coletor reiniciado no meio da volta: primeiro sem last_lap_s, depois o jogo
  // reanuncia o último tempo com o cronômetro em 47 s.
  const quadros = [0, 1, 2, 3].map(i => ({...sample, lap_time_s:47 + i * 0.1, last_lap_s:i < 2 ? null : 101.94, timestamp:new Date(t0 + i * 100).toISOString()}));
  assert.equal(recentLapResult(quadros, t0 + 300), null);
});

test('top speed ignores a one- or two-frame spike', () => {
  const v = speeds => speeds.map(speed_kmh => ({...sample, speed_kmh}));
  assert.equal(topSpeedOf(v([240, 248.5, 249, 249, 249, 386.2, 150])), 249, 'pico de teleporte ignorado');
  assert.equal(topSpeedOf(v([240, 249, 249, 249, 395, 391])), 249, 'dois quadros de pico ignorados');
  assert.equal(topSpeedOf(v([230, 251.9, 251.9, 251.8])), 251.8);
  assert.equal(topSpeedOf(v([100, 150])), 150, 'menos de três amostras: o máximo');
  assert.equal(topSpeedOf([]), null);
});
test('completed laps are detected in the live trail, with sectors and spike-free top speed', () => {
  const {quadros} = fimDeVolta();
  quadros[5] = {...quadros[5], speed_kmh:386.2};
  const fim = quadros.findIndex(q => q.last_lap_s === 101.94);
  quadros[fim] = {...quadros[fim], last_lap_s1:25.1, last_lap_s2:52.0, last_lap_s3:24.84};
  const voltas = lapCompletions(quadros);
  assert.equal(voltas.length, 1);
  assert.equal(voltas[0].last_lap_s, 101.94);
  assert.equal(voltas[0].timestamp, quadros[fim].timestamp, 'mesmo timestamp que a consulta do Grail usa');
  assert.equal(voltas[0].last_lap_s3, 24.84);
  assert.equal(voltas[0].top_speed_kmh, 100, 'o pico de 386,2 não vira a máxima');
});

test('a lap entering the leaderboard takes its sectors from the first frame that has them', () => {
  const {quadros} = fimDeVolta();
  const fim = quadros.findIndex(q => q.last_lap_s === 101.94);
  // Os 3 primeiros quadros com o tempo novo ainda sem setores.
  for (let k = fim + 3; k < quadros.length; k++) quadros[k] = {...quadros[k], last_lap_s1:25.1, last_lap_s2:52.0, last_lap_s3:24.84};
  const [volta] = lapCompletions(quadros);
  assert.equal(volta.timestamp, quadros[fim].timestamp);
  assert.deepEqual([volta.last_lap_s1, volta.last_lap_s2, volta.last_lap_s3], [25.1, 52.0, 24.84]);
});

test('two real laps with the same time on different days both count', () => {
  const ontem = {...sample, 'rig.id':'rig-01', driver_name:'Plinio Moreira', 'session.id':'s-ontem', last_lap_s:101.12, lap_start_s:0.04, timestamp:'2026-10-20T19:05:46Z'};
  const hoje = {...ontem, 'session.id':'s-hoje', lap_start_s:0.05, timestamp:'2026-10-21T22:40:10Z'};
  const unicas = dedupeLaps([ontem, hoje]);
  assert.equal(unicas.length, 2);
  assert.equal(lapsByTime(unicas).length, 2, 'as duas entram na classificação');
});
test('a re-announced lap time after a collector restart still counts once', () => {
  const real = {...sample, 'rig.id':'rig-01', driver_name:'Plinio Moreira', 'session.id':'s1', last_lap_s:101.12, lap_start_s:0.05, timestamp:'2026-10-21T22:40:10Z'};
  // Coletor reiniciado 3 min depois, com o carro no meio da volta (cronômetro em 47 s).
  const reanuncio = {...real, 'session.id':'s2', lap_start_s:47.3, timestamp:'2026-10-21T22:43:02Z'};
  assert.deepEqual(dedupeLaps([real, reanuncio]), [real]);
  // Se a volta real ficou fora do período, o reanúncio é o que sobra dela.
  assert.deepEqual(dedupeLaps([reanuncio]), [reanuncio]);
});
