# Projeto: Telemetria de Kart (Automobilista 2) → Dynatrace

## Objetivo do evento
Evento com clientes em kart real: apresentação do Dynatrace + corrida. Ideia central:
instalar/simular um dispositivo de telemetria no kart, enviar dados pro Dynatrace, e
mostrar em dashboards bonitos como ficaram os dados durante a corrida (heatmap de pista,
leaderboard, etc).

## Decisão estratégica: testar tudo virtualmente antes
Em vez de depender só do hardware físico no kart, decidimos usar o **Automobilista 2
(AMS2)** como fonte de telemetria simulada — permite testar todo o pipeline remotamente
e também abre a porta para **eventos virtuais** com clientes de casa.

- AMS2 transmite telemetria via **UDP broadcast, porta 5606**, protocolo herdado do
  "Project CARS 2" (mesma engine).
- Licenciamento: Steam, ~US$20-37, sem modelo corporativo — uso comercial não é
  restringido explicitamente no EULA, mas vale checar antes de um evento formal.
- Multiplayer P2P gratuito, sem precisar de servidor dedicado.

## Arquitetura definida (visão geral)
```
AMS2 (UDP broadcast :5606, protocolo binário)
   → Decoder/bridge Python (recepção UDP + decode + binning)
   → OTel Collector (processors: batch, memory_limiter, transform)
        ├─ pipeline de métricas agregadas (heatmap, avg speed etc)
        └─ pipeline de logs discretos (voltas, incidentes, picos de G)
   → Dynatrace (Grail, métricas, dashboards / Custom App)
```

Decisões de design importantes:
- **Telemetria contínua de alta frequência → métrica**, não log (log tem custo de
  ingestão maior, ~3-5x mais bytes por evento, e query DQL fica mais lenta pra
  dashboard em tempo real).
- **Eventos discretos e esparsos (voltas completas, incidentes, picos de G) → log**,
  onde a flexibilidade de recalcular em DQL compensa o custo.
- **Binning de posição (heatmap) deve ser feito no OTel Collector** (processor
  `transform`, agregando por célula de grid antes de exportar), não em DQL na leitura —
  muito mais barato em volume.
- Arquitetura de threads no decoder: recepção UDP, decodificação e envio devem ficar em
  threads/processos separados para não perder pacotes por bloqueio de rede.
- Volume estimado é pequeno (ordem de centenas de pontos/s para 8 karts) — o gargalo
  real tende a ser banda de broadcast UDP na rede local, não processamento.

## Descoberta do protocolo UDP (trabalho em andamento)
- Formato binário little-endian, validado contra os bytes reais capturados.
- **Cabeçalho comum a todos os pacotes** (12 bytes, formato `<IIBBBB`):
  `packet_number, category_packet_number, partial_packet_index, partial_packet_number,
  packet_type, packet_version`. Tipo 0 = "telemetry".
- O erro anterior era tratar os dois contadores de 32 bits como quatro campos de 16/8
  bits. Nos primeiros bytes `9c180000 f00b0000 01010004`, os valores corretos são:
  pacote 6300, pacote de categoria 3056, parcial 1/1, tipo 0, versão 4.
- Cada tick normalmente contém um pacote de **telemetria** tipo 0, versão 4, com 559
  bytes, e um pacote de **timings** tipo 3, versão 1, com 1063 bytes.
- A captura completa tem 14.579 pacotes em 388,312 s (37,5 pkt/s), incluindo tipos 0,
  1, 2, 3, 4, 7 e 8. Há tamanhos de 24 a 1452 bytes.
- O arquivo `DYNATRACE/eventos.jsonl` existente foi gerado com o cabeçalho antigo de 8
  bytes; portanto, seu `body_hex` começa quatro bytes antes do corpo real. O dump bruto
  `DYNATRACE/captura.txt` está íntegro e deve ser usado para reprocessamento.
- Payload contém texto ASCII reconhecível (`"Slick Macio"` — nome de composto de pneu),
  confirmando que a captura está correta e o protocolo é genuíno.
