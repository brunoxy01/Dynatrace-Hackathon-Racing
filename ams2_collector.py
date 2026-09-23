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

import argparse
import json
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


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_event(rig_id: str, rig_name: str, session_id: str, state: SessionState,
                 telemetry: dict, timings: Optional[dict], source: str) -> dict:
    return {
        "timestamp": iso_now(),
        "event.type": EVENT_TYPE,
        "event.provider": EVENT_PROVIDER,
        "source": source,  # "real" (udp/replay) ou "mock"
        "session.id": session_id,
        "rig.id": rig_id,
        "rig.name": rig_name,
        "driver_name": state.driver_name,
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


def post_events(url: str, token: Optional[str], events: list, timeout: float = 10.0) -> None:
    if not events:
        return
    body = json.dumps(events).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Api-Token {token}"
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            resp.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode("utf-8", "replace")
        print(f"[erro] HTTP {e.code} ao enviar {len(events)} evento(s): {detail[:300]}", file=sys.stderr)
    except urllib.error.URLError as e:
        print(f"[erro] falha de conexao: {e}", file=sys.stderr)


class Collector:
    def __init__(self, rig_id: str, rig_name: str, session_id: str, source_label: str):
        self.state = SessionState()
        self.rig_id = rig_id
        self.rig_name = rig_name
        self.session_id = session_id
        self.source_label = source_label
        self._last_timings: Optional[dict] = None

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
            return build_event(
                self.rig_id, self.rig_name, self.session_id, self.state,
                telemetry, self._last_timings, self.source_label,
            )
        return None


def run_udp(args, ingest_url: Optional[str]) -> int:
    collector = Collector(args.rig_id, args.rig_name, f"live-{int(time.time())}", "real")
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((args.bind, args.port))
    print(f"[info] escutando UDP em {args.bind}:{args.port} (rig={args.rig_id}) - Ctrl+C para parar")

    batch = []
    last_flush = time.time()
    try:
        while True:
            raw, _addr = sock.recvfrom(4096)
            ev = collector.handle_packet(raw)
            if ev:
                if args.dry_run or not ingest_url:
                    print(json.dumps(ev, ensure_ascii=False))
                else:
                    batch.append(ev)
            if batch and (time.time() - last_flush >= args.flush_interval or len(batch) >= args.batch_size):
                post_events(ingest_url, args.token, batch)
                batch = []
                last_flush = time.time()
    except KeyboardInterrupt:
        print("\n[info] interrompido pelo usuario")
        if batch and ingest_url and not args.dry_run:
            post_events(ingest_url, args.token, batch)
    return 0


def run_replay(args, ingest_url: Optional[str]) -> int:
    collector = Collector(args.rig_id, args.rig_name, f"replay-{int(time.time())}", "real")

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
                if args.dry_run or not ingest_url:
                    print(json.dumps(ev, ensure_ascii=False))
                else:
                    batch.append(ev)
            if batch and (time.time() - last_flush >= args.flush_interval or len(batch) >= args.batch_size):
                post_events(ingest_url, args.token, batch)
                batch = []
                last_flush = time.time()

        if batch and ingest_url and not args.dry_run:
            post_events(ingest_url, args.token, batch)
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
    parser.add_argument("--endpoint", default=os.environ.get("DT_ENV_URL"))
    parser.add_argument("--token", default=os.environ.get("DT_API_TOKEN"))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.source == "replay" and not args.file:
        print("erro: --source replay exige --file captura.txt", file=sys.stderr)
        return 1
    if not args.dry_run and not args.endpoint:
        print("erro: informe --endpoint ou defina DT_ENV_URL", file=sys.stderr)
        return 1
    if not args.dry_run and not args.token:
        print("erro: informe --token ou defina DT_API_TOKEN (escopo bizevents.ingest)", file=sys.stderr)
        return 1

    ingest_url = args.endpoint.rstrip("/") + "/api/v2/bizevents/ingest" if args.endpoint else None

    if args.source == "udp":
        return run_udp(args, ingest_url)
    return run_replay(args, ingest_url)


if __name__ == "__main__":
    raise SystemExit(main())
