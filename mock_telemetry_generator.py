#!/usr/bin/env python3
"""
Dynatrace Hackathon Racing - Gerador de Telemetria MOCK (sintetica)
====================================================================

Gera eventos SINTETICOS com o MESMO schema usado pelo collector real do
Automobilista 2 (ver ams2_collector.py / ams2_protocol.py), limitado aos
11 campos combinados que vocês definiram:

    aceleracao, velocidade, marcha, frenagem, posicao (x,y),
    tempo de volta, rank de volta, melhor volta, numero de volta,
    nome do piloto, carro utilizado

Use isto quando NAO tiver um simulador ligado (ou o captura.txt real) e
quiser gerar carga sintetica extra para testar o app com mais "rigs"
simultaneos do que os que vocês gravaram.

Se ja tiver a captura real (captura.txt), prefira `ams2_collector.py
--source replay` - ele decodifica os MESMOS pacotes reais gravados na
sessao em Interlagos (nao são valores inventados).

Uso:
    export DT_ENV_URL="https://abc12345.live.dynatrace.com"
    export DT_API_TOKEN="dt0c01.XXXXX...."
    python3 mock_telemetry_generator.py --rigs 6 --hz 2
"""

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

EVENT_TYPE = "racing.telemetry"
EVENT_PROVIDER = "hackathon.racing.mock"

DRIVER_NAMES = [
    "Ayrton", "Nelson", "Emerson", "Rubens", "Felipe", "Nelsinho",
    "Helio", "Tony", "Cristiano", "Bruno", "Lucas", "Pietro",
]
CAR_NAMES = [
    "Formula Ultimate Hybrid Gen2", "Camaro SS", "Porsche Cup 992",
    "F-Reiza", "Stock Car 2024", "GT3 Class",
]

