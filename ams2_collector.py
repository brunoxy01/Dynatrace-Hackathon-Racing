#!/usr/bin/env python3
"""
Dynatrace Hackathon Racing - Collector real do Automobilista 2
================================================================

Decodifica telemetria REAL do AMS2 (protocolo UDP oficial - ver
ams2_protocol.py) e envia para o Dynatrace via Business Events API, com
EXATAMENTE os 11 campos combinados:

    aceleracao, velocidade, marcha, frenagem, posicao (x,y),
    tempo de volta, rank de volta, melhor volta, numero de volta,
    nome do piloto, carro utilizado

Dois modos:

1) --source udp     (DIA DO EVENTO - dados reais em tempo real)
   Escuta na porta UDP que o AMS2 transmite (default 5606). No jogo:
   Options -> System -> UDP Frequency: 1 / UDP Protocol Version: Project CARS 2.

2) --source replay --file captura.txt   (JA FUNCIONA HOJE, com a captura
   real de vocês)
   Le o arquivo de captura (formato: ts\\tip:porta\\tsize\\thex_bytes, uma
   linha por pacote UDP) e decodifica os MESMOS pacotes reais gravados na
   sessao em Interlagos, reenviando para o Dynatrace como se estivesse
   acontecendo agora. Isso te da dados 100% reais (nao mock) para comecar a
   montar o app HOJE, sem esperar o dia do evento.

Uso:
    export DT_ENV_URL="https://abc12345.live.dynatrace.com"
    export DT_API_TOKEN="dt0c01.SEU_TOKEN"

    # dia do evento, um processo por simulador (rig_id diferente em cada um)
    python3 ams2_collector.py --source udp --rig-id rig-01 --rig-name "Simulador 1"

    # hoje, usando a captura real que vocês fizeram
    python3 ams2_collector.py --source replay --file captura.txt --rig-id rig-01 --loop --speed 4
"""

from __future__ import annotations  # sintaxe `str | None` tambem no Python 3.9

import argparse
import json
import re
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Optional

from ams2_protocol import (
    SessionState,
    decode_header,
    decode_telemetry,
)

EVENT_TYPE = "racing.telemetry"
EVENT_PROVIDER = "hackathon.racing.ams2"
DEFAULT_UDP_PORT = 5606
DEFAULT_OTLP_ENDPOINT = "http://127.0.0.1:4318/v1/logs"
OTLP_SERVICE_NAME = "ams2-rig"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


# O piloto digita o proprio nome no perfil do AMS2. Combinando "Nome [Empresa]",
# o rig nao precisa ser reconfigurado a cada cliente que senta na cadeira.
# Aceita "[Nome][Empresa]", "Nome [Empresa]" e "Nome" (sem empresa).
NOME_EMPRESA = re.compile(r"^\s*\[?\s*([^\[\]]+?)\s*\]?\s*\[\s*([^\[\]]+?)\s*\]\s*$")


def split_driver_company(bruto: Optional[str]):
    """Separa nome do piloto e empresa. Devolve (nome, empresa|None).

    Feito aqui e nao no OpenPipeline de proposito: vale igual nos dois caminhos
    de ingestao (business events e logs OTLP), nao depende de configuracao no
    tenant e da' para testar. O texto original segue em driver_name_raw, entao
    uma regra de OpenPipeline ainda pode reprocessar depois se preferirem.
    """
    if not bruto or not bruto.strip():
        return None, None
    casado = NOME_EMPRESA.match(bruto)
    if casado:
        return casado.group(1).strip(), casado.group(2).strip()
    return bruto.strip().strip("[]").strip() or None, None


