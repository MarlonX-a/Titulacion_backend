import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import {
  CARRERA_SOFTWARE_ID, DOCENTE_ALMEIDA_ID, DOCENTE_PEREZ_LOOR_ID, DOCENTE_PEREZ_VERA_ID, LINEA_ID, temasImportHarness,
} from '../../test/support/importaciones-temas-harness.js';
import { temasWorkbook } from '../../test/support/temas-workbook.js';
import { EstadoTema } from '../temas/enums/estado-tema.enum.js';
import { TipoTema } from '../temas/enums/tipo-tema.enum.js';
import { LoteImportacionEstado } from './enums/lote-importacion-estado.enum.js';
import { LoteImportacionTipo } from './enums/lote-importacion-tipo.enum.js';
import { PreparacionImportacionEstado as Estado } from './enums/preparacion-importacion-estado.enum.js';

const dto = { carrera_id: CARRERA_SOFTWARE_ID, linea_id: LINEA_ID, tipo: TipoTema.GRUPO };

async function preparar() {
  const harness = temasImportHarness({ titulosExistentes: ['Tema Existente'] });
  const libro = await temasWorkbook([
    [1, 'ING. ALMEIDA EDISON', 'Tema A', 'SOFTWARE', 'Observación A'],
    [2, 'PÉREZ', 'Tema B', 'INGENIERÍA EN SOFTWARE', null],
    [3, 'RODRÍGUEZ ANA', 'Tema C', 'MEDICINA', null],
    [4, 'ALMEIDA EDISON', 'tema a', null, null],
    [5, 'ALMEIDA EDISON', 'Tema existente', null, null],
  ]);
  const preview = await harness.service.validar(harness.admin, 'temas.xlsx', libro, '127.0.0.1', dto);
  return { harness, preview };
}

describe('ImportacionesTemasService', () => {
  it('genera la vista previa con docentes vinculados, pendientes y duplicados', async () => {
    const { harness, preview } = await preparar();
    expect(preview).toMatchObject({ tipo: LoteImportacionTipo.TEMAS, estado: Estado.LISTA, carrera_id: CARRERA_SOFTWARE_ID, linea_id: LINEA_ID, tipo_tema: TipoTema.GRUPO, total_filas: 5, listas: 1, pendientes: 2, duplicadas: 2, con_errores: 0, puede_confirmar: false });
    expect(preview.filas.map((fila) => fila.estado)).toEqual(['LISTA', 'PENDIENTE_DOCENTE', 'PENDIENTE_DOCENTE', 'DUPLICADA', 'DUPLICADA']);
    expect(preview.filas[0]!.docente?.id).toBe(DOCENTE_ALMEIDA_ID);
    expect(preview.filas[1]!.candidatos.map((c) => c.id)).toEqual([DOCENTE_PEREZ_LOOR_ID, DOCENTE_PEREZ_VERA_ID]);
    expect(preview.filas[2]!.candidatos).toEqual([]);
    expect(preview.filas[2]!.advertencias[0]).toContain('no coincide con la seleccionada');
    expect(preview.filas[4]!.advertencias).toContain('El tema ya existe en el banco de la carrera; se omitirá.');
    expect(harness.storage.savePrivate).toHaveBeenCalledOnce();
    expect(harness.repos.preparaciones.rows[0]).toMatchObject({ tipo: LoteImportacionTipo.TEMAS, periodo: null, carrera_id: CARRERA_SOFTWARE_ID });
  });

  it('bloquea la confirmación mientras haya docentes pendientes', async () => {
    const { harness, preview } = await preparar();
    await expect(harness.service.confirmar(preview.id, harness.admin, null)).rejects.toBeInstanceOf(ConflictException);
    expect(harness.repos.lotes.rows).toHaveLength(0);
  });

  it('rechaza resoluciones para nombres inexistentes o docentes de fuera de la carrera', async () => {
    const { harness, preview } = await preparar();
    await expect(harness.service.resolverDocentes(preview.id, { resoluciones: [{ nombre_excel: 'NADIE', docente_id: DOCENTE_PEREZ_LOOR_ID }] }, harness.admin, null)).rejects.toBeInstanceOf(BadRequestException);
    await expect(harness.service.resolverDocentes(preview.id, { resoluciones: [{ nombre_excel: 'PÉREZ', docente_id: '00000000-0000-4000-8000-000000000099' }] }, harness.admin, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resuelve docentes por nombre del Excel y crea los temas PUBLICADOS omitiendo duplicados', async () => {
    const { harness, preview } = await preparar();
    const resuelta = await harness.service.resolverDocentes(preview.id, { resoluciones: [
      { nombre_excel: 'perez', docente_id: DOCENTE_PEREZ_LOOR_ID },
      { nombre_excel: 'RODRÍGUEZ ANA', docente_id: DOCENTE_PEREZ_VERA_ID },
    ] }, harness.admin, null);
    expect(resuelta).toMatchObject({ pendientes: 0, listas: 3, puede_confirmar: true });

    const resultado = await harness.service.confirmar(preview.id, harness.admin, '127.0.0.1');
    expect(resultado).toMatchObject({ estado: Estado.COMPLETADA, creados: 3, omitidos: 2 });
    const creados = harness.repos.temas.rows.filter((row) => row.lote_importacion_id === resultado.lote_id);
    expect(creados.map((row) => [row.titulo, row.estado, row.tipo, row.descripcion])).toEqual([
      ['Tema A', EstadoTema.PUBLICADO, TipoTema.GRUPO, 'Observación A'],
      ['Tema B', EstadoTema.PUBLICADO, TipoTema.GRUPO, 'Tema B'],
      ['Tema C', EstadoTema.PUBLICADO, TipoTema.GRUPO, 'Tema C'],
    ]);
    expect(harness.repos.historial.rows).toHaveLength(3);
    expect(harness.repos.lotes.rows[0]).toMatchObject({ tipo: LoteImportacionTipo.TEMAS, periodo: null, estado: LoteImportacionEstado.COMPLETADO_CON_ERRORES, total_filas: 5, filas_ok: 3, filas_error: 2 });
    await expect(harness.service.confirmar(preview.id, harness.admin, null)).rejects.toThrow('La importación ya fue completada.');
  });

  it('responde 404 para una preparación inexistente', async () => {
    const harness = temasImportHarness();
    await expect(harness.service.get('00000000-0000-4000-8000-000000000000')).rejects.toBeInstanceOf(NotFoundException);
  });
});
