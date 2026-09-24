@echo off
setlocal
title Hackathon Racing - GERADOR DE TESTE (nao usar no evento)
cd /d "%~dp0"

if exist "config.bat" call config.bat
if "%AMS2_PORT%"=="" set AMS2_PORT=5606

set PY=
where python >nul 2>&1 && set PY=python
if "%PY%"=="" ( where py >nul 2>&1 && set PY=py -3 )
if "%PY%"=="" (
  echo [ERRO] Python nao encontrado. Rode primeiro o 1-instalar.bat
  pause
  exit /b 1
)

echo ===================================================
echo  GERADOR DE TESTE
echo.
echo  Faz as vezes do Automobilista 2: reenvia a captura
echo  real por UDP em 127.0.0.1:%AMS2_PORT%, com variacao
echo  aleatoria de velocidade, freio e posicao.
echo.
echo  NAO rode isto junto com o simulador de verdade: os
echo  dois escrevem na mesma porta e a telemetria mistura.
echo.
echo  Ctrl+C para parar.
echo ===================================================
echo.

%PY% "..\cars2_telemetry_generator.py" --host 127.0.0.1 --port %AMS2_PORT% ^
  --loop --speed 1 --speed-pct 7 --brake-pct 12 --position-x-pct 1

echo.
pause
