import { describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { SituacionIngreso } from '../habilitados/enums/situacion-ingreso.enum.js';
import { PeriodoEstado } from '../periodos/enums/periodo-estado.enum.js';
import { CrearEquipoDto } from './dto/crear-equipo.dto.js';
import { nombreGrupoPorDefecto, periodoAdmiteEquipos, situacionAdmiteAsignacion } from './reglas-equipo.js';

describe('reglas de equipos administrativos', () => {
  it('conforma equipos durante la postulación, con la postulación cerrada o durante la titulación', () => {
    expect(Object.values(PeriodoEstado).filter(periodoAdmiteEquipos)).toEqual([PeriodoEstado.POSTULACION_ABIERTA, PeriodoEstado.POSTULACION_CERRADA, PeriodoEstado.EN_CURSO]);
  });

  it('admite ADMITIDO siempre y PENDIENTE solo antes del inicio de titulación', () => {
    const inicio = new Date('2026-12-01T00:00:00Z');
    expect(situacionAdmiteAsignacion(SituacionIngreso.ADMITIDO, new Date('2027-01-01'), inicio)).toBe(true);
    expect(situacionAdmiteAsignacion(SituacionIngreso.PENDIENTE, new Date('2026-11-30'), inicio)).toBe(true);
    expect(situacionAdmiteAsignacion(SituacionIngreso.PENDIENTE, inicio, inicio)).toBe(false);
    expect(situacionAdmiteAsignacion(SituacionIngreso.NO_ADMITIDO, new Date('2026-11-01'), inicio)).toBe(false);
  });

  it('genera un nombre de grupo de 120 caracteres como máximo', () => {
    expect(nombreGrupoPorDefecto('  Sistema   de   tutorías ')).toBe('Equipo — Sistema de tutorías');
    const largo = nombreGrupoPorDefecto('x'.repeat(300));
    expect(largo).toHaveLength(120);
    expect(largo.endsWith('…')).toBe(true);
  });
});

describe('CrearEquipoDto', () => {
  const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const errores = async (body: Record<string, unknown>) => (await validate(plainToInstance(CrearEquipoDto, body))).map((error) => error.property);
  const valido = { estudiante_ids: [uuid(1)], tema_id: uuid(2), docente_ids: [uuid(3)], motivo: 'Acta 1' };

  it('acepta un cuerpo válido y recorta el motivo', async () => {
    expect(await errores(valido)).toEqual([]);
    expect(plainToInstance(CrearEquipoDto, { ...valido, motivo: '  Acta  ' }).motivo).toBe('Acta');
  });

  it('rechaza listas vacías, repetidas, demasiados candidatos, UUID inválidos y motivo en blanco', async () => {
    expect(await errores({ ...valido, estudiante_ids: [] })).toContain('estudiante_ids');
    expect(await errores({ ...valido, estudiante_ids: [uuid(1), uuid(1)] })).toContain('estudiante_ids');
    expect(await errores({ ...valido, docente_ids: [uuid(3), uuid(3).toUpperCase()] })).toContain('docente_ids');
    expect(await errores({ ...valido, docente_ids: Array.from({ length: 11 }, (_v, i) => uuid(10 + i)) })).toContain('docente_ids');
    expect(await errores({ ...valido, tema_id: 'no-es-uuid' })).toContain('tema_id');
    expect(await errores({ ...valido, motivo: '   ' })).toContain('motivo');
    expect(await errores({ ...valido, nombre_grupo: 'x'.repeat(121) })).toContain('nombre_grupo');
  });
});
