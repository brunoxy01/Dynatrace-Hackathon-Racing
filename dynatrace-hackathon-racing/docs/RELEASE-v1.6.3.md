# v1.6.3 — Pontos numerados no mapa dos destaques

Ajuste em cima da v1.6.2, a pedido: o texto "O que o mapa mostra" citava "ponto 01", "ponto 05" etc., mas o mapa em si não tinha nenhum número visível — só quem já conhecia a numeração do mapa principal sabia onde procurar.

## O que mudou

- **Os 6 pontos de referência agora aparecem sempre no mapa dos destaques**, numerados — os mesmos 6 pontos já numerados no mapa principal (Ao vivo/Replay). Os pontos sem nenhum destaque aparecem discretos, em cinza; o(s) ponto(s) com uma zona ou piloto em destaque ganha(m) um selo escuro com o número, bem visível, acima do cluster de bolinhas.
- Isso fecha o elo que faltava: o texto diz "perto do ponto 01" e agora dá pra achar exatamente onde é o ponto 01 no desenho, sem precisar decorar a numeração.

## Sobre a dúvida do "mapa estático com só um piloto"

Conferi o código: não é um bug de renderização. As duas listas "zona mais forte, por piloto" (frenagem e aceleração) e os marcadores do mapa usam a mesma telemetria "bruta" da aba Ao vivo — uma consulta ao Grail limitada às 10.000 amostras mais recentes do período. Já a lista de **Consistência** usa uma consulta separada e mais ampla, agregada por volta concluída, que não tem esse limite.

Isso significa: se o período escolhido for longo (ex.: "Last 7 days"), um piloto pode ter voltas completas registradas (aparece em Consistência) mas as amostras de posição/freio/aceleração dele podem ter ficado de fora das 10.000 mais recentes — por isso ele não aparece nas zonas por piloto nem no mapa, mesmo estando "ali" nos dados. Essa é a mesma armadilha da janela de 10.000 amostras já conhecida no projeto desde a v1.0.0.

No dia do evento, com 2 simuladores rodando ao mesmo tempo e um período curto (ex.: "Last 30 minutes"), os dois cabem tranquilamente nas 10.000 amostras — já testamos isso com 4 carros simultâneos sem problema. O caso que você viu foi testando com um período longo, que mistura sessões antigas.

Se quiser que as zonas por piloto e o mapa dos destaques sejam robustos mesmo em períodos longos (ignorando a janela de 10.000), dá para adicionar uma consulta dedicada à aba Intelligence com agregação por piloto direto no Grail — isso é uma mudança de escopo maior (sai do "sem consulta nova" original) e prefiro confirmar com você antes de fazer.

## Técnico

- `TrackMap.tsx`: `InsightsMap` agora desenha os 6 pontos de referência sempre (`REFERENCE_POINT_COUNT`), com um selo numerado adicional acima de cada cluster de zona/piloto.
- Sem mudança de lógica de dados — só apresentação.
- `npm run lint`, `npm test` (56/56) e `npm run build` limpos.
