# v1.4.3 — Espaçamento entre seções e mapa de calor um pouco mais tolerante

Só o app mudou (**1.4.2 → 1.4.3**). Continua na branch `feature/tres-telas`, sem merge na main. O pacote dos simuladores segue o mesmo da v1.1.0.

Confirmado na tela real: as iniciais no mapa (PL, BR, JO, AG) e as pílulas douradas/prata/bronze da v1.4.2 estão no ar. Dois ajustes a partir do que foi visto.

## As seções ficavam coladas

`.leaderboard` (a tabela de voltas/pódio) não tinha margem própria acima — nem no "Ao vivo"/"Placar" (vinha direto depois do pódio de empresas) nem no "Replay" (vinha direto depois do mapa). Sem gap nenhum, os painéis pareciam duas caixas empurradas uma contra a outra. Adicionado `margin-top:24px`, confirmado via medição real (24px de distância entre os cards do pódio e a tabela abaixo).

## Mapa de calor: corte e tolerância de lacuna, um pouco mais generosos

Medindo o espaçamento real dos nós do traçado (não tinha feito isso na v1.4.2): a distância entre nós consecutivos já é ~27m em mediana, bem mais do que eu tinha assumido. O corte de distância do `nearestNode` passou de 35 para 45 unidades — dá folga para a racing line real desviar um pouco da referência sem deixar de contar —, e o limite de ponte do mapa de calor subiu de 3 para 5 nós (~135-175m).

**Honestidade sobre o que isso resolve e o que não resolve.** Medido contra uma volta real da captura: um SETOR inteiro pode ficar sem nenhuma amostra por perto — no caso medido, 34 nós seguidos (quase 1/4 da pista), porque a gravação daquela volta específica termina antes de voltar à linha. Nenhum limite de ponte razoável deveria tentar preencher isso — seria inventar dado para um quarto da pista que o carro nunca passou naquela volta. Esse cinza é esperado e correto. Os ajustes de v1.4.3 ajudam com lacunas pequenas e espalhadas (amostragem mais rala em retas rápidas, racing line fora da referência); não eliminam um buraco genuinamente sem dado.

## Verificação

43 testes do app (ajustados para a nova tolerância), `npm run lint` e `npm run build` limpos. O gap entre seções foi medido de verdade no navegador (24px). O efeito da tolerância maior no mapa de calor foi simulado contra a volta real da captura — sem mudança no setor sem dado algum (correto, por design), mas sem acesso ao Grail não dá para confirmar o efeito exato na sessão específica que motivou o pedido.
