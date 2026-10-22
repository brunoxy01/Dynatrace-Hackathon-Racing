# v1.6.1 — Mapa dos destaques com mapa de calor e pilotos

Ajuste em cima da v1.6.0, a pedido: o "Mapa dos destaques" da aba Dynatrace Intelligence estava muito vazio (só um contorno cinza com três bolinhas soltas). Só esse componente mudou.

## O que mudou

- O mini-mapa agora desenha o **mapa de calor combinado por baixo dos marcadores** — os mesmos trechos coloridos de azul (velocidade), vermelho (frenagem) e verde (aceleração) do mapa principal, não só um contorno cinza.
- Além das 3 bolinhas grandes (zona mais forte de freio/aceleração/velocidade), agora aparecem **bolinhas pequenas com as iniciais dos 3 pilotos mais fortes** de frenagem e de aceleração, no ponto exato da pista — a mesma informação das duas listas abaixo, só que também plotada no lugar.
- Marcadores que caem no mesmo ponto de referência (comum quando a zona mais puxada da pista é a mesma para todo mundo) deixaram de sobrepor texto: os rótulos de zona empilham verticalmente, e os pilotos se espalham num pequeno arco ao redor do ponto.
- Legenda de cores abaixo do mapa, reaproveitando o mesmo componente visual do mapa principal.

Continua sem nenhuma consulta nova ao Grail: é o mesmo `events` já carregado pela aba, só desenhado de um jeito mais denso.

## Técnico

- `TrackMap.tsx`: `InsightsMap` passou a receber `events` e calcular `trackHeat`/`mixedHeatColor` como o `TrackMap` principal; marcadores agora têm `kind: 'zona' | 'piloto'`, agrupados por ponto de referência antes de desenhar, para resolver sobreposição.
- `Dashboard.tsx`: `mapaInsights` inclui os top-3 de `frenagemPorPiloto` e `aceleracaoPorPiloto`, além das 3 zonas globais.
- Validado localmente com o gerador de demonstração (`replay_server.py`, 4 participantes simulados): mapa de calor real nos trechos percorridos, cluster de marcadores sem sobreposição de texto.
- `npm run lint`, `npm test` (56/56, sem testes novos — mudança é só de apresentação) e `npm run build` limpos.
