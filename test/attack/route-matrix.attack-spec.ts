import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { ModulesContainer, Reflector } from '@nestjs/core';
import request from 'supertest';
import { AuthenticationGuard } from '../../src/auth/authentication.guard.js';
import type { AuthenticationService } from '../../src/auth/authentication.service.js';
import type { UsuariosService } from '../../src/usuarios/usuarios.service.js';
import { validateEnvironment } from '../../src/config/environment.js';
import { PDF_MIME, pdfBenigno } from '../fixtures/attack/archivos-maliciosos.mjs';
import { crearCuenta, firmarToken, tokenDe, type Cuenta, type Rol } from './support/actors.js';
import { sembrarEscenarioMatriz, type EscenarioMatriz } from './support/escenario.js';
import { bootAttackApp, uuid, type AttackApp } from './support/harness.js';

// Claves de metadatos usadas por el guard global (cadenas, idénticas en src/ y dist/).
const IS_PUBLIC = 'isPublic';
const REQUIRED_ROLES = 'requiredRoles';
const ALLOW_FIRST_ACCESS = 'allow-first-access';
const ALLOW_UNREGISTERED = 'allowUnregisteredIdentity';
const METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'ALL', 'OPTIONS', 'HEAD'] as const;
const ROLES: Rol[] = ['ADMIN', 'DOCENTE', 'ESTUDIANTE'];

/**
 * Rutas autenticadas sin @Roles aprobadas explícitamente (cualquier rol activo puede usarlas).
 * Una ruta nueva sin @Roles hace fallar la prueba hasta que se revise y se añada aquí.
 */
const RUTAS_SIN_ROLES_APROBADAS: string[] = [
  'POST /auth/change-initial-password',
  'POST /auth/change-password',
  'GET /auth/me',
  'GET /notificaciones',
  'GET /notificaciones/:id',
  'POST /notificaciones/:id/leer',
  'POST /notificaciones/leer-todas',
  'GET /notificaciones/no-leidas/contador',
  'GET /usuarios/me',
];

/**
 * Rutas públicas aprobadas. `GET /healthz` es la única adición deliberada del paquete S5/S7
 * (comprobación de salud del contenedor, cuerpo constante). Una ruta pública nueva hace fallar la
 * prueba hasta que se revise y se añada aquí.
 */
const RUTAS_PUBLICAS_APROBADAS: string[] = [
  'GET /',
  'GET /auth/csrf',
  'GET /healthz',
  'POST /auth/forgot-password',
  'POST /auth/login',
  'POST /auth/logout',
  'POST /auth/refresh',
  'POST /auth/reset-password',
];

interface Ruta {
  method: (typeof METHODS)[number];
  path: string;
  roles?: string[];
  isPublic: boolean;
  firstAccess: boolean;
  allowUnregistered: boolean;
}

function meta<T>(key: string, handler: object, controller: object): T | undefined {
  return (Reflect.getMetadata(key, handler) as T | undefined) ?? (Reflect.getMetadata(key, controller) as T | undefined);
}

/** Matriz de rutas generada a partir de los metadatos reales de Nest. */
function descubrirRutas(attack: AttackApp): Ruta[] {
  const rutas: Ruta[] = [];
  for (const module of attack.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as (new (...args: never[]) => unknown) | null;
      if (!controller) continue;
      const base = ([] as string[]).concat(Reflect.getMetadata(PATH_METADATA, controller) as string | string[] ?? '');
      const proto = controller.prototype as Record<string, unknown>;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (name === 'constructor' || typeof handler !== 'function') continue;
        const paths = Reflect.getMetadata(PATH_METADATA, handler) as string | string[] | undefined;
        const method = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        if (paths === undefined || method === undefined) continue;
        for (const prefix of base) {
          for (const sub of ([] as string[]).concat(paths)) {
            const path = `/${[prefix, sub].map((part) => part.replace(/^\/+|\/+$/g, '')).filter(Boolean).join('/')}`;
            rutas.push({
              method: METHODS[method]!, path,
              roles: meta<string[]>(REQUIRED_ROLES, handler, controller),
              isPublic: meta<boolean>(IS_PUBLIC, handler, controller) === true,
              firstAccess: meta<boolean>(ALLOW_FIRST_ACCESS, handler, controller) === true,
              allowUnregistered: meta<boolean>(ALLOW_UNREGISTERED, handler, controller) === true,
            });
          }
        }
      }
    }
  }
  return rutas.sort((a, b) => `${a.path} ${a.method}`.localeCompare(`${b.path} ${b.method}`));
}

