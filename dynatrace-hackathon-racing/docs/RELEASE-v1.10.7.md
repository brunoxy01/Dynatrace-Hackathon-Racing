# v1.10.7 — Ao vivo sem saltos e sem pista pintada à frente do carro

App (**1.10.6 → 1.10.7**) e pacote do rig.

## O que estava acontecendo

1. **A pista pintava antes da bolinha chegar.** O mapa de calor usava todas as amostras recebidas, inclusive as mais novas, mas a bolinha anda de propósito 5 s atrás delas. Com a janela de 2 minutos do Ao vivo, a "ponta" pintada ficava visivelmente à frente do carro.
2. **A bolinha andava em degraus.** O rig manda 10 amostras/s e o relógio do mapa anda a cada 50 ms. Sem interpolação, a bolinha ficava parada 100 ms e saltava para a amostra seguinte.
3. **O rig podia mandar em rajadas.** Desde a v1.10.4 o envio usa uma conexão só, para manter a ordem. Se um POST demorasse mais que o intervalo de envio (0,5 s), os lotes se acumulavam e chegavam em blocos: a bolinha parava e depois corria.

## O que mudou

- **App:** a posição da bolinha é **interpolada** entre as duas amostras em volta do instante. Buracos maiores que 1 s (box, pausa, reinício) não são interpolados, para o carro não deslizar por fora da pista.
- **App:** no Ao vivo, o mapa de calor vai **só até o ponto onde a bolinha começa** a cada recarga. Entre recargas, o carro anda à frente da tinta, nunca atrás.
- **Rig:** a thread de envio **junta num POST só** os lotes que se acumularam enquanto o anterior viajava (até 500 amostras). A ordem se mantém, e quando a rede piora o POST cresce, não a fila.

## Setores (S1/S2/S3)

Nada mudou no cálculo. Validado de novo pelo caminho real do rig: gerador UDP fazendo o papel do jogo → coletor com corte de 10 Hz → evento com S1 = 24,653, S2 = 57,540, S3 = 21,822. Os setores exigem o pacote do rig **v1.10.5 ou mais novo** e aparecem a partir da **primeira volta completa** depois de abrir o coletor. Voltas gravadas com rigs anteriores ficam com "—".

## Técnico

- `racing.ts`: `positionAt` (interpolação, sem atravessar buracos > 1 s). `TrackMap.tsx`: marcadores usam `positionAt`; calor do Ao vivo cortado em `mais nova − PLAYBACK_TRAIL_MS`.
- `ams2_collector.py`: `EnvioEmSegundoPlano` agrupa a fila acumulada num único envio (`max_por_envio = 500`).
- Teste de envio com a captura real: a 20× a velocidade do jogo, 3.549/3.549 amostras entregues sem descarte.
- Testes novos: interpolação da bolinha; fila acumulada saindo num POST só, em ordem. `npm test` (67/67), `npm run lint`, `tsc` e os testes Python limpos.
