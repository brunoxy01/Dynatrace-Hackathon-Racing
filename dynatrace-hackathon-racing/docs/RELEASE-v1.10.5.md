# v1.10.5 — Tempos de setor (S1, S2, S3) nas tabelas de voltas

App (**1.10.4 → 1.10.5**) e pacote do rig. **Os setores só aparecem para voltas gravadas com o rig desta versão**: é o coletor que os calcula.

## O que aparece

As tabelas **Top 10 voltas** (Ao vivo e Placar) e **Voltas registradas** (Replay) ganham as colunas **S1, S2 e S3** logo depois do tempo da volta. Abaixo de um minuto o setor aparece em segundos ("24.653"); acima, como "1:02.345". As colunas ordenam como número.

Mostram "—" as voltas gravadas antes desta versão do rig e as voltas em que o coletor entrou no meio (por exemplo, a primeira depois de abrir o `HackathonRacing.exe` com o carro já na pista).

## De onde vêm os setores

O pacote de tempos do AMS2 (tipo 3) traz, para cada piloto, o setor atual e quanto tempo ele já correu dentro desse setor. O coletor não decodificava nenhum dos dois.

- **S1 e S2:** na virada de setor, o cronômetro da volta menos o tempo já corrido no setor novo.
- **S3:** fecha com o tempo oficial da volta (pacote 7): volta − S1 − S2.

Conferido na volta real da captura (104,015 s): S1 = 24,653, S2 = 57,540, S3 = 21,822. O jogo reporta 21,821 como último setor; a diferença é arredondamento.

Os setores viajam em cada amostra (`last_lap_s1/s2/s3`) junto com o `last_lap_s`, repetidos ao longo da volta seguinte. Assim o agrupamento de voltas do app os pega sem casamento extra.

## Técnico

- `ams2_protocol.py`: `decode_timings` passa a ler `sSector` (3 bits baixos do byte 15) e `sCurrentSectorTime` (byte 26). `SessionState` acompanha as viradas de setor e fecha os três setores quando chega o tempo oficial, que pode vir antes ou depois da virada de volta.
- `ams2_collector.py`: campos `last_lap_s1`, `last_lap_s2`, `last_lap_s3` no evento.
- `Dashboard.tsx`: `LAPS` agrega os setores com `max()`; colunas `SECTOR_COLUMNS` nas duas tabelas. `racing.ts`: `sectorTime`.
- Testes Python novos sobre a captura real (setores da volta 1; nenhum setor inventado antes da primeira volta completa). `npm test` (63/63), `npm run lint`, `tsc` limpos; DQL validada.
