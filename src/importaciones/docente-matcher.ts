export interface DocenteCandidato {
  id: string;
  nombres: string;
  apellidos: string;
}

export interface CoincidenciaDocente {
  /** Set only when exactly one teacher matches. */
  docente: DocenteCandidato | null;
  /** Every match when there are several (for the preview selector); empty otherwise. */
  candidatos: DocenteCandidato[];
}

/** Academic titles that the institutional sheet sometimes prefixes to names. */
const TITULOS = new Set(['ing', 'mg', 'msc', 'mgs', 'phd', 'dr', 'dra', 'lic', 'abg', 'econ', 'arq', 'tlgo']);

/** Lowercase, without accents, hyphens or punctuation, single-spaced. */
export function normalizarNombre(valor: string): string {
  return valor
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[-.,;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokensNombre(valor: string): string[] {
  return normalizarNombre(valor)
    .split(' ')
    .filter((token) => token.length > 0 && !TITULOS.has(token));
}

/** A teacher matches when their `nombres apellidos` contains every word of the Excel name. */
export function coincidirDocente(nombreExcel: string, docentes: DocenteCandidato[]): CoincidenciaDocente {
  const buscados = tokensNombre(nombreExcel);
  if (buscados.length === 0) return { docente: null, candidatos: [] };

  const coincidencias = docentes.filter((docente) => {
    const propios = new Set(tokensNombre(`${docente.nombres} ${docente.apellidos}`));
    return buscados.every((token) => propios.has(token));
  });

  if (coincidencias.length === 1) return { docente: coincidencias[0]!, candidatos: [] };
  return { docente: null, candidatos: coincidencias.length > 1 ? coincidencias : [] };
}
