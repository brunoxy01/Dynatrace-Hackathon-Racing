# v1.0.1 — Fim do piscar do painel

O painel inteiro piscava a cada 30 segundos: mapa ficava cinza, KPIs voltavam para "—", pódio esvaziava, e logo em seguida tudo reaparecia.

**Causa.** O modo ao vivo desliza a janela de tempo recalculando o timeframe absoluto a cada 30s. Para o cache do `useDql` isso não é uma reconsulta — é uma **query nova**, com chave nova. E em query nova o `data` volta a ser `undefined` até a resposta chegar. Nesse intervalo o painel renderizava como se não houvesse dado nenhum.

O problema já existia desde que o modo ao vivo ganhou atualização automática, mas ficou bem mais visível na v1.0.0, que passou de uma para quatro consultas simultâneas (telemetria e voltas concluídas, cada uma nas duas fontes).

**Correção.** O painel agora segura o último resultado bom enquanto o próximo não chega. Dois cuidados para não mascarar estado real:

- uma resposta vazia de verdade não é `undefined`, então um período sem eventos continua zerando o painel e mostrando o aviso correto;
- trocar de período ou de modo limpa na hora, sem arrastar dado da janela anterior.

Sem mudanças no pipeline de ingestão nem no pacote dos rigs — o `HackathonRacing-rig-windows.zip` da v1.0.0 continua válido.
