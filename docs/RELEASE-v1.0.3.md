# v1.0.3 — Resistência a rede instável

Só o pacote dos simuladores mudou. **O app continua na 1.0.1**, nada a reinstalar na tenant.

Durante o teste no rig do Plinio apareceu isto:

```
[erro] bizevents (20 evento(s)): falha de conexao -
       <urlopen error _ssl.c:993: The handshake operation timed out>
```

Um soluço de rede no POST para a API de business events. **Nenhum dado foi perdido**: o caminho OTLP roda independente do de bizevents, então aquelas 20 amostras chegaram ao Grail pelo collector, como logs, e o app deduplica por `sample.id`. O caminho duplo fez exatamente o que foi desenhado para fazer.

Mesmo assim, o episódio expôs duas fraquezas que agora estão corrigidas.

## Retry nas falhas transitórias

O lote morria na primeira falha. Agora são três tentativas com backoff. Erros 4xx **não** são repetidos — token errado ou escopo faltando não melhoram insistindo, só atrasam o próximo lote.

## O envio saiu da thread de captura

Esse era o problema mais sério, e invisível no log. O POST remoto rodava na mesma thread que lê o socket UDP. Com a rede lenta, o `recvfrom` ficava parado dezenas de segundos e o buffer do socket transbordava — perdendo telemetria que o jogo **já tinha entregue** à máquina, sem nada aparecer no console.

O envio de bizevents passou para uma thread própria, com fila limitada. O OTLP continua síncrono: vai para `127.0.0.1`, que aceita na hora e já tem fila em disco e reenvio dentro do próprio collector.

Verificado com um endpoint que trava 12 segundos nas três primeiras tentativas: a captura seguiu sem pausa e **1.240 das 1.241 amostras foram entregues**. Antes, aqueles 36 segundos de travamento derrubariam tudo que chegasse no período.

## Encerramento

Ctrl+C agora espera a fila de envio esvaziar antes de fechar, em vez de descartar o que estava pendente.
