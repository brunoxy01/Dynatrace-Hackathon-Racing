# v1.1.1 — Tabelas ordenáveis

Só o app mudou (**1.1.0 → 1.1.1**, precisa reinstalar na tenant). O pacote dos simuladores é o mesmo da v1.1.0, nada a refazer nos rigs.

## Ordenar pelas colunas

As duas tabelas — **Top 10 pilotos** e **Voltas registradas** — agora ordenam ao clicar no cabeçalho.

Isso tinha uma armadilha: o tipo de ordenação padrão do Strato é **texto**. Ligar só o `sortable` teria colocado a volta 10 antes da 9 e ordenado os tempos alfabeticamente — parecendo funcionar, entregando a ordem errada. Cada coluna numérica foi marcada explicitamente.

Onde a coluna mostra texto formatado, a ordenação aponta para o valor cru:

- **Tempo** e **Tempo atual** ordenam pelos segundos da volta, não pela string `1:44.015`
- **Concluída em** ordena pelo timestamp real, não pela data formatada em `dd/mm/aaaa`

**Posição X / Y** não é ordenável: ordenar um par de coordenadas não significa nada.

## Sobre a imagem real do carro

Adiada a pedido. Fica registrado o que foi apurado: **o AMS2 não manda imagem alguma pelo UDP** — o protocolo carrega só o nome do carro, e nenhum dos tipos de pacote (0, 1, 2, 3, 4, 7, 8) traz arte. O tipo 8 é um catálogo de nomes, texto puro.

O jogo tem artes próprias, mas empacotadas dentro da instalação nos PCs Windows e sob licença de terceiros (Reiza, Porsche e outros). O app roda na tenant e não tem acesso ao disco do rig de qualquer forma. Mostrar o carro real depende de alguém colocar um PNG por modelo nos assets do app.

## Verificação

23 testes do app, `npm run lint`, `npm run build` e `tsc` limpos. A ordenação em si não foi clicada num navegador — o que foi verificado é que cada coluna declara o tipo e o acessor de ordenação corretos.
