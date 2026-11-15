import { describe, expect, it } from 'vitest';
import { inferirTipoTemaLegacy } from './inferir-tipo-tema-legacy.js';

describe('inferencia del tipo al migrar temas heredados', () => {
  it('conserva un uso activo exclusivo de parejas cuando el período no permitía grupos', () => {
    expect(inferirTipoTemaLegacy(1, 3, [
      { num_integrantes: 2, max_integrantes_default: 2 },
    ])).toBe('PAREJA');
  });

  it('conserva el mapeo por máximo cuando no hay evidencia inequívoca de pareja', () => {
    expect(inferirTipoTemaLegacy(1, 3, [])).toBe('GRUPO');
    expect(inferirTipoTemaLegacy(1, 3, [
      { num_integrantes: 2, max_integrantes_default: 4 },
    ])).toBe('GRUPO');
    expect(inferirTipoTemaLegacy(1, 3, [
      { num_integrantes: 2, max_integrantes_default: 2 },
      { num_integrantes: 3, max_integrantes_default: 4 },
    ])).toBe('GRUPO');
  });

  it('mantiene los casos históricos inequívocos de individual y pareja', () => {
    expect(inferirTipoTemaLegacy(1, 1, [])).toBe('INDIVIDUAL');
    expect(inferirTipoTemaLegacy(1, 2, [])).toBe('PAREJA');
  });
});
