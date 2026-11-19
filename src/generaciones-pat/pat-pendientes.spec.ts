import {
  calcularPendientesPat, contenidoEfectivo, cursoDesdeNivel, MODALIDAD_ACADEMICA_PREDETERMINADA, pendientesContenido, pendientesPersonales, resolverTutorPat,
  type TutorPropuestoPat,
} from './pat-pendientes.js';

const personalCompleto = {
  fecha_nacimiento: '2002-05-18', paralelo: 'A', sexo: 'Femenino', nacionalidad: 'Ecuatoriana', estado_civil: 'Soltera', provincia: 'Manabí',
  canton: 'Manta', parroquia: 'Manta', celular: '0990000000', tiene_discapacidad: false, correo_personal_no_aplica: true,
  telefono_convencional_no_aplica: true, certificado_votacion: 'CV-123',
};
const sugerencias = { problematica: 'Descripción del tema', articulaciones: ['INVESTIGACION'] };
const propuesta = (id: string, docente: string): TutorPropuestoPat => ({ id, orden_prioridad: 1, docente_id: docente, nombres: `N-${docente}`, apellidos: 'Docente', elegible_actualmente: true, es_proponente_tema: false });

describe('pendientes del PAT', () => {
  it('lista los campos personales vacíos en orden estable y con claves simples', () => {
    expect(pendientesPersonales({})).toEqual([
      'fecha_nacimiento', 'paralelo', 'sexo', 'nacionalidad', 'estado_civil', 'provincia', 'canton', 'parroquia', 'celular',
      'tiene_discapacidad', 'correo_personal', 'telefono_convencional', 'certificado_votacion',
    ]);
  });

  it('ya no exige curso (se deriva del nivel) y acepta los "no aplica"', () => {
    expect(pendientesPersonales(personalCompleto)).toEqual([]);
    expect(pendientesPersonales({ ...personalCompleto, correo_personal_no_aplica: false })).toEqual(['correo_personal']);
    expect(pendientesPersonales({ ...personalCompleto, paralelo: '   ' })).toEqual(['paralelo']);
  });

  it('exige categoría, grado y detalle de OTRA cuando se declara discapacidad', () => {
    expect(pendientesPersonales({ ...personalCompleto, tiene_discapacidad: true })).toEqual(['discapacidades', 'grado_discapacidad']);
    expect(pendientesPersonales({ ...personalCompleto, tiene_discapacidad: true, discapacidades: ['OTRA'], grado_discapacidad: '40%' })).toEqual(['otra_discapacidad']);
  });

  it('el contenido efectivo usa la descripción del tema y las articulaciones sugeridas como predeterminados', () => {
    const efectivo = contenidoEfectivo({}, sugerencias);
    expect(efectivo).toEqual({ problematica: 'Descripción del tema', problematica_personalizada: false, confirma_problematica: false, articulaciones: ['INVESTIGACION'], modalidad_academica: MODALIDAD_ACADEMICA_PREDETERMINADA, tutor_propuesto_id: null });
    expect(pendientesContenido(efectivo)).toEqual(['confirma_problematica']);
  });

  it('respeta lo que guardó el estudiante y detecta articulaciones excluyentes o vacías', () => {
    const guardado = contenidoEfectivo({ problematica: 'Propia', confirma_problematica: true, articulaciones: ['NINGUNA', 'DOCENCIA'], tutor_propuesto_id: 'tp-2' }, sugerencias);
    expect(guardado).toMatchObject({ problematica: 'Propia', problematica_personalizada: true, tutor_propuesto_id: 'tp-2' });
    expect(pendientesContenido(guardado)).toEqual(['articulaciones_excluyentes']);
    expect(pendientesContenido(contenidoEfectivo({ articulaciones: [], confirma_problematica: true }, { problematica: '', articulaciones: [] }))).toEqual(['problematica', 'articulaciones']);
  });

  it('calcularPendientesPat compone personales, contenido, tutor y extensión', () => {
    const contenido = contenidoEfectivo({ confirma_problematica: true }, sugerencias);
    expect(calcularPendientesPat({ personal: personalCompleto, contenido, tutorResuelto: true, extensionPat: 'Manta' })).toEqual([]);
    expect(calcularPendientesPat({ personal: {}, contenido, tutorResuelto: false, extensionPat: ' ' }).slice(-2)).toEqual(['tutor_propuesto_id', 'extension_pat']);
  });
});

describe('autocompletado del PAT', () => {
  it('deriva el curso del nivel', () => {
    expect(cursoDesdeNivel(1)).toBe('Primero');
    expect(cursoDesdeNivel(8)).toBe('Octavo');
    expect(cursoDesdeNivel(12)).toBe('12.º');
    expect(cursoDesdeNivel(0)).toBeNull();
  });

  it('prefiere el tutor vigente, luego la elección guardada y luego la primera propuesta', () => {
    const propuestas = [propuesta('tp-1', 'd-1'), propuesta('tp-2', 'd-2')];
    expect(resolverTutorPat({ docente_id: 'd-9', nombres: 'Vigente', apellidos: 'X' }, propuestas, 'tp-2')).toEqual({ valor: { docente_id: 'd-9', nombres: 'Vigente', apellidos: 'X', tutor_propuesto_id: null }, fuente: 'ASIGNACION_TUTOR' });
    expect(resolverTutorPat(null, propuestas, 'tp-2')).toMatchObject({ valor: { docente_id: 'd-2', tutor_propuesto_id: 'tp-2' }, fuente: 'TUTOR_PROPUESTO_ELEGIDO' });
    expect(resolverTutorPat(null, propuestas, 'no-existe')).toMatchObject({ valor: { tutor_propuesto_id: 'tp-1' }, fuente: 'TUTOR_PROPUESTO_PREDETERMINADO' });
    expect(resolverTutorPat(null, [], null)).toEqual({ valor: null, fuente: 'SIN_TUTOR' });
  });
});
