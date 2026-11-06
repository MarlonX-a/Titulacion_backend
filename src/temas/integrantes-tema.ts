import { TipoTema } from './enums/tipo-tema.enum.js';

export const MIN_INTEGRANTES_GRUPO = 3;

export interface RangoIntegrantes {
  min: number;
  /** Null only for GRUPO when no period (and therefore no max_integrantes_default) is known. */
  max: number | null;
}

/** Member-count rule: INDIVIDUAL = 1, PAREJA = 2, GRUPO = 3..period max_integrantes_default. */
export function integrantesPermitidos(tipo: TipoTema, maxGrupo?: number | null): RangoIntegrantes {
  if (tipo === TipoTema.INDIVIDUAL) return { min: 1, max: 1 };
  if (tipo === TipoTema.PAREJA) return { min: 2, max: 2 };
  return { min: MIN_INTEGRANTES_GRUPO, max: maxGrupo ?? null };
}

/** True when `cantidad` members fit the topic type in a period whose group max is `maxGrupo`. */
export function admiteIntegrantes(tipo: TipoTema, cantidad: number, maxGrupo: number): boolean {
  const { min, max } = integrantesPermitidos(tipo, maxGrupo);
  return cantidad >= min && cantidad <= (max ?? maxGrupo);
}

export function mensajeRangoIntegrantes(tipo: TipoTema, cantidad: number, maxGrupo: number): string {
  const { min, max } = integrantesPermitidos(tipo, maxGrupo);
  const tope = max ?? maxGrupo;
  const rango = min === tope ? `${min}` : `entre ${min} y ${tope}`;
  return `El tema ${tipo} admite ${rango} integrante(s); la solicitud tiene ${cantidad}.`;
}

/**
 * SQL mirror of integrantesPermitidos for raw queries. `t` is the tema alias and `maxGrupoSql` an
 * SQL expression that yields the period's max_integrantes_default.
 */
export function rangoIntegrantesSql(t: string, maxGrupoSql: string): { min: string; max: string } {
  return {
    min: `(CASE ${t}."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE ${MIN_INTEGRANTES_GRUPO} END)`,
    max: `(CASE ${t}."tipo" WHEN 'INDIVIDUAL' THEN 1 WHEN 'PAREJA' THEN 2 ELSE ${maxGrupoSql} END)`,
  };
}
