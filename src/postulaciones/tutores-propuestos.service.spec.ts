import { TutoresPropuestosService } from './tutores-propuestos.service.js';
import { UsuarioEstado } from '../usuarios/enums/usuario-estado.enum.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';

describe('TutoresPropuestosService.porPostulaciones', () => {
  const docente = (id: string) => ({ id, titulo_academico: 'MSc', departamento: 'TI', habilitado_tutoria: true, usuario: { nombres: `N${id}`, apellidos: `A${id}`, estado: UsuarioEstado.ACTIVO, rol: UsuarioRol.DOCENTE } });

  it('carga los tutores de toda la página en una consulta y los agrupa por postulación', async () => {
    const records = [
      { id: 'tp1', postulacion: { id: 'p1' }, docente: docente('d1'), orden_prioridad: 1 },
      { id: 'tp2', postulacion: { id: 'p1' }, docente: docente('d2'), orden_prioridad: 2 },
      { id: 'tp3', postulacion: { id: 'p2' }, docente: docente('d2'), orden_prioridad: 1 },
    ];
    const repository = { find: vi.fn(async () => records) };
    const service = new TutoresPropuestosService(repository as never, {} as never, {} as never, {} as never);

    const result = await service.porPostulaciones([{ id: 'p1', proponenteId: 'd2' }, { id: 'p2', proponenteId: null }, { id: 'p3', proponenteId: null }]);

    expect(repository.find).toHaveBeenCalledTimes(1);
    expect(result.get('p1')?.map((t) => [t.docente_id, t.orden_prioridad, t.es_proponente_tema])).toEqual([['d1', 1, false], ['d2', 2, true]]);
    expect(result.get('p2')).toEqual([expect.objectContaining({ postulacion_id: 'p2', docente: expect.objectContaining({ nombres: 'Nd2' }), elegible_actualmente: true })]);
    expect(result.get('p3')).toEqual([]);
  });

  it('no consulta sin postulaciones', async () => {
    const repository = { find: vi.fn() };
    const service = new TutoresPropuestosService(repository as never, {} as never, {} as never, {} as never);
    await expect(service.porPostulaciones([])).resolves.toEqual(new Map());
    expect(repository.find).not.toHaveBeenCalled();
  });
});
