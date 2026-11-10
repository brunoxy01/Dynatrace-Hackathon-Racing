# v1.11.8 — Tela "Trocar piloto" para o dia do evento

A versão que sobe no dia: liga o pacote dos pilotos/empresas (nome + logo da
tenant) direto no coletor de cada rig, numa tela local que abre sozinha no
navegador quando o `HackathonRacing.exe` liga.

## O que foi trazido

- **Tela "Trocar piloto" (`rig/painel_piloto.py`)**: cada rig sobe uma página
  em `http://127.0.0.1:8765/` onde o operador digita o nome do piloto e
  escolhe a empresa — sem precisar mexer em nenhum arquivo nem reiniciar o
  coletor. A escolha some assim que confirmada (sem esperar a próxima volta
  começar) e o coletor passa a reportar o piloto novo pro Dynatrace quando a
  volta atual fecha ou é reiniciada no jogo.
- **Empresa por lista fixa**: em vez de texto livre, um menu suspenso com as 6
  empresas do evento — Claro, Crefisa, B3, Banco Bradesco, Banco Digio e
  Santander (as três razões sociais do grupo Santander entram como uma única
  opção). O servidor rejeita qualquer valor fora da lista.
- **Animação roxa**: nome do piloto em destaque com um degradê roxo animado,
  campo de nome com brilho ao focar, botão "Confirmar piloto" com pulso roxo
  no hover — pedido explícito para o visual do dia.
- **Coluna Empresa na Classificação**: Placar, Ao vivo e Replay agora mostram
  a empresa de cada piloto na tabela de voltas (`racing.ts`/`Dashboard.tsx`),
  com filtro por piloto/empresa/carro acima da tabela.
- **Ensaio sempre começa da largada**: `cars2_telemetry_generator.py` ganhou
  `trim_to_track_start` (`--start-at-line`) — corta a captura de teste até a
  amostra de posição mais próxima do ponto de largada do traçado, em vez de
  começar de onde a gravação por acaso começa. Testado com 2 rigs simulados
  rodando ao mesmo tempo: os dois cruzam a linha e o piloto escolhido na tela
  aparece certinho na telemetria, sem fantasma de sessão antiga (o fix da
  v1.11.7 continua valendo).

## Como foi validado

- 52 testes Python + 87 testes JS, lint e build limpos.
- 2 rigs reais (dry-run) rodando ao mesmo tempo, cada um com sua própria tela
  de troca de piloto; testadas as 6 empresas da lista fixa; confirmado que
  `driver_name`/`company_name` saem corretos na telemetria assim que a volta
  fecha.
- Confirmado contra o tenant real (v1.11.7) via Grail que o fix de sessão
  duplicada (v1.11.7) segue correto com o novo fluxo de troca de piloto.

## O que NÃO entrou

- As mudanças de `company_name`/troca de sessão do coletor da branch
  `frontend-new` do Plinio foram reavaliadas e trazidas (eram a base necessária
  para a tela "Trocar piloto"); nada além disso veio daquela branch.
