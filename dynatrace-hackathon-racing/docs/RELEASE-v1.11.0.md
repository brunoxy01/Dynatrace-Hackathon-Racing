# v1.11.0 — Uma coluna por piloto no Ao vivo

Com 2 (ou mais) simuladores rodando ao mesmo tempo, o painel "Piloto na pista" mostrava só **um** piloto — o da amostra mais recente. Os outros ficavam de fora, mesmo transmitindo normalmente.

## O que mudou

- A aba **Ao vivo** agora mostra **uma coluna completa por piloto com telemetria fresca** (ficha + telemetria ao vivo própria), lado a lado com o mapa — não empilhadas uma embaixo da outra. Sem limite de quantidade: cabe 2, 3 ou quantos simuladores estiverem ativos; se não couberem todas as colunas na largura da tela, as de mais quebram pra linha de baixo sozinhas.
- "Fresco" usa a mesma janela de 60s já usada pelo indicador de pulso ("Ao vivo · N amostras/min") — quem não manda nada há mais de um minuto sai da lista, do mesmo jeito que já "sumia" silenciosamente antes.
- Com um piloto só (ou nenhum), o layout é idêntico ao de antes — mapa + uma coluna, igual sempre foi.
- Escolher um piloto específico no seletor "Todos os pilotos" continua mostrando só aquele, como já era — o layout de várias colunas é só para "Todos os pilotos" com mais de um ativo.

## Técnico

- `racing.ts`: nova função pura `activeDrivers(drivers, now, windowMs)` — filtra e ordena por mais recente primeiro. 2 testes novos (79 no total, eram 77).
- `Dashboard.tsx`: `painelDoPiloto` ganha `cartaoDoPiloto` (extraído do card único de antes); quando há 2+ pilotos ativos, devolve uma `<div className="driver-column">` por piloto como filha direta do `.hero-grid` (lado a lado), em vez de empilhar tudo dentro de uma coluna só.
- `racing.css`: `.hero-grid-multi` (flex-wrap, aplicado só quando há 2+ pilotos) substitui o grid fixo de 2 colunas nesse caso — o mapa mantém um tamanho mínimo confortável e cada coluna de piloto tem no mínimo 300px, quebrando linha sozinha.
- Validado localmente: patch temporário fazendo o Script local (4 participantes simultâneos da demonstração) passar pelo mesmo caminho do Ao vivo confirmou as colunas lado a lado, quebrando para uma segunda linha com 1400px de largura; revertido antes do commit.
- `npm run lint`, `npm test` (79/79) e `npm run build` limpos.
