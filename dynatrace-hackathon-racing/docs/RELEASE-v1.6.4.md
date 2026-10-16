# v1.6.4 — Nome do app: "Dynatrace Racing"

A pedido do chefe do Bruno: o nome visível do app deixa de ser "Hackathon Racing" e passa a ser **Dynatrace Racing**.

## O que mudou

- Título no cabeçalho do app.
- Nome exibido na plataforma Dynatrace (launchpad, título da aba do navegador) — vem de `app.config.json`.
- Rodapé do app.
- Texto alternativo do logo.
- README da pasta do app.

O `id` interno do app (`my.dynatrace.hackathon.racing`) **não foi alterado** — mudar o id criaria um app novo na plataforma, perdendo o histórico de versões e a URL atual. Só o nome de exibição mudou.

## Técnico

- `app.config.json`: `app.name` → "Dynatrace Racing".
- `Dashboard.tsx`: título (`<Heading level={1}>`), `alt` do logo e rodapé atualizados.
- `README.md` (da pasta do app): título atualizado.
- Validado localmente antes de publicar: título e aba do navegador confirmados como "Dynatrace Racing".
- `npm run lint`, `npm test` (56/56) e `npm run build` limpos.
