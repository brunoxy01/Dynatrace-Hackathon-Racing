#!/usr/bin/env python3
"""Gera trafego UDP de CARS2/AMS2 a partir de uma captura HEX real."""

import argparse
import math
import socket
import struct
import time
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

from ams2_udp_listener import HEADER_FORMAT, HEADER_SIZE, PACKET_TYPES, parse_header

DEFAULT_CAPTURE = Path(__file__).parent / "captura.txt"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 5606

TELEMETRY_PACKET_TYPE = 0
TELEMETRY_PACKET_VERSION = 4


@dataclass(frozen=True)
class TelemetryVariations:
    speed_pct: float = 0.0
    throttle_pct: float = 0.0
    brake_pct: float = 0.0
    gear_pct: float = 0.0
    acceleration_pct: float = 0.0
    position_x_pct: float = 0.0
    position_y_pct: float = 0.0


@dataclass(frozen=True)
class CapturedPacket:
    timestamp: datetime
    payload: bytes
    line_number: int


def load_capture(path: Path) -> list[CapturedPacket]:
    packets = []
    with path.open(encoding="utf-8") as capture_file:
        for line_number, line in enumerate(capture_file, 1):
            if not line.strip():
                continue
            try:
                timestamp_text, _source, size_text, payload_hex = line.rstrip().split("\t")
                payload = bytes.fromhex(payload_hex)
                declared_size = int(size_text)
                timestamp = datetime.fromisoformat(timestamp_text)
            except (ValueError, TypeError) as exc:
                raise ValueError(f"linha {line_number} invalida em {path}: {exc}") from exc
            if len(payload) != declared_size:
                raise ValueError(
                    f"linha {line_number}: tamanho declarado {declared_size}, real {len(payload)}"
                )
            if parse_header(payload) is None:
                raise ValueError(f"linha {line_number}: pacote menor que {HEADER_SIZE} bytes")
            packets.append(CapturedPacket(timestamp, payload, line_number))
    if not packets:
        raise ValueError(f"nenhum pacote encontrado em {path}")
    return packets


def select_packets(
    packets: Iterable[CapturedPacket], packet_types: set[int] | None
) -> list[CapturedPacket]:
    if packet_types is None:
        return list(packets)
    return [packet for packet in packets if packet.payload[10] in packet_types]


def rewrite_packet_number(payload: bytes, packet_number: int) -> bytes:
    rewritten = bytearray(payload)
    struct.pack_into("<I", rewritten, 0, packet_number % (2**32))
    return bytes(rewritten)


def _scaled(value: float, variation_pct: float) -> float:
    return value * (1.0 + variation_pct / 100.0)


def _scaled_u8(value: int, variation_pct: float) -> int:
    return max(0, min(255, round(_scaled(value, variation_pct))))


def apply_telemetry_variations(payload: bytes, variations: TelemetryVariations) -> bytes:
    """Altera somente campos confirmados do pacote Car Physics v4."""
    if variations == TelemetryVariations():
        return payload
    if (
        len(payload) < 555
        or payload[10] != TELEMETRY_PACKET_TYPE
        or payload[11] != TELEMETRY_PACKET_VERSION
    ):
        return payload

    rewritten = bytearray(payload)
    rewritten[29] = _scaled_u8(rewritten[29], variations.brake_pct)
    rewritten[30] = _scaled_u8(rewritten[30], variations.throttle_pct)

    speed = max(0.0, _scaled(struct.unpack_from("<f", rewritten, 36)[0], variations.speed_pct))
    struct.pack_into("<f", rewritten, 36, speed)

    gear_num_gears = rewritten[45]
    gear = gear_num_gears & 0x0F
    if gear != 0x0F:
        num_gears = gear_num_gears >> 4
        max_gear = max(0, num_gears - 1)
        varied_gear = max(0, min(max_gear, round(_scaled(gear, variations.gear_pct))))
        rewritten[45] = (gear_num_gears & 0xF0) | varied_gear

    for offset in (100, 104, 108):
        value = struct.unpack_from("<f", rewritten, offset)[0]
        struct.pack_into("<f", rewritten, offset, _scaled(value, variations.acceleration_pct))

    position_x = struct.unpack_from("<f", rewritten, 542)[0]
    position_y = struct.unpack_from("<f", rewritten, 550)[0]
    struct.pack_into("<f", rewritten, 542, _scaled(position_x, variations.position_x_pct))
    struct.pack_into("<f", rewritten, 550, _scaled(position_y, variations.position_y_pct))
    return bytes(rewritten)


def inspect_capture(packets: list[CapturedPacket]) -> None:
    type_counts = Counter()
    version_counts = Counter()
    size_counts = Counter(len(packet.payload) for packet in packets)
    for packet in packets:
        header = struct.unpack_from(HEADER_FORMAT, packet.payload)
        packet_type, packet_version = header[4], header[5]
        type_counts[f"{packet_type}:{PACKET_TYPES.get(packet_type, 'unknown')}"] += 1
        version_counts[f"tipo {packet_type} v{packet_version}"] += 1

    duration = (packets[-1].timestamp - packets[0].timestamp).total_seconds()
    rate = (len(packets) - 1) / duration if duration > 0 else 0.0
    print(f"pacotes: {len(packets)} | duracao: {duration:.3f}s | media: {rate:.1f} pkt/s")
    print(f"tamanhos: {dict(sorted(size_counts.items()))}")
    print(f"tipos: {dict(sorted(type_counts.items()))}")
    print(f"versoes: {dict(sorted(version_counts.items()))}")


