#!/usr/bin/env python3
"""Hackathon Racing - processo unico do rig.

Um duplo clique liga tudo o que precisa rodar dentro do simulador:

  1. sobe o OTel Collector (processo filho) com a config de producao;
  2. espera o receiver OTLP responder;
  3. escuta o UDP do Automobilista 2, decodifica e entrega a telemetria.

Configuracao em `racing.ini`, ao lado do executavel. Sem ini, usa variaveis de
ambiente. Ctrl+C derruba o collector junto.

Modo de ensaio (`--teste`): sobe tambem o gerador, que reenvia a captura real
por UDP fazendo o papel do jogo. Serve para validar a cadeia inteira sem o AMS2.
"""

from __future__ import annotations  # sintaxe `str | None` tambem no Python 3.9

import argparse
import configparser
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

# Em desenvolvimento os modulos ficam na raiz do repo, um nivel acima. No
# executavel do PyInstaller eles ja' vao embutidos.
BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parent))
REPO = Path(__file__).resolve().parent.parent
for path in (str(REPO), str(BASE)):
    if path not in sys.path:
        sys.path.insert(0, path)

import ams2_collector  # noqa: E402

# Pasta onde o executavel foi colocado (nao a pasta temporaria do PyInstaller).
HERE = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent

COLLECTOR_NAMES = ("dynatrace-otel-collector.exe", "dynatrace-otel-collector")
PIDFILE = "collector.pid"


def pasta_estado() -> Path:
    """Estado transitorio (pidfile, fila) fica junto do collector."""
    motor = HERE / "motor"
    return motor if motor.is_dir() else HERE


def limpar_collector_orfao() -> None:
    """Derruba um collector que tenha sobrado de uma execucao anterior.

    Nem sempre da' para encerrar o filho no caminho de saida: fechar a janela no
    X do Windows, ou o bootloader do PyInstaller nao repassando o sinal, deixam
    o collector vivo segurando a porta 4318 - e o proximo duplo clique falharia.
    Guardamos o PID em disco e limpamos na entrada, entao o rig sempre sobe.
    """
    arquivo = pasta_estado() / PIDFILE
    if not arquivo.exists():
        return
    try:
        pid = int(arquivo.read_text().strip())
    except (ValueError, OSError):
        arquivo.unlink(missing_ok=True)
        return
    try:
        # So' mata se o processo ainda existe; o PID pode ter sido reciclado,
        # por isso o pidfile e' escrito e removido pelo proprio supervisor.
        os.kill(pid, 0)
    except OSError:
        arquivo.unlink(missing_ok=True)
        return
    print(f"[..] encontrei um collector orfao (pid {pid}) de uma execucao anterior; encerrando")

    def morreu() -> bool:
        try:
            os.kill(pid, 0)
            return False
        except OSError:
            return True

    for sinal, espera in ((15, 10.0), (9, 5.0)):  # SIGTERM e, se insistir, SIGKILL
        try:
            os.kill(pid, sinal)
        except OSError:
            break
        limite = time.time() + espera
        while time.time() < limite:
            if morreu():
                break
            time.sleep(0.25)
        if morreu():
            break
    print("[ok] collector orfao encerrado" if morreu() else f"[!!] o collector {pid} resistiu; feche-o na mao")
    arquivo.unlink(missing_ok=True)


def carregar_config(caminho: Path) -> dict:
    """racing.ini (secao [rig]) com fallback para variaveis de ambiente."""
    valores = {
        "rig_id": os.environ.get("RIG_ID", "rig-01"),
        "rig_name": os.environ.get("RIG_NAME", "Simulador 1"),
        "driver_name": os.environ.get("RACING_DRIVER", ""),
        "company_name": os.environ.get("RACING_COMPANY", ""),
        "dt_env_url": os.environ.get("DT_ENV_URL", ""),
        "dt_api_token": os.environ.get("DT_API_TOKEN", ""),
        "ams2_port": os.environ.get("AMS2_PORT", "5606"),
        "sink": os.environ.get("RACING_SINK", "both"),
        # Quanto o rig segura as amostras antes de enviar. Baixar isto aproxima
        # o mapa do tempo real ao custo de mais requisicoes HTTPS por segundo.
        "batch_size": os.environ.get("RACING_BATCH_SIZE", "10"),
        "flush_interval": os.environ.get("RACING_FLUSH_INTERVAL", "1.0"),
    }
    if caminho.exists():
        parser = configparser.ConfigParser()
        parser.read(caminho, encoding="utf-8")
        if parser.has_section("rig"):
            for chave in valores:
                if parser.has_option("rig", chave):
                    valores[chave] = parser.get("rig", chave).strip()
    return valores


