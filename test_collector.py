import json
import struct
import threading
import time
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import unittest

from ams2_collector import (
    Collector,
    ConexaoHttp,
    EnvioEmSegundoPlano,
    build_otlp_payload,
    post_otlp,
)
from ams2_protocol import decode_header


def _anunciar(estado, tempo):
    """O jogo anuncia um tempo de volta novo (pacote 7)."""
    estado.last_lap_s = tempo
    estado.anunciar_tempo(tempo)


def _pacotes_da_captura():
    with open("captura.txt", encoding="utf-8") as f:
        return [bytes.fromhex(l.rstrip("\n").split("\t")[3]) for l in f if l.count("\t") == 3]


def _participante(raw):
    idx = struct.unpack_from("<H", raw, 1057)[0]
    off = 33 + idx * 32
    return off, raw[off + 15] & 7, raw[off + 21]


def _corrida(tempos):
    """Corrida de varias voltas feita com a volta real completa da captura
    (104,015 s) repetida: o numero da volta sobe e, na passagem pela linha, o
    jogo anuncia o tempo oficial da volta anterior - como no AMS2."""
    pacotes = _pacotes_da_captura()
    cruzamentos, anterior = [], None
    for i, raw in enumerate(pacotes):
        if decode_header(raw).packet_type == 3:
            _, setor, _ = _participante(raw)
            if anterior == 2 and setor == 0:
                cruzamentos.append(i)
            anterior = setor
    inicio, fim = cruzamentos[0], cruzamentos[1]
    volta = pacotes[inicio:fim]
    modelo7 = next(raw for raw in volta if decode_header(raw).packet_type == 7)

    def com_ultimo(raw, valor):
        b = bytearray(raw)
        struct.pack_into("<f", b, 20, valor)  # sLastLapTime do participante 0
        return bytes(b)

    corrida = list(pacotes[:inicio])
    for k in range(len(tempos) + 1):
        anuncio = tempos[k - 1] if k > 0 else None
        anunciado = False
        for raw in (volta if k < len(tempos) else pacotes[fim:fim + 400]):
            tipo = decode_header(raw).packet_type
            if tipo == 3:
                b = bytearray(raw)
                off, _, lap = _participante(raw)
                b[off + 21] = lap + k
                corrida.append(bytes(b))
                if anuncio is not None and not anunciado:
                    corrida.append(com_ultimo(modelo7, anuncio))
                    anunciado = True
            elif tipo == 7:
                corrida.append(com_ultimo(raw, anuncio) if anuncio is not None else raw)
            else:
                corrida.append(raw)
    return corrida


