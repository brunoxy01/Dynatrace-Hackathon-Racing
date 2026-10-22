# v1.10.13 — Setores registrados em todas as voltas

Pacote do rig **e** app (**1.10.12 → 1.10.13**). **O conserto está no rig**: atualize o `HackathonRacing.exe` nos simuladores. As voltas já gravadas sem setores continuam com "—"; o setor não foi enviado na hora.

## O problema

Algumas voltas registravam S1/S2/S3 e outras não, de forma intermitente. O tempo da volta sempre aparecia.

## A causa

O coletor só fechava os setores de uma volta quando via, **no mesmo pacote**, o número da volta aumentar com o setor anterior ainda em S3. Na volta completa da captura as duas coisas mudam juntas. Mas o jogo às vezes vira o setor um pacote **antes** de incrementar a volta; a própria captura tem uma passagem pela linha em que o setor vira e o número da volta não muda. Nesses casos o coletor perdia a volta, e se ela ia parar no placar, era sem setores.

Confirmado em teste: o código anterior falha exatamente no cenário "setor vira um pacote antes do número da volta"; o novo passa.

## O que mudou

- **Rig:** a volta fecha na **passagem S3 → S1**, que é a linha em si, sem depender do número da volta. O tempo oficial é casado com o **maior cronômetro visto na volta**, então tanto faz se o cronômetro zera antes ou depois da virada, ou se o tempo oficial chega antes ou depois da linha. Qualquer salto de setor fora de ordem (box, reinício, pacote perdido) descarta a volta em andamento: ela fica sem setores em vez de setores errados.
- **App:** a volta que entra no placar na hora pega os setores do primeiro quadro que os tiver. Se o tempo oficial chega um instante antes da linha, os primeiros quadros com ele ainda vêm sem setores.

## Quando ainda aparece "—" (esperado)

- Voltas gravadas com rigs anteriores à v1.10.13 que caíram no defeito acima.
- A primeira volta depois de abrir o coletor com o carro já na pista: o coletor entrou no meio dela.
- Voltas com ida ao box ou reinício no meio.

## Técnico

- `ams2_protocol.py`: `_acompanhar_setores` reescrito em torno da passagem S3 → S1, com `_maior_cur` no lugar do último cronômetro.
- `racing.ts`: `lapCompletions` busca os setores nos quadros seguintes da mesma volta.
- Testes novos para as ordens de pacote na linha: as duas mudanças juntas; setor antes do número da volta; número da volta antes do setor; cronômetro zerando antes da virada; tempo oficial antes da linha; salto fora de ordem (sem setores). Captura real continua dando S1 = 24,653, S2 = 57,540, S3 = 21,822.
- `npm test` (75/75), `npm run lint`, `tsc` e os testes Python limpos.
