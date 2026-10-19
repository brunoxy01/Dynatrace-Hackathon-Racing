# v1.8.1 — Capacete redesenhado

Ajuste em cima da v1.8.0, a pedido: a forma do capacete de lado estava feia. Redesenhado com mais detalhe, na mesma composição de um capacete de corrida de verdade visto de perfil: calota arredondada, entrada de ar no topo, friso diagonal separando a calota da viseira, viseira grande com o pino do visor e uma faixa de corrida na parte de baixo. Só esse ícone mudou.

## Técnico

- `Dashboard.tsx`: `Capacete` reescrito com mais caminhos SVG (calota, entrada de ar, friso, viseira, pino, faixa), viewBox 100×80 para mais espaço de desenho.
- `npm run lint`, `npm test` (58/58) e `npm run build` limpos. Validado localmente ampliando o ícone via inspeção no navegador antes de publicar.
