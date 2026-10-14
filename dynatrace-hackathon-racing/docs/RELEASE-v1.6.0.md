# v1.6.0 — Dynatrace Intelligence com mais contexto

Só a aba **Dynatrace Intelligence** mudou nesta versão. Nenhuma outra tela foi tocada.

## O que mudou

A aba tinha dois cartões (frenagem e velocidade) e uma lista de consistência. Virou:

- **Três cartões**: frenagem, **aceleração** (não existia) e velocidade.
- **Pico de velocidade agora mostra o piloto** que atingiu a marca, não só o número e o ponto de referência.
- **Mapa dos destaques**: miniatura do traçado de Interlagos com um marcador colorido em cada ponto de referência onde a frenagem, a aceleração ou a velocidade máxima aconteceram — para não depender só do número do ponto em texto.
- **Duas listas novas, por piloto**: a zona de frenagem mais forte e a zona de aceleração mais forte de cada piloto, lado a lado, no mesmo estilo da lista de consistência que já existia.

Tudo calculado do que o app já carrega (telemetria do período + voltas concluídas) — nenhuma consulta nova ao Grail, nenhuma dependência de IA externa.

## Técnico

- `racing.ts`: `topSpeedLocation` ganhou o campo `driverName`; `accelerationHotspot` é novo (mesma lógica de `brakingHotspot`, isolada em `acceleration_g`); `brakingHotspotsByDriver` e `accelerationHotspotsByDriver` agrupam por `driver_name` e retornam a zona mais forte de cada piloto, ordenado do mais intenso para o mais fraco.
- `TrackMap.tsx`: novo componente `InsightsMap`, uma silhueta compacta do traçado (sem mapa de calor, sem carro) que recebe uma lista de marcadores `{referencePoint, color, label}` e os posiciona usando a mesma numeração de pontos de referência já desenhada no mapa principal.
- `Dashboard.tsx`: três novos `useMemo` (`hotspotAceleracao`, `frenagemPorPiloto`, `aceleracaoPorPiloto`) e um `mapaInsights` que monta os marcadores do `InsightsMap` a partir dos três cartões.
- 5 testes novos (56 no total, eram 51): `accelerationHotspot` (acha a zona certa / retorna null sem amostra), `brakingHotspotsByDriver` e `accelerationHotspotsByDriver` (um por piloto, ignora amostra sem nome), e `topSpeedLocation` agora também confere o `driverName`.
- `npm run lint`, `npm test` (56/56) e `npm run build` limpos.
