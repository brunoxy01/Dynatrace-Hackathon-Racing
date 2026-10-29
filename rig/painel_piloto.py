#!/usr/bin/env python3
"""Painel do rig para trocar o piloto - uma pagina simples no navegador.

O HackathonRacing.exe sobe este painel em http://127.0.0.1:8765 (so' a propria
maquina acessa) e abre o navegador nele. Trocar o nome ali grava o driver_name
no racing.ini; a vigia do racing.ini aplica no coletor em ate' 1 segundo, sem
reiniciar nada. Editar o racing.ini a mao tem o mesmo efeito.

Tambem roda sozinho, so' para editar o racing.ini de outro jeito:
    python rig/painel_piloto.py --config racing.ini
"""

from __future__ import annotations  # sintaxe `str | None` tambem no Python 3.9

import argparse
import configparser
import html
import json
import os
import re
import secrets
import threading
import time
import urllib.parse
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Optional

PORTA_PADRAO = 8765
TAMANHO_MAXIMO_DO_NOME = 40


# ---------- racing.ini ----------

def limpar_nome(bruto: str) -> str:
    """Tira o que quebraria o racing.ini (quebra de linha, `;`, `#`, `=`) ou a
    leitura dele (`%` e' interpolacao no configparser) e limita o tamanho."""
    nome = re.sub(r"[\x00-\x1f\x7f%;#=]", "", bruto or "")
    nome = re.sub(r"\s+", " ", nome).strip()
    return nome[:TAMANHO_MAXIMO_DO_NOME].strip()


def ler_driver_name(caminho: Path) -> Optional[str]:
    """driver_name da secao [rig]; None se a chave (ou o arquivo) nao existe."""
    parser = configparser.ConfigParser(interpolation=None)
    parser.read(caminho, encoding="utf-8-sig")
    if parser.has_option("rig", "driver_name"):
        return parser.get("rig", "driver_name").strip()
    return None


def gravar_driver_name(caminho: Path, nome: str) -> None:
    """Grava driver_name na secao [rig] preservando o resto do arquivo
    (comentarios, ordem, quebras de linha, BOM). A escrita e' atomica: a vigia
    nunca le um racing.ini pela metade."""
    caminho = Path(caminho)
    bruto = caminho.read_bytes() if caminho.exists() else b""
    bom = bruto.startswith(b"\xef\xbb\xbf")
    texto = bruto.decode("utf-8-sig")
    fim_de_linha = "\r\n" if "\r\n" in texto else "\n"
    linhas = texto.splitlines(keepends=True)
    nova = f"driver_name = {nome}"
    secao, cabecalho_rig, feito = None, None, False
    for i, linha in enumerate(linhas):
        limpa = linha.strip()
        if limpa.startswith("[") and limpa.endswith("]"):
            secao = limpa[1:-1].strip().lower()
            if secao == "rig" and cabecalho_rig is None:
                cabecalho_rig = i
            continue
        if secao == "rig" and re.match(r"\s*driver_name\s*[=:]", linha):
            linhas[i] = nova + (linha[len(linha.rstrip("\r\n")):] or fim_de_linha)
            feito = True
            break
    if not feito:
        if cabecalho_rig is not None:
            linhas.insert(cabecalho_rig + 1, nova + fim_de_linha)
        else:
            if linhas and not linhas[-1].endswith(("\n", "\r")):
                linhas[-1] += fim_de_linha
            linhas += ["[rig]" + fim_de_linha, nova + fim_de_linha]
    temporario = caminho.with_name(caminho.name + ".tmp")
    temporario.write_bytes((b"\xef\xbb\xbf" if bom else b"") + "".join(linhas).encode("utf-8"))
    os.replace(temporario, caminho)


class VigiaDoIni:
    """Confere o racing.ini a cada `intervalo` segundos e chama `ao_mudar(nome)`
    quando o driver_name muda. Vazio vira None: volta ao nome do perfil do jogo.
    Chave ausente nao muda nada (fica o que estava valendo)."""

    def __init__(self, caminho: Path, ao_mudar: Callable[[Optional[str]], None],
                 inicial: Optional[str], intervalo: float = 1.0):
        self.caminho = Path(caminho)
        self.ao_mudar = ao_mudar
        self.atual = inicial
        self.intervalo = intervalo
        self._marca = self._marca_do_arquivo()
        self._parar = threading.Event()

    def _marca_do_arquivo(self):
        try:
            info = self.caminho.stat()
            return info.st_mtime_ns, info.st_size
        except OSError:
            return None

    def checar(self) -> bool:
        """Uma conferencia. Devolve True se aplicou um piloto novo."""
        marca = self._marca_do_arquivo()
        if marca is None or marca == self._marca:
            return False
        try:
            valor = ler_driver_name(self.caminho)
        except (configparser.Error, OSError, UnicodeDecodeError):
            return False  # salvo pela metade no editor: tenta na proxima volta
        self._marca = marca
        if valor is None:
            return False
        nome = valor or None
        if nome == self.atual:
            return False
        self.atual = nome
        self.ao_mudar(nome)
        return True

    def iniciar(self) -> "VigiaDoIni":
        threading.Thread(target=self._laco, name="vigia-racing-ini", daemon=True).start()
        return self

    def _laco(self) -> None:
        while not self._parar.wait(self.intervalo):
            try:
                self.checar()
            except Exception as erro:  # a vigia nunca derruba o rig
                print(f"\n[!!] vigia do racing.ini: {erro}", flush=True)

    def parar(self) -> None:
        self._parar.set()


