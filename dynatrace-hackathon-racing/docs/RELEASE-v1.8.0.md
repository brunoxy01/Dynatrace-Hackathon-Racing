# v1.8.0 — Fim da categoria empresa + capacete de lado

## Categoria empresa removida (script e app)

A pedido: "empresa" deixa de existir como categoria, tanto no coletor Python quanto no app.

**No script (coletor/rig):**
- `ams2_collector.py`: removida a função `split_driver_company` (que separava "Nome [Empresa]" digitado no perfil do AMS2) e o campo `company_name` do evento emitido. O nome do piloto agora é só o que vier do jogo ou de `--driver-name`, sem parsing de colchetes.
- `--company-name` / `RACING_COMPANY` removidos do CLI do coletor, do `rig/hackathon_racing.py` (lê `racing.ini`), do `rig/config.exemplo.bat`, do `rig/LEIAME.txt` e do template de `racing.ini` gerado pelo workflow de empacotamento.
- `ensaio-3-rigs.sh`: rigs de ensaio não declaram mais empresa.
- `replay_server.py` (demonstração local): os 3 pilotos sintéticos não carregam mais `company_name`.

**No app:**
- "Disputa entre empresas" → **"Disputa entre pilotos"** (já feito na v1.7.0) continua; agora o campo `company_name` nem existe mais em lugar nenhum: removido do tipo `Telemetry`, da consulta DQL (`FIELDS`), da coluna "Empresa" nas tabelas de Classificação e Replay, do filtro "Filtrar por empresa" na aba Replay, da badge na ficha do piloto, e do subtítulo do pódio (mostra o carro agora).
- `companyPodium` removida de `racing.ts` — só existe `driverPodium`.

## Capacete de lado

O capacete do pódio (ouro/prata/bronze) era visto de frente; agora é um **perfil lateral** — calota arredondada com a viseira inclinada, olhando para a direita. Mesmo brilho pulsante de antes.

## Técnico

- Python: `ams2_collector.py`, `rig/hackathon_racing.py`, `rig/config.exemplo.bat`, `rig/LEIAME.txt`, `ensaio-3-rigs.sh`, `replay_server.py`, `.github/workflows/pacote-rig.yml` — toda referência a `company`/`empresa` removida. `test_collector.py` e `test_replay.py` atualizados; 15/15 testes Python passam.
- `racing.ts`: campo `company_name` fora do `Telemetry`; `companyPodium` removida.
- `Dashboard.tsx`: `FIELDS`, `rankColumns`, `replayColumns`, filtro de empresa (`filtroEmpresa`/`opcoesEmpresa`), badge da ficha do piloto e subtítulo do pódio, todos sem `company_name`. Novo SVG de `Capacete` em perfil lateral.
- `npm run lint`, `npm test` (58/58) e `npm run build` limpos. Validado localmente: tabelas sem coluna Empresa, pódio "Disputa entre pilotos" com capacete lateral brilhando.
