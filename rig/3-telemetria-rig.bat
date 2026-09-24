@echo off
setlocal
title Hackathon Racing - telemetria do rig
cd /d "%~dp0"

if not exist "config.bat" (
  echo [ERRO] config.bat nao existe. Rode primeiro o 1-instalar.bat
  pause
  exit /b 1
)
call config.bat

set PY=
where python >nul 2>&1 && set PY=python
if "%PY%"=="" ( where py >nul 2>&1 && set PY=py -3 )
if "%PY%"=="" (
  echo [ERRO] Python nao encontrado. Rode primeiro o 1-instalar.bat
  pause
  exit /b 1
)

echo ===================================================
echo  Rig: %RIG_ID% ^(%RIG_NAME%^)
echo  Escutando a telemetria do AMS2 na porta UDP %AMS2_PORT%
echo  Destino: %RACING_SINK%
echo.
echo  No AMS2: Options ^> System
echo    UDP Protocol Version = Project CARS 2
echo    UDP Frequency        = 1
echo.
echo  DEIXE ESTA JANELA ABERTA. Ctrl+C para parar.
echo ===================================================
echo.

%PY% "..\ams2_collector.py" --source udp --port %AMS2_PORT% ^
  --rig-id "%RIG_ID%" --rig-name "%RIG_NAME%" --sink %RACING_SINK%

echo.
echo [info] telemetria encerrada.
pause
