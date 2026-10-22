# v1.11.2 — Sem volta duplicada no placar e setores mais robustos

Pacote do rig **e** app (**1.11.1 → 1.11.2**). Sobre a v1.11.1 (um cartão por piloto no Ao vivo), sem mudar nada dela.

## Volta duplicada logo depois de concluída

Ao fechar uma volta, ela aparecia duas vezes no placar por um tempo.

**Causa** (introduzida na v1.10.14): a volta entra no placar na hora, montada a partir de um quadro da telemetria ao vivo, e esse quadro levava o identificador da amostra (`sample.id`). A linha que o Grail devolve não tem esse campo, então as duas não eram reconhecidas como a mesma volta. Até a v1.10.13, a regra "mesmo piloto + mesmo tempo" escondia isso; na v1.10.14 ela passou a manter todas as voltas reais, e a duplicata apareceu.

**Correção:** a linha inserida na hora não leva mais o `sample.id`. Além disso, duas linhas reais do mesmo piloto, simulador e tempo a menos de 1 minuto uma da outra contam como a mesma volta, e fica a do Grail. Voltas iguais em momentos diferentes (ex.: 1:41.120 ontem e hoje) continuam aparecendo as duas.

## Setores que às vezes não registravam

Os dados no Dynatrace não trazem o setor de cada quadro, só S1/S2/S3 já calculados, então a causa foi buscada no coletor. Três fragilidades, todas confirmadas em teste contra o coletor da v1.11.1:

1. **S1/S2 só eram calculados no pacote exato da virada de setor.** Se ali o jogo mandasse o "tempo no setor" ainda indisponível, a volta perdia os setores.
2. **Setor "piscando" por um pacote perto da divisa** (ex.: S2 → S1 → S2) descartava a volta inteira.
3. **Reinício no meio do S3** parecia uma passagem pela linha e podia sobrescrever os setores certos da volta anterior.

**Correção:** o coletor registra o **instante em que cada setor começou**, que dá para tirar de qualquer pacote dentro do setor (cronômetro − tempo já corrido no setor). O primeiro pacote válido basta, e um pacote estranho não derruba a volta. A volta fecha na passagem S3 → S1, ou quando o cronômetro zera ainda em S3. Setores já fechados para um tempo de volta não são sobrescritos.

As voltas já gravadas sem setores continuam com "—".

## Técnico

- `ams2_protocol.py`: `_acompanhar_setores` passa a usar `_inicio_setor`; novo `_fechar_volta`; `_fechar_setores` não sobrescreve setores já fechados.
- `racing.ts`: `lapCompletions` sem `sample.id`; `dedupeLaps` junta linhas reais da mesma volta a menos de 60 s.
- Testes novos: tempo no setor indisponível na virada; setor piscando na divisa; reinício no S3; volta inserida ao vivo + a mesma volta do Grail (inclusive com timestamp alguns segundos diferente). Os três primeiros falham no coletor da v1.11.1 e passam agora.
- `npm test` (80/80), `npm run lint`, `tsc`, `npm run build` e os testes Python limpos. Captura real continua dando S1 = 24,653, S2 = 57,540, S3 = 21,822.
