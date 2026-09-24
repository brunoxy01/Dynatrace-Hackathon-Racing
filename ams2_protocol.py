#!/usr/bin/env python3
"""
Decodificador do protocolo UDP do Automobilista 2 (AMS2).

AMS2 roda na engine Madness e fala o protocolo UDP do Project CARS 2
("patch 5" / "version 2" no menu do jogo: Options -> System -> UDP Protocol
Version: Project CARS 2). Os offsets de byte abaixo seguem o
`SMS_UDP_Definitions.hpp` original da Slightly Mad Studios, na mesma forma
publicada e testada pelo projeto open-source `ams2-telemetry`
(https://github.com/chris-r-uol/ams2-telemetry, arquivo
`src/shared/protocol/layouts.ts`).

Validamos esses offsets contra a captura real de vocês
(captura.txt / eventos.jsonl, sessao gravada em 2026-09-19 em Interlagos):
- driver name decodificado: "fehspfc9"
- carro decodificado: "Formula Ultimate Hybrid Gen2"
- pista decodificada: "Interlagos" / "Interlagos_GP", 4294.9 m
- 1 volta real decodificada: 104.015 s

Todos os pacotes comecam com um cabecalho de 12 bytes (little-endian):
    packetNumber          u32 @0
    categoryPacketNumber  u32 @4
    partialPacketIndex    u8  @8
    partialPacketNumber   u8  @9
    packetType            u8  @10
    packetVersion         u8  @11

packetType:
    0 = Telemetry (car physics)   - a cada tick de UDP
    1 = Race definition           - quando muda (pista, records)
    2 = Participants              - quando muda (nomes dos pilotos)
    3 = Timings                   - a cada tick (posicao, volta, tempos)
    4 = Game state                - a cada 5-10s
    7 = Time stats                - nas passagens de setor (melhor volta)
    8 = Vehicle/class names       - quando muda (nome do carro)
"""

from __future__ import annotations  # sintaxe `str | None` tambem no Python 3.9

import struct
from dataclasses import dataclass, field
from typing import Optional


def _u32(b: bytes, o: int) -> int:
    return struct.unpack_from("<I", b, o)[0]


def _u16(b: bytes, o: int) -> int:
    return struct.unpack_from("<H", b, o)[0]


def _u8(b: bytes, o: int) -> int:
    return b[o]


def _i8(b: bytes, o: int) -> int:
    return struct.unpack_from("<b", b, o)[0]


def _f32(b: bytes, o: int) -> float:
    return struct.unpack_from("<f", b, o)[0]


def _str(b: bytes, o: int, length: int) -> str:
    return b[o : o + length].split(b"\x00", 1)[0].decode("latin1", "replace").strip()


PACKET_TYPE_NAMES = {
    0: "telemetry",
    1: "race_definition",
    2: "participants",
    3: "timings",
    4: "game_state",
    7: "time_stats",
    8: "vehicle_or_class_names",
}


@dataclass
class Header:
    packet_number: int
    category_packet_number: int
    partial_packet_index: int
    partial_packet_number: int
    packet_type: int
    packet_version: int

    @property
    def type_name(self) -> str:
        return PACKET_TYPE_NAMES.get(self.packet_type, f"unknown({self.packet_type})")


def decode_header(raw: bytes) -> Header:
    return Header(
        packet_number=_u32(raw, 0),
        category_packet_number=_u32(raw, 4),
        partial_packet_index=_u8(raw, 8),
        partial_packet_number=_u8(raw, 9),
        packet_type=_u8(raw, 10),
        packet_version=_u8(raw, 11),
    )


def decode_telemetry(raw: bytes) -> dict:
    """packetType == 0. Carro atualmente visualizado (o simulador local)."""
    brake = _u8(raw, 29)
    throttle = _u8(raw, 30)
    clutch = _u8(raw, 31)
    speed_ms = _f32(raw, 36)
    gear_num_gears = _u8(raw, 45)
    gear_raw = gear_num_gears & 0x0F
    num_gears = gear_num_gears >> 4
    accel = tuple(_f32(raw, 100 + j * 4) for j in range(3))  # localAcceleration x,y,z (m/s^2)
    full_pos = tuple(_f32(raw, 542 + j * 4) for j in range(3))  # posicao global do carro no mundo

    gear = -1 if gear_raw == 0xF else gear_raw  # 0xF = re

    accel_g = (sum(a * a for a in accel) ** 0.5) / 9.81

    return {
        "speed_kmh": round(speed_ms * 3.6, 1),
        "gear": gear,
        "num_gears": num_gears,
        "brake_pct": round(brake / 255 * 100, 1),
        "throttle_pct": round(throttle / 255 * 100, 1),
        "clutch_pct": round(clutch / 255 * 100, 1),
        "acceleration_g": round(accel_g, 3),
        "acceleration_xyz": [round(a, 3) for a in accel],
        "pos_x": round(full_pos[0], 2),
        "pos_y": round(full_pos[2], 2),  # eixo Z do jogo ~ "y" no mapa 2D (X/Z = plano do chao)
        "pos_z_height": round(full_pos[1], 2),
    }


TIMINGS_PARTICIPANTS_OFFSET = 33
PARTICIPANT_INFO_SIZE = 32


