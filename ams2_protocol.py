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


# Nenhum carro do AMS2 chega perto disto, nem um Formula USA na oval de
# Indianapolis. O jogo emite quadros acima desse limite quando teletransporta o
# carro (voltar aos boxes, reiniciar a sessao) ou quando a fisica lanca o carro
# numa batida: sSpeed vira a distancia do salto dividida pelo tick. Um unico
# quadro desses definia sozinho a "velocidade maxima" do painel, entao a leitura
# e' descartada em vez de ser ingerida.
MAX_PLAUSIBLE_SPEED_KMH = 400.0

# Mesmo tipo de quadro quebrado, no acelerometro. Nenhum carro de corrida passa
# de ~6 g nem na frenagem mais forte - na captura real o p99 e' 3,2 g -, mas
# zebra alta, batida e reposicionamento produzem picos absurdos (105 g na
# captura). Sao 0,04% dos quadros, e bastavam para sujar a leitura na tela.
MAX_PLAUSIBLE_G = 10.0


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
    speed_kmh = round(speed_ms * 3.6, 1)

    return {
        "speed_kmh": speed_kmh if 0 <= speed_kmh <= MAX_PLAUSIBLE_SPEED_KMH else None,
        "gear": gear,
        "num_gears": num_gears,
        "brake_pct": round(brake / 255 * 100, 1),
        "throttle_pct": round(throttle / 255 * 100, 1),
        "clutch_pct": round(clutch / 255 * 100, 1),
        "acceleration_g": round(accel_g, 3) if accel_g <= MAX_PLAUSIBLE_G else None,
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
    # sSector: os 3 bits baixos sao o setor atual (0 = S1, 1 = S2, 2 = S3); os
    # de cima carregam precisao extra da posicao no mundo. Conferido na captura.
    sector_byte = _u8(raw, off + 15)
    race_state_byte = _u8(raw, off + 20)
    current_lap = _u8(raw, off + 21)
    current_time = _f32(raw, off + 22)  # tempo de volta em andamento (s); -1 = nao disponivel ainda
    sector_time = _f32(raw, off + 26)   # tempo dentro do setor atual (s); -1 = idem
    car_index_raw = _u16(raw, off + 18)

    return {
        "num_participants": num_participants,
        "local_participant_index": local_idx,
        "lap_number": current_lap,
        "lap_race_position": race_pos_byte & 0x7F,
        "lap_time_s": None if current_time < 0 else round(current_time, 3),
        "sector": sector_byte & 0x07,
        "sector_time_s": None if sector_time < 0 else round(sector_time, 3),
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
    # Setores da ULTIMA volta concluida (s1, s2, s3), valendo enquanto
    # last_lap_s for `last_lap_sectors_for` - mesma semantica do last_lap_s,
    # que o jogo repete ao longo da volta seguinte.
    last_lap_sectors: Optional[tuple] = None
    last_lap_sectors_for: Optional[float] = None
    _last_car_index: Optional[int] = field(default=None, repr=False)
    _last_participant_index: Optional[int] = field(default=None, repr=False)
    _sector: Optional[int] = field(default=None, repr=False)
    _maior_cur: Optional[float] = field(default=None, repr=False)
    _ultimo_cur: Optional[float] = field(default=None, repr=False)
    # Instante (no cronometro da volta) em que S2 e S3 comecaram: {1: ..., 2: ...}
    _inicio_setor: dict = field(default_factory=dict, repr=False)
    _concluida: Optional[tuple] = field(default=None, repr=False)
    # Tempo anunciado durante o S3 da volta em andamento, um instante antes da
    # linha: e' o tempo DESTA volta.
    _anuncio_no_s3: Optional[float] = field(default=None, repr=False)

    def ingest_participants(self, raw: bytes) -> None:
        names = decode_participants(raw)
        if self._last_participant_index is not None and self._last_participant_index in names:
            self.driver_name = names[self._last_participant_index]
        elif names:
            # sessao com 1 unico piloto: pega o primeiro nome nao vazio
            self.driver_name = next(iter(names.values()))

    def ingest_vehicle_names(self, raw: bytes, size_bytes: int) -> None:
        # O AMS2 manda sCarIndex = 0xFFFF para o carro do proprio jogador (o
        # sentinela "sou eu"), entao o indice nunca casa com o catalogo e quem
        # resolve o modelo na pratica e' o fallback abaixo. Numa sessao solo o
        # catalogo tem um veiculo so' e o resultado e' exato; com IA na pista ha'
        # varios e o primeiro da lista pode nao ser o do jogador.
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
            anterior = self.last_lap_s
            self.last_lap_s = s["last_lap_s"]
            self.best_lap_s = s["fastest_lap_s"]
            # O pacote 7 tambem chega a cada fim de setor repetindo o mesmo
            # tempo; so' uma MUDANCA e' o anuncio de uma volta nova.
            if self.last_lap_s and self.last_lap_s != anterior:
                self.anunciar_tempo(self.last_lap_s)

    def anunciar_tempo(self, tempo: float) -> None:
        """O jogo anunciou um tempo de volta novo. E' o tempo da volta que
        acabou de fechar na linha (S1/S2 ja' guardados em _concluida) ou, se
        chegou durante o S3, o da volta que esta' fechando agora."""
        if self._concluida is not None:
            self._fechar_setores(tempo)
        elif self._sector == 2 and 2 in self._inicio_setor:
            self._anuncio_no_s3 = tempo

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
        self._acompanhar_setores(t)
        return t

    def _acompanhar_setores(self, t: dict) -> None:
        """Os setores saem do instante em que cada setor COMECOU, no cronometro
        da volta: em qualquer pacote dentro do setor, cronometro menos o tempo
        ja' corrido no setor. Inicio de S2 = S1; inicio de S3 = S1 + S2; S3 fecha
        com o tempo oficial da volta (pacote 7), em _fechar_setores.

        Por que assim: calcular so' no pacote exato da virada perdia a volta se
        ali o jogo mandasse o tempo no setor ainda indisponivel, ou se o setor
        "piscasse" por um pacote perto da divisa. Agora o primeiro pacote valido
        do setor basta, e um pacote estranho nao derruba a volta.

        A volta fecha na passagem S3 -> S1 (a linha), sem depender do numero da
        volta, que o jogo as vezes incrementa um pacote antes ou depois. Se o
        cronometro zera ainda em S3, a volta fecha ali mesmo. Cronometro zerando
        no meio da volta (box, reinicio) descarta a volta em andamento: ela fica
        sem setores em vez de setores errados."""
        setor, cur, no_setor = t["sector"], t["lap_time_s"], t["sector_time_s"]
        anterior = self._sector
        zerou = cur is not None and self._ultimo_cur is not None and cur < self._ultimo_cur - 1.0
        if (anterior == 2 and setor == 0) or (zerou and anterior == 2):
            self._fechar_volta()
        elif zerou:
            self._inicio_setor = {}
            self._maior_cur = None
        if setor in (1, 2) and setor not in self._inicio_setor and cur is not None and no_setor is not None:
            inicio = round(cur - no_setor, 3)
            if inicio > 0 and (setor == 1 or self._inicio_setor.get(1, 0) < inicio):
                self._inicio_setor[setor] = inicio
                # A volta anterior teve todo o S1 desta para receber o tempo
                # oficial; se nao recebeu (box, reinicio), fica sem setores em
                # vez de pegar o tempo de outra volta.
                if setor == 1:
                    self._concluida = None
        self._sector = setor
        if cur is not None:
            self._ultimo_cur = cur
            if self._maior_cur is None or cur > self._maior_cur:
                self._maior_cur = cur

    def _fechar_volta(self) -> None:
        """Passagem pela linha: guarda S1, S2 e o maior cronometro da volta e
        comeca a volta seguinte do zero.

        O tempo oficial desta volta e' o que o jogo anunciou durante o S3 (um
        instante antes da linha) ou o PROXIMO anuncio - nunca o tempo que ja'
        estava em vigor. Antes o casamento era por proximidade (tempo oficial a
        ate' 1 s do cronometro), mas no instante da linha o jogo ainda mostra o
        tempo da volta ANTERIOR: com voltas consistentes (1:41.7, 1:41.8...) ele
        "casava", os setores ficavam presos a' volta errada e a certa ficava
        sem eles. Por isso so' a primeira volta de cada sessao tinha setores."""
        inicio_s2, inicio_s3 = self._inicio_setor.get(1), self._inicio_setor.get(2)
        if inicio_s2 is not None and inicio_s3 is not None and self._maior_cur is not None:
            self._concluida = (inicio_s2, round(inicio_s3 - inicio_s2, 3), self._maior_cur)
            if self._anuncio_no_s3 is not None:
                self._fechar_setores(self._anuncio_no_s3)
        # Uma segunda passagem "vazia" logo em seguida (cronometro zerou um
        # pacote antes de o setor virar) nao apaga a volta que acabou de fechar.
        self._anuncio_no_s3 = None
        self._inicio_setor = {}
        self._maior_cur = None

    def _fechar_setores(self, tempo: float) -> None:
        """Casa S1/S2 da volta fechada com o tempo oficial dela e calcula S3.
        Quem escolhe o tempo e' a ordem dos anuncios; a conferencia de 1,5 s
        contra o cronometro e' so' sanidade (box ou reinicio no S3)."""
        s1, s2, cronometro = self._concluida
        self._concluida = None
        if abs(tempo - cronometro) > 1.5:
            return
        s3 = round(tempo - s1 - s2, 3)
        if min(s1, s2, s3) > 0:
            self.last_lap_sectors = (s1, s2, s3)
            self.last_lap_sectors_for = tempo

    def sectors_of_last_lap(self) -> tuple:
        """(s1, s2, s3) da volta em last_lap_s, ou (None, None, None)."""
        if self.last_lap_sectors and self.last_lap_sectors_for == self.last_lap_s:
            return self.last_lap_sectors
        return (None, None, None)
