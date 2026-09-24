#!/usr/bin/env python3
"""
AMS2 UDP Telemetry Listener - V1 (teste)
==========================================

Objetivo desta versao:
  1. Ouvir o broadcast UDP do Automobilista 2 (protocolo "Project CARS 2",
     porta padrao 5606).
  2. Gerar um "evento" por pacote recebido (JSON Lines), decodificando com
     seguranca apenas o cabecalho comum a todos os pacotes.
  3. Permitir gravar o dump bruto (timestamp + payload em hex) em um arquivo
     de texto, para reprocessar/testar offline depois -- sem precisar do
     jogo rodando de novo.

IMPORTANTE sobre o decode:
  O layout exato dos campos de telemetria (posicao, velocidade, G-force etc)
  do protocolo "Project CARS 2" usado pelo AMS2 e' documentacao de
  comunidade, nao e' spec oficial da Reiza/SMS. Por isso esta V1 decodifica
    com confianca apenas o CABECALHO (12 bytes, comum a todo pacote: numero do
  pacote, tipo, versao), que e' o dado mais estavel entre implementacoes.
  O corpo de cada pacote fica salvo em hex no evento e no dump -- assim,
  quando validarmos o struct exato (comparando com uma ferramenta de
  referencia, ex. RaceTelemetry do PyPI ou CREST2), reprocessamos os JSONL
  gerados aqui sem precisar recapturar nada.

Configuracao no jogo (Options -> System):
  Shared Memory       = Off (ou Project CARS 2, tanto faz p/ este script)
  UDP Protocol Version = Project CARS 2
  UDP Frequency        = comece com um valor alto (ex. 5 ou 6) para gerar
                          menos pacotes/seg durante o teste inicial

Uso basico:
  python3 ams2_udp_listener.py --dump captura.txt --events eventos.jsonl

Uso so' para inspecionar no terminal (sem gravar nada):
  python3 ams2_udp_listener.py --host 0.0.0.0 --port 5606
"""

from __future__ import annotations  # sintaxe `str | None` tambem no Python 3.9

import argparse
import json
import signal
import socket
import struct
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_HOST = "0.0.0.0"
DEFAULT_PORT = 5606

# Cabecalho comum a todos os pacotes do protocolo "Project CARS 2" (fonte:
# documentacao de comunidade / plugins de terceiros). 12 bytes, little-endian:
#   packet_number            (uint32)  numero sequencial do pacote
#   category_packet_number   (uint32)  numero sequencial dentro da categoria
#   partial_packet_index     (uint8)   indice de pacote parcial (fragmentacao)
#   partial_packet_number    (uint8)   total de pacotes parciais
#   packet_type              (uint8)   tipo do pacote (ver PACKET_TYPES)
#   packet_version           (uint8)   versao do formato do pacote
HEADER_FORMAT = "<IIBBBB"
HEADER_SIZE = struct.calcsize(HEADER_FORMAT)

# Mapeamento de tipos conhecidos (best-effort, comunidade). Qualquer tipo
# fora dessa lista aparece como "unknown_<numero>" no evento -- nao trava o
# script, so' fica sem nome amigavel ate validarmos.
PACKET_TYPES = {
    0: "telemetry",
    1: "race_definition",
    2: "participants",
    3: "timings",
    4: "game_state",
    5: "weather_state",
    6: "vehicle_names",
    7: "time_stats",
    8: "participant_vehicle_names",
}


class GracefulStop:
    """Permite Ctrl+C parar o loop com flush limpo dos arquivos."""

    def __init__(self):
        self.stop = False
        signal.signal(signal.SIGINT, self._handler)
        signal.signal(signal.SIGTERM, self._handler)

    def _handler(self, signum, frame):
        self.stop = True


def parse_header(payload: bytes):
    """Decodifica o cabecalho comum. Retorna dict ou None se o pacote for
    menor que o cabecalho esperado (pacote corrompido/truncado)."""
    if len(payload) < HEADER_SIZE:
        return None
    packet_number, category_packet_number, partial_idx, partial_total, ptype, pversion = (
        struct.unpack(HEADER_FORMAT, payload[:HEADER_SIZE])
    )
    return {
        "packet_number": packet_number,
        "category_packet_number": category_packet_number,
        "partial_packet_index": partial_idx,
        "partial_packet_number": partial_total,
        "packet_type": PACKET_TYPES.get(ptype, f"unknown_{ptype}"),
        "packet_type_raw": ptype,
        "packet_version": pversion,
    }


