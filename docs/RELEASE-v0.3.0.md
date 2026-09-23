# v0.3.0 — Histórico no Grail e app publicado na tenant

- App publicado em https://bwm98081.apps.dynatrace.com/ui/apps/my.dynatrace.hackathon.racing.
- Seletor oficial Strato: últimos 7 dias, horas, hoje, ontem e intervalo personalizado.
- Períodos convertidos em datas absolutas antes da consulta ao Grail.
- Intervalos até agora atualizam a cada 30 segundos; períodos fechados permitem atualização manual.
- Limite explícito de 10.000 eventos, com aviso de que os indicadores representam a amostra retornada.
- Correção do marcador para usar a posição mais recente mesmo quando o Grail retorna dados em ordem decrescente.
- Ícone de instalação reduzido para 69 KB, preservando a transparência e a logo original do dashboard.
- Mantém replay local com quatro pilotos, empresas simuladas, mapa combinado e bordas animadas da versão 0.2.0.

Validação: 8 testes do frontend, lint e build aprovados. Consulta real de 7 dias e 24 horas validada; instalação confirmada pela App Toolkit e app aberto na tenant.

O replay local não ingere dados no Grail. Os registros históricos podem conter valores do coletor antigo, inclusive campos de volta ausentes. Cadastro de empresas, OpenPipeline e workflow de métricas continuam pendentes.
