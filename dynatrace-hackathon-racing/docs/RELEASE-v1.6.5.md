# v1.6.5 — Fim da bolinha fantasma no meio da pista

Corrige o que parecia um bug visual: antes do carro ter uma posição real (carregando, ainda nos boxes), o AMS2 manda `pos_x=0, pos_y=0`. O app desenhava esse valor como se fosse telemetria de verdade — e como Interlagos nunca passa perto da origem do mundo (o nó mais próximo fica a 115 unidades dali), a bolinha aparecia flutuando sozinha no meio do traçado, sem seguir nenhuma curva.

## O que mudou

- `parseEvents` agora trata o par exato `pos_x=0, pos_y=0` como "ainda sem posição" (igual a não ter mandado nada), em vez de aceitar como coordenada válida.
- Isso afeta tudo que já dependia de posição válida — a bolinha do carro no mapa, o mapa de calor e os destaques da aba Dynatrace Intelligence — de uma vez só, porque todos correm a partir do mesmo `parseEvents`.
- Uma amostra com só um dos eixos em zero (`pos_x=0, pos_y=42`, por exemplo) continua válida — só o par exato (0,0) é descartado.

## Técnico

- `racing.ts`: `parseEvents` ganhou a checagem `semPosicaoReal = posX === 0 && posY === 0`, aplicada a `pos_x`/`pos_y` antes de devolver a amostra.
- 2 testes novos (58 no total, eram 56): confirma que `(0,0)` vira `null` nos dois eixos, e que um valor real num dos eixos não é descartado por engano.
- `npm run lint`, `npm test` (58/58) e `npm run build` limpos. Validado também contra uma captura real via o script local (`replay_server.py`), sem regressão nos marcadores normais.