const concreta = (path: string) => path.replace(/:[A-Za-z_]+/g, () => uuid());
const etiqueta = (ruta: Ruta) => `${ruta.method} ${ruta.path}`;

describe('Matriz BOLA/BFLA generada desde las rutas (ataque)', () => {
  let attack: AttackApp;
  let rutas: Ruta[];
  const tokens = new Map<Rol, string>();
  let firstAccessToken: string;

  const send = (ruta: Ruta, token?: string) => {
    const agent = request(attack.baseUrl);
    const path = concreta(ruta.path);
    const call = ruta.method === 'GET' ? agent.get(path) : ruta.method === 'PATCH' ? agent.patch(path)
      : ruta.method === 'DELETE' ? agent.delete(path) : ruta.method === 'PUT' ? agent.put(path) : agent.post(path);
    return (token ? call.set('Authorization', `Bearer ${token}`) : call).send({});
  };

  beforeAll(async () => {
    attack = await bootAttackApp();
    rutas = descubrirRutas(attack);
    for (const rol of ROLES) tokens.set(rol, await tokenDe(attack, await crearCuenta(attack, { rol })));
    const nueva = await crearCuenta(attack, { rol: 'ESTUDIANTE', requiereCambio: true });
    firstAccessToken = await firmarToken(attack, nueva.usuarioId, { typ: 'first_access' });
  });
  afterAll(async () => { await attack?.close(); });

  it('[matriz] se descubrieron las rutas de la aplicación', () => {
    expect(rutas.length).toBeGreaterThan(50);
    expect(rutas.some((ruta) => ruta.path === '/auth/login' && ruta.isPublic)).toBe(true);
  });

  it('[matriz] anónimo recibe 401 en toda ruta que no sea @Public', async () => {
    const fallos: string[] = [];
    for (const ruta of rutas.filter((item) => !item.isPublic)) {
      const response = await send(ruta);
      if (response.status !== 401) fallos.push(`${etiqueta(ruta)} -> ${response.status}`);
    }
    expect(fallos).toEqual([]);
  });

  it('[matriz] un rol no listado en @Roles recibe 403', async () => {
    const fallos: string[] = [];
    for (const ruta of rutas.filter((item) => !item.isPublic && item.roles?.length)) {
      for (const rol of ROLES.filter((item) => !ruta.roles!.includes(item))) {
        const response = await send(ruta, tokens.get(rol));
        if (response.status !== 403) fallos.push(`${etiqueta(ruta)} como ${rol} -> ${response.status}`);
      }
    }
    expect(fallos).toEqual([]);
  });

  it('[matriz] un token first_access recibe 403 salvo en la ruta de cambio inicial', async () => {
    const fallos: string[] = [];
    const permitidas = rutas.filter((ruta) => ruta.firstAccess).map(etiqueta);
    expect(permitidas).toEqual(['POST /auth/change-initial-password']);
    for (const ruta of rutas.filter((item) => !item.isPublic && !item.firstAccess)) {
      const response = await send(ruta, firstAccessToken);
      if (response.status !== 403) fallos.push(`${etiqueta(ruta)} -> ${response.status}`);
    }
    expect(fallos).toEqual([]);
  });

  it('[matriz] las rutas autenticadas sin @Roles coinciden con la lista aprobada', () => {
    const sinRoles = rutas.filter((ruta) => !ruta.isPublic && !ruta.roles?.length).map(etiqueta);
    expect(sinRoles).toEqual(RUTAS_SIN_ROLES_APROBADAS);
  });

  it('[matriz] las rutas públicas coinciden con la lista aprobada', () => {
    const publicas = rutas.filter((ruta) => ruta.isPublic).map(etiqueta).sort((x, y) => x.localeCompare(y));
    expect(publicas).toEqual([...RUTAS_PUBLICAS_APROBADAS].sort((x, y) => x.localeCompare(y)));
  });

  it('[M11] ninguna ruta declara @AllowUnregisteredIdentity', () => {
    expect(rutas.filter((ruta) => ruta.allowUnregistered).map(etiqueta)).toEqual([]);
  });

  it('[M11] el guard no honra el metadato allowUnregisteredIdentity', async () => {
    const handler = () => undefined;
    Reflect.defineMetadata(ALLOW_UNREGISTERED, true, handler);
    Reflect.defineMetadata(REQUIRED_ROLES, ['ADMIN'], handler);
    class Controlador {}
    const authentication = { verifyToken: () => Promise.resolve({ subject: uuid(), issuer: 'x', firstAccess: false }) } as unknown as AuthenticationService;
    const usuarios = {
      getActiveById: () => Promise.reject(new UnauthorizedException('Identidad no registrada.')),
      recordAccess: () => Promise.resolve(new Date()),
    } as unknown as UsuariosService;
    const guard = new AuthenticationGuard(new Reflector(), authentication, usuarios);
    const context = {
      getHandler: () => handler, getClass: () => Controlador,
      switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: 'Bearer token-valido' } }) }),
    } as unknown as ExecutionContext;
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('[M3] /docs y /docs-json responden 404 con la configuración por defecto', async () => {
    expect((await request(attack.baseUrl).get('/docs')).status).toBe(404);
    expect((await request(attack.baseUrl).get('/docs-json')).status).toBe(404);
  });

  it('[M3] SWAGGER_ENABLED queda desactivado si no se define explícitamente', () => {
    const env = validateEnvironment({ NODE_ENV: 'development', DB_USERNAME: 'u', DB_PASSWORD: 'p', DB_NAME: 'd' });
    expect(env.SWAGGER_ENABLED).toBe(false);
  });

  describe('autorización por objeto con identificadores reales del dueño', () => {
    let e: EscenarioMatriz;
    let actores: Array<[string, Cuenta]>;
    const tokensObjeto = new Map<string, string>();
    const tokenObjeto = async (cuenta: Cuenta) => {
      if (!tokensObjeto.has(cuenta.usuarioId)) tokensObjeto.set(cuenta.usuarioId, await tokenDe(attack, cuenta));
      return tokensObjeto.get(cuenta.usuarioId)!;
    };
    /** Rutas con parámetros de ruta no exclusivas de ADMIN: las que esta matriz debe cubrir. */
    const rutasObjeto = () => rutas.filter((ruta) => !ruta.isPublic && ruta.path.includes(':') && !(ruta.roles?.length === 1 && ruta.roles[0] === 'ADMIN'));
    const resolver = (ruta: Ruta) => {
      const caso = RUTAS_OBJETO[etiqueta(ruta)]!;
      const path = ruta.path.replace(/:([A-Za-z_]+)/g, (_match, param: string) => caso.params[param]!(e));
      return caso.query ? `${path}?${caso.query(e)}` : path;
    };
    const llamar = async (ruta: Ruta, cuenta: Cuenta) => {
      const caso = RUTAS_OBJETO[etiqueta(ruta)]!;
      const agent = request(attack.baseUrl);
      const path = resolver(ruta);
      const call = (ruta.method === 'GET' ? agent.get(path) : ruta.method === 'PATCH' ? agent.patch(path) : agent.post(path)).set('Authorization', `Bearer ${await tokenObjeto(cuenta)}`);
      const body = caso.body?.(e);
      if (body === 'pdf') return call.field('plantilla_id', e.plantilla).attach('archivo', pdfBenigno(), { filename: 'pat.pdf', contentType: PDF_MIME });
      return ruta.method === 'GET' ? call : call.send(body ?? {});
    };
    /** Identificadores del dueño que nunca deben aparecer en respuestas de otros actores. */
    const idsDelDueno = () => [e.asignacionGrupal, e.asignacionTutor, e.documentoGrupal, e.grupoAsignado, e.grupoPropioAbierto, e.invitacionPropia, e.notificacionPropia, e.postulacionGrupalCerrada, e.postulacionSinTutores];
    const extracto = (response: request.Response) => JSON.stringify(response.body ?? response.text).slice(0, 200);

    beforeAll(async () => {
      e = await sembrarEscenarioMatriz(attack);
      actores = [['estudiante de otro grupo', e.otroGrupo], ['ex-integrante', e.exIntegrante], ['ESTUDIANTE sin perfil', e.sinPerfil], ['docente no relacionado', e.docenteAjeno]];
    });

    it('[matriz-objetos] toda ruta con parámetros no exclusiva de ADMIN tiene mapeo explícito o una exclusión justificada', () => {
      const fallos: string[] = [];
      const presentes = new Set(rutasObjeto().map(etiqueta));
      for (const ruta of rutasObjeto()) {
        const clave = etiqueta(ruta);
        if (RUTAS_NO_CUBIERTAS[clave]) continue;
        const caso = RUTAS_OBJETO[clave];
        if (!caso) { fallos.push(`${clave}: sin mapeo. Añade una entrada a RUTAS_OBJETO (parámetro -> identificador del escenario) o, si no puede probarse sin efectos, a RUTAS_NO_CUBIERTAS con el motivo.`); continue; }
        for (const [, param] of ruta.path.matchAll(/:([A-Za-z_]+)/g)) {
          if (!caso.params[param!]) fallos.push(`${clave}: falta el identificador del parámetro :${param} en RUTAS_OBJETO.`);
        }
      }
      for (const clave of [...Object.keys(RUTAS_OBJETO), ...Object.keys(RUTAS_NO_CUBIERTAS)]) {
        if (!presentes.has(clave)) fallos.push(`${clave}: la entrada ya no corresponde a ninguna ruta no exclusiva de ADMIN; elimínala.`);
      }
      expect(fallos).toEqual([]);
    });

    it('[matriz-objetos] control positivo: el dueño obtiene 2xx en las rutas de lectura con sus identificadores', async () => {
      await attack.flushLimiter();
      const fallos: string[] = [];
      let comprobadas = 0;
      for (const ruta of rutasObjeto().filter((item) => RUTAS_OBJETO[etiqueta(item)]?.lectura && (!item.roles?.length || item.roles.includes('ESTUDIANTE')))) {
        const response = await llamar(ruta, e.estA);
        comprobadas += 1;
        if (response.status < 200 || response.status >= 300) fallos.push(`${etiqueta(ruta)} -> ${response.status} ${extracto(response)}`);
      }
      console.info(`[matriz-objetos] control positivo del dueño: ${comprobadas} rutas de lectura`);
      expect(comprobadas).toBeGreaterThan(15);
      expect(fallos).toEqual([]);
    });

    it('[matriz-objetos] ningún actor ajeno obtiene 2xx con los identificadores del dueño', async () => {
      await attack.flushLimiter();
      const huecos: string[] = [];
      const inconclusos: string[] = [];
      const fugas: string[] = [];
      const cubiertas = new Map<string, number>();
      const estados = new Map<number, number>();
      // Lecturas primero y, entre las mutaciones, `disolver` al final: si alguna prosperara, no altera los casos restantes.
      const orden = (ruta: Ruta) => (RUTAS_OBJETO[etiqueta(ruta)]!.lectura ? 0 : ruta.path.endsWith('/disolver') ? 2 : 1);
      const casos = rutasObjeto().filter((ruta) => RUTAS_OBJETO[etiqueta(ruta)]).sort((a, b) => orden(a) - orden(b));
      for (const ruta of casos) {
        const caso = RUTAS_OBJETO[etiqueta(ruta)]!;
        for (const [actor, cuenta] of actores) {
          const response = await llamar(ruta, cuenta);
          const linea = `${etiqueta(ruta)} como ${actor} -> ${response.status} ${extracto(response)}`;
          if (response.status >= 200 && response.status < 300) {
            if (!caso.permitida) {
              if (!HUECOS_CONOCIDOS.includes(`${etiqueta(ruta)} | ${actor}`)) huecos.push(linea);
              continue;
            }
            const texto = JSON.stringify(response.body);
            const filtrados = idsDelDueno().filter((id) => texto.includes(id));
            if (filtrados.length) fugas.push(`${linea} expone ${filtrados.join(', ')}`);
          } else if (response.status === 400 || response.status === 401 || response.status === 429 || response.status >= 500) {
            // 400: el rechazo vino de la validación, no de la autorización; 401/429/5xx tampoco prueban nada.
            inconclusos.push(linea);
            continue;
          }
          cubiertas.set(actor, (cubiertas.get(actor) ?? 0) + 1);
          estados.set(response.status, (estados.get(response.status) ?? 0) + 1);
          // Un 409 no es 2xx, pero puede venir de una regla de estado evaluada antes que la pertenencia.
          if (response.status === 409) console.info(`[matriz-objetos] 409 (rechazo por estado, no prueba la autorización): ${linea}`);
        }
      }
      console.info(`[matriz-objetos] estados de los casos concluyentes: ${JSON.stringify(Object.fromEntries(estados))}`);
      console.info(`[matriz-objetos] rutas con parámetros no exclusivas de ADMIN: ${rutasObjeto().length}; mapeadas: ${casos.length}; no cubiertas: ${Object.keys(RUTAS_NO_CUBIERTAS).length}; permitidas: ${Object.values(RUTAS_OBJETO).filter((c) => c.permitida).length}`);
      console.info(`[matriz-objetos] casos concluyentes por actor: ${JSON.stringify(Object.fromEntries(cubiertas))}`);
      expect(huecos, 'respuestas 2xx no autorizadas').toEqual([]);
      expect(fugas, 'rutas permitidas que devuelven identificadores del dueño').toEqual([]);
      expect(inconclusos, 'casos inconclusos: ajusta el cuerpo para que decida la autorización').toEqual([]);
    });

    // FALLO-ESPERADO(matriz-objetos): un caso por hueco conocido. Vitest lo reporta como fallo esperado y
    // pasa a rojo cuando el hueco se corrige; entonces se elimina de HUECOS_CONOCIDOS y de aquí.
    for (const hueco of HUECOS_CONOCIDOS) {
      it.fails(`[FALLO-ESPERADO matriz-objetos] ${hueco} no debe responder 2xx`, async () => {
        const [clave, actor] = hueco.split(' | ') as [string, string];
        const ruta = rutasObjeto().find((item) => etiqueta(item) === clave)!;
        const cuenta = actores.find(([nombre]) => nombre === actor)![1];
        const response = await llamar(ruta, cuenta);
        expect(response.status >= 200 && response.status < 300, `${hueco} -> ${response.status} ${extracto(response)}`).toBe(false);
      });
    }
  });
});

