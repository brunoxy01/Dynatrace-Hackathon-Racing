# v1.4.0 — Delta contra o líder, replay na largada e medalhas

Só o app mudou (**1.3.1 → 1.4.0**). Continua na branch **`feature/tres-telas`**, sem merge na main.

## O replay agora começa na largada

O replay começava com o carro já andando, um pouco antes da linha. A janela que busca a volta no Grail tem margem nas duas pontas de propósito — o "fechamento" é o primeiro quadro que reportou o tempo, não o cruzamento exato —, e essa margem aparecia na tela.

Quem sabe onde a volta começa é o **cronômetro do próprio jogo**: `lap_time_s` zera ao cruzar a linha e cresce até o tempo da volta. O recorte anda de trás para frente a partir do fechamento enquanto o cronômetro decresce; ele para de decrescer — ou some, porque o jogo não reportava tempo na volta anterior — exatamente na largada.

Medido contra a volta real da captura:

| | antes | depois |
|---|---|---|
| amostras | 2.160 | 2.080 |
| início | **141 m** antes da linha | **0,0 m** |
| cronômetro | 141,0 s (volta anterior) | **0,057 s** |
| fim | 2 s depois da linha | 104,012 s, a 4 m da linha |

A volta oficial é 104,015 s. A telemetria agora conta do zero ao fechar, e não de um ponto qualquer antes.

## Delta contra a melhor volta, ao vivo

No painel de telemetria, nas telas **Ao vivo** e **Replay**, apareceu a comparação com a volta mais rápida do período — o delta das transmissões de F1. Dá para saber, **antes de a volta terminar**, se o carro está ganhando ou perdendo para o líder naquele trecho. Verde à frente, vermelho atrás.

Funciona assim: as amostras da volta de referência viram um perfil "em cada ponto do traçado, quanto tempo o líder já tinha gasto para chegar ali". O carro atual é comparado no ponto onde está.

O perfil usa o traçado **completo** (467 pontos), não os pontos ralos do desenho: comparando uma volta contra ela mesma, o erro cai de 2,2 s para **1,0 s no pior caso e 0,11 s na média** — a pior imprecisão fica na curva mais lenta, onde o carro demora mais a atravessar o mesmo trecho.

**Limitação conhecida:** perto da linha, o mesmo ponto do traçado é visitado no começo e no fim da volta. O carro que está fechando casaria com o instante da largada e o delta saltaria uma volta inteira. Diferenças acima de meia volta são tratadas como essa ambiguidade e mostram "—" em vez de um número errado. Na prática são 2 de 2.080 quadros.

## Medalhas e alinhamento

As três primeiras posições ganharam 🥇 🥈 🥉 — na tabela de voltas e no pódio de empresas, nas duas telas. O Strato não tem ícone de medalha (conferi: 846 ícones, nenhum serve), então são emojis, que renderizam as três cores de verdade em qualquer plataforma.

As colunas de **posição** e **tempo** estavam alinhadas à direita enquanto o resto ficava à esquerda. Agora seguem o mesmo alinhamento das demais.

## Pódio e nome da aba

A **disputa entre empresas** voltou para o topo da classificação na tela **Ao vivo**, e nas duas telas fica no mesmo lugar, com o mesmo formato.

A aba **Histórico** passou a se chamar **Placar**.

## Verificação

35 testes do app, `npm run lint`, `npm run build` e `tsc` limpos. Ganharam teste: o recorte da volta (largada, fechamento, e o caso sem cronômetro utilizável) e o delta (zero contra a própria referência, sinal correto à frente e atrás, em branco na ambiguidade da linha e fora da pista). O recorte foi conferido contra a volta real da captura, medindo a distância até o desenho da largada.

**As telas não foram abertas num navegador.**
