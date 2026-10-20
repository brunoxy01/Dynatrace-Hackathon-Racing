import json
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
