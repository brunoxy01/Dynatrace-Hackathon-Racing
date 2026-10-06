# v1.4.4 — Bandeira do Brasil, espaçamentos e mapa sempre azul

Só o app mudou (**1.4.3 → 1.4.4**). Continua na branch `feature/tres-telas`, sem merge na main. O pacote dos simuladores segue o mesmo da v1.1.0.

Três ajustes a partir do print com as marcações.

## Selo do Brasil no cabeçalho

Novo selo com a bandeira do Brasil ao lado do título, com o mesmo efeito de borda/brilho do painel do mapa — só que em verde e amarelo em vez de roxo.

## Filtros colados na tabela, na tela de Replay

`Filtrar por` e os três seletores (piloto/empresa/simulador) não tinham margem antes da tabela de voltas. Adicionado espaço — 20px medidos de verdade no navegador.

## O mapa de calor não fica mais cinza

Pedido direto: um trecho sem dado dava a impressão de telemetria perdida. Agora todo nó do traçado tem cor — real onde há amostra, **azul por padrão** (a mesma cor usada para "parado/sem frear/sem acelerar") onde ainda não há. A legenda do mapa foi atualizada: "Azul também é o padrão onde ainda não há dado" no lugar de "Cinza: sem dados".

Isso não distingue mais visualmente "sem dado nenhum" de "parado, sem frenagem nem aceleração" — os dois mostram o mesmo azul, de propósito: o pedido explícito foi não dar a impressão de perda de dados.

## O que isso não resolve (continua genuíno)

Os ajustes da v1.4.3 (corte de distância e tolerância de ponte maiores) continuam valendo: um setor inteiro sem nenhuma amostra próxima — o caso medido contra a captura real, ~900m sem dado numa volta cuja gravação terminou antes de voltar à linha — agora aparece **azul** em vez de cinza, graças a este ajuste, mas o app ainda não "sabe" que o carro passou ali. É uma mudança puramente visual: deixa de parecer erro, sem fingir que há telemetria onde não há.

## Verificação

43 testes do app (ajustados: `mixedHeatColor` com todos os valores nulos ou zerados agora espera azul, não null), `npm run lint` e `npm run build` limpos. Os três pontos conferidos num navegador: bandeira renderizando (66×66px, borda verde/amarela), gap de 20px entre filtros e tabela na tela de Replay, e a pista inteiramente azul mesmo com a simulação local parada (zero amostra).