# ---------- pagina ----------

PAGINA = """<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trocar piloto - {rig_id}</title>
<style>
  body {{ margin: 0; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background: #14161f; color: #f0f1f5; }}
  main {{ max-width: 520px; margin: 48px auto; padding: 0 20px; }}
  .card {{ background: #1e2130; border: 1px solid #353a4f; border-radius: 12px; padding: 28px; }}
  .eyebrow {{ font-size: 11px; letter-spacing: 2px; color: #9aa0b8; text-transform: uppercase; }}
  h1 {{ font-size: 24px; margin: 6px 0 20px; }}
  .atual {{ background: #262a3c; border-radius: 8px; padding: 14px 16px; margin-bottom: 22px; }}
  .atual b {{ display: block; font-size: 22px; margin-top: 4px; }}
  .detalhe {{ font-size: 12px; color: #9aa0b8; margin-top: 6px; }}
  label {{ display: block; font-size: 13px; margin-bottom: 6px; }}
  input[type=text] {{ width: 100%; box-sizing: border-box; font-size: 18px; padding: 12px; border-radius: 8px;
                     border: 1px solid #4a5170; background: #11131b; color: #fff; }}
  button {{ margin-top: 14px; width: 100%; font-size: 17px; padding: 12px; border: 0; border-radius: 8px;
           background: #8b55ec; color: #fff; cursor: pointer; }}
  button:hover {{ background: #9d6ff0; }}
  .msg {{ margin-top: 16px; padding: 12px 14px; border-radius: 8px; background: #1f3b2c; color: #b8f2cf; }}
  .msg.erro {{ background: #4a1f25; color: #ffc9cf; }}
  .ajuda {{ font-size: 12px; color: #9aa0b8; margin-top: 18px; line-height: 1.5; }}
</style>
</head>
<body>
<main>
  <div class="card">
    <div class="eyebrow">Hackathon Racing {versao} &middot; {rig_id}</div>
    <h1>Trocar piloto &middot; {rig_name}</h1>
    <div class="atual">
      <span class="eyebrow">Piloto em uso agora</span>
      <b id="piloto">{piloto}</b>
      <div class="detalhe" id="detalhe">{detalhe}</div>
    </div>
    <form method="post" action="/piloto">
      <input type="hidden" name="token" value="{token}">
      <label for="nome">Nome do piloto</label>
      <input type="text" id="nome" name="nome" value="{nome_no_ini}" maxlength="{tamanho}" autofocus autocomplete="off"
             placeholder="Em branco = nome do perfil do AMS2">
      <button type="submit">Trocar piloto</button>
    </form>
    {mensagem}
    <p class="ajuda">Vale na hora, sem reiniciar o coletor. A volta em andamento fica com o novo piloto,
      e o ultimo tempo do piloto anterior nao aparece como sendo dele. Em branco, o nome vem do perfil do AMS2.</p>
  </div>
</main>
<script>
  async function atualizar() {{
    try {{
      const r = await fetch('/estado', {{cache: 'no-store'}});
      const e = await r.json();
      document.getElementById('piloto').textContent = e.piloto_em_uso || 'Aguardando o jogo';
      document.getElementById('detalhe').textContent = e.detalhe;
    }} catch (erro) {{ /* coletor fechado: fica o ultimo estado */ }}
  }}
  setInterval(atualizar, 2000);
</script>
</body>
</html>
"""


def _detalhe(estado: dict) -> str:
    partes = []
    if estado.get("origem"):
        partes.append(f"nome vindo do {estado['origem']}")
    if estado.get("sessao"):
        partes.append(f"sessao {estado['sessao']}")
    return " · ".join(partes) or "coletor ainda sem dados do jogo"


