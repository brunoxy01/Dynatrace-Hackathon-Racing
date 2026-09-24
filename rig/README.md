# Pacote do rig (Windows)

Tudo o que roda **dentro da máquina do simulador**. Dois processos locais, nenhum componente externo:

```
Automobilista 2  --UDP 5606-->  ams2_collector.py  --+--> API de business events --> Dynatrace
  (ou 4-gerador-teste.bat)                           |
                                                     +--> OTLP 127.0.0.1:4318
                                                             |
                                                       OTel Collector  --> Dynatrace (logs)
```

O app lê as duas fontes e deduplica pelo campo `sample.id`, então ligar as duas não duplica nada no painel.

## Preparo (uma vez por máquina)

1. Copie a pasta do repositório para o rig.
2. Rode **`1-instalar.bat`**. Ele confere o Python, baixa o OTel Collector da release oficial da Dynatrace e cria o `config.bat`.
3. Preencha o `config.bat`: `RIG_ID` (diferente em cada rig), `DT_ENV_URL` e `DT_API_TOKEN`.

O token precisa de **dois escopos**: `bizevents.ingest` e `logs.ingest`. O `config.bat` não vai para o Git.

## No dia do evento

Duas janelas, nesta ordem:

1. **`2-coletor-otel.bat`** — sobe o OTel Collector. Deixe aberta.
2. **`3-telemetria-rig.bat`** — escuta o AMS2 e alimenta os dois caminhos. Deixe aberta.

No AMS2, em `Options > System`: `UDP Protocol Version = Project CARS 2` e `UDP Frequency = 1`.

## Ensaio sem o simulador

**`4-gerador-teste.bat`** reenvia a captura real por UDP, fazendo o papel do jogo. A cadeia daí para frente é idêntica à do dia do evento — é exatamente o mesmo caminho, só muda quem produz os pacotes UDP.

Não rode o gerador junto com o jogo: os dois escrevem na mesma porta e a telemetria se mistura.

Uma ressalva sobre o gerador: as variações (`--speed-pct`, `--brake-pct`, ...) são **escalas fixas**, não ruído aleatório por amostra. `--speed-pct 7` reproduz a volta inteira 7% mais rápida, o que serve para fabricar "outro piloto" consistente a partir da mesma captura, mas não gera dispersão amostra a amostra.

## Se algo não subir

| Sintoma | Causa provável |
| --- | --- |
| `Python nao encontrado` | Reinstale marcando "Add python.exe to PATH" |
| Collector sobe e morre na hora | `DT_API_TOKEN` vazio ou sem `logs.ingest` |
| `falha de conexao` no `3-telemetria-rig` | O `2-coletor-otel.bat` não está rodando |
| Telemetria zerada com o jogo aberto | `UDP Protocol Version` não está em `Project CARS 2` |
| Nada aparece no app | Confira o período no seletor; a ingestão leva alguns segundos |

Se a rede cair no meio do evento, o collector guarda as amostras em `fila-otel/` e reenvia quando a conexão voltar. O caminho de business events **não** tem fila: o que falhar ali se perde.