def build_event(rig_id: str, rig_name: str, session_id: str, state: SessionState,
                 telemetry: dict, timings: Optional[dict], source: str,
                 sample_seq: int = 0, driver_name: Optional[str] = None,
                 company_name: Optional[str] = None) -> dict:
    nome_do_jogo, empresa_do_jogo = split_driver_company(state.driver_name)
    return {
        "timestamp": iso_now(),
        # Identidade unica da amostra. Quando bizevents e OTLP rodam juntos o mesmo
        # frame chega ao Grail por dois caminhos; a DQL do app usa isto para deduplicar.
        "sample.id": f"{rig_id}|{session_id}|{sample_seq}",
        "event.type": EVENT_TYPE,
        "event.provider": EVENT_PROVIDER,
        "source": source,  # "real" (udp/replay) ou "mock"
        "session.id": session_id,
        "rig.id": rig_id,
        "rig.name": rig_name,
        # O piloto e a empresa saem de "Nome [Empresa]" digitado no perfil do AMS2.
        # As opcoes --driver-name / --company-name vencem, para quando o rig ja'
        # sabe quem esta na cadeira.
        "driver_name": driver_name or nome_do_jogo,
        # O app monta o podio "Disputa entre empresas" por este campo. O protocolo
        # do AMS2 nao tem nada equivalente: ou vem no nome, ou e' informado aqui.
        "company_name": company_name or empresa_do_jogo,
        "driver_name_raw": state.driver_name,
        "car_name": state.car_name,
        "acceleration_g": telemetry["acceleration_g"],
        "speed_kmh": telemetry["speed_kmh"],
        "gear": telemetry["gear"],
        "brake_pct": telemetry["brake_pct"],
        "pos_x": telemetry["pos_x"],
        "pos_y": telemetry["pos_y"],
        "lap_time_s": timings["lap_time_s"] if timings else None,
        "lap_race_position": timings["lap_race_position"] if timings else None,
        "best_lap_s": state.best_lap_s,
        "last_lap_s": state.last_lap_s,
        "lap_invalidated": timings["lap_invalidated"] if timings else None,
        "track_name": state.track_location,
        "lap_number": timings["lap_number"] if timings else None,
    }


def _post_json(url: str, payload, headers: dict, what: str, timeout: float = 10.0) -> bool:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
        return True
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        print(f"[erro] {what}: HTTP {e.code} - {detail[:300]}", file=sys.stderr)
    except urllib.error.URLError as e:
        print(f"[erro] {what}: falha de conexao - {e}", file=sys.stderr)
    return False


def post_events(url: str, token: Optional[str], events: list, timeout: float = 10.0) -> None:
    """Envia para a Business Events API (/api/v2/bizevents/ingest)."""
    if not events:
        return
    headers = {"Authorization": f"Api-Token {token}"} if token else {}
    _post_json(url, events, headers, f"bizevents ({len(events)} evento(s))", timeout)