def build_event(ts: datetime, addr, payload: bytes) -> dict:
    """Monta o evento enxuto: metadados + cabecalho decodificado + corpo em
    hex (para decode posterior, quando o struct completo for validado)."""
    header = parse_header(payload)
    event = {
        "ts": ts.isoformat(),
        "src_ip": addr[0],
        "src_port": addr[1],
        "size_bytes": len(payload),
        "header": header,
        "body_hex": payload[HEADER_SIZE:].hex() if header else payload.hex(),
    }
    return event


def open_writer(path: str | None):
    if path is None:
        return None
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    return open(p, "a", encoding="utf-8", buffering=1)  # line-buffered


def main():
    parser = argparse.ArgumentParser(description="AMS2 UDP telemetry listener (V1)")
    parser.add_argument("--host", default=DEFAULT_HOST, help="IP para bind (default: 0.0.0.0)")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help="Porta UDP (default: 5606)")
    parser.add_argument("--dump", default=None, help="Arquivo texto com dump bruto (timestamp + hex) de cada pacote")
    parser.add_argument("--events", default=None, help="Arquivo JSONL com um evento decodificado por linha")
    parser.add_argument("--stats-every", type=int, default=5, help="Intervalo (s) para imprimir estatisticas no terminal")
    parser.add_argument("--quiet", action="store_true", help="Nao imprime estatisticas periodicas no terminal")
    args = parser.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.bind((args.host, args.port))
    sock.settimeout(1.0)  # permite checar o sinal de parada periodicamente

    dump_file = open_writer(args.dump)
    events_file = open_writer(args.events)

    stopper = GracefulStop()
    type_counter = Counter()
    total_packets = 0
    total_bytes = 0
    last_stats_ts = time.monotonic()
    start_ts = time.monotonic()

    print(f"[ams2-listener] ouvindo UDP em {args.host}:{args.port} (Ctrl+C para parar)")
    if args.dump:
        print(f"[ams2-listener] dump bruto -> {args.dump}")
    if args.events:
        print(f"[ams2-listener] eventos JSONL -> {args.events}")

    try:
        while not stopper.stop:
            try:
                payload, addr = sock.recvfrom(65535)
            except socket.timeout:
                pass
            else:
                now = datetime.now(timezone.utc)
                total_packets += 1
                total_bytes += len(payload)

                event = build_event(now, addr, payload)
                ptype = event["header"]["packet_type"] if event["header"] else "corrupted"
                type_counter[ptype] += 1

                if dump_file:
                    # Uma linha por pacote: timestamp ISO, origem, tamanho, hex completo.
                    # Formato simples e grep-avel, pensado para reprocessar depois.
                    dump_file.write(
                        f"{now.isoformat()}\t{addr[0]}:{addr[1]}\t{len(payload)}\t{payload.hex()}\n"
                    )

                if events_file:
                    events_file.write(json.dumps(event, ensure_ascii=False) + "\n")

            # Estatisticas periodicas, independente de ter chegado pacote nesse tick
            if not args.quiet and (time.monotonic() - last_stats_ts) >= args.stats_every:
                elapsed = time.monotonic() - start_ts
                rate = total_packets / elapsed if elapsed > 0 else 0
                kbps = (total_bytes / 1024) / elapsed if elapsed > 0 else 0
                top_types = ", ".join(f"{k}={v}" for k, v in type_counter.most_common(5))
                print(
                    f"[ams2-listener] {total_packets} pacotes | {rate:.1f} pkt/s | "
                    f"{kbps:.1f} KB/s | tipos: {top_types or '-'}"
                )
                last_stats_ts = time.monotonic()
    finally:
        elapsed = time.monotonic() - start_ts
        print("\n[ams2-listener] encerrando...")
        print(f"[ams2-listener] total: {total_packets} pacotes, {total_bytes} bytes, {elapsed:.1f}s")
        print(f"[ams2-listener] distribuicao por tipo: {dict(type_counter)}")
        sock.close()
        if dump_file:
            dump_file.close()
        if events_file:
            events_file.close()


if __name__ == "__main__":
    main()
