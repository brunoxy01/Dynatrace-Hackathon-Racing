# v1.10.6 — Replay de linha a linha e classificação paginada

Só o app mudou (**1.10.5 → 1.10.6**). O pacote do rig é o mesmo da v1.10.5.

## Replay começa na linha de largada e termina na linha de chegada

O AMS2 entrega o carro um pouco antes da linha, e nesse trecho o cronômetro do jogo pode já estar correndo. O replay recortava a volta **só pelo cronômetro**, então começava exatamente onde o piloto ganhava o controle, antes da linha.

Agora o recorte usa a **posição do carro na pista**. A linha de largada/chegada é o ponto 0 do traçado do app, e o carro anda no sentido crescente: cruzar a linha é pular do último ponto para o primeiro. Conferido na captura: 466 → 0, no mesmo quadro em que o cronômetro zera. O cronômetro continua localizando qual volta é; a passagem pela linha mais próxima de cada ponta define o primeiro e o último quadro.

Na volta real da captura, a reprodução começa no ponto 0 (cruzamento da linha) e termina no ponto 466, o último antes da chegada. Sem posição nas amostras, vale o recorte antigo pelo cronômetro.

O mesmo recorte vale para a volta de referência do delta ("contra a melhor volta").

## Classificação: top 20 com paginação

As tabelas de classificação (Ao vivo e Placar) deixam de cortar nas 10 primeiras. Agora mostram **todas as voltas do período, 20 por página**. A primeira página é o top 20; com mais voltas, a tabela pagina.

No Ao vivo, as voltas recarregam a cada 15 s. A tabela não volta mais para a página 1 a cada recarga; ela só recomeça do topo quando o período muda.

## Técnico

- `racing.ts`: `lineCrossings`, `trimToLineToLine` (cronômetro localiza a volta, passagem pela linha recorta) e `startsAtTrackLine`. O aviso de "largada fora do trecho gravado" considera a posição, não só o cronômetro.
- `Dashboard.tsx`: replay e referência usam `trimToLineToLine`. Classificação com `DataTable.Pagination` (20 por página, `autoResetPageIndex={false}`, `key` pelo período).
- Testes novos com o traçado real de Interlagos: cronômetro já correndo antes da linha, cronômetro que só aparece depois dela (como na captura) e amostras sem posição. `npm test` (66/66), `npm run lint`, `tsc` limpos.