def achar_collector() -> "Path | None":
    """Procura em motor/ primeiro: no pacote o collector fica escondido ali para
    o operador ver um unico .exe e nao ter duvida sobre qual abrir."""
    for pasta in (HERE / "motor", HERE):
        for nome in COLLECTOR_NAMES:
            candidato = pasta / nome
            if candidato.exists():
                return candidato
    return None


def achar_config_otel() -> "Path | None":
    """Aceita o pacote (motor/), o layout plano e o repo clonado."""
    candidatos = (
        HERE / "motor" / "otelcol-racing.yaml",
        HERE / "otelcol-racing.yaml",
        HERE.parent / "otel" / "otelcol-racing.yaml",
    )
    for candidato in candidatos:
        if candidato.exists():
            return candidato
    return None


def esperar_porta(url: str, tentativas: int = 40) -> bool:
    """O receiver responde 400 a um GET; qualquer resposta HTTP serve."""
    for _ in range(tentativas):
        try:
            urllib.request.urlopen(url, timeout=1).read()
            return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.25)
    return False


def porta_livre(porta: int, espera: float = 10.0) -> bool:
    """Reinicio logo apos um crash pode pegar a porta ainda nao liberada pelo
    sistema; insistir alguns segundos evita recusar o rig sem motivo."""
    limite = time.time() + espera
    while True:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            try:
                sock.bind(("0.0.0.0", porta))
                return True
            except OSError:
                if time.time() >= limite:
                    return False
        time.sleep(0.5)


def subir_collector(config: dict, config_yaml: Path) -> "subprocess.Popen | None":
    binario = achar_collector()
    if binario is None:
        print(f"[!!] OTel Collector nao encontrado em {HERE}.")
        print("     Rode o 1-instalar.bat, ou use --sem-collector para so' enviar business events.")
        return None

    ambiente = dict(os.environ)
    ambiente["DT_OTLP_ENDPOINT"] = config["dt_env_url"].rstrip("/") + "/api/v2/otlp"
    ambiente["DT_API_TOKEN"] = config["dt_api_token"]

    print(f"[..] subindo o OTel Collector ({binario.name})")
    processo = subprocess.Popen(
        [str(binario), "--config", str(config_yaml)],
        cwd=str(binario.parent), env=ambiente,
        stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
    )
    try:
        (pasta_estado() / PIDFILE).write_text(str(processo.pid), encoding="utf-8")
    except OSError:
        pass
    if not esperar_porta("http://127.0.0.1:4318/v1/logs"):
        processo.terminate()
        erro = (processo.stderr.read() or b"").decode("utf-8", "replace")
        print("[ERRO] o collector nao subiu. Saida:")
        print(erro[:800] or "  (sem mensagem)")
        return None
    print("[ok] collector no ar, recebendo OTLP em 127.0.0.1:4318")
    return processo