type Escenario = EscenarioMatriz;
interface CasoObjeto {
  /** Parámetro de ruta -> identificador real del escenario del dueño (estA). */
  params: Record<string, (e: Escenario) => string>;
  query?: (e: Escenario) => string;
  /** Cuerpo mínimo válido para que el 403/404 provenga de la autorización y no de la validación. */
  body?: (e: Escenario) => object | 'pdf';
  lectura: boolean;
  /** Lista permitida: legible por cualquier estudiante o docente autenticado; justificación de una línea. */
  permitida?: string;
}

const enCerrado = { periodoId: (e: Escenario) => e.periodoCerrado };
const enAbierto = { periodoId: (e: Escenario) => e.periodoAbierto };
/** Postulación individual PENDIENTE de estA, sin tutores, en período abierto: solo la pertenencia decide. */
const sinTutores = { periodoId: (e: Escenario) => e.periodoIndividual, id: (e: Escenario) => e.postulacionSinTutores };
const patGrupal = { ...enCerrado, asignacionId: (e: Escenario) => e.asignacionGrupal };
const propio = 'Datos del propio actor: el servicio filtra por su perfil y pertenencia ACTIVA, no por el identificador de la ruta (se comprueba que no devuelva identificadores del dueño).';

/**
 * Mapeo explícito (método y ruta) -> identificadores reales del dueño. Una ruta nueva con
 * parámetros y sin entrada aquí ni en RUTAS_NO_CUBIERTAS hace fallar la matriz.
 */
