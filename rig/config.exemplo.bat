@echo off
rem ===================================================================
rem  MODELO DE CONFIGURACAO - copie este arquivo para  config.bat
rem  e preencha os valores. O config.bat NAO vai para o Git.
rem ===================================================================

rem --- Identidade deste simulador. Use um valor DIFERENTE em cada rig. ---
set RIG_ID=rig-01
set RIG_NAME=Simulador 1

rem --- Quem esta na cadeira. Preenchido, vence o nome do perfil do AMS2 ---
rem --- (que e o da conta Steam). Em branco, o nome vem do jogo.         ---
set RACING_DRIVER=

rem --- Ambiente Dynatrace (classic, terminado em .live.dynatrace.com) ---
set DT_ENV_URL=https://SEU_AMBIENTE.live.dynatrace.com

rem --- Token de ingestao. Precisa dos escopos:            ---
rem ---   bizevents.ingest   (caminho business events)     ---
rem ---   logs.ingest        (caminho OTel Collector)      ---
set DT_API_TOKEN=COLE_O_TOKEN_AQUI

rem --- Endpoint OTLP do mesmo ambiente. Normalmente basta manter. ---
set DT_OTLP_ENDPOINT=%DT_ENV_URL%/api/v2/otlp

rem --- Porta UDP que o AMS2 transmite (Options > System > UDP). ---
set AMS2_PORT=5606

rem --- Destinos: bizevents (recomendado), otlp ou both.         ---
rem --- otlp precisa do escopo logs.ingest no token.              ---
rem --- "both" manda cada amostra duas vezes e dobra o volume.    ---
set RACING_SINK=bizevents

rem --- Amostras de telemetria por segundo (o jogo manda ~20). 0 = todas. ---
set RACING_SAMPLE_HZ=10
