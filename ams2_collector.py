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
import http.client
import json
import os
import queue
import socket
import sys
import threading
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Optional

from ams2_protocol import (
    SessionState,
    decode_header,
    decode_telemetry,
)

# Versao exibida no console do rig. O workflow do pacote (pacote-rig.yml)
# troca esta linha pela tag da release antes de gerar o executavel; o valor
# aqui vale para quem roda direto do repositorio.
VERSAO = "v1.10.8"

EVENT_TYPE = "racing.telemetry"
EVENT_PROVIDER = "hackathon.racing.ams2"
DEFAULT_UDP_PORT = 5606
DEFAULT_OTLP_ENDPOINT = "http://127.0.0.1:4318/v1/logs"
# O AMS2 manda ~20 quadros/s com UDP Frequency = 1. O mapa e os indicadores nao
# ganham nada visivel com isso, e metade do volume e' metade do que ingerir e
# consultar. 0 desliga o corte e envia todo quadro.
DEFAULT_SAMPLE_HZ = 10.0
OTLP_SERVICE_NAME = "ams2-rig"


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_event(rig_id: str, rig_name: str, session_id: str, state: SessionState,
                 telemetry: dict, timings: Optional[dict], source: str,
                 sample_seq: int = 0, driver_name: Optional[str] = None) -> dict:
    nome_do_jogo = (state.driver_name or "").strip() or None
    s1, s2, s3 = state.sectors_of_last_lap()
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
        # O piloto digita o proprio nome no perfil do AMS2 (conta Steam). A
        # opcao --driver-name vence, para quando o rig ja' sabe quem esta na
        # cadeira.
        "driver_name": driver_name or nome_do_jogo,
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
        # Setores da volta em last_lap_s; nulos se o coletor entrou no meio dela.
        "last_lap_s1": s1,
        "last_lap_s2": s2,
        "last_lap_s3": s3,
        "lap_invalidated": timings["lap_invalidated"] if timings else None,
        "track_name": state.track_location,
        "lap_number": timings["lap_number"] if timings else None,
    }