- **Offset 40 (float32)**: valor ~1227, sobe suavemente a cada pacote — candidato a
  tempo decorrido de sessão ou coordenada em deriva lenta.
- **Offset 534 (float32)**: mudou de ~150 para ~-345 entre duas janelas de tempo
  distintas da captura — candidato a posição/campo físico real, ainda não confirmado.

## Metodologia de decode (sem confiar 100% em doc externa)
Abordagem empírica em 2 fases, porque não há certeza sobre a doc oficial:
1. **Diff/triagem entre cenários** (`ams2_dump_diff.py`) — compara dois momentos
   conhecidos (ex: parado vs. acelerando) e acha offsets estáveis dentro de cada cenário
   mas diferentes entre eles. Não precisa saber o valor exato do HUD, só contrastar
   qualitativamente.
2. **Calibração fina** (`ams2_telemetry_probe.py`) — usa pares (timestamp, valor exato
   do HUD) anotados durante uma sessão controlada, e acha a interseção de offsets que
   batem com todas as amostras. Confirma o campo e a unidade exatos.

Ambas as ferramentas filtram valores `NaN`/`Inf` (lixo de bytes desalinhados) e a
ferramenta de diff descarta offsets com magnitude absurda (>100000) pra não deixar
ruído dominar o ranking.

## Ferramentas construídas (todas testadas com os dados reais enviados)

| Arquivo | Função |
|---|---|
| `ams2_udp_listener.py` | Escuta UDP (porta/host configuráveis via `--port`/`--host` ou env vars `AMS2_UDP_HOST`/`AMS2_UDP_PORT`), decodifica o cabeçalho com segurança, grava dump bruto (texto) e eventos (JSONL) com o corpo em hex. |
| `cars2_telemetry_generator.py` | Lê e valida os structs HEX de `captura.txt`, inspeciona tipos/tamanhos e reproduz os datagramas via UDP com timing real ou acelerado, repetição e renumeração contínua. |
| `ams2_telemetry_probe.py` | Calibração empírica de offsets: `--list` (lista eventos), `--watch-offset` (evolução de um offset no tempo), `--expected timestamp=valor` (interseção de offsets candidatos). |
| `ams2_dump_diff.py` | Diff/triagem rápida entre cenários (`--scenario nome=inicio,fim` ou `--scenario-file`), rankeando offsets por separação entre cenários vs. ruído interno. |
| `ams2_udp_replayer.py` | Reenvia pacotes UDP reais capturados (bytes idênticos, timing original ou acelerado, com `--loop`) para testar o pipeline completo sem depender do jogo. Testado em loopback com sucesso — bytes chegaram idênticos do outro lado. |
| `kart_telemetry_generator.py` | Gerador sintético de telemetria (múltiplos karts numa pista virtual "estádio", física simplificada) enviando via OTLP (HTTP/gRPC) pro OTel Collector. Tem "limitador de funcionalidades" (`FIELD_CONFIG`) — calcula telemetria completa internamente mas só envia os 10 indicadores solicitados: aceleração, velocidade, marcha, frenagem, posição x/y, tempo de volta, rank de volta, melhor volta, número de volta. Suporta `--dry-run` (sem precisar do OTel SDK) e `--disable-field`. |

## Troubleshooting de rede já resolvido
- Erro inicial: script rodando com `--host 127.0.0.1` (loopback, não recebe broadcast) e
  porta errada (5605 em vez de 5606) — corrigido para `--host 0.0.0.0 --port 5606`.
- Depois disso, broadcast ainda não chegava mesmo com firewall do Windows desligado e
  regra de rede criada — indicando bloqueio numa camada mais baixa (driver de
  rede/antivírus corporativo/isolamento de cliente Wi-Fi). Próximos passos sugeridos e
  ainda não confirmados como resolvidos:
  - Testar com **outra máquina** enviando o broadcast (não a própria máquina pra si
    mesma — muitos switches não ecoam de volta pro mesmo cabo/porta).
  - Capturar com Wireshark direto na placa de rede (`udp.port == 5606`) pra saber se o
    pacote nem chega na placa.
  - Verificar EDR/antivírus corporativo (filtro NDIS que sobrevive ao firewall desligado).
  - Verificar "broadcast/multicast filtering" nas propriedades avançadas da placa de
    rede, e isolamento de cliente no roteador/AP se for Wi-Fi.

