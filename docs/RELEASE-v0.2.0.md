# v0.2.0 — Replay progressivo de Interlagos

Checkpoint para o evento Dynatrace Hackathon Racing.

- App React/Strato executável com mapa SVG suave e telemetria real do dump UDP.
- Replay local em Python: pista inicialmente cinza, cores progressivas e controles de reprodução.
- Fechamento da volta incluído: última volta de 1:44.015 e melhor calculada entre voltas concluídas, com origem explícita.
- Bordas animadas sincronizadas no pódio e roxo mais vivo no card da pista.
- README reestruturado com contexto do evento, prints, origem dos campos e comandos de execução.
- Correção da interpretação dos pacotes de nomes de carro e preservação da última volta.

Validação: 7 testes do frontend, testes Python do protocolo e replay, lint e build aprovados. Replay completo conferido no navegador.

Ainda pendentes: cadastro de empresa, OpenPipeline, logos, workflow de métricas e agregação durável para múltiplos simuladores. Esta release não faz deploy no Dynatrace.

Consulte README.md para reproduzir localmente e operar o coletor no evento.
