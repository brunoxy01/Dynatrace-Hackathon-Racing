@echo off
setlocal
title Hackathon Racing - OTel Collector
cd /d "%~dp0"

if not exist "config.bat" (
  echo [ERRO] config.bat nao existe. Rode primeiro o 1-instalar.bat
  pause
  exit /b 1
)
call config.bat

if not exist "dynatrace-otel-collector.exe" (
  echo [ERRO] collector nao encontrado. Rode primeiro o 1-instalar.bat
  pause
  exit /b 1
)
if "%DT_API_TOKEN%"=="COLE_O_TOKEN_AQUI" (
  echo [ERRO] preencha DT_API_TOKEN no config.bat
  pause
  exit /b 1
)

echo ===================================================
echo  OTel Collector - enviando para %DT_OTLP_ENDPOINT%
echo  Recebendo OTLP em 127.0.0.1:4318
echo  DEIXE ESTA JANELA ABERTA. Ctrl+C para parar.
echo ===================================================
echo.

dynatrace-otel-collector.exe --config "..\otel\otelcol-racing.yaml"

echo.
echo [info] collector encerrado.
pause
