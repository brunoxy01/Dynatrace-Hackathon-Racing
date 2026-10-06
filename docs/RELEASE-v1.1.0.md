# v1.1.0 — Números reais na tela, mapa ao vivo e histórico de voltas

Mudaram **os dois lados**: o app (agora na **1.1.0**, precisa reinstalar na tenant) e o pacote dos simuladores.

Esta release saiu de uma sessão de teste no rig do Plinio, onde o painel mostrava **579,4 km/h** de velocidade máxima num Porsche 911, dois carros na pista com um piloto só, e o nome da conta Steam no lugar do nome do cliente.

## Velocidade máxima impossível

O painel mostrava 579,4 km/h. O decodificador estava certo — na captura real de Interlagos o pico é **300,6 km/h**, e `sSpeed` bate com `|sWorldVelocity|` dentro de 0,6 m/s em todos os 7.236 quadros.

O problema é que o AMS2 emite quadros com velocidade impossível quando **teletransporta o carro** (voltar aos boxes, reiniciar a sessão) ou quando a física o lança numa batida: `sSpeed` vira a distância do salto dividida pelo tick. Como o indicador é um máximo sobre 10.000 amostras, **um único quadro desses definia o painel inteiro**.

Leituras acima de 400 km/h agora são descartadas na decodificação, e o app aplica o mesmo corte nas sessões que já estão no Grail — não precisa reingerir nada.

O acelerômetro tinha o mesmo defeito, e ninguém tinha percebido: **105,8 g** de pico na captura, contra 3,2 g de p99 real. São 0,04% dos quadros. Mesmo tratamento, corte em 10 g.

## O nome do piloto agora sai do `racing.ini`

O AMS2 não pergunta o nome do piloto: ele usa o da conta Steam da máquina. Como o rig é compartilhado entre clientes, todo mundo aparecia como `plinioaugusto01`.

O coletor já sabia receber um nome, mas **o `racing.ini` gerado pelo pacote não tinha essa chave** — não havia como preencher. Agora tem:

```ini
driver_name  = Bruno Lima
company_name = Dynatrace
```

Preenchido, vence o nome do perfil do AMS2. Em branco, o comportamento antigo continua valendo (inclusive o formato `Nome Sobrenome [Empresa]` no perfil do jogo). O `LEIAME.txt` foi reescrito no passo 4.

## Dois carros na pista com um piloto só

Bug real, e explicava mais coisas. A identidade do piloto incluía o nome e o carro — mas os dois chegam em **pacotes UDP próprios, cerca de 27 segundos depois** do primeiro quadro de telemetria, e ficam nulos até lá.

Na captura real isso dá exatamente duas identidades para uma sessão: 535 eventos com os campos nulos, 6.701 com os valores. Um carro é o real; o outro é um fantasma parado onde o carro estava quando os nomes chegaram. Também duplicava linhas na classificação.

A identidade agora é **simulador + sessão** — que é justamente o que o coletor renova a cada cliente novo. Piloto e carro voltaram a ser o que sempre foram: atributos, não identidade.

## O mapa acompanha a pista

O painel estava **30 a 40 segundos atrás** da pista, e ~97% disso era um número só: o app reconsultava o Grail a cada 30 s.

- A telemetria agora recarrega a cada **5 s**. As voltas concluídas seguem em 30 s, num relógio separado — uma volta em Interlagos leva ~100 s e cada ciclo custa quatro consultas ao Grail.
- O carrinho **desliza** em vez de teletransportar. O Grail entrega um bloco de amostras por consulta, mas elas cobrem um intervalo contínuo; um relógio de reprodução percorre o bloco a 20 quadros/s, cerca de 8 s atrás do fim. Vale só no modo Grail: o replay da captura corre a 4× e já é contínuo.
- No rig, `batch_size` e `flush_interval` saíram do código para o `racing.ini` (padrão 10 amostras / 1,0 s, antes 20 / 2,0 s). No executável eles eram inalcançáveis.

## Histórico de voltas

A classificação mostrava só a última volta de cada piloto, e o motivo não era a interface.

O simulador repete o mesmo `last_lap_s` em **todos** os quadros da volta seguinte. A 20 Hz são cerca de **2.427 linhas idênticas para uma única volta** — medido na captura. Com o limite de 5.000 registros, a consulta cobria duas voltas e meia.

A consulta agora agrega no Grail, uma linha por volta. Na captura: 2.427 linhas viram 1, com o tempo certo (1:44.015).

Com isso veio o **drill down**: um seletor ao lado de "Todos os pilotos" troca a tabela de baixo para **Voltas registradas** — volta, tempo, piloto, carro, empresa, simulador e horário, filtrada pelo piloto selecionado e pelo período escolhido, com paginação.

## O modelo do carro

Estava escrito à mão como "Porsche 911" em três lugares da interface. O modelo real já vinha decodificado do pacote de veículos e era simplesmente ignorado. Agora aparece no card do piloto, na classificação, na nova tabela de voltas e na legenda do mapa.

O card do piloto também deixou de mostrar quem lidera e passou a mostrar **quem está na pista agora** — o pódio e a classificação já respondem "quem é o mais rápido", e o painel ao lado anuncia a última leitura recebida.

## Limitações conhecidas

**Carro errado se houver IA na pista.** O AMS2 manda `sCarIndex = 0xFFFF` (o sentinela "sou eu") para o carro do jogador, então o índice nunca casa com o catálogo de veículos e quem resolve o modelo é um fallback que pega o primeiro da lista. Numa sessão solo — o caso dos rigs — o catálogo tem um veículo só e o resultado é exato. Com IA na pista, pode pegar o carro errado.

**A ilustração do mapa continua sendo um Porsche.** O texto abaixo dela é o modelo real, mas a imagem é fixa. Trocar por carro exigiria uma arte por modelo.

**A consulta de voltas não foi executada contra a tenant.** A semântica foi validada na captura real e a sintaxe contra a referência de DQL, mas não houve execução no Grail. Se ela falhar, o app agora mostra um banner de erro em vez de deixar o pódio e a lista silenciosamente vazios — se esse banner aparecer, é isto.

## Verificação

19 testes Python e 23 do app, `npm run lint` e `npm run build` limpos. Os cortes de velocidade e g foram verificados contra os 7.236 quadros da captura real (nenhum quadro legítimo descartado). A animação do mapa não foi vista num navegador: a regra de avanço e ressincronização do relógio foi extraída para uma função pura e simulada em teste por 40 ciclos de 5 s a 20 quadros/s — sem travadas, sem ressincronizações, atraso final dentro do rastro.
