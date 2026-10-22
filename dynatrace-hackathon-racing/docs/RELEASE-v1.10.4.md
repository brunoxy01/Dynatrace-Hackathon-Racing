# v1.10.4 — Replay das voltas novas volta a começar na largada

App (**1.10.3 → 1.10.4**) e pacote do rig.

## O problema

No Replay, as voltas gravadas com o coletor v1.10.0/1.10.1 começavam no meio da pista, com o cronômetro já passando de um minuto. Voltas mais antigas reproduziam normalmente.

## A causa provável

Na v1.10.0 o envio de bizevents passou a usar **2 threads em paralelo**. Os lotes passaram a chegar ao Grail fora de ordem e, pelo sintoma, o timestamp gravado não acompanha a ordem do jogo.

O replay recorta a volta andando de trás para frente enquanto o cronômetro do jogo decresce. Ordenando as amostras pelo timestamp, uma inversão no meio da volta fazia o recorte parar ali, e a reprodução começava com mais de um minuto rodado. Voltas antigas foram enviadas por uma thread só, por isso não tinham o problema.

## O que mudou

- **App:** o Replay, e o perfil da volta de referência usado no delta, ordenam as amostras pela **sequência gerada no rig** (fim do `sample.id`), não pelo timestamp. Isso conserta também as voltas **já gravadas**. Amostras sem sequência (dados antigos) continuam ordenadas por timestamp.
- **Rig:** o envio de bizevents volta para **1 thread**. A conexão reaproveitada (keep-alive), que é o ganho principal da v1.10, continua.

## Para confirmar a causa nos seus dados

Numa sessão gravada com a v1.10.0/1.10.1, se `seq` não estiver sempre crescendo enquanto o `timestamp` cresce, os lotes chegaram fora de ordem:

```
fetch bizevents, from: now()-2h
| filter event.type == "racing.telemetry"
| fieldsAdd seq = toLong(arrayLast(splitString(`sample.id`, "|")))
| sort timestamp asc
| fields timestamp, `session.id`, seq, lap_time_s
| limit 300
```

## Técnico

- `racing.ts`: `sampleSeq` e `inSampleOrder`; `Dashboard.tsx` usa `inSampleOrder` antes do `trimToLap` no replay e na referência.
- `ams2_collector.py`: `Dispatcher` com 1 thread para bizevents.
- Novo teste reproduz o sintoma: volta com o lote do meio chegando antes. Ordenada por timestamp, o recorte começa em 3 s; ordenada pela sequência, começa em 0.
- `npm test` (62/62), `npm run lint`, `tsc` e os testes Python limpos.
