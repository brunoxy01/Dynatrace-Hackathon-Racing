#!/usr/bin/env bash
# Ensaio dos 3 simuladores numa maquina so' (macOS/Linux).
#
# Sobe um OTel Collector e tres pares gerador+coletor, cada um com rig, piloto,
# empresa e ritmo diferentes. E' a mesma cadeia do dia do evento: a unica coisa
# trocada e' quem produz os pacotes UDP (o gerador no lugar do AMS2).
#
#   cp .env.exemplo .env.local   # preencha DT_ENV_URL e DT_API_TOKEN
#   ./ensaio-3-rigs.sh           # envia de verdade para o Dynatrace
#   ./ensaio-3-rigs.sh --local   # nao envia nada; usa os endpoints falsos
#
# Ctrl+C derruba tudo.

set -euo pipefail
cd "$(dirname "$0")"

PY="${PY:-$(command -v python3)}"
LOCAL=0
[ "${1:-}" = "--local" ] && LOCAL=1

TMP="$(mktemp -d)"
COLETOR_BIN="${COLETOR_BIN:-./dynatrace-otel-collector}"

# ---- pilotos do ensaio: nome, empresa, porta UDP, variacao de ritmo ----
RIGS=(
  "rig-01|Bruno Lima|Dynatrace|15606|0"
  "rig-02|Joao Pereira|Bradesco|15607|-6"
  "rig-03|Agnes Souza|Caixa|15608|7"
)

encerrar() {
  [ "${ENCERRANDO:-0}" = "1" ] && return
  ENCERRANDO=1
  echo ""
  echo "[..] encerrando tudo"
  # mata o grupo de processos inteiro, inclusive os filhos
  pkill -P $$ 2>/dev/null || true
  wait 2>/dev/null || true
  echo "[ok] ensaio encerrado. Logs em $TMP"
}
ENCERRANDO=0
trap encerrar EXIT INT TERM

if [ "$LOCAL" = "1" ]; then
  echo "=== ENSAIO LOCAL - nada sai para o Dynatrace ==="
  CONFIG_OTEL="otel/otelcol-teste-local.yaml"
  "$PY" otel/endpoint_falso.py --port 4319 --out "$TMP/otlp.jsonl" > "$TMP/endpoint.log" 2>&1 &
  sleep 1
  SINK="otlp"
  EXTRA=()
else
  [ -f .env.local ] && set -a && . ./.env.local && set +a
  : "${DT_ENV_URL:?defina DT_ENV_URL (ex.: https://abc12345.live.dynatrace.com) no .env.local}"
  : "${DT_API_TOKEN:?defina DT_API_TOKEN no .env.local}"
  export DT_OTLP_ENDPOINT="${DT_ENV_URL%/}/api/v2/otlp"
  echo "=== ENSAIO REAL - enviando para ${DT_ENV_URL} ==="
  CONFIG_OTEL="otel/otelcol-racing.yaml"
  SINK="both"
  EXTRA=(--endpoint "$DT_ENV_URL" --token "$DT_API_TOKEN")
fi

# ---- 1. collector (um so', os tres rigs mandam para ele) ----
if [ ! -x "$COLETOR_BIN" ]; then
  echo "[ERRO] collector nao encontrado em $COLETOR_BIN"
  echo "       baixe de https://github.com/Dynatrace/dynatrace-otel-collector/releases"
  echo "       ou aponte COLETOR_BIN=/caminho/do/binario"
  exit 1
fi
echo "[..] subindo o OTel Collector"
"$COLETOR_BIN" --config "$CONFIG_OTEL" > "$TMP/collector.log" 2>&1 &
for _ in $(seq 40); do
  curl -s -o /dev/null -m 1 -X POST http://127.0.0.1:4318/v1/logs \
    -H 'Content-Type: application/json' -d '{"resourceLogs":[]}' && break
  sleep 0.25
done
echo "[ok] collector recebendo OTLP em 127.0.0.1:4318"

# ---- 2. um coletor Python e um gerador por rig ----
for entrada in "${RIGS[@]}"; do
  IFS='|' read -r rig piloto empresa porta variacao <<< "$entrada"
  "$PY" ams2_collector.py --source udp --bind 127.0.0.1 --port "$porta" \
    --rig-id "$rig" --rig-name "Simulador ${rig#rig-}" \
    --driver-name "$piloto" --company-name "$empresa" \
    --sink "$SINK" --batch-size 40 --flush-interval 2 \
    ${EXTRA[@]+"${EXTRA[@]}"} > "$TMP/$rig.log" 2>&1 &
  sleep 0.5
  "$PY" cars2_telemetry_generator.py --host 127.0.0.1 --port "$porta" \
    --loop --speed 3 --speed-pct "$variacao" --brake-pct "$variacao" \
    > "$TMP/$rig-gerador.log" 2>&1 &
  echo "[ok] $rig  $piloto / $empresa  (porta $porta, ritmo ${variacao}%)"
done

echo ""
echo "======================================================="
echo " Tres rigs correndo. Ctrl+C para parar."
echo " Logs: $TMP"
if [ "$LOCAL" = "0" ]; then
  echo ""
  echo " Confira no Dynatrace (leva ~30s para aparecer):"
  echo "   fetch bizevents | filter event.type == \"racing.telemetry\""
  echo "   | summarize count(), by:{rig.id, driver_name, company_name}"
  echo ""
  echo "   fetch logs | filter event.type == \"racing.telemetry\""
  echo "   | summarize count(), by:{rig.id, driver_name, company_name}"
fi
echo "======================================================="

while true; do
  sleep 10
  if [ "$LOCAL" = "1" ]; then
    printf "\r[local] %s registros no endpoint falso   " "$(wc -l < "$TMP/otlp.jsonl" 2>/dev/null || echo 0)"
  else
    printf "\r[real] enviando... erros ate agora: %s   " "$(grep -ch '\[erro\]' "$TMP"/rig-*.log 2>/dev/null | paste -sd+ - | bc 2>/dev/null || echo 0)"
  fi
done
