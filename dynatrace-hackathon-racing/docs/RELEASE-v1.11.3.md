# v1.11.3 — Fim da bolinha fantasma com 2 pilotos

## O bug

Reportado: com 2 pilotos na pista ao mesmo tempo, o mapa mostrava um bug visual nas bolinhas (carros). Achamos a causa raiz investigando a branch do colega Plinio (`frontend-new`), que adiciona uma tela "Trocar piloto" no rig — ela muda o `session.id` do coletor sempre que o piloto troca, sem reiniciar o processo.

O app já identifica cada carro por `rig.id + session.id` (`driverKey`). Isso é correto para separar sessões de verdade, mas tem um efeito colateral que já existia antes do Plinio mexer em qualquer coisa: quando o MESMO simulador físico ganha uma sessão nova (troca de piloto, ou só um reinício do coletor), a sessão antiga fica órfã — ninguém mais manda amostra pra ela — mas as amostras dela continuam dentro da janela de 2 minutos do Ao Vivo. Resultado: **duas bolinhas para um rig só** — uma parada (a sessão antiga), uma em movimento (a nova). A mesma coisa acontecia nos cartões de piloto da aba Ao Vivo.

**Importante:** esse bug é do app (`racing.ts`/`TrackMap.tsx`), não do coletor do Plinio. A tela dele só tornou o reinício de sessão rotineiro (acontece a cada troca) em vez de raro (só em reinício manual do coletor), o que deixou o bug fácil de reproduzir.

## O que foi feito

- **Coletor confirmado saudável**: validei a `main` (sem as mudanças do Plinio) com a suíte completa antes de mexer em qualquer coisa — 33 testes Python e 80 testes JS, lint e build, tudo limpo. As mudanças de coletor da `frontend-new` (campo `company_name`, sessão nova por troca de piloto) **não foram trazidas para a main** — ficam só na branch dele, para revisão à parte.
- **Correção do bug**: `latestSessionTrails` e `latestSessionDrivers`, novas em `racing.ts` — por `rig.id`, mantêm só a sessão com a amostra mais recente. Aplicadas no mapa (`TrackMap.tsx`) e nos cartões de piloto (`Dashboard.tsx`). Rigs DIFERENTES rodando ao mesmo tempo continuam cada um com sua bolinha — o filtro só colapsa quando é o MESMO rig com 2 sessões.
- **3 testes novos** reproduzindo o cenário exato: 2 rigs de verdade (continuam 2 bolinhas), 1 rig com sessão reiniciada (vira 1 bolinha só, a mais nova), e a versão para os cartões de piloto.
- Validado com o gerador de demonstração local (replay_server.py, 4 participantes simultâneos): continua mostrando os 4 carros normalmente — o fix não mexe no caso comum, só no caso de sessão duplicada do mesmo rig.

## Técnico

- `racing.ts`: `latestSessionTrails(paths)` e `latestSessionDrivers(drivers)`, construídas sobre um helper privado `ultimaSessaoPorRig` que mantém, por `rig.id`, o item (trilha ou piloto) com o timestamp mais recente.
- `TrackMap.tsx`: `CarMarkers` usa `latestSessionTrails(trails(events))` em vez de `trails(events)` puro.
- `Dashboard.tsx`: `pilotosAoVivo` usa `latestSessionDrivers(activeDrivers(...))`.
- 83/83 testes (eram 80), lint e build limpos.
