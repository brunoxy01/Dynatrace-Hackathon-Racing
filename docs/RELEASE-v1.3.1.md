# v1.3.1 — Ranking por volta, replay que roda mais de uma vez

Só o app mudou (**1.3.0 → 1.3.1**). Continua na branch **`feature/tres-telas`**, sem merge na main.

Cinco problemas relatados no uso das telas novas.

## "7 dias, e só uma linha na tabela"

O ranking era **por piloto**: uma linha por pessoa, com o melhor tempo dela. Com um piloto só na pista, o período inteiro virava **uma linha** — por mais voltas que tivessem sido dadas.

Agora o ranking é **por volta**, da mais rápida para a mais lenta. Um piloto rápido ocupa várias posições, que é como um ranking de tempos funciona. Vale nas telas **Ao vivo** e **Histórico**.

## A tabela recarregava sozinha

As voltas eram reconsultadas a cada 30 segundos. No meio da leitura a tabela se redesenhava, **descartando a ordenação e a página** em que a pessoa estava — o que também explica a queixa de que clicar em *Tempo* não ordenava: ordenava, e a recarga seguinte desfazia.

A recarga automática das voltas saiu. Cada tabela ganhou um botão **Atualizar** no canto superior direito, e só busca dados novos quando você pedir. O mapa da tela **Ao vivo** continua atualizando sozinho a cada 5 segundos — ali é o objetivo.

As colunas de tempo também ganharam ordenação explícita pelo valor em segundos, não pelo texto `1:37.400`.

## O replay só rodava uma vez

Bug de verdade, e a razão de "não consigo rodar o replay". O fim da volta era guardado em estado por um efeito que chamava `setPlaying(false)`. Esse efeito lia o cursor do render **anterior**: ao escolher uma segunda volta, o cursor ainda era o do fim da primeira, então a reprodução era pausada no mesmo instante em que começava. A primeira volta rodava; as seguintes, não.

O fim da volta passou a ser **derivado** do cursor e do total de amostras, em vez de guardado. Sem estado, sem corrida entre efeitos.

## Clicar na volta reproduz

Na tela **Replay**, o tempo da volta virou o próprio botão: clicar em `1:37.400` reproduz aquela volta. A coluna de ação separada saiu — duplicava o alvo de clique sem dizer nada a mais. A coluna continua ordenável pelo tempo.

## Disputa entre empresas mostrava o piloto errado

O pódio passava por um "melhor de cada piloto" antes de agrupar por empresa. Quando o mesmo piloto tinha várias voltas, a volta certa se perdia nesse meio do caminho. Agora o pódio sai direto das voltas já ordenadas por tempo: a primeira volta de cada empresa é, por construção, a melhor dela.

**Atenção:** voltas sem `company_name` preenchido **não entram no pódio**. Se o seu nome não aparece pela empresa certa, confira o `company_name` no `racing.ini` do rig — sem ele, o coletor tenta extrair do perfil do AMS2 no formato `Nome [Empresa]`, e sem os colchetes a volta fica sem empresa.

## Verificação

32 testes do app, `npm run lint`, `npm run build` e `tsc` limpos. Ganharam teste: o ranking por volta (o piloto rápido ocupando mais de uma posição), o descarte de voltas sem tempo utilizável, e o pódio de empresas — este último reproduzindo o caso relatado, com um piloto de duas voltas e outro com a volta mais rápida da mesma empresa.

**As telas não foram abertas num navegador.**