def decode_timings(raw: bytes) -> dict:
    """packetType == 3. Retorna os dados do participante local (o jogador)."""
    num_participants = _i8(raw, 12)
    local_idx = _u16(raw, 1057)
    off = TIMINGS_PARTICIPANTS_OFFSET + local_idx * PARTICIPANT_INFO_SIZE

    race_pos_byte = _u8(raw, off + 14)
    race_state_byte = _u8(raw, off + 20)
    current_lap = _u8(raw, off + 21)
    current_time = _f32(raw, off + 22)  # tempo de volta em andamento (s); -1 = nao disponivel ainda
    car_index_raw = _u16(raw, off + 18)

    return {
        "num_participants": num_participants,
        "local_participant_index": local_idx,
        "lap_number": current_lap,
        "lap_race_position": race_pos_byte & 0x7F,
        "lap_time_s": None if current_time < 0 else round(current_time, 3),
        "lap_invalidated": bool(race_state_byte & 0x80),
        "car_index": car_index_raw & 0x7FFF,
        "car_index_is_player": car_index_raw == 0xFFFF,
    }


def decode_participants(raw: bytes) -> dict:
    """packetType == 2. Nomes dos pilotos (ate 16). Retorna {index: name}."""
    names = {}
    for i in range(16):
        name = _str(raw, 16 + i * 64, 64)
        if name:
            idx = _u16(raw, 1104 + i * 2)
            names[idx] = name
    return names


VEHICLE_INFO_OFFSET = 12
VEHICLE_INFO_SIZE = 72


def decode_vehicle_names(raw: bytes, size_bytes: int) -> dict:
    """packetType == 8, variante 'vehicle info' (pacote de 1164 bytes). Retorna {index: nome_do_carro}."""
    vehicles = {}
    if size_bytes != 1164:
        return vehicles  # provavelmente a variante 'class names' (1452 bytes) - nao usada aqui
    i = 0
    while True:
        off = VEHICLE_INFO_OFFSET + i * VEHICLE_INFO_SIZE
        if off + VEHICLE_INFO_SIZE > len(raw):
            break
        idx = _u16(raw, off)
        name = _str(raw, off + 8, 64)
        if name:
            vehicles[idx] = name
        i += 1
    return vehicles


TIME_STATS_OFFSET = 16
PARTICIPANT_STATS_SIZE = 32


def decode_time_stats(raw: bytes) -> dict:
    """packetType == 7. Retorna {participant_index: {fastest_lap_s, last_lap_s}}."""
    stats = {}
    i = 0
    while True:
        off = TIME_STATS_OFFSET + i * PARTICIPANT_STATS_SIZE
        if off + PARTICIPANT_STATS_SIZE > len(raw):
            break
        fastest = _f32(raw, off + 0)
        last = _f32(raw, off + 4)
        if fastest > 0 or last > 0:
            stats[i] = {
                "fastest_lap_s": round(fastest, 3) if fastest > 0 else None,
                "last_lap_s": round(last, 3) if last > 0 else None,
            }
        i += 1
    return stats


def decode_race_definition(raw: bytes) -> dict:
    """packetType == 1. Pista e melhores tempos."""
    return {
        "track_location": _str(raw, 48, 64),
        "track_variation": _str(raw, 112, 64),
        "track_length_m": round(_f32(raw, 44), 1),
        "personal_fastest_lap_s": _f32(raw, 16),
    }


@dataclass
class SessionState:
    """Mantem o ultimo valor conhecido de cada tipo de pacote 'on-change',
    para poder montar um evento completo a cada tick de telemetria."""

    driver_name: Optional[str] = None
    car_name: Optional[str] = None
    track_location: Optional[str] = None
    best_lap_s: Optional[float] = None
    last_lap_s: Optional[float] = None
    _last_car_index: Optional[int] = field(default=None, repr=False)
    _last_participant_index: Optional[int] = field(default=None, repr=False)

    def ingest_participants(self, raw: bytes) -> None:
        names = decode_participants(raw)
        if self._last_participant_index is not None and self._last_participant_index in names:
            self.driver_name = names[self._last_participant_index]
        elif names:
            # sessao com 1 unico piloto: pega o primeiro nome nao vazio
            self.driver_name = next(iter(names.values()))

    def ingest_vehicle_names(self, raw: bytes, size_bytes: int) -> None:
        vehicles = decode_vehicle_names(raw, size_bytes)
        if self._last_car_index is not None and self._last_car_index in vehicles:
            self.car_name = vehicles[self._last_car_index]
        elif vehicles:
            self.car_name = next(iter(vehicles.values()))

    def ingest_time_stats(self, raw: bytes) -> None:
        stats = decode_time_stats(raw)
        # Never attribute another participant's record to the local driver.
        s = stats.get(self._last_participant_index)
        if s:
            self.last_lap_s = s["last_lap_s"]
            self.best_lap_s = s["fastest_lap_s"]

    def ingest_race_definition(self, raw: bytes) -> None:
        rd = decode_race_definition(raw)
        self.track_location = rd["track_location"] or self.track_location
        if rd["personal_fastest_lap_s"] and rd["personal_fastest_lap_s"] > 0:
            if self.best_lap_s is None or rd["personal_fastest_lap_s"] < self.best_lap_s:
                self.best_lap_s = rd["personal_fastest_lap_s"]

    def ingest_timings(self, raw: bytes) -> dict:
        t = decode_timings(raw)
        self._last_car_index = t["car_index"]
        self._last_participant_index = t["local_participant_index"]
        return t