class ConexaoHttp:
    """Conexao HTTP(S) reaproveitada entre os POSTs.

    O urllib abre um TCP + TLS novo a cada requisicao. Do Brasil ate o tenant
    isso sao varias idas e voltas por lote, e com 2 lotes/s a thread de envio
    nao dava conta: a fila crescia e o atraso subia minuto a minuto. Com
    keep-alive o handshake acontece uma vez e cada lote custa um POST so'.

    Nao e' thread-safe: cada thread de envio tem a sua.
    """

    def __init__(self, url: str, timeout: float = 10.0):
        partes = urllib.parse.urlsplit(url)
        self.https = partes.scheme == "https"
        self.host = partes.hostname or "127.0.0.1"
        self.port = partes.port
        self.caminho = (partes.path or "/") + (f"?{partes.query}" if partes.query else "")
        self.timeout = timeout
        self._conn: Optional[http.client.HTTPConnection] = None

    def _abrir(self) -> http.client.HTTPConnection:
        classe = http.client.HTTPSConnection if self.https else http.client.HTTPConnection
        return classe(self.host, self.port, timeout=self.timeout)

    def fechar(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None

    def post(self, body: bytes, headers: dict):
        """Devolve (status, corpo). Uma conexao ociosa que o servidor ja' fechou
        so' e' descoberta no envio; nesse caso reabre e tenta de novo na hora,
        sem gastar uma das tentativas com espera."""
        for reaproveitada in ((self._conn is not None), False):
            if self._conn is None:
                self._conn = self._abrir()
            try:
                self._conn.request("POST", self.caminho, body=body, headers=headers)
                resp = self._conn.getresponse()
                corpo = resp.read()
            except (http.client.HTTPException, OSError):
                self.fechar()
                if reaproveitada:
                    continue
                raise
            if resp.will_close:
                self.fechar()
            return resp.status, corpo
        raise OSError("conexao recusada")  # inalcancavel: o laco sempre retorna ou levanta


def _post_json(conexao: ConexaoHttp, payload, headers: dict, what: str, tentativas: int = 3) -> bool:
    """POST com retry nas falhas transitorias.

    Rede de evento oscila: um handshake TLS que estoura o tempo derrubava o lote
    inteiro na primeira tentativa. Erros 4xx nao sao repetidos - token errado ou
    escopo faltando nao melhoram insistindo, so' atrasam o proximo lote.
    """
    body = json.dumps(payload).encode("utf-8")
    cabecalhos = {"Content-Type": "application/json", **headers}
    ultimo = "desconhecido"
    for tentativa in range(1, tentativas + 1):
        try:
            status, corpo = conexao.post(body, cabecalhos)
            if 200 <= status < 300:
                if tentativa > 1:
                    print(f"[info] {what}: entregue na tentativa {tentativa}", file=sys.stderr)
                return True
            detail = corpo.decode("utf-8", "replace")
            if status < 500 and status != 429:
                print(f"[erro] {what}: HTTP {status} - {detail[:300]}", file=sys.stderr)
                return False
            ultimo = f"HTTP {status} - {detail[:150]}"
        except (http.client.HTTPException, OSError) as e:
            ultimo = f"falha de conexao - {e}"
        if tentativa < tentativas:
            time.sleep(min(2 ** (tentativa - 1), 4))
    print(f"[erro] {what}: {ultimo} (desisti apos {tentativas} tentativas)", file=sys.stderr)
    return False


def post_events(conexao: ConexaoHttp, token: Optional[str], events: list) -> None:
    """Envia para a Business Events API (/api/v2/bizevents/ingest)."""
    if not events:
        return
    headers = {"Authorization": f"Api-Token {token}"} if token else {}
    _post_json(conexao, events, headers, f"bizevents ({len(events)} evento(s))")


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

    So' stdlib de proposito: os rigs sao maquinas de jogo Windows e
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


def post_otlp(conexao: ConexaoHttp, events: list) -> None:
    """Envia para o OTel Collector local, que repassa ao Dynatrace."""
    if not events:
        return
    _post_json(conexao, build_otlp_payload(events), {}, f"otlp ({len(events)} registro(s))")


class Collector:
    def __init__(self, rig_id: str, rig_name: str, session_id: str, source_label: str,
                 driver_name: Optional[str] = None, sample_hz: float = 0.0):
        self.state = SessionState()
        self.rig_id = rig_id
        self.rig_name = rig_name
        self.driver_name = driver_name
        self.session_id = session_id
        self.source_label = source_label
        self._last_timings: Optional[dict] = None
        self._sample_seq = 0
        # Folga de 10% no intervalo: com o jogo a 20 Hz e jitter de rede, um
        # corte exato em 100 ms deixaria passar ora 1, ora 2 quadros em cada 3.
        self._intervalo = 0.9 / sample_hz if sample_hz > 0 else 0.0
        self._ultimo_envio: Optional[float] = None

    def handle_packet(self, raw: bytes, agora: Optional[float] = None) -> Optional[dict]:
        """Processa um pacote UDP cru; retorna um evento pronto quando um
        frame de telemetria (packetType 0) for decodificado, ou None.

        `agora` e' o relogio usado no corte de frequencia (segundos). O replay
        passa o horario gravado na captura, para que --speed 0 nao descarte
        quase tudo; no UDP ao vivo vale o relogio da maquina."""
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
            # Os pacotes de estado (voltas, nomes) acima sao sempre processados;
            # so' a amostra de telemetria e' rarefeita.
            if self._intervalo:
                instante = time.monotonic() if agora is None else agora
                if self._ultimo_envio is not None and instante - self._ultimo_envio < self._intervalo:
                    return None
                self._ultimo_envio = instante
            telemetry = decode_telemetry(raw)
            self._sample_seq += 1
            return build_event(
                self.rig_id, self.rig_name, self.session_id, self.state,
                telemetry, self._last_timings, self.source_label, self._sample_seq,
                self.driver_name,
            )
        return None


class EnvioEmSegundoPlano:
    """Tira o POST da thread que le o socket UDP.

    Sem isto, uma rede lenta trava o recvfrom por dezenas de segundos e o buffer
    do socket transborda: perde-se telemetria que o jogo ja' tinha mandado. A fila
    e' limitada de proposito - se o destino ficar fora do ar por muito tempo,
    descarta o lote MAIS ANTIGO: num painel ao vivo, o dado novo vale mais.

    Cada thread tem a sua conexao keep-alive (`criar_envio` e' chamado uma vez
    por thread). Mais de uma thread embaralha a ORDEM DE CHEGADA dos lotes, e
    o app ja' sofreu com isso: o replay recortava a volta pela ordem do Grail e
    comecava no meio. Por isso o padrao e' 1 thread; com keep-alive ela da' conta.
    """

    def __init__(self, criar_envio, nome: str, limite: int = 300, trabalhadores: int = 1,
                 max_por_envio: int = 500):
        self.fila: "queue.Queue[list]" = queue.Queue(maxsize=limite)
        self.nome = nome
        self.max_por_envio = max_por_envio
        self.descartados = 0
        self.threads = [
            threading.Thread(target=self._laco, args=(criar_envio,), name=f"envio-{nome}-{i}", daemon=True)
            for i in range(trabalhadores)
        ]
        for thread in self.threads:
            thread.start()

    def _laco(self, criar_envio) -> None:
        envia = criar_envio()
        while True:
            lotes = [self.fila.get()]
            # Junta no mesmo POST o que se acumulou enquanto o anterior viajava.
            # Com uma thread so' (para manter a ordem), um POST mais lento que o
            # intervalo de envio fazia a fila crescer e os dados chegarem em
            # rajadas - no Ao vivo a bolinha parava e depois corria. Assim o
            # POST cresce quando a rede piora, e a fila nao.
            while sum(len(l) for l in lotes) < self.max_por_envio:
                try:
                    lotes.append(self.fila.get_nowait())
                except queue.Empty:
                    break
            try:
                juntos = [amostra for lote in lotes for amostra in lote]
                if juntos:
                    envia(juntos)
            except Exception as erro:  # nunca deixar a thread de envio morrer
                print(f"[erro] {self.nome}: {erro}", file=sys.stderr)
            finally:
                for _ in lotes:
                    self.fila.task_done()

    def enfileirar(self, lote: list) -> None:
        while True:
            try:
                self.fila.put_nowait(lote)
                return
            except queue.Full:
                try:
                    antigo = self.fila.get_nowait()
                except queue.Empty:
                    continue
                self.fila.task_done()
                self.descartados += len(antigo)
                print(f"[!!] {self.nome}: fila cheia, {self.descartados} amostras antigas descartadas no total",
                      file=sys.stderr)

    def pendentes(self) -> int:
        return self.fila.qsize()

    def drenar(self, segundos: float = 15.0) -> None:
        limite = time.time() + segundos
        while self.fila.unfinished_tasks and time.time() < limite:
            time.sleep(0.2)


class Dispatcher:
    """Entrega cada lote aos destinos escolhidos em --sink."""

    def __init__(self, args, ingest_url: Optional[str]):
        self.args = args
        self.ingest_url = ingest_url
        self.to_bizevents = args.sink in ("bizevents", "both") and bool(ingest_url) and not args.dry_run
        self.to_otlp = args.sink in ("otlp", "both") and not args.dry_run
        # Os dois destinos saem da thread do UDP, cada um com UMA thread: a ordem
        # de chegada fica igual a' ordem do jogo. Com 2 threads no bizevents os
        # lotes chegavam embaralhados ao Grail (v1.10.0/1.10.1). A conexao
        # keep-alive e' o que faz uma thread so' acompanhar o rig.
        self._bizevents = EnvioEmSegundoPlano(self._envio_bizevents, "bizevents") \
            if self.to_bizevents else None
        self._otlp = EnvioEmSegundoPlano(self._envio_otlp, "otlp") if self.to_otlp else None

    def _envio_bizevents(self):
        conexao = ConexaoHttp(self.ingest_url)
        return lambda lote: post_events(conexao, self.args.token, lote)

    def _envio_otlp(self):
        conexao = ConexaoHttp(self.args.otlp_endpoint)
        return lambda lote: post_otlp(conexao, lote)

    def _filas(self):
        return [f for f in (self._bizevents, self._otlp) if f is not None]

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

    def pendentes(self) -> int:
        """Lotes esperando envio. Se isto so' cresce, o destino nao acompanha o
        rig e o atraso no painel vai subir junto."""
        return sum(f.pendentes() for f in self._filas())

    def flush(self, batch: list) -> None:
        if not batch:
            return
        for fila in self._filas():
            fila.enfileirar(list(batch))

    def encerrar(self) -> None:
        """Da' chance de a fila esvaziar antes de o processo morrer."""
        for fila in self._filas():
            fila.drenar()


def run_udp(args, dispatcher: "Dispatcher") -> int:
    collector = Collector(args.rig_id, args.rig_name, f"live-{int(time.time())}", "real",
                          args.driver_name, args.sample_hz)
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.bind((args.bind, args.port))
    print(f"[info] coletor {VERSAO} escutando UDP em {args.bind}:{args.port} (rig={args.rig_id}) - Ctrl+C para parar")
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
                print(f"[{VERSAO}] {sent} amostras enviadas | fila: {dispatcher.pendentes()} lote(s)   ",
                      end="\r", flush=True)
    except KeyboardInterrupt:
        print("\n[info] interrompido pelo usuario")
        dispatcher.flush(batch)
        sent += len(batch)
        print("[..] esvaziando a fila de envio")
        dispatcher.encerrar()
        print(f"[info] total enviado: {sent} amostras")
    return 0


def run_replay(args, dispatcher: "Dispatcher") -> int:
    collector = Collector(args.rig_id, args.rig_name, f"replay-{int(time.time())}", "real",
                          args.driver_name, args.sample_hz)
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

            ev = collector.handle_packet(raw, t.timestamp())
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
    dispatcher.encerrar()
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
    parser.add_argument("--batch-size", type=int, default=10)
    # Era 1.0s - metade do caminho de ponta a ponta até o mapa "parecer" ao
    # vivo é esta espera mais o timeout do batch do OTel Collector (ver
    # otel/otelcol-racing.yaml). Baixar os dois reduz o atraso percebido; o
    # resto (ingestão e indexação no Grail) não é configurável por aqui.
    parser.add_argument("--flush-interval", type=float, default=0.5, help="segundos entre envios ao Dynatrace")
    parser.add_argument(
        "--sample-hz", type=float, default=float(os.environ.get("RACING_SAMPLE_HZ", DEFAULT_SAMPLE_HZ)),
        help=f"amostras de telemetria por segundo enviadas (default: {DEFAULT_SAMPLE_HZ:g}; 0 = todas as do jogo)",
    )
    parser.add_argument(
        "--driver-name", default=os.environ.get("RACING_DRIVER") or None,
        help="sobrepoe o nome do piloto vindo do simulador (o cliente na cadeira)",
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
