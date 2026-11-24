import { describe, expect, it } from 'vitest';
import { coincidirTutor } from './coincidir-tutor.js';

const candidatos = [
  { id: 'c1', nombres: 'Sandra Jackeline', apellidos: 'Soledispa Pereira' },
  { id: 'c2', nombres: 'Luis', apellidos: 'Mendoza Prueba' },
];

describe('coincidirTutor', () => {
  it('ignora títulos, acentos y mayúsculas y solo compara con los candidatos del equipo', () => {
    expect(coincidirTutor('Ing. Sandra Jackeline Soledispa Pereira, Mg', candidatos)).toMatchObject({ candidato_id: 'c1', confianza: 'alta' });
    expect(coincidirTutor('PhD. Luís Mendoza', candidatos)).toMatchObject({ candidato_id: 'c2', confianza: 'media' });
    expect(coincidirTutor('Ing. Persona Ajena', candidatos).confianza).toBe('nula');
  });
});
