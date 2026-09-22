# Dynatrace Hackathon Racing — Telemetria do Automobilista 2

Pacote para popular o app/dashboards da Dynatrace com eventos de corrida do
**Automobilista 2 (AMS2)**, tanto com dados REAIS (a partir da captura que
vocês já fizeram, ou em tempo real no dia do evento) quanto com dados
sintéticos extras, se precisar de mais carga para testar.

## Escopo dos campos (o que vocês pediram)

Só estes 11, sempre:

| Campo pedido | Campo no evento | Origem no protocolo do AMS2 |
|---|---|---|
| Aceleração | `acceleration_g` | `localAcceleration` (pacote Telemetry) |
| Velocidade | `speed_kmh` | `speed` (Telemetry) |
| Marcha | `gear` | `gearNumGears` (Telemetry) |
| Frenagem | `brake_pct` | `brake` (Telemetry) |
| Posição na pista (x,y) | `pos_x`, `pos_y` | `fullPosition` (Telemetry) |
| Tempo de volta | `lap_time_s` | `currentTime` (Timings) |
| Rank de volta | `lap_race_position` | `racePosition` (Timings) |
| Melhor volta | `best_lap_s` | `fastestLapTime` (Time Stats) |
| Número da volta | `lap_number` | `currentLap` (Timings) |
| Nome do piloto | `driver_name` | pacote Participants |
| Carro utilizado | `car_name` | pacote Vehicle Names |

## Boa notícia: já decodificamos o protocolo real do AMS2