class ServidorDoPainel(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, endereco, caminho_ini: Path, obter_estado: Optional[Callable[[], dict]]):
        super().__init__(endereco, _Painel)
        self.caminho_ini = Path(caminho_ini)
        self.obter_estado = obter_estado
        # Formularios de outros sites nao conseguem trocar o piloto: so' quem
        # abriu esta pagina tem o token.
        self.token = secrets.token_urlsafe(16)

    def estado(self) -> dict:
        estado = dict(self.obter_estado()) if self.obter_estado else {}
        try:
            nome_no_ini = ler_driver_name(self.caminho_ini)
        except (configparser.Error, OSError, UnicodeDecodeError):
            nome_no_ini = None
        if not self.obter_estado:  # rodando sozinho, sem o coletor
            estado.setdefault("piloto_em_uso", nome_no_ini or None)
            estado.setdefault("origem", "racing.ini" if nome_no_ini else None)
        estado["nome_no_ini"] = nome_no_ini or ""
        estado["detalhe"] = _detalhe(estado)
        return estado


class _Painel(BaseHTTPRequestHandler):
    server: ServidorDoPainel

    def log_message(self, *_args) -> None:  # o console do rig e' do coletor
        pass

    def _responder(self, status: int, corpo: bytes, tipo: str, extra: Optional[dict] = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(corpo)))
        self.send_header("Cache-Control", "no-store")
        for chave, valor in (extra or {}).items():
            self.send_header(chave, valor)
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self) -> None:
        url = urllib.parse.urlsplit(self.path)
        if url.path == "/estado":
            corpo = json.dumps(self.server.estado(), ensure_ascii=False).encode("utf-8")
            self._responder(200, corpo, "application/json; charset=utf-8")
            return
        if url.path != "/":
            self._responder(404, b"nao encontrado", "text/plain; charset=utf-8")
            return
        query = urllib.parse.parse_qs(url.query)
        mensagem = ""
        if "trocado" in query:
            novo = query.get("nome", [""])[0]
            texto = f"Piloto trocado para {novo}." if novo else "Piloto trocado: agora vale o nome do perfil do AMS2."
            mensagem = f'<div class="msg" role="status">{html.escape(texto)} O coletor aplica em ate\' 1 segundo.</div>'
        estado = self.server.estado()
        corpo = PAGINA.format(
            rig_id=html.escape(str(estado.get("rig_id") or "rig")),
            rig_name=html.escape(str(estado.get("rig_name") or "")),
            versao=html.escape(str(estado.get("versao") or "")),
            piloto=html.escape(estado.get("piloto_em_uso") or "Aguardando o jogo"),
            detalhe=html.escape(estado["detalhe"]),
            token=self.server.token,
            nome_no_ini=html.escape(estado["nome_no_ini"], quote=True),
            tamanho=TAMANHO_MAXIMO_DO_NOME,
            mensagem=mensagem,
        ).encode("utf-8")
        self._responder(200, corpo, "text/html; charset=utf-8")

    def do_POST(self) -> None:
        if urllib.parse.urlsplit(self.path).path != "/piloto":
            self._responder(404, b"nao encontrado", "text/plain; charset=utf-8")
            return
        tamanho = int(self.headers.get("Content-Length") or 0)
        if tamanho > 4096:
            self._responder(413, b"formulario grande demais", "text/plain; charset=utf-8")
            return
        dados = urllib.parse.parse_qs(self.rfile.read(tamanho).decode("utf-8", "replace"), keep_blank_values=True)
        if not secrets.compare_digest(dados.get("token", [""])[0], self.server.token):
            self._responder(403, b"token invalido: recarregue a pagina", "text/plain; charset=utf-8")
            return
        nome = limpar_nome(dados.get("nome", [""])[0])
        gravar_driver_name(self.server.caminho_ini, nome)
        destino = "/?trocado=1&nome=" + urllib.parse.quote(nome)
        self._responder(303, b"", "text/plain; charset=utf-8", {"Location": destino})


def iniciar_painel(caminho_ini: Path, obter_estado: Optional[Callable[[], dict]] = None,
                   porta: int = PORTA_PADRAO) -> Optional[str]:
    """Sobe o painel em segundo plano, so' em 127.0.0.1. Devolve a URL, ou None
    se a porta estiver ocupada (o rig segue funcionando sem o painel)."""
    try:
        servidor = ServidorDoPainel(("127.0.0.1", porta), caminho_ini, obter_estado)
    except OSError as erro:
        print(f"[!!] painel de troca de piloto nao subiu na porta {porta}: {erro}")
        print("     o nome ainda pode ser trocado editando driver_name no racing.ini")
        return None
    threading.Thread(target=servidor.serve_forever, name="painel-piloto", daemon=True).start()
    return f"http://127.0.0.1:{servidor.server_address[1]}/"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--config", type=Path, default=Path("racing.ini"))
    parser.add_argument("--porta", type=int, default=PORTA_PADRAO)
    args = parser.parse_args()
    url = iniciar_painel(args.config, None, args.porta)
    if not url:
        return 1
    print(f"[i] painel em {url} - Ctrl+C para fechar")
    webbrowser.open(url)
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
