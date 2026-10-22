# v1.10.0 — Menos atraso entre o rig e o painel

App (**1.9.0 → 1.10.0**) e pacote do rig. Em cima da `feature/tres-telas`, sem merge na main.

A v1.9.0 baixou as esperas configuradas (`flush_interval`, `batch.timeout`). Esta versão ataca o que sobrava: o envio que não acompanhava o rig, o volume dobrado e a consulta do Ao vivo, que ficava mais lenta conforme o evento acumulava dados.

## Coletor (`ams2_collector.py`)

- **Conexão reaproveitada (keep-alive).** O `urllib` abria TCP + TLS novos a cada lote. Do Brasil até o tenant isso são várias idas e voltas por POST, e com uma thread só a fila de bizevents crescia minuto a minuto: o atraso **aumentava ao longo da sessão**. Agora o handshake acontece uma vez por thread.
- **Envio fora da thread do UDP nos dois caminhos.** Bizevents com 2 threads, OTLP com 1. Com a fila cheia, cai o lote **mais antigo**: num painel ao vivo, o dado novo vale mais.
- **`--sample-hz` (padrão 10).** O AMS2 manda ~20 quadros/s; metade é suficiente para o mapa e os indicadores, e é metade do que ingerir e consultar. Os pacotes de volta e de nomes continuam todos processados. `0` envia tudo.
- A linha de progresso mostra `fila: N lote(s)`. Se só cresce, o destino não acompanha o rig.

## Rig

- `sink` padrão **`otlp`** em vez de `both`: com `both` cada amostra era ingerida e consultada duas vezes. `both` continua disponível.
- `sample_hz = 10` no `racing.ini` do pacote e `RACING_SAMPLE_HZ` no `config.bat`.

## OTel Collector (`otelcol-racing.yaml`)

- `batch.timeout` 2s → **1s**, `send_batch_size` 200 → 50 (a 10 amostras/s um lote de 200 nunca enchia; valia sempre o timeout).
- Primeiro reenvio 5s → **1s** (máx. 15s), `num_consumers` 2 → 4. A fila em disco continua.

## App — aba Ao vivo

- **Mapa, piloto em destaque, velocidade máxima e o pulso** consultam sempre os **últimos 2 minutos**, recarregando a cada **3s**, independente do seletor. Antes varriam o período inteiro (7 dias por padrão) a cada 5s só para ficar com as 10.000 amostras mais novas.
- **Classificação (Top 10), pódio e melhor volta** seguem o seletor, que nessa aba passa a se chamar "Período da classificação".
- A aba **Dynatrace Intelligence** continua analisando o período do seletor.

## Técnico

- Novos testes Python: corte de 20 → 10 Hz (com jitter), reaproveitamento de conexão, reconexão sem backoff quando o servidor fecha a conexão ociosa, descarte do lote mais antigo.
- `npm run lint`, `npm test` (58/58), `tsc` e os testes Python limpos. Replay da `captura.txt` contra um receptor OTLP local: 7.236 quadros → 3.549 enviados (~10 Hz), sem perda.
- Não medido ainda contra o tenant: comparar o atraso com a DQL abaixo antes e depois.

```
fetch logs, from: now()-5m
| filter event.type == "racing.telemetry"
| summarize ultimo = max(timestamp), by: {rig.id}
| fieldsAdd atraso = now() - ultimo
```
