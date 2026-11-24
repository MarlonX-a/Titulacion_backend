const TITULOS = new Set(['ing', 'inge', 'mg', 'mgs', 'mgtr', 'msc', 'mba', 'phd', 'dr', 'dra', 'lic', 'lcdo', 'lcda', 'ab', 'abg', 'arq', 'econ', 'esp', 'psic']);

export type ConfianzaTutor = 'alta' | 'media' | 'nula';

export interface CoincidenciaTutor {
  candidato_id: string | null;
  confianza: ConfianzaTutor;
  nombre_word: string;
  nombre_sistema: string | null;
}

/** Compara el tutor pedido en el Word solo contra los candidatos del equipo. */
export function coincidirTutor(pedido: string, candidatos: Array<{ id: string; nombres: string; apellidos: string }>): CoincidenciaTutor {
  const objetivo = tokensNombre(pedido);
  if (!objetivo.length) return { candidato_id: null, confianza: 'nula', nombre_word: pedido.trim(), nombre_sistema: null };
  let mejor: CoincidenciaTutor = { candidato_id: null, confianza: 'nula', nombre_word: pedido.trim(), nombre_sistema: null };
  for (const candidato of candidatos) {
    const sistema = tokensNombre(`${candidato.nombres} ${candidato.apellidos}`);
    const confianza = confianzaDe(objetivo, sistema);
    if (rango(confianza) > rango(mejor.confianza)) {
      mejor = { candidato_id: candidato.id, confianza, nombre_word: pedido.trim(), nombre_sistema: `${candidato.nombres} ${candidato.apellidos}`.trim() };
    }
  }
  return mejor;
}

export function tokensNombre(valor: string): string[] {
  const limpio = valor.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[.,]/g, ' ');
  return limpio.split(/\s+/).filter((token) => token && !TITULOS.has(token));
}

function confianzaDe(pedido: string[], sistema: string[]): ConfianzaTutor {
  if (!pedido.length || !sistema.length) return 'nula';
  if (pedido.join(' ') === sistema.join(' ')) return 'alta';
  const cubre = (origen: string[], destino: string[]) => origen.every((token) => destino.includes(token));
  if (cubre(pedido, sistema) || cubre(sistema, pedido)) return 'media';
  return 'nula';
}

function rango(confianza: ConfianzaTutor): number {
  return confianza === 'alta' ? 2 : confianza === 'media' ? 1 : 0;
}