const RUTAS_OBJETO: Record<string, CasoObjeto> = {
  'GET /lineas-investigacion/:id': { params: { id: (e) => e.lineaTemaGrupal }, lectura: true, permitida: 'Catálogo de líneas activas: LineasInvestigacionService.getById solo filtra activa=true para no ADMIN; sin datos de estudiantes.' },
  'GET /notificaciones/:id': { params: { id: (e) => e.notificacionPropia }, lectura: true },
  'POST /notificaciones/:id/leer': { params: { id: (e) => e.notificacionPropia }, lectura: false },
  'GET /periodos/:id': { params: { id: (e) => e.periodoCerrado }, lectura: true, permitida: 'Calendario institucional: PeriodosService.getById no depende del actor y GET /periodos admite los tres roles; sin datos personales.' },
  'GET /periodos/:periodoId/asignaciones-tema': { params: enCerrado, lectura: true, permitida: 'AsignacionesTemaService.list filtra al docente proponente (docenteUser.id = actor); ESTUDIANTE recibe 403 por rol.' },
  'POST /periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat': { params: patGrupal, body: () => 'pdf', lectura: false },
  'GET /periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat': { params: patGrupal, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat/:documentoId/revision': { params: { ...patGrupal, documentoId: (e) => e.documentoGrupal }, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat/:id': { params: { ...patGrupal, id: (e) => e.documentoGrupal }, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat/:id/descarga': { params: { ...patGrupal, id: (e) => e.documentoGrupal }, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat/ultima': { params: patGrupal, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tema/:asignacionId/documentos-pat/ultima/descarga': { params: patGrupal, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tema/:id': { params: { ...enCerrado, id: (e) => e.asignacionGrupal }, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tema/me': { params: enCerrado, lectura: true, permitida: propio },
  'GET /periodos/:periodoId/asignaciones-tutor/:id': { params: { ...enCerrado, id: (e) => e.asignacionTutor }, lectura: true },
  'GET /periodos/:periodoId/asignaciones-tutor/me': { params: enCerrado, lectura: true, permitida: propio },
  'GET /periodos/:periodoId/carga-tutorial/me': { params: enCerrado, lectura: true, permitida: propio },
  'GET /periodos/:periodoId/config-carga-tutorial/efectiva/me': { params: enCerrado, lectura: true, permitida: propio },
  'POST /periodos/:periodoId/grupos/:grupoId/invitaciones': { params: { ...enAbierto, grupoId: (e) => e.grupoPropioAbierto }, body: (e) => ({ estudiante_destino_id: e.estLibre.estudianteId }), lectura: false },
  'GET /periodos/:periodoId/grupos/:grupoId/invitaciones': { params: { ...enAbierto, grupoId: (e) => e.grupoPropioAbierto }, lectura: true },
  'GET /periodos/:periodoId/grupos/:id': { params: { ...enCerrado, id: (e) => e.grupoAsignado }, lectura: true },
  'POST /periodos/:periodoId/grupos/:id/cambiar-representante': { params: { ...enAbierto, id: (e) => e.grupoPropioAbierto }, body: (e) => ({ estudiante_id: e.estB.estudianteId, motivo: 'Acuerdo entre los integrantes.' }), lectura: false },
  'POST /periodos/:periodoId/grupos/:id/disolver': { params: { ...enAbierto, id: (e) => e.grupoPropioAbierto }, body: () => ({ motivo: 'Reorganización del grupo.' }), lectura: false },
  'POST /periodos/:periodoId/grupos/:id/salir': { params: { ...enAbierto, id: (e) => e.grupoPropioAbierto }, body: () => ({ motivo: 'Salida voluntaria.' }), lectura: false },
  'GET /periodos/:periodoId/grupos/me': { params: enAbierto, lectura: true, permitida: propio },
  'GET /periodos/:periodoId/habilitados/candidatos-invitacion': { params: enAbierto, lectura: true, permitida: 'Candidatos a invitar del período: HabilitadosService.candidatosInvitacion exige que el actor esté habilitado (getMine) y lista solo habilitados sin grupo activo.' },
  'GET /periodos/:periodoId/habilitados/me': { params: enAbierto, lectura: true, permitida: propio },
  'POST /periodos/:periodoId/invitaciones/:id/aceptar': { params: { ...enAbierto, id: (e) => e.invitacionPropia }, lectura: false },
  'POST /periodos/:periodoId/invitaciones/:id/cancelar': { params: { ...enAbierto, id: (e) => e.invitacionPropia }, lectura: false },
  'POST /periodos/:periodoId/invitaciones/:id/rechazar': { params: { ...enAbierto, id: (e) => e.invitacionPropia }, lectura: false },
  'GET /periodos/:periodoId/invitaciones/me': { params: enAbierto, lectura: true, permitida: propio },
  'GET /periodos/:periodoId/plantillas-pat/vigente': { params: enCerrado, lectura: true, permitida: 'Plantilla PAT vigente del período, común a todos: authorizeDownload solo exige al ESTUDIANTE estar HABILITADO en el período.' },
  'GET /periodos/:periodoId/plantillas-pat/vigente/descarga': { params: enCerrado, lectura: true, permitida: 'Descarga de la plantilla PAT vigente del período, con la misma comprobación de habilitación.' },
  'GET /periodos/:periodoId/postulaciones': { params: enCerrado, lectura: true, permitida: 'PostulacionesService.list filtra a los temas del docente (teacherUser.id = actor); ESTUDIANTE recibe 403 por rol.' },
  'GET /periodos/:periodoId/postulaciones/:id': { params: { ...enCerrado, id: (e) => e.postulacionGrupalCerrada }, lectura: true },
  'POST /periodos/:periodoId/postulaciones/:id/cancelar': { params: sinTutores, body: () => ({ motivo: 'Cancelación de prueba.' }), lectura: false },
  'POST /periodos/:periodoId/postulaciones/:id/tutores-propuestos': { params: sinTutores, body: (e) => ({ tutores_propuestos: [e.docenteTutor.docenteId!] }), lectura: false },
  'GET /periodos/:periodoId/postulaciones/:id/tutores-propuestos': { params: { ...enCerrado, id: (e) => e.postulacionGrupalCerrada }, lectura: true },
  'GET /periodos/:periodoId/postulaciones/me': { params: enCerrado, lectura: true, permitida: propio },
  'GET /periodos/:periodoId/temas/:temaId/tutores-disponibles': { params: { ...enAbierto, temaId: (e) => e.temaAbierto }, lectura: true, permitida: 'Docentes elegibles de un tema PUBLICADO: TemasService.getById exige al estudiante habilitación en el período y misma carrera, y al docente ser el proponente.' },
  'GET /temas/:id': { params: { id: (e) => e.temaAbierto }, query: (e) => `periodo_id=${e.periodoAbierto}`, lectura: true, permitida: 'Tema PUBLICADO del banco de la carrera: TemasService.getById exige al estudiante período habilitado y misma carrera, y al docente ser el proponente.' },
};

/** Rutas con parámetros que la matriz no puede llamar sin efectos o sin objeto del dueño. */
const RUTAS_NO_CUBIERTAS: Record<string, string> = {
  'POST /periodos/:periodoId/grupos': 'Crea un grupo del propio actor; el único identificador es el período (no hay objeto del dueño) y un éxito legítimo deja efectos.',
  'POST /periodos/:periodoId/postulaciones': 'Crea una postulación del propio actor; el único identificador es el período y un éxito legítimo deja efectos.',
};

/**
 * FALLO-ESPERADO(matriz-objetos): respuestas 2xx no autorizadas encontradas por la matriz y aún sin
 * corregir, como `MÉTODO ruta | actor`. Cada una tiene su caso `it.fails` arriba.
 */
const HUECOS_CONOCIDOS: string[] = [];
