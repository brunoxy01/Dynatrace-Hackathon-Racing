@echo off
setlocal
title Hackathon Racing - instalacao do rig
cd /d "%~dp0"

echo ===================================================
echo  Hackathon Racing - preparando este simulador
echo ===================================================
echo.

rem ---------- 1. Python ----------
set PY=
where python >nul 2>&1 && set PY=python
if "%PY%"=="" ( where py >nul 2>&1 && set PY=py -3 )
if "%PY%"=="" (
  echo [ERRO] Python nao encontrado.
  echo        Instale em https://www.python.org/downloads/windows/
  echo        e marque "Add python.exe to PATH" durante a instalacao.
  echo.
  pause
  exit /b 1
)
echo [ok] Python encontrado: %PY%
%PY% --version

rem ---------- 2. Collector ----------
if exist "dynatrace-otel-collector.exe" (
  echo [ok] OTel Collector ja esta baixado.
  goto :config
)

echo.
echo [..] Baixando o Dynatrace OTel Collector ^(cerca de 45 MB^)...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$v='0.57.0';" ^
  "$zip='collector.zip';" ^
  "$url=\"https://github.com/Dynatrace/dynatrace-otel-collector/releases/download/v$v/dynatrace-otel-collector_${v}_Windows_x86_64.zip\";" ^
  "Invoke-WebRequest -Uri $url -OutFile $zip;" ^
  "Expand-Archive -Path $zip -DestinationPath . -Force;" ^
  "Remove-Item $zip"
if errorlevel 1 (
  echo.
  echo [ERRO] Falha ao baixar o collector. Verifique a conexao ou o proxy.
  pause
  exit /b 1
)
echo [ok] Collector baixado.

:config
rem ---------- 3. Configuracao ----------
echo.
if exist "config.bat" (
  echo [ok] config.bat ja existe.
) else (
  copy /y "config.exemplo.bat" "config.bat" >nul
  echo [!!] config.bat criado a partir do modelo.
  echo      ABRA o config.bat e preencha RIG_ID, DT_ENV_URL e DT_API_TOKEN
  echo      antes de seguir.
  notepad config.bat
)

echo.
echo ===================================================
echo  Pronto. No dia do evento, rode nesta ordem:
echo    2-coletor-otel.bat     ^(deixe a janela aberta^)
echo    3-telemetria-rig.bat   ^(deixe a janela aberta^)
echo ===================================================
echo.
pause
