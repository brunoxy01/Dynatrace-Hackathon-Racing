# v1.3.0 — Três telas, e o fim das voltas duplicadas

Só o app mudou (**1.2.0 → 1.3.0**). O pacote dos simuladores segue o mesmo da v1.1.0.

Esta versão está na branch **`feature/tres-telas`** e **não foi mesclada na main**, a pedido.

## As voltas estavam duplicando — e por quê

Na tela apareciam **cinco linhas para duas voltas reais**:

```
Volta 0   2:23.067   11:11:03
Volta 0   1:37.400   11:00:57
Volta 1   2:23.067   11:07:41
Volta 1   1:37.400   11:07:15
Volta 2   2:23.067   11:08:59
```

Dois tempos distintos, cinco linhas. São duas causas somadas:

**O agrupamento incluía `lap_number`.** O simulador repete o mesmo `last_lap_s` em todos os quadros até fechar uma volta nova — e, quando as voltas seguintes não registram tempo, ele atravessa várias voltas carregando o mesmo valor. Agrupar por `lap_number` criava uma linha para cada volta em que o carro passou com aquele tempo pendurado.

**O reinício do coletor duplicava de novo.** Quem lembra o último tempo é o jogo, não o coletor. Uma sessão nova relista a mesma volta física, com um `session.id` diferente — foi o que produziu a linha das 11:11:03.

A correção vai nas duas pontas: `lap_number` saiu da chave de agrupamento no Grail, e o app colapsa a mesma volta entre sessões do mesmo piloto no mesmo simulador, mantendo a ocorrência mais antiga — o instante em que a volta realmente fechou.

A coluna **"Volta"** também saiu das tabelas. Ela mostrava `0` para voltas fechadas antes do coletor subir, porque o `lap_number` do simulador não identifica a volta que terminou. O que identifica uma volta é quem a fez, quanto durou e quando terminou — que é exatamente o que as colunas mostram agora.

## Três telas

O seletor de fonte de dados virou **abas**.

**1 · Ao vivo** — o painel de hoje: mapa com o carro andando, piloto em destaque, telemetria, velocidade máxima, melhor volta e o Top 10 de quem está na pista.

**2 · Histórico** — o ranking do período: um piloto por linha, com a **melhor volta** dele, empresa, carro e simulador. Abaixo, a disputa entre empresas.

**3 · Replay** — o mapa e a telemetria em cima, a lista de voltas embaixo. Filtros de **piloto, empresa e simulador**. Clicar em *Reproduzir* numa volta a roda no mapa em tempo real, com os dados do piloto ao lado.

O seletor de período subiu para o cabeçalho e vale para as três telas.

## Detalhes

- O pódio de empresas passou a sair das **voltas do período**, não da telemetria recente. A janela de amostras cobre menos de um minuto por rig e quase nunca contém uma volta fechada — era por isso que ele vivia em "Aguardando empresa".
- No Replay, o filtro de piloto age só na tabela. O mapa mostra a volta escolhida inteira; sem isso, mudar o filtro depois do play apagava o carro da pista.
- O script local (`replay_server.py`) virou uma quarta aba, visível só em desenvolvimento.

## Verificação

30 testes do app, `npm run lint`, `npm run build` e `tsc` limpos. A duplicação ganhou teste próprio que reproduz exatamente as cinco linhas da tela e exige que sobrem duas voltas, com o horário de fechamento correto — mais os casos de mesmo tempo por pilotos e simuladores diferentes, que devem continuar separados.

**As telas não foram abertas num navegador.** A lógica e os dados foram verificados; o layout das três abas, não.
