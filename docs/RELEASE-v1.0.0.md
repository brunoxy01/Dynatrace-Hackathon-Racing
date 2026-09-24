# v1.0.0 — Pronto para o evento

Primeira versão completa: telemetria real saindo de três simuladores, passando por um OTel Collector local em cada rig, chegando ao Grail por dois caminhos independentes e aparecendo no painel ao vivo. Validada de ponta a ponta com ~13.000 amostras enviadas para a tenant, sem uma única falha de entrega.

## Como funciona

```
Automobilista 2 ──UDP 5606──> ams2_collector.py ──┬──> API de business events ──> Grail (bizevents)
                                                  └──> OTLP 127.0.0.1:4318
                                                         └─> OTel Collector ──> Grail (logs)
```

Os dois processos rodam **dentro da máquina do simulador**, sem componente externo. O app consulta as duas fontes com queries independentes e junta os resultados deduplicando por `sample.id`: se um caminho cair, o painel continua com o outro.

Business events e OTLP **não se convertem entre si** — um OTel Collector não consegue produzir bizevents, e OTLP sempre cai em `logs`/`spans`/`metrics`. Por isso as duas fontes coexistem em vez de uma substituir a outra.

### Piloto e empresa

O piloto escreve `Nome Sobrenome [Empresa]` no perfil do AMS2. O jogo transmite esse nome no pacote de participantes (tipo 2), o coletor decodifica e separa nome e empresa. **O rig não precisa ser reconfigurado entre clientes.** O texto original fica em `driver_name_raw`, então uma regra de OpenPipeline ainda pode reprocessar depois.

## O pacote dos rigs

`HackathonRacing-rig-windows.zip`: um `.exe` que sobe o OTel Collector e a ponte UDP num processo só. O operador edita apenas o `racing.ini` (rig, URL do ambiente e token) e dá duplo clique. Instruções completas no `LEIAME.txt` dentro do zip.

Montado no CI em `windows-latest`, com o OTel Collector oficial da Dynatrace e checksum conferido durante o build.

**Ainda não foi executado no Windows.** O build passa, os binários são PE32+ legítimos e o mesmo código compilado para macOS roda de ponta a ponta, mas o teste em Windows real está pendente.

## Correções que mudam o resultado no evento

**Pódio vazio mesmo com voltas concluídas.** A consulta de telemetria traz os 10.000 eventos mais recentes; com três rigs a ~60 amostras/s isso cobre menos de um minuto, e uma volta em Interlagos leva ~104s. A transição de volta quase nunca caía na janela, então o cálculo da melhor volta não validava e a "Disputa entre empresas" ficava em "Aguardando empresa". Agora as voltas concluídas vêm de uma consulta própria, agregada no Grail em vez de recortada pela janela.

**`company_name` nunca era emitido** pelo coletor real — só pelo `replay_server.py` de demonstração. Na prática o pódio ficaria vazio no dia mesmo com o problema acima resolvido.

**Geradores morriam calados no Python 3.9.** `str | None` só existe do 3.10 em diante; os coletores e o collector subiam normalmente enquanto nenhum pacote UDP era produzido. Resolvido com `from __future__ import annotations`; os testes passam no 3.9 e no 3.14.

**Marcha corrompida no gerador.** As marchas válidas vão de 1 até `num_gears`, mas o limite estava em `num_gears - 1`: a marcha mais alta nunca era gerada, e era rebaixada mesmo com `--gear-pct 0`.

**Token exposto no `ps`.** O script de ensaio passava `--token` na linha de comando, visível para qualquer usuário da máquina. Agora vai pelo ambiente.

**Collector órfão travando a porta 4318.** Fechar a janela no X do Windows deixava o collector vivo e o duplo clique seguinte falhava. O supervisor registra o PID em disco, limpa o que sobrou na entrada e insiste 10s no bind UDP.

**Credencial obrigatória nos dois caminhos.** Antes, `sink=otlp` sem token subia "com sucesso" e descartava tudo em silêncio.

**`npm run lint` quebrado.** Uma pasta duplicada com o scaffold original e um `node_modules` corrompido fazia o ESLint abortar antes de analisar qualquer arquivo.

## Painel

- Indicador de tempo real no cabeçalho: amostras no último minuto e quantos simuladores estão reportando, ou há quanto tempo a pista está muda.
- "Telemetria" no card do piloto agora mostra **Automobilista 2** em vez do carro do jogo; o carro informado pelo simulador ficou no tooltip.
- Porsche 911 reposicionado no canto inferior esquerdo do mapa.
- Top 10 com larguras mínimas por coluna e números alinhados à direita.
- Novo escopo `storage:logs:read`, necessário para a fonte OTel.

## Ensaio sem o simulador

```bash
cp .env.exemplo .env.local     # DT_ENV_URL e DT_API_TOKEN
./ensaio-3-rigs.sh             # três rigs, três empresas, três ritmos
./ensaio-3-rigs.sh --local     # não envia nada para o Dynatrace
```

O token precisa de `bizevents.ingest` **e** `logs.ingest`.

## Validação

14 testes do app, 18 testes Python (no 3.9 e no 3.14), `npm run lint` e `npm run build` limpos, e uma execução real de ~13.000 amostras pelos dois caminhos com zero erro de entrega.
