# v0.4.0 — Telemetria dos rigs em um duplo clique

## Para os simuladores

Novo pacote **`HackathonRacing-rig-windows.zip`** anexado a esta release: um `.exe` que sobe o OTel Collector e a ponte UDP num processo só. O operador do rig edita apenas o `racing.ini` (rig, URL do ambiente e token) e dá duplo clique. Instruções no `LEIAME.txt` dentro do zip.

O pacote é montado no CI em `windows-latest` (PyInstaller não faz cross-compile) e traz o OTel Collector oficial da Dynatrace com o checksum conferido durante o build.

## Piloto e empresa vêm do nome no jogo

O piloto escreve `Nome Sobrenome [Empresa]` no perfil do AMS2 e o coletor separa os dois. Ideia do Igor, implementada no Python e não no OpenPipeline: vale igual nos dois caminhos de ingestão, não depende de configuração no tenant e é testável. O texto original segue em `driver_name_raw`, então uma regra de OpenPipeline ainda pode reprocessar depois.

**Correção relacionada:** o `ams2_collector.py` nunca emitia `company_name` — só o `replay_server.py` de demonstração emitia. Na prática o pódio "Disputa entre empresas" ficaria vazio no dia do evento. Agora a empresa é preenchida pelo nome no jogo, com `--company-name` como reserva.

## Três simuladores

`ensaio-3-rigs.sh` sobe um collector e três pares gerador+coletor com rig, piloto, empresa e ritmo distintos, numa máquina só. Verificado: 9.600 amostras, três empresas e três velocidades de pico (250 / 266 / 284,6 km/h).

## App

- Novo indicador de tempo real no cabeçalho, ao lado do status da consulta: amostras recebidas no último minuto e quantos simuladores estão reportando, ou há quanto tempo a pista está muda. Só aparece em períodos que terminam em agora.
- Escopo `storage:logs:read` adicionado, necessário para a fonte OTel.

## Robustez do rig

- **Collector órfão.** Fechar a janela no X do Windows, ou o bootloader do PyInstaller não repassar o sinal, deixava o collector vivo segurando a porta 4318 — e o duplo clique seguinte falhava. O supervisor agora registra o PID em disco, limpa o que sobrou na entrada (com SIGKILL de reserva) e insiste 10s no bind UDP.
- **Credencial obrigatória nos dois caminhos.** Antes, `sink=otlp` sem token subia "com sucesso" e descartava tudo em silêncio.

Validação: `npm run lint`, `npm test`, `npm run build`, os testes Python (18) e uma execução real da cadeia gerador → UDP → ponte → OTLP → OTel Collector 0.57.0.