TRACK_LENGTH_M = 4300.0
SECTOR_BOUNDARIES = (0.33, 0.66, 1.0)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class Rig:
    rig_id: str
    rig_name: str
    driver_name: str
    car_name: str
    session_id: str
    distance_m: float = field(default_factory=lambda: random.uniform(0, TRACK_LENGTH_M))
    lap_number: int = 1
    lap_start_ts: float = field(default_factory=time.time)
    best_lap_s: Optional[float] = None
    pace_factor: float = field(default_factory=lambda: random.uniform(0.9, 1.05))
    race_position: int = 1

    def speed_curve(self) -> float:
        pos = self.distance_m / TRACK_LENGTH_M
        base = 150 + 130 * math.sin(pos * 2 * math.pi * 3) ** 2
        return max(35.0, min(320.0, base * self.pace_factor))

    def step(self, dt: float) -> dict:
        speed_kmh = self.speed_curve() * random.uniform(0.97, 1.03)
        prev_distance = self.distance_m
        self.distance_m += speed_kmh * (1000 / 3600) * dt
        lap_progress = self.distance_m / TRACK_LENGTH_M

        if lap_progress >= 1.0:
            lap_time_s = round(time.time() - self.lap_start_ts, 3)
            if self.best_lap_s is None or lap_time_s < self.best_lap_s:
                self.best_lap_s = lap_time_s
            self.lap_number += 1
            self.lap_start_ts = time.time()
            self.distance_m -= TRACK_LENGTH_M

        gear = max(1, min(6, int(speed_kmh // 55) + 1))
        throttle = 60 + 40 * math.sin((self.distance_m / TRACK_LENGTH_M) * 2 * math.pi * 3)
        brake_pct = round(max(0.0, 100 - throttle - random.uniform(0, 15)) if throttle < 40 else 0.0, 1)

        # aceleracao aproximada (delta de velocidade / tempo), em g
        delta_speed_ms = (speed_kmh - self.speed_curve()) * (1000 / 3600)
        acceleration_g = round(abs(delta_speed_ms) / dt / 9.81 + random.uniform(0, 0.05), 3) if dt > 0 else 0.0

        # posicao (x,y) num "circuito" circular fake, so para ter algo plausivel no mapa
        angle = (self.distance_m / TRACK_LENGTH_M) * 2 * math.pi
        radius = 600
        pos_x = round(radius * math.cos(angle), 2)
        pos_y = round(radius * math.sin(angle), 2)

        current_lap_time_s = round(time.time() - self.lap_start_ts, 3)

        return {
            "timestamp": iso_now(),
            "event.type": EVENT_TYPE,
            "event.provider": EVENT_PROVIDER,
            "source": "mock",
            "session.id": self.session_id,
            "rig.id": self.rig_id,
            "rig.name": self.rig_name,
            "driver_name": self.driver_name,
            "car_name": self.car_name,
            "acceleration_g": acceleration_g,
            "speed_kmh": round(speed_kmh, 1),
            "gear": gear,
            "brake_pct": brake_pct,
            "pos_x": pos_x,
            "pos_y": pos_y,
            "lap_time_s": current_lap_time_s,
            "lap_race_position": self.race_position,
            "best_lap_s": self.best_lap_s,
            "lap_number": self.lap_number,
        }


def build_rigs(n: int, session_id: str) -> list:
    rigs = []
    for i in range(1, n + 1):
        rigs.append(
            Rig(
                rig_id=f"rig-{i:02d}",
                rig_name=f"Simulador {i}",
                driver_name=random.choice(DRIVER_NAMES) + f" #{i}",
                car_name=random.choice(CAR_NAMES),
                session_id=session_id,
                race_position=i,
            )
        )
    return rigs


def post_events(url: str, token: Optional[str], events: list, timeout: float = 10.0) -> None:
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


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--rigs", type=int, default=6, help="numero de simuladores/rigs simulados (default: 6)")
    parser.add_argument("--hz", type=float, default=2.0, help="frequencia de eventos por rig, em Hz (default: 2)")
    parser.add_argument("--duration", type=float, default=0.0, help="duracao em segundos; 0 = roda para sempre (default: 0)")
    parser.add_argument(
        "--endpoint", type=str, default=os.environ.get("DT_ENV_URL"),
        help="URL base do ambiente Dynatrace, ex: https://abc12345.live.dynatrace.com (ou defina DT_ENV_URL)",
    )
    parser.add_argument(
        "--token", type=str, default=os.environ.get("DT_API_TOKEN"),
        help="API token com escopo 'bizevents.ingest' (ou defina DT_API_TOKEN)",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--out-jsonl", type=str, default=None)
    args = parser.parse_args()

    if not args.dry_run and not args.endpoint:
        print("erro: informe --endpoint ou defina DT_ENV_URL", file=sys.stderr)
        return 1
    if not args.dry_run and not args.token:
        print("erro: informe --token ou defina DT_API_TOKEN (escopo bizevents.ingest)", file=sys.stderr)
        return 1

    ingest_url = args.endpoint.rstrip("/") + "/api/v2/bizevents/ingest" if args.endpoint else None

    session_id = f"mock-{int(time.time())}"
    rigs = build_rigs(args.rigs, session_id)
    dt = 1.0 / args.hz
    start = time.time()
    out_fh = open(args.out_jsonl, "a", encoding="utf-8") if args.out_jsonl else None

    print(f"[info] gerando telemetria MOCK para {len(rigs)} rig(s) a {args.hz} Hz cada "
          f"(session.id={session_id}) - Ctrl+C para parar")
    print(f"[info] {'enviando para ' + ingest_url if ingest_url and not args.dry_run else 'modo --dry-run: nada sera enviado'}")

    try:
        while True:
            batch = [rig.step(dt) for rig in rigs]
            if out_fh:
                for ev in batch:
                    out_fh.write(json.dumps(ev, ensure_ascii=False) + "\n")
                out_fh.flush()
            if args.dry_run or not ingest_url:
                print(json.dumps(batch[0], ensure_ascii=False))
            else:
                post_events(ingest_url, args.token, batch)
            if args.duration and (time.time() - start) >= args.duration:
                break
            time.sleep(dt)
    except KeyboardInterrupt:
        print("\n[info] interrompido pelo usuario")
    finally:
        if out_fh:
            out_fh.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
