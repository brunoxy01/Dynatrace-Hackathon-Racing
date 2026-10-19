# v1.8.2 — Ícone do pódio vira carrinho

Ajuste em cima da v1.8.1, a pedido: em vez do capacete, o ícone do pódio agora é um **carrinho esportivo visto de lado** — carroceria com cabine, janela recortada, aerofólio traseiro e duas rodas com o miolo na cor do pódio (ouro/prata/bronze). Mesmo brilho pulsante de antes, só a forma do ícone mudou.

## Técnico

- `Dashboard.tsx`: `Capacete` (mantém o nome da função/classe CSS para não mexer em mais nada) redesenhado como silhueta de carro — carroceria, aerofólio, janela e duas rodas com miolo colorido.
- `npm run lint`, `npm test` (58/58) e `npm run build` limpos. Validado localmente ampliando o ícone no navegador antes de publicar.