O AMS2 fala o protocolo UDP do Project CARS 2 (Options → System → UDP
Protocol Version: Project CARS 2). Os offsets de byte usados aqui vêm do
`SMS_UDP_Definitions.hpp` oficial da Slightly Mad Studios, na forma
publicada e testada pelo projeto open-source
[`ams2-telemetry`](https://github.com/chris-r-uol/ams2-telemetry).

**Validamos isso contra a captura real de vocês** (`captura.txt`, sessão de
2026-09-19 em Interlagos):

- Piloto decodificado: `fehspfc9`
- Carro decodificado: `Formula Ultimate Hybrid Gen2` (depois `Camaro SS`)
- Pista: `Interlagos` / `Interlagos_GP`, 4294.9 m
- Voltas reais decodificadas, ex.: `104.015 s`

Ou seja: **não é mock**, é a decodificação real dos bytes que os simuladores
mandaram. Isso muda o plano — em vez de só inventar números, dá pra já
mandar dados reais da sessão de teste pro Dynatrace hoje.

## Os 3 scripts

### 1. `ams2_collector.py` — o principal (real, hoje e no dia do evento)

```bash
export DT_ENV_URL="https://abc12345.live.dynatrace.com"
export DT_API_TOKEN="dt0c01.SEU_TOKEN"

# HOJE: replay da captura real que vocês já fizeram (dados reais, não mock)
python3 ams2_collector.py --source replay --file captura.txt --speed 4 --loop \
    --rig-id rig-01 --rig-name "Simulador 1"

# DIA DO EVENTO: escuta o UDP real do AMS2 (um processo por simulador,
# rodando na mesma máquina/rede de cada rig)
python3 ams2_collector.py --source udp --port 5606 \
    --rig-id rig-01 --rig-name "Simulador 1"
```

No jogo, em cada simulador: **Options → System → UDP Frequency: 1** e
**UDP Protocol Version: Project CARS 2**, apontando o UDP para o IP da
máquina que roda o `ams2_collector.py --source udp` (ou `127.0.0.1` se
rodar na mesma máquina do simulador).

`--speed 4` no replay acelera a reprodução (4x mais rápido que o tempo
real); `--speed 0` manda tudo o mais rápido possível, sem pausas; `--loop`
repete o arquivo pra sempre, útil pra manter o app "vivo" com dados reais
enquanto vocês testam.

### 2. `mock_telemetry_generator.py` — carga sintética extra (opcional)

Mesmo schema de 11 campos, mas com valores inventados (não vem de nenhuma
captura real). Útil só se quiser simular MAIS simuladores rodando ao mesmo
tempo do que os que vocês gravaram, pra testar volume/concorrência no app:

```bash
python3 mock_telemetry_generator.py --rigs 6 --hz 2
```

Cada evento sai com `"source": "mock"` (contra `"source": "real"` do
collector), pra vocês conseguirem filtrar/excluir fácil depois.

### 3. `ams2_protocol.py` — o decodificador, usado pelos outros dois

Não precisa rodar direto; é o módulo com a lógica de decodificação dos
pacotes UDP do AMS2 (cabeçalho + telemetria + timings + participantes +
nomes de carro + melhores tempos). Se quiser expandir os campos capturados
no futuro (temperatura de pneu, combustível, setores, dano etc.), os
offsets de todos os pacotes estão documentados nos comentários desse
arquivo.

Todos os scripts usam só a biblioteca padrão do Python (`urllib`, `struct`,
`socket`) — não precisa instalar nada além do Python 3.

## Pré-requisitos no Dynatrace

1. Token com escopo de ingestão de business events:
   - **Classic API token**: Settings → Access Tokens → Generate new token →
     escopo **`bizevents.ingest`** ("Ingest bizevents").
   - (Alternativa) **Platform token** com escopo `openpipeline:bizevents:ingest`.
2. URL do ambiente, ex: `https://abc12345.live.dynatrace.com`.

> Referência oficial: [Ingest business events via API](https://docs.dynatrace.com/docs/observe/business-observability/bo-events-capturing/bo-events-capturing-external-sources)

Teste sempre com `--dry-run` primeiro (imprime no terminal, não gasta
ingestão) antes de rodar de verdade contra o Dynatrace.

## Conferindo no Dynatrace

Notebooks → DQL:

```
fetch bizevents
| filter event.type == "racing.telemetry"
| sort timestamp desc
| limit 100
```

Velocidade média e melhor volta por rig, últimos 5 min:

```
fetch bizevents, from: now() - 5m
| filter event.type == "racing.telemetry"
| summarize avg(speed_kmh), min(best_lap_s), by: {`rig.id`, `driver_name`}
```

Pina isso num Dashboard e você já tem o esqueleto do app.

## No dia do evento

1. Cada simulador aponta o UDP dele (Options → System) para a máquina que
   vai rodar `ams2_collector.py --source udp --rig-id rig-XX`, uma
   instância por rig (com `rig-id`/`rig-name` diferentes).
2. Cada instância decodifica os pacotes reais e manda pro mesmo endpoint
   Dynatrace, com `"source": "real"`.
3. Como o schema é o mesmo que vocês já validaram com o replay/mock, os
   dashboards não precisam de nenhum ajuste — só passam a mostrar dados do
   evento em vez da sessão de teste.

## Limitações e avisos

- `pos_x`/`pos_y` vêm de `fullPosition` (coordenadas globais do jogo no
  eixo X/Z — Y costuma ser a altura). Se o mapa 2D sair "estranho"
  (rotacionado/espelhado), é só ajustar no app, os valores brutos estão
  certos.
- `acceleration_g` é a magnitude do vetor de aceleração local (não separa
  "acelerando" de "freando/curva"); se precisar separar por eixo, os 3
  componentes já vêm decodificados em `ams2_protocol.decode_telemetry`
  (`acceleration_xyz`), só não estão no evento final pra manter o escopo de
  11 campos.
- `lap_time_s` e `best_lap_s` aparecem como `null` até o jogo ter esse dado
  disponível (ex.: primeira volta em andamento).
- Confirme escopos de token e limites de payload (5 MB por requisição) na
  documentação oficial da Dynatrace antes do evento — detalhes de API
  podem mudar com o tempo.
