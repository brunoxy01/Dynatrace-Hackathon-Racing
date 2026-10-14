# v1.6.2 — "O que o mapa mostra": insights em texto ao lado do mapa

Ajuste em cima da v1.6.1, a pedido: o mapa dos destaques ficava sozinho, sem nenhuma leitura em texto ao lado — só quem olhasse com calma as bolinhas e cores entendia o que estava vendo. Só esse painel mudou.

## O que mudou

- O "Mapa dos destaques" virou duas colunas: o mapa à esquerda, e uma caixa **"O que o mapa mostra"** à direita, com os mesmos achados em frases curtas:
  - Freio mais forte: ponto de referência e intensidade média.
  - Aceleração mais forte: ponto de referência e intensidade média.
  - Pico de velocidade: valor, piloto e ponto de referência.
  - Piloto com o freio mais forte (o primeiro da lista de frenagem por piloto).
  - Piloto com a aceleração mais forte (o primeiro da lista de aceleração por piloto).
- Cada linha tem uma bolinha colorida igual à do mapa (vermelho = freio, verde = aceleração, azul = velocidade), para a leitura em texto e o mapa usarem a mesma linguagem visual.
- Em telas estreitas (abaixo de 1080px) a caixa de texto desce para debaixo do mapa, em vez de espremer as duas colunas.

Mesma fonte de dados de sempre — nenhuma consulta nova ao Grail, nenhum dado novo calculado; é só o que já estava nos cartões e nas listas, resumido ao lado do mapa.

## Técnico

- `Dashboard.tsx`: o conteúdo de `insights-map-panel` virou um grid de duas colunas (`insights-map-row`); a coluna da direita (`insights-notes`) é uma lista de `<li>` condicionais, cada uma lendo os mesmos `hotspotFrenagem`, `hotspotAceleracao`, `picoVelocidade`, `frenagemPorPiloto[0]` e `aceleracaoPorPiloto[0]` já usados nos cartões.
- `racing.css`: `.insights-map-row` (grid 1.3fr/1fr, empilha em telas estreitas) e `.insights-notes` (caixa com borda, lista com bolinha colorida por linha, reaproveitando as cores de `.mixed-legend`).
- Validado localmente com o gerador de demonstração (4 participantes simulados): texto e mapa concordam entre si (mesmo ponto de referência, mesma cor, mesmo piloto).
- `npm run lint`, `npm test` (56/56, sem testes novos — mudança é só de apresentação) e `npm run build` limpos.
