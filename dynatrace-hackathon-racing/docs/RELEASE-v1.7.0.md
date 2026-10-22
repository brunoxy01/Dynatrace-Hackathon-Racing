# v1.7.0 — Atualização em tempo real de verdade + pódio de pilotos com capacete

## Correção: "o mapa não parece estar pegando em tempo real"

Investigando o relato, achei uma lacuna concreta entre o que o botão "Atualizar" devia fazer e o que o hook `useDql` realmente faz por padrão: `refetch()` **só busca de novo se os dados já estiverem "stale"** — por padrão, só depois de 60 segundos. Clicar em "Atualizar" antes disso literalmente não fazia nada, porque o hook considerava a última resposta ainda "fresca" e devolvia o mesmo resultado em cache. Isso bate exatamente com o relato: clicou em Atualizar, continuou igual.

- O botão "Atualizar" agora chama `forceRefetch()` nas quatro consultas (telemetria + voltas, bizevents + OTel), que ignora o stale time e busca de verdade, sempre.
- Todas as consultas ao vivo (`live`, `liveOtel`, `liveLaps`, `liveLapsOtel`) agora têm `staleTime: 0` explícito, para que também o ciclo automático (a cada 5s/15s) nunca seja silenciosamente ignorado pelo mesmo motivo.

Isso não descarta que a ingestão em si (Grail) tenha algum atraso natural — isso é inerente à plataforma —, mas elimina a causa mais provável de "continua igual mesmo depois de eu pedir pra atualizar".

## Pódio de pilotos com capacete

- "Disputa entre empresas" virou **"Disputa entre pilotos"**, por enquanto — mesmo ranking (melhor volta), agrupado por piloto em vez de empresa.
- As medalhas (🥇🥈🥉) viraram **capacetes** dourado, prata e bronze, desenhados em SVG (o Strato não tem ícone de capacete, mesma lacuna já registrada para medalha), com um **brilho pulsante** ao redor — no espírito do brilho já usado na borda do mapa da pista.
- O efeito aparece em todo lugar que já usava a medalha: o pódio e a coluna de posição da tabela de classificação.

## Técnico

- `Dashboard.tsx`: botão "Atualizar" troca `refetch()` por `forceRefetch()`; `live`/`liveOtel`/`liveLaps`/`liveLapsOtel` ganham `staleTime: 0`. Novo componente `Capacete` (SVG) substitui o array de emojis `MEDALHAS`. `podioEmpresas` agora usa `driverPodium` em vez de `companyPodium`.
- `racing.ts`: nova função `driverPodium` (mesma lógica de `companyPodium`, agrupada por `driver_name`).
- `racing.css`: `.capacete-brilho` com `drop-shadow` animado (`@keyframes capacete-pulso`), substituindo as regras de `.medalha`.
- `npm run lint`, `npm test` (58/58) e `npm run build` limpos. Validado localmente: pódio renderiza os três capacetes com cores e brilho corretos; título "Disputa entre pilotos" confirmado em tela.
