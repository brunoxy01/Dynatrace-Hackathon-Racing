# v1.5.0 — Dynatrace Intelligence, suporte confirmado a 2+ simuladores, rollback do azul padrão

Só o app mudou (**1.4.4 → 1.5.0**). Continua na branch `feature/tres-telas`, sem merge na main. O pacote dos simuladores segue o mesmo da v1.1.0.

## Rollback: a pista volta a ficar cinza onde não há dado

A v1.4.4 tinha trocado os trechos sem telemetria de cinza para azul, para não dar impressão de perda de dados. A pedido, revertido: um nó sem amostra nenhuma volta a ficar cinza, distinto de um nó com dado real mas zerado (parado, sem frear, sem acelerar), que continua azul. A bandeira do Brasil e o espaçamento dos filtros da v1.4.4 permanecem.

## Suporte a 2+ simuladores em tempo real, confirmado

A identidade de cada carro no mapa já era `rig.id + session.id` desde a v1.1.0 — dois rigs diferentes sempre geram duas trilhas independentes, e `CarMarkers` desenha um marcador por trilha sem limite de quantidade. Isso **já funcionava**; o que faltava era prova disso contra o cenário exato que preocupa: dois simuladores transmitindo ao mesmo tempo, com relógios que não batem perfeitamente.

Dois testes novos cobrem isso:
- dois rigs com timestamps sobrepostos: cada um aparece na própria posição mais recente, nunca na do outro;
- um rig atrasado em relação ao outro (latência de rede): o relógio compartilhado do mapa não faz o atrasado desaparecer nem pular para uma posição que ele nunca reportou — ele fica na última posição real dele até ter mais dado.

Também verificado de novo num navegador, com 4 carros simultâneos do gerador local renderizando corretamente ao mesmo tempo.

## Nova aba: Dynatrace Intelligence

Observações automáticas sobre o período selecionado, calculadas a partir do que o app já carrega — **sem** consulta nova ao Grail e **sem** nenhuma IA externa (Davis CoPilot ficou de fora desta rodada; precisaria de investigação própria sobre API e permissões disponíveis no toolkit).

- **Zona de maior frenagem** — intensidade média de freio por trecho do traçado, localizada pelo ponto de referência mais próximo (mesma numeração 01-06 já desenhada no mapa).
- **Pico de velocidade** — maior leitura válida do período e onde ocorreu.
- **Consistência volta a volta** — desvio padrão do tempo de volta por piloto, do mais consistente para o menos, exigindo pelo menos duas voltas no período (uma volta só não tem desvio que signifique algo).

A aba reaproveita a mesma consulta de telemetria do "Ao vivo" (nenhuma consulta nova criada) e a mesma consulta de voltas do "Placar"/"Replay".

## Verificação

51 testes do app (8 novos: 2 de concorrência entre simuladores, 6 das três funções de insight), `npm run lint` e `npm run build` limpos. Testado num navegador local: a aba renderiza sem erro com os estados vazios corretos quando não há dado; as três funções de insight foram executadas contra a captura real (zona de frenagem a 96,3% perto do ponto 01, pico de 300,6 km/h no mesmo ponto — valores plausíveis e consistentes com o que já sabíamos da captura).
