import { cumplePoliticaClave, type DatosPersonalesClave } from './password-policy.validator.js';

const ESTUDIANTE: DatosPersonalesClave = {
  email: 'e1300000001@live.uleam.edu.ec',
  nombres: 'Ana María',
  apellidos: 'López Cedeño',
  identificadores: ['1300000001', 'MAT-2026-0042'],
};
const DOCENTE: DatosPersonalesClave = { email: 'carla.mendoza@uleam.edu.ec', nombres: 'Carla', apellidos: 'Mendoza Vera', identificadores: [null] };

describe('cumplePoliticaClave', () => {
  it.each([
    ['contiene la cédula', ESTUDIANTE, '1300000001-Clave!'],
    ['es la parte local del correo', ESTUDIANTE, 'e1300000001'],
    ['contiene la parte local del correo', DOCENTE, 'carla.mendoza-Segura-9'],
    ['contiene la matrícula sin separadores', ESTUDIANTE, 'xx-mat20260042-yy'],
    ['combina nombres y apellidos', ESTUDIANTE, 'AnaMaríaLópezCedeño'],
    ['combina apellidos y nombres con separadores', DOCENTE, 'Mendoza.Vera.Carla'],
    ['repite un único carácter', DOCENTE, 'aaaaaaaaaaaaa'],
    ['es una secuencia ascendente', DOCENTE, 'abcdefghijklm'],
    ['es una secuencia descendente de dígitos', DOCENTE, '9876543210'],
    ['es una contraseña común', DOCENTE, 'Contraseña123'],
    ['es una contraseña común con símbolos', DOCENTE, 'Pass-word-1234'],
  ])('rechaza una contraseña que %s', (_caso, datos, password) => {
    expect(cumplePoliticaClave(password, datos)).toBe(false);
  });

  it.each([
    ['una frase larga sin datos personales', ESTUDIANTE, 'Marea-Volcan-Zafiro-41'],
    ['un nombre acompañado de otras palabras', ESTUDIANTE, 'Ana-camina-al-faro-2026'],
    ['dígitos que no forman una secuencia', DOCENTE, '1357924680-xq'],
    ['una cuenta sin perfil ni identificadores', { email: 'admin.dev@uleam.edu.ec' }, 'Titulacion-Dev-2026!'],
  ])('acepta %s', (_caso, datos, password) => {
    expect(cumplePoliticaClave(password, datos)).toBe(true);
  });

  it('no rechaza por un dato personal demasiado corto contenido en la contraseña', () => {
    expect(cumplePoliticaClave('Barco-ana-luz-de-mar', { email: 'ana@uleam.edu.ec' })).toBe(true);
    expect(cumplePoliticaClave('ana', { email: 'ana@uleam.edu.ec' })).toBe(false);
  });
});
