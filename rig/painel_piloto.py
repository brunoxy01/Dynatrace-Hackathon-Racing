#!/usr/bin/env python3
"""Tela "Trocar piloto" do rig.

Pagina local (so' 127.0.0.1) onde o operador informa o nome do piloto e a
empresa. E' a UNICA fonte desses dados: o driver_name do racing.ini nao e' mais
usado. A escolha vai direto para o coletor, que roda no mesmo processo, sem
reiniciar nada. O coletor so' passa a reportar o piloto novo quando uma volta
comeca ou e' reiniciada no jogo (ver Collector.definir_piloto).

A ultima escolha fica salva em piloto-atual.json, ao lado do executavel, e
volta sozinha quando o HackathonRacing.exe e' aberto de novo.

Visual igual ao do app Dynatrace Racing: tema escuro do Strato, mesma fonte e
o mesmo logo.
"""

from __future__ import annotations  # sintaxe `str | None` tambem no Python 3.9

import html
import json
import os
import secrets
import sys
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable, Optional

ARQUIVO = "piloto-atual.json"
LIMITE = 40
PORTA_PADRAO = 8765
# Lista fixa de convidados do dia do evento: o nome do piloto é digitado, a
# empresa é só escolhida aqui (sem digitação, sem erro de digitação no telão).
EMPRESAS = ["Claro", "Crefisa", "B3", "Banco Bradesco", "Banco Digio", "Santander"]


def limpar(texto: Optional[str]) -> Optional[str]:
    """Uma linha, sem caracteres de controle, ate' LIMITE caracteres."""
    texto = "".join(c if c.isprintable() else " " for c in (texto or ""))
    texto = " ".join(texto.split())[:LIMITE].strip()
    return texto or None


