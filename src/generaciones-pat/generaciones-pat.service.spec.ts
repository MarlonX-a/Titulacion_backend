import { GeneracionesPatService } from './generaciones-pat.service.js';

describe('GeneracionesPatService', () => {
  const service = Object.create(GeneracionesPatService.prototype) as GeneracionesPatService;

  it('exige una respuesta explícita para contacto y certificado no aplicables', () => {
    const pending = service['pendingPersonal']({});
    expect(pending).toContain('fecha_nacimiento');
    expect(pending).toContain('correo_personal o correo_personal_no_aplica');
    expect(pending).toContain('telefono_convencional o telefono_convencional_no_aplica');
    expect(pending).toContain('certificado_votacion o certificado_votacion_no_aplica');
  });

  it('solicita categorías y grado cuando se declara discapacidad', () => {
    const pending = service['pendingPersonal']({ tiene_discapacidad: true, discapacidades: ['VISUAL'] });
    expect(pending).toContain('grado_discapacidad');
    expect(pending).not.toContain('discapacidades');
  });

  it('genera un PDF con firma vacía y conserva la identificación del trabajo', async () => {
    const buffer = await service['render']({
      periodo_nombre: 'Período de prueba', periodo_codigo: 'PAT-TEST', extension: 'Extensión Manta',
      facultad: 'Facultad de Ciencias', carrera: 'Sistemas', nombres: 'José', apellidos: 'Peña', cedula: '0000000000',
      email: 'estudiante@live.uleam.edu.ec', titulo: 'Sistema de prueba', descripcion: 'Descripción larga', nivel: 6,
      personal: { fecha_nacimiento: '2002-05-18', curso: 'Sexto', paralelo: 'A', sexo: 'Femenino', nacionalidad: 'Ecuatoriana', estado_civil: 'Soltera', provincia: 'Manabí', canton: 'Manta', parroquia: 'Manta', correo_personal_no_aplica: true, telefono_convencional_no_aplica: true, certificado_votacion_no_aplica: true, celular: '0990000000', tiene_discapacidad: false },
      contenido: { modalidad_academica: 'TRABAJO_INTEGRACION_CURRICULAR', problematica: 'Descripción de la problemática con acentos: investigación, vinculación y docencia. '.repeat(180), articulaciones: ['INVESTIGACION'] },
      participantes: [{ nombres: 'José', apellidos: 'Peña', matricula: '0000123' }], tutor: { nombres: 'Ana', apellidos: 'Docente' },
    });
    expect(buffer.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buffer.length).toBeGreaterThan(1500);
    expect((buffer.toString('latin1').match(/\/Type\s*\/Page\b/g) ?? []).length).toBeGreaterThan(1);
  });

  it('rechaza una fecha de nacimiento imposible o futura', () => {
    expect(() => service['validatePersonal']({ fecha_nacimiento: '2001-02-30' }, false)).toThrow();
    expect(() => service['validatePersonal']({ fecha_nacimiento: '2999-01-01' }, false)).toThrow();
  });
});