class OtlpPayloadTests(unittest.TestCase):
    evento = {
        "timestamp": "2026-09-19T00:00:00+00:00",
        "sample.id": "rig-01|s1|7",
        "driver_name": "Bruno Lima",
        "speed_kmh": 213.4,
        "gear": 5,
        "lap_invalidated": False,
        "best_lap_s": None,
    }

    def _atributos(self) -> dict:
        registro = build_otlp_payload([self.evento])["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]
        return {a["key"]: a["value"] for a in registro["attributes"]}

    def test_every_field_is_a_flat_scalar_attribute(self):
        """Campos planos chegam ao Grail como atributo de topo com o mesmo nome
        do bizevent, identico nos modelos raw e flattened."""
        atributos = self._atributos()
        self.assertEqual({"stringValue": "Bruno Lima"}, atributos["driver_name"])
        self.assertEqual({"doubleValue": 213.4}, atributos["speed_kmh"])
        self.assertEqual({"intValue": "5"}, atributos["gear"])
        self.assertEqual({"boolValue": False}, atributos["lap_invalidated"])

    def test_bool_is_not_serialized_as_an_integer(self):
        # bool e' subclasse de int em Python; a ordem do isinstance importa.
        self.assertNotIn("intValue", self._atributos()["lap_invalidated"])

    def test_null_fields_are_omitted_instead_of_sent_as_empty(self):
        self.assertNotIn("best_lap_s", self._atributos())

    def test_timestamp_travels_in_the_record_time_not_as_an_attribute(self):
        registro = build_otlp_payload([self.evento])["resourceLogs"][0]["scopeLogs"][0]["logRecords"][0]
        esperado = int(datetime.fromisoformat(self.evento["timestamp"]).timestamp() * 1_000_000_000)
        self.assertNotIn("timestamp", self._atributos())
        self.assertEqual(str(esperado), registro["timeUnixNano"])
        self.assertEqual(registro["timeUnixNano"], registro["observedTimeUnixNano"])

    def test_payload_is_serializable_as_json(self):
        json.dumps(build_otlp_payload([self.evento]))


def _pacote_telemetria() -> bytes:
    """Primeiro quadro de telemetria (packetType 0) da captura real."""
    with open("captura.txt", encoding="utf-8") as f:
        for linha in f:
            partes = linha.rstrip("\n").split("\t")
            if len(partes) == 4:
                bruto = bytes.fromhex(partes[3])
                if len(bruto) >= 12 and bruto[10] == 0:
                    return bruto
    raise AssertionError("captura sem quadro de telemetria")


class SampleRateTests(unittest.TestCase):
    def _enviados(self, sample_hz: float, fonte_hz: float = 20.0, segundos: float = 10.0) -> int:
        collector = Collector("rig", "Rig", "s", "real", sample_hz=sample_hz)
        pacote = _pacote_telemetria()
        quadros = int(fonte_hz * segundos)
        return sum(1 for i in range(quadros) if collector.handle_packet(pacote, i / fonte_hz))

    def test_20hz_from_the_game_becomes_10hz(self):
        self.assertEqual(100, self._enviados(10.0))

    def test_zero_keeps_every_frame(self):
        self.assertEqual(200, self._enviados(0.0))

    def test_jitter_does_not_drop_below_target(self):
        collector = Collector("rig", "Rig", "s", "real", sample_hz=10.0)
        pacote = _pacote_telemetria()
        # quadros a 20 Hz com ate' 8 ms de atraso alternado
        instantes = [i * 0.05 + (0.008 if i % 2 else 0.0) for i in range(200)]
        enviados = sum(1 for t in instantes if collector.handle_packet(pacote, t))
        self.assertGreaterEqual(enviados, 95)
        self.assertLessEqual(enviados, 105)


class SectorTests(unittest.TestCase):
    def _eventos(self):
        collector = Collector("rig", "Rig", "s", "real")
        with open("captura.txt", encoding="utf-8") as f:
            for linha in f:
                partes = linha.rstrip("\n").split("\t")
                if len(partes) == 4:
                    evento = collector.handle_packet(bytes.fromhex(partes[3]))
                    if evento:
                        yield evento

    def test_completed_lap_carries_its_three_sectors(self):
        """Volta 1 da captura: 104,015 s. S1 e S2 saem do cronometro na virada
        de setor; S3 fecha com o tempo oficial (o jogo reporta 21,821 como
        ultimo setor - a diferenca e' arredondamento)."""
        voltas = {(e["last_lap_s"], e["last_lap_s1"], e["last_lap_s2"], e["last_lap_s3"])
                  for e in self._eventos() if e["last_lap_s"]}
        self.assertEqual({(104.015, 24.653, 57.54, 21.822)}, voltas)

    def test_lap_joined_midway_has_no_sectors(self):
        # A captura comeca no meio de uma volta: antes da primeira volta
        # completa, nenhum quadro inventa setores.
        for evento in self._eventos():
            if not evento["last_lap_s"]:
                self.assertIsNone(evento["last_lap_s1"])
                self.assertIsNone(evento["last_lap_s3"])


class SectorOrderTests(unittest.TestCase):
    """Ordens de pacote vistas no jogo na passagem pela linha. Volta de 101,94 s:
    S1 = 25,10, S2 = 52,00, S3 = 24,84."""

    def _volta(self, linha, tempo_oficial_antes=False):
        from ams2_protocol import SessionState
        estado = SessionState()

        def timings(volta, setor, cronometro, no_setor):
            estado._acompanhar_setores({"lap_number": volta, "sector": setor,
                                        "lap_time_s": cronometro, "sector_time_s": no_setor})

        def oficial():
            _anunciar(estado, 101.94)

        timings(3, 0, 0.05, 0.05)
        timings(3, 0, 25.0, 25.0)
        timings(3, 1, 25.15, 0.05)    # S1 = 25,10
        timings(3, 1, 77.0, 51.9)
        timings(3, 2, 77.15, 0.05)    # S2 = 52,00
        timings(3, 2, 101.9, 24.8)
        if tempo_oficial_antes:
            oficial()
        for pacote in linha:
            timings(*pacote)
        if not tempo_oficial_antes:
            oficial()
        return estado.sectors_of_last_lap()

    def test_lap_and_sector_change_together(self):
        self.assertEqual((25.1, 52.0, 24.84), self._volta([(4, 0, 0.05, 0.05)]))

    def test_sector_flips_one_packet_before_the_lap_number(self):
        # Antes: o coletor exigia as duas mudancas no mesmo pacote e perdia a volta.
        self.assertEqual((25.1, 52.0, 24.84), self._volta([(3, 0, 0.05, 0.05), (4, 0, 0.1, 0.1)]))

    def test_lap_number_changes_one_packet_before_the_sector(self):
        self.assertEqual((25.1, 52.0, 24.84), self._volta([(4, 2, 101.95, 24.85), (4, 0, 0.05, 0.05)]))

    def test_clock_resets_before_the_sector_flips(self):
        self.assertEqual((25.1, 52.0, 24.84), self._volta([(4, 2, 0.02, 24.9), (4, 0, 0.05, 0.05)]))

    def test_official_time_arriving_before_the_line(self):
        self.assertEqual((25.1, 52.0, 24.84), self._volta([(4, 0, 0.05, 0.05)], tempo_oficial_antes=True))

    def test_sector_time_missing_on_the_transition_packet(self):
        # No pacote da virada o jogo ainda manda "tempo no setor" indisponivel
        # (-1 -> None); o pacote seguinte do mesmo setor basta.
        from ams2_protocol import SessionState
        estado = SessionState()
        for volta, setor, cron, no_setor in [(3, 0, 0.05, 0.05), (3, 0, 25.0, 25.0), (3, 1, 25.15, None), (3, 1, 25.2, 0.1),
                                             (3, 1, 77.0, 51.9), (3, 2, 77.15, None), (3, 2, 77.2, 0.1), (3, 2, 101.9, 24.8), (4, 0, 0.05, 0.05)]:
            estado._acompanhar_setores({"lap_number": volta, "sector": setor, "lap_time_s": cron, "sector_time_s": no_setor})
        _anunciar(estado, 101.94)
        self.assertEqual((25.1, 52.0, 24.84), estado.sectors_of_last_lap())

    def test_sector_flicker_near_a_boundary_keeps_the_lap(self):
        # S2 -> S1 -> S2 por um pacote perto da divisa: antes descartava a volta.
        self.assertEqual((25.1, 52.0, 24.84), self._volta([(3, 1, 101.91, 76.8), (3, 2, 101.92, 24.82), (4, 0, 0.05, 0.05)]))

    def test_restart_in_s3_does_not_overwrite_the_previous_lap_sectors(self):
        from ams2_protocol import SessionState
        estado = SessionState()

        def timings(volta, setor, cron, no_setor):
            estado._acompanhar_setores({"lap_number": volta, "sector": setor, "lap_time_s": cron, "sector_time_s": no_setor})

        for pacote in [(3, 0, 0.05, 0.05), (3, 1, 25.15, 0.05), (3, 2, 77.15, 0.05), (3, 2, 101.9, 24.8), (4, 0, 0.05, 0.05)]:
            timings(*pacote)
        _anunciar(estado, 101.94)
        self.assertEqual((25.1, 52.0, 24.84), estado.sectors_of_last_lap())
        # Volta seguinte: reinicio em S3 com o cronometro em 101,5 s (perto do
        # tempo anterior) e volta para S1 com o cronometro zerado. O jogo nao
        # anuncia tempo novo: os setores da volta anterior ficam intactos.
        for pacote in [(4, 1, 26.0, 0.1), (4, 2, 80.0, 0.1), (4, 2, 101.5, 21.6), (4, 0, 0.05, 0.05)]:
            timings(*pacote)
        self.assertEqual((25.1, 52.0, 24.84), estado.sectors_of_last_lap())

    def test_consistent_laps_do_not_take_the_previous_lap_time(self):
        # A causa dos setores faltando: na linha o jogo ainda mostra o tempo da
        # volta ANTERIOR (101,94); com voltas parecidas ele era aceito como o
        # desta volta. O tempo certo (101,90) so' e' anunciado depois.
        from ams2_protocol import SessionState
        estado = SessionState()

        def timings(volta, setor, cron, no_setor):
            estado._acompanhar_setores({"lap_number": volta, "sector": setor, "lap_time_s": cron, "sector_time_s": no_setor})

        for pacote in [(3, 0, 0.05, 0.05), (3, 1, 25.15, 0.05), (3, 2, 77.15, 0.05), (3, 2, 101.9, 24.8), (4, 0, 0.05, 0.05)]:
            timings(*pacote)
        _anunciar(estado, 101.94)
        for pacote in [(4, 1, 25.2, 0.05), (4, 2, 77.1, 0.05), (4, 2, 101.85, 24.8), (5, 0, 0.05, 0.05)]:
            timings(*pacote)
        # Antes do anuncio novo, os setores da volta 1 seguem intactos.
        self.assertEqual((25.1, 52.0, 24.84), estado.sectors_of_last_lap())
        _anunciar(estado, 101.90)
        self.assertEqual((25.15, 51.9, 24.85), estado.sectors_of_last_lap())

    def test_every_lap_of_a_consistent_race_gets_its_sectors(self):
        # Regressao do defeito visto nos rigs (22/10): so' a primeira volta de
        # cada sessao registrava setores. Quatro voltas a centesimos uma da outra.
        tempos = [104.015, 104.062, 103.987, 104.031]
        coletor = Collector("rig", "Rig", "s", "real")
        setores = {}
        for raw in _corrida(tempos):
            evento = coletor.handle_packet(raw)
            if evento and evento["last_lap_s"] in tempos and evento["last_lap_s"] not in setores:
                setores[evento["last_lap_s"]] = (evento["last_lap_s1"], evento["last_lap_s2"], evento["last_lap_s3"])
        for tempo in tempos:
            s1, s2, s3 = setores[tempo]
            self.assertIsNotNone(s1, f"volta de {tempo} sem setores")
            self.assertAlmostEqual(tempo, s1 + s2 + s3, places=3)

    def test_out_of_order_sector_jump_drops_the_lap_instead_of_inventing(self):
        # Reinicio/box no meio da volta: S3 -> S2 -> S3 -> linha. Sem setores.
        self.assertEqual((None, None, None), self._volta([(3, 1, 10.0, 1.0), (3, 2, 11.0, 0.1), (4, 0, 0.05, 0.05)]))


class DriverSwapTests(unittest.TestCase):
    """Troca do piloto com o coletor rodando (racing.ini ou painel)."""

    def setUp(self):
        self.pacotes = _pacotes_da_captura()
        self.telemetria = next(raw for raw in self.pacotes if decode_header(raw).packet_type == 0)
        self.coletor = Collector("rig-01", "Simulador 1", "live-1", "real", "Bruno Lima")
        # Captura inteira: o jogo ja' anunciou a volta de 104,015 s do Bruno.
        for raw in self.pacotes:
            self.coletor.handle_packet(raw)
        self.assertEqual(104.015, self.coletor.state.last_lap_s)
        # A captura termina no menu principal; o piloto volta a dirigir.
        self.coletor.handle_packet(_estado_do_jogo(self.pacotes, 2))

    def test_new_driver_gets_a_new_session(self):
        antes = self.coletor.handle_packet(self.telemetria)
        self.coletor.trocar_piloto("Ana Souza")
        depois = self.coletor.handle_packet(self.telemetria)
        self.assertEqual("Bruno Lima", antes["driver_name"])
        self.assertEqual("Ana Souza", depois["driver_name"])
        self.assertNotEqual(antes["session.id"], depois["session.id"])
        self.assertTrue(depois["sample.id"].endswith("|1"), "a sessao nova recomeca a sequencia")

    def test_previous_driver_lap_time_does_not_leak_to_the_new_one(self):
        self.coletor.state.best_lap_s = 103.5
        self.coletor.trocar_piloto("Ana Souza")
        evento = self.coletor.handle_packet(self.telemetria)
        self.assertIsNone(evento["last_lap_s"], "104,015 e' do Bruno, nao da Ana")
        self.assertIsNone(evento["last_lap_s1"])
        self.assertIsNone(evento["best_lap_s"])
        # A Ana fecha a primeira volta dela: o tempo novo aparece.
        anuncio = bytearray(next(raw for raw in self.pacotes if decode_header(raw).packet_type == 7))
        struct.pack_into("<f", anuncio, 20, 99.5)
        self.coletor.handle_packet(bytes(anuncio))
        self.assertEqual(99.5, self.coletor.handle_packet(self.telemetria)["last_lap_s"])

    def test_blank_name_falls_back_to_the_game_profile(self):
        self.coletor.trocar_piloto("")
        evento = self.coletor.handle_packet(self.telemetria)
        self.assertEqual(self.coletor.state.driver_name, evento["driver_name"])
        self.assertEqual("perfil do jogo", self.coletor.estado()["origem"])

    def test_same_name_keeps_the_session(self):
        sessao = self.coletor.session_id
        self.coletor.trocar_piloto("Bruno Lima")
        self.assertEqual(sessao, self.coletor.session_id)

    def test_driver_is_name_plus_company(self):
        sessao = self.coletor.session_id
        self.coletor.trocar_piloto("Bruno Lima", "Dynatrace")
        evento = self.coletor.handle_packet(self.telemetria)
        self.assertEqual(("Bruno Lima", "Dynatrace"), (evento["driver_name"], evento["company_name"]))
        self.assertNotEqual(sessao, evento["session.id"], "outra empresa = outro piloto = sessao nova")
        self.assertNotIn("rig.name", evento)


def _estado_do_jogo(pacotes, estado):
    """Pacote de estado do jogo (tipo 4) da captura com o estado trocado."""
    b = bytearray(next(raw for raw in pacotes if decode_header(raw).packet_type == 4))
    b[14] = (b[14] & 0xF8) | estado
    return bytes(b)


class OwnCarTests(unittest.TestCase):
    """O AMS2 manda na telemetria o carro que a CAMERA mostra; numa corrida
    online ou nos boxes isso pode ser outro participante. So' o carro do
    piloto deste PC entra nas amostras."""

    def setUp(self):
        self.pacotes = _pacotes_da_captura()
        self.coletor = Collector("rig", "Rig", "s", "real", "Bruno Lima")
        self.coletor.handle_packet(_estado_do_jogo(self.pacotes, 2))
        self.tempos = next(raw for raw in self.pacotes if decode_header(raw).packet_type == 3)
        self.telemetria = next(raw for raw in self.pacotes if decode_header(raw).packet_type == 0)

    def _tempos_com_local(self, local, participantes=2):
        """Pacote de tempos com 2 participantes: o 0 da captura e um 1 parado na
        volta 9; `local` e' o indice que o jogo informa como jogador local."""
        b = bytearray(self.tempos)
        b[12] = participantes
        b[33 + 32:33 + 64] = b[33:33 + 32]
        b[33 + 32 + 21] = 9  # volta 9 no participante 1
        struct.pack_into("<H", b, 1057, local)
        return bytes(b)

    def _telemetria_vista(self, visualizado):
        b = bytearray(self.telemetria)
        b[12] = visualizado & 0xFF
        return bytes(b)

    def test_frames_of_another_participant_are_dropped(self):
        self.coletor.handle_packet(self._tempos_com_local(0))
        self.assertIsNotNone(self.coletor.handle_packet(self._telemetria_vista(0)))
        self.assertIsNone(self.coletor.handle_packet(self._telemetria_vista(1)), "camera no outro carro")
        self.assertEqual(1, self.coletor.descartados_outro_carro)

    def test_frames_outside_driving_are_dropped(self):
        self.coletor.handle_packet(self._tempos_com_local(0))
        for estado in (1, 3, 4, 6):  # menu, pausado, boxes/garagem, replay
            self.coletor.handle_packet(_estado_do_jogo(self.pacotes, estado))
            self.assertIsNone(self.coletor.handle_packet(self._telemetria_vista(0)), f"estado {estado}")
        self.coletor.handle_packet(_estado_do_jogo(self.pacotes, 2))
        self.assertIsNotNone(self.coletor.handle_packet(self._telemetria_vista(0)))

    def test_alternating_local_index_does_not_switch_the_car(self):
        self.coletor.handle_packet(self._tempos_com_local(0))
        for i in range(30):  # o jogo alterna o "local" pacote a pacote
            self.coletor.handle_packet(self._tempos_com_local(i % 2))
        self.assertEqual(0, self.coletor.state.indice_proprio())
        evento = self.coletor.handle_packet(self._telemetria_vista(0))
        self.assertNotEqual(9, evento["lap_number"], "volta lida do carro proprio, nao do participante 1")

    def test_a_steady_new_local_index_is_a_real_car_change(self):
        self.coletor.handle_packet(self._tempos_com_local(0))
        for _ in range(20):
            self.coletor.handle_packet(self._tempos_com_local(1))
        self.assertEqual(1, self.coletor.state.indice_proprio())
        self.assertEqual(9, self.coletor.handle_packet(self._telemetria_vista(1))["lap_number"])

    def test_game_name_comes_from_the_own_position_not_the_online_id(self):
        # Dois pilotos na lista, os dois com o mesmo sIndex (id da partida
        # online). Antes, o ultimo da lista sobrescrevia: "Andy Schultz".
        participantes = bytearray(next(raw for raw in self.pacotes if decode_header(raw).packet_type == 2))
        participantes[16:16 + 64] = b"Alexandre Sacco".ljust(64, b"\0")
        participantes[16 + 64:16 + 128] = b"Andy Schultz".ljust(64, b"\0")
        struct.pack_into("<HH", participantes, 1104, 0, 0)
        coletor = Collector("rig", "Rig", "s", "real")  # sem nome: vale o do jogo
        coletor.handle_packet(_estado_do_jogo(self.pacotes, 2))
        coletor.handle_packet(self._tempos_com_local(0))
        coletor.handle_packet(bytes(participantes))
        self.assertEqual("Alexandre Sacco", coletor.handle_packet(self._telemetria_vista(0))["driver_name"])


class _Contador(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive
    conexoes = set()
    corpos = []

    def do_POST(self):
        _Contador.conexoes.add(self.client_address)
        _Contador.corpos.append(self.rfile.read(int(self.headers["Content-Length"])))
        self.send_response(200)
        self.send_header("Content-Length", "2")
        self.end_headers()
        self.wfile.write(b"{}")

    def log_message(self, *args):
        pass


class KeepAliveTests(unittest.TestCase):
    def setUp(self):
        _Contador.conexoes = set()
        _Contador.corpos = []
        self.servidor = ThreadingHTTPServer(("127.0.0.1", 0), _Contador)
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.servidor.server_port}/v1/logs"

    def tearDown(self):
        self.servidor.shutdown()
        self.servidor.server_close()

    def test_many_batches_reuse_one_connection(self):
        conexao = ConexaoHttp(self.url)
        for _ in range(5):
            post_otlp(conexao, [OtlpPayloadTests.evento])
        conexao.fechar()
        self.assertEqual(5, len(_Contador.corpos))
        self.assertEqual(1, len(_Contador.conexoes))

    def test_reconnects_when_server_dropped_idle_connection(self):
        conexao = ConexaoHttp(self.url)
        post_otlp(conexao, [OtlpPayloadTests.evento])
        conexao._conn.sock.close()  # simula o servidor fechando a conexao ociosa
        inicio = time.time()
        post_otlp(conexao, [OtlpPayloadTests.evento])
        conexao.fechar()
        self.assertEqual(2, len(_Contador.corpos))
        self.assertLess(time.time() - inicio, 0.9, "reabrir nao deve esperar o backoff")


class FilaTests(unittest.TestCase):
    def test_full_queue_drops_the_oldest_batch(self):
        liberar = threading.Event()
        recebidos = []

        def criar_envio():
            def envia(lote):
                liberar.wait()
                recebidos.extend(lote)
            return envia

        fila = EnvioEmSegundoPlano(criar_envio, "teste", limite=2)
        fila.enfileirar([0])          # a thread pega este e fica presa
        time.sleep(0.1)
        for i in (1, 2, 3):
            fila.enfileirar([i])      # 1 e' descartado quando 3 chega
        liberar.set()
        fila.drenar(2)
        self.assertEqual([0, 2, 3], recebidos)
        self.assertEqual(1, fila.descartados)

    def test_backlog_goes_out_in_one_post_and_in_order(self):
        liberar = threading.Event()
        envios = []

        def criar_envio():
            def envia(amostras):
                liberar.wait()
                envios.append(list(amostras))
            return envia

        fila = EnvioEmSegundoPlano(criar_envio, "teste")
        fila.enfileirar([0, 1])       # a thread pega este e fica presa no POST
        time.sleep(0.1)
        for lote in ([2, 3], [4, 5], [6]):
            fila.enfileirar(lote)     # acumulam enquanto o POST demora
        liberar.set()
        fila.drenar(2)
        self.assertEqual([[0, 1], [2, 3, 4, 5, 6]], envios)


if __name__ == "__main__":
    unittest.main()