def ler_piloto_salvo(caminho: Path) -> tuple:
    """(nome, empresa) da ultima escolha na tela; (None, None) se nao houver."""
    try:
        dados = json.loads(Path(caminho).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return (None, None)
    if not isinstance(dados, dict):
        return (None, None)
    return (limpar(dados.get("driver_name")), limpar(dados.get("company_name")))


def salvar_piloto(caminho: Path, nome: Optional[str], empresa: Optional[str]) -> None:
    """Gravacao atomica: um arquivo pela metade nunca e' lido no proximo inicio."""
    caminho = Path(caminho)
    temporario = caminho.with_name(caminho.name + ".tmp")
    temporario.write_text(json.dumps({"driver_name": nome, "company_name": empresa}, ensure_ascii=False),
                          encoding="utf-8")
    os.replace(temporario, caminho)


def achar_asset(nome: str) -> Optional[Path]:
    """No executavel o logo vai embutido (pasta assets do PyInstaller); rodando
    do repositorio, vem direto do app."""
    candidatos = []
    if getattr(sys, "_MEIPASS", None):
        candidatos.append(Path(sys._MEIPASS) / "assets" / nome)
    candidatos.append(Path(__file__).resolve().parent.parent / "dynatrace-hackathon-racing" / "ui" / "assets" / nome)
    return next((c for c in candidatos if c.is_file()), None)


def _iniciais(nome: Optional[str]) -> str:
    return (nome or "").strip()[:2].upper() or "—"


ESTILO = """
:root{--bg:#19192c;--superficie:#212135;--borda:#3b3b52;--texto:#ebecff;--suave:#b1b2d2;
--destaque:#999bed;--destaque-hover:#a8abfe;--no-destaque:#1f2037;--verde:#2eb77d;--roxo:#a272ce}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);color:var(--texto);
font-family:DynatraceFlow,Roboto,"Segoe UI",Helvetica,sans-serif;font-variant-numeric:tabular-nums}
.app{max-width:1080px;margin:auto;padding:28px 36px 20px;min-height:100vh}
.identity{display:flex;align-items:center;gap:18px;margin-bottom:24px}
.identity img{width:92px;height:92px;object-fit:contain}
.eyebrow{font-size:10px;font-weight:700;letter-spacing:1.7px;opacity:.65;text-transform:uppercase}
h1{font-size:30px;font-weight:700;letter-spacing:-1px;line-height:1.25;margin:5px 0}
.identity p{margin:6px 0 0;font-size:13px;opacity:.65}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.2fr);gap:20px;
border-top:1px solid color-mix(in srgb,var(--texto) 13%,transparent);padding-top:20px}
.panel{border:1px solid color-mix(in srgb,var(--texto) 13%,transparent);border-radius:10px;
background:color-mix(in srgb,var(--texto) 3%,transparent);padding:20px 22px}
.driver-card{background:linear-gradient(120deg,#8b55ed0c,#00bdba09)}
.panel-heading{display:flex;justify-content:space-between;align-items:center;gap:12px}
.status{display:flex;align-items:center;gap:8px;font-size:12px;border:1px solid var(--borda);border-radius:24px;padding:6px 12px}
.status-dot{width:7px;height:7px;border-radius:50%;background:var(--roxo)}
.status-dot.ativo{background:var(--verde);box-shadow:0 0 0 4px #2eb77d18}
.driver-title{display:flex;align-items:center;gap:14px;margin:22px 0}
.avatar{display:grid;place-items:center;width:54px;height:54px;border-radius:50%;flex:none;
background:linear-gradient(135deg,#d5ef58,#67d9ba);color:#153e31;font-size:18px;font-weight:700}
h2{font-size:26px;font-weight:700;letter-spacing:-.6px;margin:0;overflow-wrap:anywhere}
@keyframes brilho-roxo{0%{background-position:0% 50%}100%{background-position:200% 50%}}
#atual-nome{background:linear-gradient(90deg,var(--texto),var(--roxo),var(--destaque),var(--texto));
background-size:200% auto;-webkit-background-clip:text;background-clip:text;color:transparent;
animation:brilho-roxo 3s linear infinite}
.driver-title p{margin:6px 0 0;font-size:13px;opacity:.65}
.form-panel h3{font-size:21px;letter-spacing:-.5px;margin:6px 0 18px}
label{display:block;font-size:12px;color:var(--suave);margin:0 0 6px}
@keyframes roxo-pulso{0%{box-shadow:0 0 0 0 #a272ce66,0 0 0 2px #999bed40}70%{box-shadow:0 0 0 7px #a272ce00,0 0 0 2px #999bed40}100%{box-shadow:0 0 0 0 #a272ce00,0 0 0 2px #999bed40}}
input[type=text],select{width:100%;font:inherit;font-size:15px;color:var(--texto);background:var(--superficie);
border:1px solid var(--borda);border-radius:6px;padding:10px 12px;margin-bottom:16px;outline:none;appearance:none;transition:border-color .15s ease}
select{background-image:linear-gradient(45deg,transparent 50%,var(--suave) 50%),linear-gradient(135deg,var(--suave) 50%,transparent 50%);
background-position:calc(100% - 20px) center,calc(100% - 15px) center;background-size:5px 5px,5px 5px;background-repeat:no-repeat}
input[type=text]:focus,select:focus{border-color:var(--roxo);animation:roxo-pulso 1.3s ease-out infinite}
@keyframes botao-pronto{0%{box-shadow:0 0 0 0 #a272ce55}100%{box-shadow:0 0 0 10px #a272ce00}}
button{font:inherit;font-size:14px;font-weight:600;color:var(--no-destaque);background:var(--destaque);
border:0;border-radius:6px;padding:10px 18px;cursor:pointer;transition:background .15s ease,transform .1s ease}
button:hover{background:var(--destaque-hover);animation:botao-pronto 1s ease-out infinite}
button:active{transform:scale(.95)}
.muted{font-size:12px;color:var(--suave);line-height:1.5;margin:16px 0 0}
.notice{padding:14px 18px;border:1px solid #2eb77d55;border-radius:8px;background:#2eb77d0f;margin-bottom:18px;font-size:13px}
.page-footer{font-size:10px;opacity:.55;margin-top:22px;display:flex;justify-content:space-between;gap:12px}
@media(max-width:780px){.app{padding:16px}.grid{grid-template-columns:1fr}.identity img{width:66px;height:66px}h1{font-size:25px}}
"""

SCRIPT = """
const $ = id => document.getElementById(id);
async function atualizar() {
  try {
    const r = await fetch('/estado', {cache: 'no-store'});
    if (!r.ok) throw new Error();
    const e = await r.json();
    // A tela mostra a ESCOLHA PENDENTE assim que confirmada, sem esperar a
    // volta começar (isso é só quando o coletor passa a REPORTAR o piloto
    // novo pro Dynatrace - ver Collector.definir_piloto).
    const mostrar = e.proximo || {piloto: e.piloto, empresa: e.empresa};
    const nome = mostrar.piloto || e.nome_do_jogo || 'Aguardando piloto';
    $('atual-nome').textContent = nome;
    $('atual-empresa').textContent = mostrar.piloto
      ? (mostrar.empresa || 'Empresa não informada') + (e.proximo ? (e.esperando_tempo_da_volta
          ? ' · entra assim que a volta atual fechar' : ' · entra na próxima volta') : '')
      : (e.nome_do_jogo ? 'Nome do perfil do jogo' : 'Escolha o piloto ao lado');
    $('avatar').textContent = (nome || '').trim().slice(0, 2).toUpperCase() || '—';
    $('status-dot').className = 'status-dot ativo';
    $('status-texto').textContent = 'Coletor no ar';
  } catch (_) {
    $('status-dot').className = 'status-dot';
    $('status-texto').textContent = 'Coletor fechado';
  }
}
setInterval(atualizar, 2000);
"""


def render_pagina(estado: dict, token: str, confirmado: bool) -> str:
    e = html.escape
    piloto, empresa, do_jogo = estado.get("piloto"), estado.get("empresa"), estado.get("nome_do_jogo")
    proximo = estado.get("proximo")
    # Mostra a escolha PENDENTE na hora (sem esperar a volta começar): só o
    # que o coletor REPORTA pro Dynatrace depende da volta, a tela pode
    # adiantar o que a pessoa acabou de confirmar.
    mostrado = proximo or {"piloto": piloto, "empresa": empresa}
    nome_atual = mostrado.get("piloto") or do_jogo or "Aguardando piloto"
    if mostrado.get("piloto"):
        sub_atual = mostrado.get("empresa") or "Empresa não informada"
        if proximo:
            sub_atual += (" · entra assim que a volta atual fechar" if estado.get("esperando_tempo_da_volta")
                          else " · entra na próxima volta")
    else:
        sub_atual = "Nome do perfil do jogo" if do_jogo else "Escolha o piloto ao lado"
    aviso = ('<div class="notice" role="status">Pronto! A troca foi registrada.</div>'
             if confirmado else "")
    return f"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Trocar piloto · Dynatrace Racing</title>
<link rel="icon" href="/icone.png"><style>{ESTILO}</style></head>
<body><div class="app">
<header class="identity"><img src="/logo.png" alt="Logo Dynatrace Racing"><div>
<span class="eyebrow">DYNATRACE · LIVE EXPERIENCE</span><h1>Dynatrace Racing</h1>
<p>Da pista aos dados. Cada curva conta.</p></div></header>
{aviso}
<main class="grid">
<section class="panel driver-card" aria-live="polite">
<div class="panel-heading"><span class="eyebrow">PILOTO NO CARRO</span>
<span class="status"><span id="status-dot" class="status-dot ativo"></span><span id="status-texto">Coletor no ar</span></span></div>
<div class="driver-title"><span class="avatar" id="avatar">{e(_iniciais(nome_atual))}</span>
<div><h2 id="atual-nome">{e(nome_atual)}</h2><p id="atual-empresa">{e(sub_atual)}</p></div></div>
</section>
<section class="panel form-panel">
<span class="eyebrow">TROCAR PILOTO</span><h3>Quem vai pilotar agora?</h3>
<form method="post" action="/piloto">
<label for="nome">Nome do piloto</label>
<input type="text" id="nome" name="nome" maxlength="{LIMITE}" autocomplete="off" required autofocus>
<label for="empresa">Empresa</label>
<select id="empresa" name="empresa" required>
<option value="" disabled{" selected" if not empresa else ""}>Escolha a empresa</option>
{"".join(f'<option value="{e(nome_empresa)}"{" selected" if nome_empresa == empresa else ""}>{e(nome_empresa)}</option>' for nome_empresa in EMPRESAS)}
</select>
<input type="hidden" name="token" value="{e(token)}">
<button type="submit">Confirmar piloto</button>
</form>
<p class="muted">Não precisa fechar o programa. O nome e a empresa passam a aparecer no Dynatrace
quando a próxima volta começar (ou quando a volta for reiniciada no jogo). A volta em andamento
continua com o piloto atual.</p>
</section>
</main>
<footer class="page-footer"><span>Dynatrace Racing · coletor {e(str(estado.get("versao") or ""))}</span>
<span>Esta página só abre neste computador.</span></footer>
</div><script>{SCRIPT}</script></body></html>"""


def iniciar_painel(arquivo: Path, obter_estado: Callable[[], dict],
                   ao_definir: Callable[[Optional[str], Optional[str]], None],
                   porta: int = PORTA_PADRAO, host: str = "127.0.0.1") -> str:
    """Sobe a tela numa thread e devolve a URL. Levanta OSError se a porta
    estiver ocupada (o rig continua funcionando sem a tela)."""
    token = secrets.token_urlsafe(16)
    assets = {"/logo.png": achar_asset("racing-logo.png"), "/icone.png": achar_asset("racing-icon.png")}

    class Tela(BaseHTTPRequestHandler):
        def log_message(self, *args):  # silencio no console do rig
            pass

        def _host_valido(self) -> bool:
            # Contra DNS rebinding: um site externo resolvendo para 127.0.0.1
            # chega com o proprio nome no Host.
            porta_real = self.server.server_address[1]
            return self.headers.get("Host", "") in (f"127.0.0.1:{porta_real}", f"localhost:{porta_real}")

        def _responder(self, status: int, corpo: bytes, tipo: str) -> None:
            self.send_response(status)
            self.send_header("Content-Type", tipo)
            self.send_header("Content-Length", str(len(corpo)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(corpo)

        def do_GET(self):
            if not self._host_valido():
                return self._responder(403, b"forbidden", "text/plain")
            caminho = urllib.parse.urlsplit(self.path)
            if caminho.path == "/":
                confirmado = urllib.parse.parse_qs(caminho.query).get("ok") == ["1"]
                pagina = render_pagina(obter_estado(), token, confirmado)
                return self._responder(200, pagina.encode("utf-8"), "text/html; charset=utf-8")
            if caminho.path == "/estado":
                return self._responder(200, json.dumps(obter_estado(), ensure_ascii=False).encode("utf-8"),
                                       "application/json; charset=utf-8")
            arquivo_asset = assets.get(caminho.path)
            if arquivo_asset is not None:
                return self._responder(200, arquivo_asset.read_bytes(), "image/png")
            self._responder(404, b"not found", "text/plain")

        def do_POST(self):
            if not self._host_valido() or urllib.parse.urlsplit(self.path).path != "/piloto":
                return self._responder(403, b"forbidden", "text/plain")
            tamanho = min(int(self.headers.get("Content-Length") or 0), 4096)
            dados = urllib.parse.parse_qs(self.rfile.read(tamanho).decode("utf-8", "replace"))
            if not secrets.compare_digest((dados.get("token") or [""])[0], token):
                return self._responder(403, "Página vencida: recarregue a tela.".encode("utf-8"),
                                       "text/plain; charset=utf-8")
            nome = limpar((dados.get("nome") or [""])[0])
            empresa = limpar((dados.get("empresa") or [""])[0])
            if empresa not in EMPRESAS:
                empresa = None
            salvar_piloto(arquivo, nome, empresa)
            ao_definir(nome, empresa)
            self.send_response(303)
            self.send_header("Location", "/?ok=1")
            self.send_header("Content-Length", "0")
            self.end_headers()

    servidor = ThreadingHTTPServer((host, porta), Tela)
    servidor.daemon_threads = True
    threading.Thread(target=servidor.serve_forever, name="tela-piloto", daemon=True).start()
    return f"http://127.0.0.1:{servidor.server_address[1]}/"
