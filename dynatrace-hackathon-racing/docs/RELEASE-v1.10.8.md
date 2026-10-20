# v1.10.8 — Versão visível no console do rig

Pacote do rig. O app só acompanha o número (**1.10.7 → 1.10.8**), sem mudança de comportamento.

## O que aparece

A versão do coletor agora está em três lugares na janela do `HackathonRacing.exe`:

- **Título da janela:** `Hackathon Racing v1.10.8 - rig-01`. Dá para conferir pela barra de tarefas qual pacote cada simulador roda.
- **Cabeçalho:** `Hackathon Racing v1.10.8 - rig-01 (Simulador 1)`.
- **Linha de progresso**, que fica sempre visível: `[v1.10.8] 900 amostras enviadas | fila: 1 lote(s)`.

## De onde vem o número

O workflow do pacote grava a **tag da release** no coletor antes de gerar o executável, então o número exibido é sempre o da release baixada. Rodando direto do repositório, vale o valor do código (`VERSAO` em `ams2_collector.py`).

## Técnico

- `ams2_collector.py`: constante `VERSAO`, exibida no início da escuta e na linha de progresso.
- `rig/hackathon_racing.py`: versão no cabeçalho e no título da janela (`SetConsoleTitleW`, só no Windows; falha silenciosa).
- `.github/workflows/pacote-rig.yml`: passo "Gravar a versão no coletor" substitui a linha `VERSAO = ...` pela tag antes do PyInstaller.