def _otlp_value(value):
    """Converte um valor Python no AnyValue do OTLP. So' escalares: manter tudo
    plano garante que cada campo vire um atributo de topo no Grail, identico ao
    bizevent, tanto no modelo raw quanto no flattened."""
    if isinstance(value, bool):
        return {"boolValue": value}
    if isinstance(value, int):
        return {"intValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    return {"stringValue": str(value)}


def build_otlp_payload(events: list) -> dict:
    """Monta um ExportLogsServiceRequest em OTLP/HTTP JSON.

    Usa urllib da stdlib de proposito: os rigs sao maquinas de jogo Windows e
    exigir `pip install opentelemetry-sdk` neles seria atrito desnecessario.
    """
    records = []
    for event in events:
        nanos = int(datetime.fromisoformat(event["timestamp"]).timestamp() * 1_000_000_000)
        attributes = [
            {"key": key, "value": _otlp_value(value)}
            for key, value in event.items()
            if value is not None and key != "timestamp"
        ]
        records.append({
            "timeUnixNano": str(nanos),
            "observedTimeUnixNano": str(nanos),
            "severityNumber": 9,
            "severityText": "INFO",
            "body": {"stringValue": EVENT_TYPE},
            "attributes": attributes,
        })
    return {"resourceLogs": [{
        "resource": {"attributes": [
            {"key": "service.name", "value": {"stringValue": OTLP_SERVICE_NAME}},
            {"key": "telemetry.sdk.language", "value": {"stringValue": "python"}},
        ]},
        "scopeLogs": [{"scope": {"name": EVENT_PROVIDER}, "logRecords": records}],
    }]}


def post_otlp(url: str, events: list, timeout: float = 10.0) -> None:
    """Envia para o OTel Collector local, que repassa ao Dynatrace."""
    if not events:
        return
    _post_json(url, build_otlp_payload(events), {}, f"otlp ({len(events)} registro(s))", timeout)


class Collector:
    def __init__(self, rig_id: str, rig_name: str, session_id: str, source_label: str,
                 driver_name: Optional[str] = None, company_name: Optional[str] = None):
        self.state = SessionState()
        self.rig_id = rig_id
        self.rig_name = rig_name
        self.driver_name = driver_name
        self.company_name = company_name
        self.session_id = session_id
        self.source_label = source_label
        self._last_timings: Optional[dict] = None
        self._sample_seq = 0

    def handle_packet(self, raw: bytes) -> Optional[dict]:
        """Processa um pacote UDP cru; retorna um evento pronto quando um
        frame de telemetria (packetType 0) for decodificado, ou None."""
        if len(raw) < 12:
            return None
        header = decode_header(raw)

        if header.packet_type == 1:
            self.state.ingest_race_definition(raw)
        elif header.packet_type == 2:
            self.state.ingest_participants(raw)
        elif header.packet_type == 3:
            self._last_timings = self.state.ingest_timings(raw)
        elif header.packet_type == 7:
            self.state.ingest_time_stats(raw)
        elif header.packet_type == 8:
            self.state.ingest_vehicle_names(raw, len(raw))
        elif header.packet_type == 0:
            telemetry = decode_telemetry(raw)
            self._sample_seq += 1
            return build_event(
                self.rig_id, self.rig_name, self.session_id, self.state,
                telemetry, self._last_timings, self.source_label, self._sample_seq,
                self.driver_name, self.company_name,
            )
        return None


class Dispatcher:
    """Entrega cada lote aos destinos escolhidos em --sink."""

    def __init__(self, args, ingest_url: Optional[str]):
        self.args = args
        self.ingest_url = ingest_url
        self.to_bizevents = args.sink in ("bizevents", "both") and bool(ingest_url) and not args.dry_run
        self.to_otlp = args.sink in ("otlp", "both") and not args.dry_run

    def describe(self) -> str:
        if self.args.dry_run:
            return "dry-run (stdout, sem ingestao)"
        destinations = []
        if self.to_bizevents:
            destinations.append(f"bizevents -> {self.ingest_url}")
        if self.to_otlp:
            destinations.append(f"otlp -> {self.args.otlp_endpoint}")
        return " | ".join(destinations) or "nenhum destino ativo"

    def enabled(self) -> bool:
        return self.to_bizevents or self.to_otlp

    def flush(self, batch: list) -> None:
        if not batch:
            return
        if self.to_bizevents:
            post_events(self.ingest_url, self.args.token, batch)
        if self.to_otlp:
            post_otlp(self.args.otlp_endpoint, batch)


def run_udp(args, dispatcher: "Dispatcher") -> int:
    collector = Collector(args.rig_id, args.rig_name, f"live-{int(time.time())}", "real",
                          args.driver_name, args.company_name)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((args.bind, args.port))
    print(f"[info] escutando UDP em {args.bind}:{args.port} (rig={args.rig_id}) - Ctrl+C para parar")
    print(f"[info] destino: {dispatcher.describe()}")

    batch = []
    sent = 0
    last_flush = time.time()
    try:
        while True:
            raw, _addr = sock.recvfrom(4096)
            ev = collector.handle_packet(raw)
            if ev:
                if not dispatcher.enabled():
                    print(json.dumps(ev, ensure_ascii=False))
                else:
                    batch.append(ev)
            if batch and (time.time() - last_flush >= args.flush_interval or len(batch) >= args.batch_size):
                dispatcher.flush(batch)
                sent += len(batch)
                batch = []
                last_flush = time.time()
                print(f"[info] {sent} amostras enviadas", end="\r", flush=True)
    except KeyboardInterrupt:
        print("\n[info] interrompido pelo usuario")
        dispatcher.flush(batch)
        sent += len(batch)
        print(f"[info] total enviado: {sent} amostras")
    return 0


def run_replay(args, dispatcher: "Dispatcher") -> int:
    collector = Collector(args.rig_id, args.rig_name, f"replay-{int(time.time())}", "real",
                          args.driver_name, args.company_name)
    print(f"[info] destino: {dispatcher.describe()}")

    def iter_packets():
        with open(args.file, "r", encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\n")
                if not line:
                    continue
                parts = line.split("\t")
                if len(parts) != 4:
                    continue
                ts, _addr, _size, hexstr = parts
                yield ts, bytes.fromhex(hexstr)

    loop_count = 0
    while True:
        loop_count += 1
        batch = []
        last_flush = time.time()
        prev_t = None
        n = 0
        for ts, raw in iter_packets():
            t = datetime.fromisoformat(ts)
            if prev_t is not None and args.speed > 0:
                delay = (t - prev_t).total_seconds() / args.speed
                if delay > 0:
                    time.sleep(min(delay, 1.0))
            prev_t = t

            ev = collector.handle_packet(raw)
            n += 1
            if ev:
                if not dispatcher.enabled():
                    print(json.dumps(ev, ensure_ascii=False))
                else:
                    batch.append(ev)
            if batch and (time.time() - last_flush >= args.flush_interval or len(batch) >= args.batch_size):
                dispatcher.flush(batch)
                batch = []
                last_flush = time.time()

        dispatcher.flush(batch)
        print(f"[info] replay #{loop_count} concluido ({n} pacotes lidos de {args.file})")
        if not args.loop:
            break
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", choices=["udp", "replay"], required=True)
    parser.add_argument("--rig-id", default="rig-01")
    parser.add_argument("--rig-name", default="Simulador 1")
    parser.add_argument("--bind", default="0.0.0.0", help="[udp] endereco para escutar (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=DEFAULT_UDP_PORT, help=f"[udp] porta UDP do AMS2 (default: {DEFAULT_UDP_PORT})")
    parser.add_argument("--file", help="[replay] caminho do captura.txt")
    parser.add_argument("--loop", action="store_true", help="[replay] repete o arquivo indefinidamente")
    parser.add_argument("--speed", type=float, default=1.0, help="[replay] multiplicador de velocidade (0 = o mais rapido possivel, sem pausas)")
    parser.add_argument("--batch-size", type=int, default=20)
    parser.add_argument("--flush-interval", type=float, default=2.0, help="segundos entre envios ao Dynatrace")
    parser.add_argument(
        "--driver-name", default=os.environ.get("RACING_DRIVER") or None,
        help="sobrepoe o nome do piloto vindo do simulador (o cliente na cadeira)",
    )
    parser.add_argument(
        "--company-name", default=os.environ.get("RACING_COMPANY") or None,
        help="empresa do piloto; alimenta o podio 'Disputa entre empresas' do app",
    )
    parser.add_argument("--endpoint", default=os.environ.get("DT_ENV_URL"))
    parser.add_argument("--token", default=os.environ.get("DT_API_TOKEN"))
    parser.add_argument(
        "--sink", choices=["bizevents", "otlp", "both"],
        default=os.environ.get("RACING_SINK", "bizevents"),
        help="destino dos eventos: bizevents (API direta), otlp (OTel Collector local) ou both (default: bizevents)",
    )
    parser.add_argument(
        "--otlp-endpoint", default=os.environ.get("RACING_OTLP_ENDPOINT", DEFAULT_OTLP_ENDPOINT),
        help=f"[otlp] receiver do OTel Collector local (default: {DEFAULT_OTLP_ENDPOINT})",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.source == "replay" and not args.file:
        print("erro: --source replay exige --file captura.txt", file=sys.stderr)
        return 1
    needs_dynatrace_api = args.sink in ("bizevents", "both") and not args.dry_run
    if needs_dynatrace_api and not args.endpoint:
        print("erro: informe --endpoint ou defina DT_ENV_URL", file=sys.stderr)
        return 1
    if needs_dynatrace_api and not args.token:
        print("erro: informe --token ou defina DT_API_TOKEN (escopo bizevents.ingest)", file=sys.stderr)
        return 1

    ingest_url = args.endpoint.rstrip("/") + "/api/v2/bizevents/ingest" if args.endpoint else None
    dispatcher = Dispatcher(args, ingest_url)

    if args.source == "udp":
        return run_udp(args, dispatcher)
    return run_replay(args, dispatcher)


if __name__ == "__main__":
    raise SystemExit(main())
