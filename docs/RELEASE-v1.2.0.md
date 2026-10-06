# v1.2.0 — Replay de uma volta escolhida

Só o app mudou (**1.1.2 → 1.2.0**, precisa reinstalar na tenant). O pacote dos simuladores segue o mesmo da v1.1.0.

O modo **"Replay da captura"** virou **"Replay de uma volta"**, e passou a ler do Grail em vez do arquivo embutido.

## O que mudou e por quê

O modo antigo reproduzia uma gravação fixa: **1 piloto, 1 volta, 6min05, feita em 18/09**. Não dava para escolher período nem piloto, porque não havia mais nada no arquivo — e entrar no modo mostrava um painel completamente vazio até alguém descobrir o botão "Reproduzir captura".

Agora o fluxo é:

1. Escolha o **período** (últimos 30 minutos, 7 dias, o que for).
2. A tabela lista **todas as voltas válidas concluídas nesse período**, de todos os simuladores.
3. O seletor de piloto lista **quem correu no período** — e filtra a tabela.
4. Clique em **Reproduzir** na volta que quiser: ela é reproduzida no mapa, em tempo real.

A lista de voltas é a mesma consulta agregada da v1.1.0, então cada volta é uma linha e o período pode ser largo sem estourar limite.

## Como a volta é recortada

O registro da volta diz quando ela **fechou** e quanto **durou**. A volta é, portanto, o intervalo que termina ali — e as amostras vêm de uma consulta à sessão daquele piloto, limitada a essa janela, com 2 segundos de margem nas duas pontas (o fechamento é o primeiro quadro que reportou o tempo, não o cruzamento exato da linha).

Validado contra a captura real: para a volta de **104,015s**, a janela devolve **2.160 amostras cobrindo 107,9s**, com o traçado inteiro de Interlagos.

O passo de reprodução sai das próprias amostras (duração ÷ quantidade), então a volta corre em **1× real** tanto num rig a 20 Hz quanto a 60 Hz, sem depender da frequência UDP configurada no jogo. Na captura isso deu exatamente 50 ms por amostra.

## Detalhes

- `rig.id` e `session.id` entram concatenados na consulta da volta. Eles vêm do próprio Grail, não de digitação, mas passam por uma lista branca de caracteres mesmo assim.
- Trocar o período limpa a volta em reprodução, para a tabela e o mapa não mostrarem períodos diferentes.
- A captura embutida (`capture.json`) deixou de ser carregada pelo app. O arquivo continua no repositório e o `prepare_capture.py` continua gerando — só não vai mais no pacote, o que também reduz o tamanho do app.

## Verificação

27 testes do app, `npm run lint`, `npm run build` e `tsc` limpos. O recorte da volta ganhou teste próprio (janela exata, margem, e registros sem duração utilizável) e foi conferido contra a volta real da captura.

**Não foi clicado num navegador.** A consulta de amostras da volta e a reprodução no mapa foram validadas pela lógica e pelos dados, não pela tela. Se a volta não aparecer ao clicar em Reproduzir, o app agora mostra um aviso explícito em vez de um mapa cinza sem explicação.