def replay(
    packets: list[CapturedPacket],
    destination: tuple[str, int],
    speed: float,
    loops: int | None,
    max_packets: int | None,
    rewrite_sequence: bool,
    variations: TelemetryVariations | None = None,
) -> int:
    sent = 0
    next_packet_number = struct.unpack_from("<I", packets[0].payload)[0]
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    if destination[0].endswith(".255") or destination[0] == "255.255.255.255":
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)

    try:
        loop_number = 0
        while loops is None or loop_number < loops:
            previous_timestamp = packets[0].timestamp
            for packet in packets:
                delay = (packet.timestamp - previous_timestamp).total_seconds() / speed
                if delay > 0:
                    time.sleep(delay)
                payload = packet.payload
                if variations is not None:
                    payload = apply_telemetry_variations(payload, variations)
                if rewrite_sequence:
                    payload = rewrite_packet_number(payload, next_packet_number)
                    next_packet_number += 1
                sock.sendto(payload, destination)
                sent += 1
                previous_timestamp = packet.timestamp
                if max_packets is not None and sent >= max_packets:
                    return sent
            loop_number += 1
    finally:
        sock.close()
    return sent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Reproduz structs UDP reais de CARS2/AMS2 sem precisar do simulador"
    )
    parser.add_argument("--capture", type=Path, default=DEFAULT_CAPTURE)
    parser.add_argument("--host", default=DEFAULT_HOST, help="destino UDP")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--speed", type=float, default=1.0, help="1=tempo real, 2=duas vezes mais rapido")
    parser.add_argument("--loop", action="store_true", help="repete a captura indefinidamente")
    parser.add_argument("--loops", type=int, default=1, help="quantidade de repeticoes")
    parser.add_argument("--max-packets", type=int)
    parser.add_argument("--packet-type", type=int, action="append", dest="packet_types")
    parser.add_argument(
        "--speed-pct", "--speed-variation-pct", type=float, default=0.0,
        help="variacao percentual da velocidade (ex.: 10 aumenta 10%%)",
    )
    parser.add_argument(
        "--throttle-pct", "--throttle-variation-pct", type=float, default=0.0,
        help="variacao percentual do acelerador, limitada a 0..100%%",
    )
    parser.add_argument(
        "--brake-pct", "--brake-variation-pct", type=float, default=0.0,
        help="variacao percentual da frenagem, limitada a 0..100%%",
    )
    parser.add_argument(
        "--gear-pct", "--gear-variation-pct", type=float, default=0.0,
        help="variacao percentual da marcha, arredondada para uma marcha valida",
    )
    parser.add_argument(
        "--acceleration-pct", "--acceleration-variation-pct", type=float, default=0.0,
        help="variacao percentual do vetor de aceleracao fisica XYZ",
    )
    parser.add_argument(
        "--position-x-pct", "--position-x-variation-pct", type=float, default=0.0,
        help="variacao percentual da coordenada X global",
    )
    parser.add_argument(
        "--position-y-pct", "--position-y-variation-pct", type=float, default=0.0,
        help="variacao percentual da coordenada Y do mapa (eixo Z do jogo)",
    )
    parser.add_argument("--inspect", action="store_true", help="analisa a captura sem transmitir")
    parser.add_argument(
        "--preserve-sequence",
        action="store_true",
        help="mantem packet_number original, inclusive entre repeticoes",
    )
    args = parser.parse_args()
    if args.speed <= 0:
        parser.error("--speed deve ser maior que zero")
    if args.loops <= 0:
        parser.error("--loops deve ser maior que zero")
    if args.max_packets is not None and args.max_packets <= 0:
        parser.error("--max-packets deve ser maior que zero")
    variation_values = (
        args.speed_pct,
        args.throttle_pct,
        args.brake_pct,
        args.gear_pct,
        args.acceleration_pct,
        args.position_x_pct,
        args.position_y_pct,
    )
    if not all(math.isfinite(value) for value in variation_values):
        parser.error("percentuais de variacao devem ser numeros finitos")
    return args


def main() -> None:
    args = parse_args()
    packets = select_packets(load_capture(args.capture), set(args.packet_types) if args.packet_types else None)
    if not packets:
        raise SystemExit("nenhum pacote corresponde aos filtros informados")
    if args.inspect:
        inspect_capture(packets)
        return

    loops = None if args.loop else args.loops
    variations = TelemetryVariations(
        speed_pct=args.speed_pct,
        throttle_pct=args.throttle_pct,
        brake_pct=args.brake_pct,
        gear_pct=args.gear_pct,
        acceleration_pct=args.acceleration_pct,
        position_x_pct=args.position_x_pct,
        position_y_pct=args.position_y_pct,
    )
    active_variations = {
        name: value
        for name, value in vars(variations).items()
        if value != 0
    }
    print(
        f"[cars2-generator] {len(packets)} structs -> {args.host}:{args.port} "
        f"| speed={args.speed:g}x | loops={'infinito' if loops is None else loops}"
    )
    if active_variations:
        print(f"[cars2-generator] variacoes percentuais: {active_variations}")
    try:
        sent = replay(
            packets,
            (args.host, args.port),
            args.speed,
            loops,
            args.max_packets,
            not args.preserve_sequence,
            variations,
        )
    except KeyboardInterrupt:
        print("\n[cars2-generator] interrompido")
    else:
        print(f"[cars2-generator] concluido: {sent} pacotes enviados")


if __name__ == "__main__":
    main()