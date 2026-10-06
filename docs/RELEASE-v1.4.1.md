# v1.4.1 — Volta nova aparece sozinha no Ao vivo, replay acha a largada

Só o app mudou (**1.4.0 → 1.4.1**). Continua na branch **`feature/tres-telas`**, sem merge na main.

## A volta concluída não aparecia no Ao vivo

Regressão introduzida na v1.3.1, e inteiramente autoinfligida. A queixa era que as tabelas se recarregavam sozinhas e descartavam a ordenação no meio da leitura — e eu tirei a recarga automática **de todas as telas**, inclusive daquela que existe justamente para ser ao vivo. Uma volta recém-concluída só aparecia quando alguém clicava em *Atualizar*.

Agora a lista de voltas se recarrega sozinha **a cada 15 segundos, e só na tela Ao vivo**. No **Placar** e no **Replay** continua manual, que é onde a recarga atrapalhava. O botão *Atualizar* segue disponível nas três.

## O replay começava no meio da volta

O recorte por cronômetro estava certo — o problema era a janela de onde os dados vinham.

O instante que fica registrado para uma volta é o primeiro quadro que **reportou** o tempo, e ele pode chegar bem depois do cruzamento da linha: o simulador carrega o último tempo entre sessões, então **um coletor reiniciado reanuncia uma volta antiga**. A janela antiga tinha 2 segundos de folga; qualquer atraso maior que isso e a largada caía fora dela, deixando a reprodução começar com o cronômetro já andando. Como só algumas voltas são reanunciadas, só algumas falhavam.

A folga antes passou de 2 para **30 segundos** (e 3 depois). Simulado contra a volta real da captura, com atrasos de anúncio de 0, 5, 15 e 25 segundos:

| atraso do anúncio | início da reprodução | cronômetro |
|---|---|---|
| 0 s | 0,0 m da largada | 0,057 s |
| 5 s | 0,0 m | 0,057 s |
| 15 s | 0,0 m | 0,057 s |
| 25 s | 0,0 m | 0,057 s |

A janela maior passa a conter mais de uma volta, e o recorte continua escolhendo a certa: ele procura o quadro de maior cronômetro **dentro da duração oficial**, o que exclui a cauda da volta anterior (cronômetro maior) e o começo da seguinte (cronômetro zerado).

## Quando a largada não está nos dados

Se o anúncio atrasar mais que a folga — um coletor reiniciado minutos depois —, a largada simplesmente não existe no trecho gravado. Nesse caso o app **avisa**, dizendo com quanto cronômetro a volta começa e por quê, em vez de reproduzir um trecho errado em silêncio. A reprodução mostra o que existe.

## Verificação

38 testes do app, `npm run lint`, `npm run build` e `tsc` limpos. Ganharam teste: a janela assimétrica, o recorte quando a janela contém três voltas (tem de ficar com a do meio), e o caso da largada ausente — que deve ser sinalizado, não disfarçado. O comportamento com atraso de anúncio foi medido contra a volta real da captura.

**As telas não foram abertas num navegador.**
