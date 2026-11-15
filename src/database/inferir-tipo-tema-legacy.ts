export type TipoTemaMigrado = 'INDIVIDUAL' | 'PAREJA' | 'GRUPO';

export interface UsoActivoTemaLegacy {
  num_integrantes: number;
  max_integrantes_default: number;
}

/**
 * El mapeo normal conserva la decisión histórica por max_integrantes. Hay una excepción segura:
 * un tema antiguo con rango que incluye 2 se usó activamente solo con parejas, y al menos uno de
 * esos períodos no permitía grupos (máximo menor que 3). En ese caso el uso vigente desambigua el
 * tipo nuevo como PAREJA, en vez de invalidar una asignación legítima.
 */
export function inferirTipoTemaLegacy(
  minIntegrantes: number,
  maxIntegrantes: number,
  usosActivos: readonly UsoActivoTemaLegacy[],
): TipoTemaMigrado {
  if (maxIntegrantes === 1) return 'INDIVIDUAL';
  if (maxIntegrantes === 2) return 'PAREJA';
  const soloParejas = usosActivos.length > 0
    && minIntegrantes <= 2
    && usosActivos.every((uso) => uso.num_integrantes === 2)
    && usosActivos.some((uso) => uso.max_integrantes_default < 3);
  return soloParejas ? 'PAREJA' : 'GRUPO';
}