def subir_gerador(porta: int, captura: Path, variacao: float) -> "threading.Thread | None":
    if not captura.exists():
        print(f"[!!] captura nao encontrada em {captura}; o modo --teste precisa dela.")
        return None
    import cars2_telemetry_generator as gerador

    pacotes = gerador.load_capture(captura)
    variacoes = gerador.TelemetryVariations(speed_pct=variacao, brake_pct=variacao)
    print(f"[ok] gerador de teste: {len(pacotes)} pacotes -> 127.0.0.1:{porta} (variacao {variacao:g}%)")

    def rodar():
        try:
            gerador.replay(pacotes, ("127.0.0.1", porta), 1.0, None, None, True, variacoes)
        except Exception as erro:  # o gerador e' acessorio; nao derruba o rig
            print(f"[!!] gerador parou: {erro}")

    thread = threading.Thread(target=rodar, daemon=True)
    thread.start()
    return thread


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=HERE / "racing.ini")
    parser.add_argument("--sem-collector", action="store_true", help="nao sobe o collector (so' business events)")
    parser.add_argument("--teste", action="store_true", help="sobe o gerador no lugar do jogo")
    parser.add_argument("--variacao", type=float, default=0.0, help="[teste] variacao percentual de ritmo")
    parser.add_argument("--dry-run", action="store_true", help="imprime os eventos em vez de enviar")
    args = parser.parse_args()

    # Handlers explicitos: shells lancando em background deixam SIGINT herdado como
    # ignorado, e o Gerenciador de Tarefas manda SIGTERM. Sem isto o collector filho
    # vaza e trava a porta 4318 para a proxima execucao.
    def encerrar(_signum, _frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGINT, encerrar)
    signal.signal(signal.SIGTERM, encerrar)

    config = carregar_config(args.config)
    porta = int(config["ams2_port"])

    print("=" * 58)
    print(f"  Hackathon Racing - {config['rig_id']} ({config['rig_name']})")
    if config["driver_name"]:
        print(f"  Piloto: {config['driver_name']} / {config['company_name'] or 'sem empresa'}")
    print(f"  UDP do AMS2: porta {porta}   |   destinos: {config['sink']}")
    print("=" * 58)

    # Os dois caminhos precisam de credencial: a API de bizevents autentica no
    # proprio coletor, e o collector OTLP autentica no exporter. Sem isto o rig
    # roda "com sucesso" e descarta tudo silenciosamente.
    if not args.dry_run and not (config["dt_env_url"] and config["dt_api_token"]):
        print("[ERRO] preencha dt_env_url e dt_api_token no racing.ini (ou DT_ENV_URL/DT_API_TOKEN).")
        print("       o token precisa dos escopos bizevents.ingest e logs.ingest.")
        return 1
    limpar_collector_orfao()
    if not porta_livre(porta):
        print(f"[ERRO] a porta UDP {porta} ja' esta em uso. Outro rig ou coletor esta rodando?")
        return 1

    collector = None
    if config["sink"] in ("otlp", "both") and not args.sem_collector and not args.dry_run:
        config_yaml = achar_config_otel()
        if config_yaml is None:
            print("[ERRO] otelcol-racing.yaml nao encontrado junto ao executavel nem em ../otel/")
            return 1
        collector = subir_collector(config, config_yaml)
        if collector is None:
            return 1

    if args.teste:
        captura = HERE / "captura.txt"
        if not captura.exists():
            captura = REPO / "captura.txt"
        subir_gerador(porta, captura, args.variacao)
    else:
        print("[i] No AMS2: Options > System > UDP Protocol Version = Project CARS 2, UDP Frequency = 1")

    # Reaproveita o loop ja' testado do ams2_collector, montando o mesmo Namespace
    # que o CLI dele produz.
    opcoes = argparse.Namespace(
        source="udp", rig_id=config["rig_id"], rig_name=config["rig_name"],
        driver_name=config["driver_name"] or None, company_name=config["company_name"] or None,
        bind="0.0.0.0", port=porta,
        batch_size=int(config["batch_size"]), flush_interval=float(config["flush_interval"]),
        endpoint=config["dt_env_url"] or None, token=config["dt_api_token"] or None,
        sink=config["sink"], otlp_endpoint=ams2_collector.DEFAULT_OTLP_ENDPOINT,
        dry_run=args.dry_run,
    )
    ingest_url = opcoes.endpoint.rstrip("/") + "/api/v2/bizevents/ingest" if opcoes.endpoint else None

    try:
        return ams2_collector.run_udp(opcoes, ams2_collector.Dispatcher(opcoes, ingest_url))
    finally:
        if collector is not None:
            print("[..] encerrando o collector")
            collector.terminate()
            try:
                collector.wait(timeout=10)
            except subprocess.TimeoutExpired:
                collector.kill()
            (pasta_estado() / PIDFILE).unlink(missing_ok=True)
            print("[ok] tudo encerrado")


if __name__ == "__main__":
    raise SystemExit(main())
