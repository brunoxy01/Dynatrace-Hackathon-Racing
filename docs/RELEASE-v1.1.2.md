# v1.1.2 — Piloto aparece desde o primeiro quadro

Só o app mudou (**1.1.1 → 1.1.2**, precisa reinstalar na tenant). O pacote dos simuladores segue o mesmo da v1.1.0.

Dois defeitos relatados no modo **Replay da captura**.

## O nome do piloto não aparecia

O AMS2 manda o nome do piloto e o modelo do carro em pacotes UDP próprios, uns **27 segundos depois** do primeiro quadro de telemetria. Até lá os dois campos vêm nulos — são **535 dos 7.236 quadros** da captura real.

O resumo por piloto descartava todo quadro sem nome, então o painel ficava em "Aguardando piloto" durante os primeiros **6,8 segundos** de reprodução. Na captura isso é especialmente sem sentido: é uma gravação fechada, o piloto é conhecido desde sempre.

Agora a identidade é preenchida para trás dentro da mesma sessão: como a sessão é a chave, os quadros do início pertencem a alguém que o resto do bloco já identifica. O nome e o carro aparecem **no primeiro quadro revelado**, e os 535 quadros voltam a contar para a velocidade máxima e a telemetria do piloto, em vez de serem ignorados.

Vale também ao vivo, no começo de cada sessão nova — e nunca empresta nome entre sessões diferentes.

## O período não aparecia

O seletor de período é um controle de consulta ao Grail, então ficava escondido no replay — que lê um arquivo local e não consulta nada. O efeito colateral é que o modo parecia quebrado.

O replay agora mostra a janela da própria gravação, no lugar onde ficaria o seletor:

```
18/09/2026 · 21:25–21:32 · 6min05
```

Junto saiu um `19 set 2026` que estava escrito à mão na barra de status. Ele vinha da data UTC da captura e passaria a contradizer o rótulo novo, que usa o fuso local de quem abre o painel. A barra agora diz só "Captura real do Automobilista 2", e a data sai de um lugar só.

## Verificação

25 testes do app, `npm run lint`, `npm run build` e `tsc` limpos. O replay foi simulado sobre o `capture.json` real, quadro a quadro: o piloto aparece no cursor 20 (antes, só no 540) e nenhum dos 7.236 quadros fica sem nome ou sem carro.
