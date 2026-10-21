import { liveDelay, stepLiveClock } from './racing';

// Relógio único do Ao vivo, compartilhado pelo carro no mapa e pelo painel do
// piloto: os dois mostram o MESMO instante. Fica fora do estado do React de
// propósito: ele muda a cada quadro (~60/s) e só quem assina (os marcadores e o
// painel de telemetria) redesenha — o mapa de calor e as tabelas não.
export interface LiveClock {
  subscribe: (ouvinte: () => void) => () => void;
  get: () => number;
  // Bloco de amostras disponível (ms). Cada vez que `newest` avança, registra o
  // atraso de ingestão e o intervalo desde o bloco anterior, que calibram o
  // atraso alvo do relógio.
  setRange: (oldest: number, newest: number) => void;
}

const JANELA_DE_MEDIDAS = 15; // ~30 s de chegadas com a recarga de 2 s

export function createLiveClock(): LiveClock {
  let clock = 0, oldest = 0, newest = 0, ultimoQuadro = 0, quadro = 0, ultimaChegada = 0;
  const lags: number[] = [], gaps: number[] = [];
  const ouvintes = new Set<() => void>();
  const guardar = (lista: number[], valor: number) => { lista.push(valor); if (lista.length > JANELA_DE_MEDIDAS) lista.shift(); };
  const passo = () => {
    const agora = Date.now();
    const decorrido = ultimoQuadro ? agora - ultimoQuadro : 0;
    ultimoQuadro = agora;
    const proximo = stepLiveClock(clock, agora, decorrido, oldest, newest, liveDelay(lags, gaps));
    if (proximo !== clock) {
      clock = proximo;
      ouvintes.forEach(ouvinte => ouvinte());
    }
    quadro = requestAnimationFrame(passo);
  };
  return {
    subscribe(ouvinte) {
      ouvintes.add(ouvinte);
      if (ouvintes.size === 1) { ultimoQuadro = 0; quadro = requestAnimationFrame(passo); }
      return () => {
        ouvintes.delete(ouvinte);
        if (!ouvintes.size) cancelAnimationFrame(quadro);
      };
    },
    get: () => clock,
    setRange(novoOldest, novoNewest) {
      const agora = Date.now();
      if (novoNewest > newest) {
        guardar(lags, agora - novoNewest);
        if (ultimaChegada) guardar(gaps, agora - ultimaChegada);
        ultimaChegada = agora;
      }
      oldest = novoOldest;
      newest = novoNewest;
    },
  };
}
