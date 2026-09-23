# Interface Dynatrace Hackathon Racing

Consulte o [README principal](../README.md) para contexto do evento, prints, origem dos dados e operação dos simuladores.

```powershell
npm ci
npm start -- --no-open --port 3000
```

Em outro terminal, na raiz do repositório: `python replay_server.py`.
Abra http://localhost:3000/ui e inicie a simulação.

Validação: `npm test`, `npm run lint`, `npm run build`.
Deploy explícito no ambiente de `app.config.json`: `npm run deploy`.

O frontend usa Strato e design tokens; o modo local é exclusivo de localhost. O modo Grail consulta novos business events. Detalhes e limites estão no README principal.
