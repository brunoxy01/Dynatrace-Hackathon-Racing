# v1.9.0 — Menos atraso no coletor + brilho do pódio colorido por posição

## Latência do coletor reduzida

A pedido: investigamos onde dá pra apertar o atraso entre o AMS2 e o mapa aparecer no app. Achamos dois pontos reais na cadeia (rig → OTel Collector → Dynatrace → Grail → app):

1. **`ams2_collector.py`**: o coletor Python segurava as amostras por até **1 segundo** (`--flush-interval`) antes de mandar pro Dynatrace. Baixado para **0.5s**.
2. **OTel Collector** (`otel/otelcol-racing.yaml` e `otel/otelcol-teste-local.yaml`): o processor de batch segurava por até **5 segundos** (`batch.timeout`) antes de enviar o lote — esse era o maior atraso configurável de toda a cadeia. Baixado para **2s**.

Juntos, isso corta até ~3,5s do atraso de ponta a ponta (rig → Dynatrace), sem sobrecarregar a rede: a 20 Hz, 2s ainda agrupa um lote saudável de amostras por requisição.

**Importante ser honesto sobre o que isso NÃO resolve:** depois que a amostra chega no Dynatrace, o Grail ainda leva um tempo próprio para indexar e deixar o dado disponível para consulta (inerente à plataforma, maior para business events do que para logs). Essa parte não é configurável por aqui. O ajuste desta versão reduz o atraso que ACONTECE ANTES de chegar no Dynatrace — a parte que o rig controla.

O `racing.ini` gerado no pacote do rig (release) já sai com `flush_interval = 0.5`.

## Brilho do pódio: rotativo e colorido por posição

A pedido: o brilho dos carrinhos deixa de ser pulsante no próprio ícone e passa a ser a **borda rotativa do card**, no mesmo estilo já usado no painel do mapa da pista — só que agora colorida por posição: ouro no 1º lugar, prata no 2º, bronze/cobre no 3º (antes era uma cor roxa única para os três).

## Técnico

- `ams2_collector.py`: `--flush-interval` default 1.0 → 0.5.
- `rig/hackathon_racing.py`: fallback de `RACING_FLUSH_INTERVAL` 1.0 → 0.5.
- `.github/workflows/pacote-rig.yml`: `racing.ini` do pacote já sai com `flush_interval = 0.5`.
- `otel/otelcol-racing.yaml` e `otel/otelcol-teste-local.yaml`: `batch.timeout` 5s → 2s.
- `strato-theme.css`: `.company::before` usa `var(--rank-cor, var(--racing-purple))` em vez de uma cor fixa.
- `racing.css`: `.place-1/2/3` ganham `--rank-cor` (ouro/prata/bronze) e a cor da borda superior do card passa a bater com o pódio; `.capacete-brilho` perde a animação de pulso (fica um drop-shadow fixo, sutil).
- `npm run lint`, `npm test` (58/58), `npm run build` e os 15 testes Python, todos limpos. Validado localmente: borda do pódio gira na cor de cada posição.
