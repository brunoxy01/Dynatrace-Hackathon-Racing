# v1.10.1 — Tela sem piscar e erros do collector visíveis no rig

App (**1.10.0 → 1.10.1**) e pacote do rig.

## App: a recarga em segundo plano não aparece mais

A cada recarga da telemetria (3s) e das voltas (15s) o timeframe absoluto muda, e para o `useDql` isso é uma consulta nova com `isLoading = true`. Resultado: o botão **Atualizar** girava, o status trocava para "Consultando telemetria" e o aviso de "sem eventos" piscava a cada ciclo.

Agora o estado de carregando só aparece na **primeira** busca de cada janela. Com um resultado anterior na mão, a tela troca os dados sem nenhum indicador.

## Rig: erros do collector aparecem no console

O rig entrega ao OTel Collector local, que responde 200 na hora. Se o envio do collector para o Dynatrace falha (token sem `logs.ingest`, URL errada, sem rede), o coletor Python não tem como saber: o contador de amostras sobe, a fila fica baixa e o painel continua vazio.

Até aqui a saída de erro do collector ficava presa num pipe que ninguém lia. Isso escondia o problema e ainda podia travar o collector quando o pipe enchesse. Agora avisos e erros dele aparecem na janela do rig, por exemplo:

```
[collector error] Exporting failed. Dropping data. | {"error": "... responded with HTTP Status Code 401"}
```

## Técnico

- `Dashboard.tsx`: `liveLoading` / `liveLapsLoading` só valem enquanto não há resultado anterior.
- `rig/hackathon_racing.py`: thread `repassar_erros_do_collector` lê o stderr do collector e repassa linhas `warn`/`error`.
- Cadeia validada localmente com o OTel Collector 0.57.0 oficial e a `otelcol-racing.yaml` desta versão: replay → collector → endpoint OTLP, ~1 envio/s, sem erros.
