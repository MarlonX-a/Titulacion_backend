import { NotFoundException } from '@nestjs/common';
import { DocumentosPatService } from './documentos-pat.service.js';
import { DocumentoPatFormato } from './enums/documento-pat-formato.enum.js';
import { EstadoUltimaPat } from './dto/ultimas-pat-periodo.dto.js';

describe('DocumentosPatService.ultimasDelPeriodo', () => {
  const rows = [
    { asignacion_tema_id: 'a1', tema_id: 't1', tema_titulo: 'Tema 1', grupo_id: null, grupo_nombre: null, documento_id: 'd1', estado: 'PENDIENTE', participantes: [{ id: 'e1', nombres: 'Ana', apellidos: 'Pérez', matricula: 'M1' }] },
    { asignacion_tema_id: 'a2', tema_id: 't2', tema_titulo: 'Tema 2', grupo_id: 'g1', grupo_nombre: 'Equipo', documento_id: null, estado: 'SIN_ENTREGA', participantes: [] },
  ];
  const document = {
    id: 'd1', asignacion_tema_id: 'a1', plantilla_id: 'p1', version: 2, nombre_archivo: 'pat.pdf', formato: DocumentoPatFormato.PDF,
    tamano_bytes: '10', hash_sha256: 'a'.repeat(64), fecha_carga: new Date('2026-10-01T00:00:00Z'), revision: null,
    plantilla: { id: 'p1', version: 'v1', nombre_archivo: 'plantilla.pdf' }, cargado_por: { id: 'u1', nombres: 'Ana', apellidos: 'Pérez' },
  };

  function setup(periodExists = true) {
    const query = vi.fn(async (sql: string, _params?: unknown[]) => (sql.includes('"periodo_titulacion" WHERE "id"=$1') ? (periodExists ? [{}] : []) : rows));
    const repository = { find: vi.fn(async () => [document]) };
    const service = new DocumentosPatService(repository as never, { options: { schema: 'titulacion_dev' }, query } as never, {} as never, {} as never, {} as never, {} as never);
    return { service, query, repository };
  }

  it('devuelve la última versión y su revisión por asignación vigente con dos consultas de datos', async () => {
    const { service, query, repository } = setup();
    const page = await service.ultimasDelPeriodo('periodo-id', { page: 1, limit: 20, estado: EstadoUltimaPat.PENDIENTE });
    expect(page.total).toBe(2);
    expect(page.data[0]).toMatchObject({ asignacion_tema_id: 'a1', tema: { id: 't1', titulo: 'Tema 1' }, estado: 'PENDIENTE', documento: { id: 'd1', version: 2, revision: 'PENDIENTE', tamano_bytes: 10 } });
    expect(page.data[1]).toMatchObject({ asignacion_tema_id: 'a2', grupo: { id: 'g1', nombre: 'Equipo' }, estado: 'SIN_ENTREGA', documento: null });
    expect(query.mock.calls[1][1]).toEqual(['periodo-id', 'PENDIENTE']);
    expect(query.mock.calls[1][0]).toContain('a."estado"=\'VIGENTE\'');
    expect(repository.find).toHaveBeenCalledTimes(1);
  });

  it('responde 404 si el período no existe', async () => {
    const { service } = setup(false);
    await expect(service.ultimasDelPeriodo('periodo-id', { page: 1, limit: 20 })).rejects.toBeInstanceOf(NotFoundException);
  });
});