## Plano de 5 etapas (o essencial: mínimo trabalho no local dos simuladores)
1. **Coleta do dump** — feito, já têm `captura.txt` (24 MB) e `eventos.jsonl` (27 MB).
2. **Análise do dump** (remoto) — `ams2_dump_diff.py` + `ams2_telemetry_probe.py`.
3. **Geração de tráfego de teste** (remoto) — `ams2_udp_replayer.py` (bytes reais) +
   `kart_telemetry_generator.py` (sintético).
4. **Criação do app/dashboards no Dynatrace** (remoto) — usando os geradores acima como
   fonte de dados.
5. **Teste real no local dos simuladores** — só validação final, trabalho técnico
   mínimo (ideal: scripts empacotados/prontos, sem precisar digitar comandos lá).

## Pendências / próximos passos
- **Busca web indisponível nesta sessão** — pendente: cruzar os offsets achados
  empiricamente com documentação oficial (SMS/WMD, fórum Reiza) e implementações
  open-source de referência (CrewChief) quando a busca voltar.
- Rodar uma sessão de captura com **ações controladas e horários anotados** (parado,
  acelerando até valor redondo no HUD, freando) para alimentar o
  `ams2_telemetry_probe.py` e confirmar os offsets de verdade — os candidatos offset 40
  e offset 534 são os mais promissores até agora.
- Resolver o troubleshooting de broadcast UDP bloqueado na rede dos simuladores (ver
  seção acima) antes de decidir se vale a pena investir mais tempo nisso ou seguir
  100% com o `ams2_udp_replayer.py`/gerador sintético para os testes remotos.
- Depois de confirmar os offsets, estender o `ams2_udp_listener.py` (ou criar um decoder
  de produção separado) para decodificar de verdade em vez de só guardar hex.
- Definir o design final do Custom App do Dynatrace com overlay do traçado real da pista
  (SVG) para o heatmap — ainda não iniciado.

## Gerador CARS2 baseado na captura real

Inspecionar os structs sem transmitir:

```bash
python3 cars2_telemetry_generator.py --inspect
```

Reproduzir uma vez em tempo real para um bridge local:

```bash
python3 cars2_telemetry_generator.py --host 127.0.0.1 --port 5606
```

Reproduzir continuamente em velocidade 10x:

```bash
python3 cars2_telemetry_generator.py --host 127.0.0.1 --port 5606 --speed 10 --loop
```

Por padrão, apenas o contador global `packet_number` é renumerado entre loops; todos os
outros bytes permanecem idênticos à captura. Use `--preserve-sequence` para replay
100% idêntico ou `--packet-type 0 --packet-type 3` para enviar somente telemetria e
timings.

### Variações percentuais da telemetria

O gerador aceita percentuais positivos ou negativos sobre o valor original:

| Opção | Campo CARS2 alterado |
|---|---|
| `--speed-pct` | velocidade em m/s |
| `--throttle-pct` | posição do acelerador |
| `--brake-pct` | posição do freio |
| `--gear-pct` | marcha atual, arredondada e limitada |
| `--acceleration-pct` | vetor de aceleração física XYZ |
| `--position-x-pct` | coordenada global X |
| `--position-y-pct` | coordenada global Z, usada como Y no mapa 2D |

Exemplo: `--speed-pct 10` produz 110% da velocidade original e `--brake-pct -20`
produz 80% da frenagem original. Os pedais ficam limitados a `0..255`, velocidade não
fica negativa, ré e quantidade de marchas são preservadas. Apenas pacotes tipo 0,
versão 4, são alterados. Com todos os percentuais em zero, os bytes originais são
preservados.
