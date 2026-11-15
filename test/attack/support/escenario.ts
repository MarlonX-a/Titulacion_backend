import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { carreraId, crearCuenta, tokenDe, type Cuenta } from './actors.js';
import type { AttackApp } from './harness.js';

/** Bloques de datos reales para los escenarios de ataque, insertados en el esquema temporal. */

const tag = () => randomBytes(3).toString('hex').toUpperCase();

export async function crearPeriodo(attack: AttackApp, options: { abierto?: boolean; max?: number } = {}): Promise<string> {
  const { facultadId } = await carreraId(attack, 'INGENIERIA_EN_SOFTWARE');
  const now = Date.now();
  const [row] = await attack.db.query(
    `INSERT INTO ${attack.s}."periodo_titulacion" ("codigo","nombre","fecha_inicio_postulacion","fecha_fin_postulacion","fecha_inicio_titulacion","estado","max_integrantes_default","facultad_id")
     VALUES ($1,$2,$3,$4,$5,'POSTULACION_ABIERTA',$6,$7) RETURNING "id"`,
    [`ATK-${tag()}`, 'Período de ataque', new Date(now - 3_600_000), new Date(now + 7 * 86_400_000), new Date(now + 30 * 86_400_000), options.max ?? 3, facultadId],
  ) as Array<{ id: string }>;
  return row!.id;
}

/** Pasa el período a POSTULACION_CERRADA (fin de postulación en el pasado), como hace el verificador de conflictos. */
export async function cerrarPostulacion(attack: AttackApp, periodoId: string): Promise<void> {
  await attack.db.query(`UPDATE ${attack.s}."periodo_titulacion" SET "fecha_fin_postulacion"=now() - interval '1 minute', "estado"='POSTULACION_CERRADA' WHERE "id"=$1`, [periodoId]);
}

export async function habilitar(attack: AttackApp, periodoId: string, ...estudiantes: Cuenta[]): Promise<void> {
  for (const estudiante of estudiantes) {
    await attack.db.query(
      `INSERT INTO ${attack.s}."estudiante_habilitado" ("periodo_id","estudiante_id","origen","estado","condicion_ingreso","situacion_ingreso","requisito_pendiente") VALUES ($1,$2,'MANUAL','HABILITADO','CONDICIONADO','PENDIENTE','Requisito pendiente')`,
      [periodoId, estudiante.estudianteId],
    );
  }
}

const lineas = new Map<string, string>();
export async function crearTema(attack: AttackApp, docente: Cuenta, tipo: 'INDIVIDUAL' | 'PAREJA' | 'GRUPO'): Promise<string> {
  let lineaId = lineas.get(attack.schema);
  if (!lineaId) {
    const [linea] = await attack.db.query(`INSERT INTO ${attack.s}."linea_investigacion" ("codigo","nombre","descripcion","activa") VALUES ($1,'Línea de ataque',NULL,true) RETURNING "id"`, [`ATK${tag()}`]) as Array<{ id: string }>;
    lineaId = linea!.id;
    lineas.set(attack.schema, lineaId);
  }
  const { carreraId: carrera } = await carreraId(attack, 'INGENIERIA_EN_SOFTWARE');
  const [row] = await attack.db.query(
    `INSERT INTO ${attack.s}."tema" ("carrera_id","linea_id","docente_proponente_id","titulo","descripcion","tipo","estado") VALUES ($1,$2,$3,$4,'Tema sembrado para pruebas de ataque.',$5,'PUBLICADO') RETURNING "id"`,
    [carrera, lineaId, docente.docenteId, `Tema de ataque ${tag()}`, tipo],
  ) as Array<{ id: string }>;
  return row!.id;
}

/** Grupo con representante, integrantes activos y ex-integrantes (RETIRADO con fecha de salida). */
export async function crearGrupo(attack: AttackApp, periodoId: string, representante: Cuenta, integrantes: Cuenta[], exIntegrantes: Cuenta[] = []): Promise<string> {
  // Los disparadores de integridad del grupo son diferidos: todo va en una transacción.
  return attack.db.transaction(async (manager) => {
    const estado = integrantes.length >= 1 ? 'ACTIVO' : 'EN_CONFORMACION';
    const [grupo] = await manager.query(`INSERT INTO ${attack.s}."grupo" ("periodo_id","nombre","estado") VALUES ($1,$2,$3) RETURNING "id"`, [periodoId, `Grupo ${tag()}`, estado]) as Array<{ id: string }>;
    const insertar = (cuenta: Cuenta, rol: string) => manager.query(
      `INSERT INTO ${attack.s}."grupo_integrante" ("grupo_id","periodo_id","estudiante_id","rol_en_grupo","estado") VALUES ($1,$2,$3,$4,'ACTIVO')`,
      [grupo!.id, periodoId, cuenta.estudianteId, rol],
    );
    await insertar(representante, 'REPRESENTANTE');
    for (const cuenta of [...integrantes, ...exIntegrantes]) await insertar(cuenta, 'INTEGRANTE');
    for (const cuenta of exIntegrantes) {
      await manager.query(
        `UPDATE ${attack.s}."grupo_integrante" SET "estado"='RETIRADO', "fecha_salida"=now(), "motivo_salida"='Salida voluntaria' WHERE "grupo_id"=$1 AND "estudiante_id"=$2`,
        [grupo!.id, cuenta.estudianteId],
      );
    }
    return grupo!.id;
  });
}

export async function crearPostulacion(attack: AttackApp, periodoId: string, temaId: string, registra: Cuenta, tutores: Cuenta[], grupo?: { id: string; integrantes: number }): Promise<string> {
  return attack.db.transaction(async (manager) => {
    const [row] = await manager.query(
      `INSERT INTO ${attack.s}."postulacion" ("tema_id","periodo_id","grupo_id","estudiante_id","num_integrantes","registrada_por_id","estado") VALUES ($1,$2,$3,$4,$5,$6,'PENDIENTE') RETURNING "id"`,
      [temaId, periodoId, grupo?.id ?? null, grupo ? null : registra.estudianteId, grupo?.integrantes ?? 1, registra.usuarioId],
    ) as Array<{ id: string }>;
    for (const [index, tutor] of tutores.entries()) {
      await manager.query(`INSERT INTO ${attack.s}."tutor_propuesto" ("postulacion_id","docente_id","orden_prioridad") VALUES ($1,$2,$3)`, [row!.id, tutor.docenteId, index + 1]);
    }
    return row!.id;
  });
}

/** Asignación de tema por el flujo HTTP real de ADMIN. */
export async function asignarTema(attack: AttackApp, admin: Cuenta, periodoId: string, postulacionId: string): Promise<string> {
  const response = await request(attack.baseUrl).post(`/periodos/${periodoId}/postulaciones/${postulacionId}/asignar-tema`)
    .set('Authorization', `Bearer ${await tokenDe(attack, admin)}`).send({ motivo: 'Asignación sembrada para la suite de ataque.' });
  if (response.status !== 201 && response.status !== 200) throw new Error(`No se pudo asignar el tema (HTTP ${response.status}): ${JSON.stringify(response.body)}`);
  return (response.body as { id: string }).id;
}

export async function asignarTutor(attack: AttackApp, admin: Cuenta, periodoId: string, asignacionId: string, docente: Cuenta): Promise<string> {
  const response = await request(attack.baseUrl).post(`/periodos/${periodoId}/asignaciones-tema/${asignacionId}/asignar-tutor`)
    .set('Authorization', `Bearer ${await tokenDe(attack, admin)}`).send({ docente_id: docente.docenteId });
  if (response.status !== 201 && response.status !== 200) throw new Error(`No se pudo asignar el tutor (HTTP ${response.status}): ${JSON.stringify(response.body)}`);
  const body = response.body as { id?: string; asignacion?: { id: string }; tutor?: { id: string } };
  const rows = await attack.db.query(`SELECT "id" FROM ${attack.s}."asignacion_tutor" WHERE "asignacion_tema_id"=$1 AND "estado"='VIGENTE'`, [asignacionId]) as Array<{ id: string }>;
  return rows[0]?.id ?? body.id ?? '';
}

export async function crearPlantilla(attack: AttackApp, periodoId: string, admin: Cuenta): Promise<string> {
  const [row] = await attack.db.query(
    `INSERT INTO ${attack.s}."plantilla_pat" ("periodo_id","version","nombre_archivo","ruta_almacenamiento","mime_type","tamano_bytes","hash_sha256","fecha_vigencia_inicio","fecha_vigencia_fin","publicada_por_id","activa")
     VALUES ($1,'1','plantilla.pdf',$2,'application/pdf','12',$3,CURRENT_DATE,NULL,$4,true) RETURNING "id"`,
    [periodoId, `plantillas-pat/attack-${tag()}.pdf`, 'a'.repeat(64), admin.usuarioId],
  ) as Array<{ id: string }>;
  return row!.id;
}

/** Documento PAT ya registrado (sin objeto en S3: basta para lectura de metadatos). */
export async function crearDocumentoPat(attack: AttackApp, asignacionId: string, plantillaId: string, cargadoPor: Cuenta): Promise<string> {
  const key = `documentos-pat/attack-${tag()}.pdf`;
  return attack.db.transaction(async (manager) => {
    await manager.query(`INSERT INTO ${attack.s}."archivo_limpieza_pendiente" ("ruta_almacenamiento") VALUES ($1)`, [key]);
    const [row] = await manager.query(
      `INSERT INTO ${attack.s}."documento_pat" ("asignacion_tema_id","plantilla_id","version","nombre_archivo","ruta_almacenamiento","formato","tamano_bytes","hash_sha256","cargado_por_id")
       VALUES ($1,$2,(SELECT COALESCE(MAX("version"),0)+1 FROM ${attack.s}."documento_pat" WHERE "asignacion_tema_id"=$1),'entrega.pdf',$3,'PDF','12',$4,$5) RETURNING "id"`,
      [asignacionId, plantillaId, key, 'b'.repeat(64), cargadoPor.usuarioId],
    ) as Array<{ id: string }>;
    await manager.query(`DELETE FROM ${attack.s}."archivo_limpieza_pendiente" WHERE "ruta_almacenamiento"=$1`, [key]);
    return row!.id;
  });
}

export interface TrabajoIndividual { titular: Cuenta; asignacionId: string }

/** Período cerrado con `n` asignaciones individuales vigentes y una plantilla PAT activa. */
export async function sembrarTrabajosIndividuales(attack: AttackApp, admin: Cuenta, docente: Cuenta, n: number): Promise<{ periodoId: string; plantillaId: string; trabajos: TrabajoIndividual[] }> {
  const periodoId = await crearPeriodo(attack);
  const titulares = await Promise.all(Array.from({ length: n }, () => crearCuenta(attack, { rol: 'ESTUDIANTE' })));
  await habilitar(attack, periodoId, ...titulares);
  const postulaciones: string[] = [];
  for (const titular of titulares) postulaciones.push(await crearPostulacion(attack, periodoId, await crearTema(attack, docente, 'INDIVIDUAL'), titular, [docente]));
  await cerrarPostulacion(attack, periodoId);
  const trabajos: TrabajoIndividual[] = [];
  for (const [index, postulacion] of postulaciones.entries()) trabajos.push({ titular: titulares[index]!, asignacionId: await asignarTema(attack, admin, periodoId, postulacion) });
  return { periodoId, plantillaId: await crearPlantilla(attack, periodoId, admin), trabajos };
}

export interface EscenarioBase {
  admin: Cuenta;
  docente: Cuenta;
  docenteAjeno: Cuenta;
  /** Período cerrado con asignaciones vigentes. */
  periodoCerrado: string;
  /** Período con postulación abierta. */
  periodoAbierto: string;
  /** Representante y compañero del grupo asignado (W1). */
  estA: Cuenta;
  estB: Cuenta;
  /** Ex-integrante (RETIRADO) del grupo de W1. */
  exIntegrante: Cuenta;
  /** Titular de la asignación individual W2. */
  estE: Cuenta;
  /** Estudiante de otra carrera. */
  estC: Cuenta;
  /** Cuenta ESTUDIANTE sin perfil de estudiante. */
  sinPerfil: Cuenta;
  grupoAsignado: string;
  asignacionGrupal: string;
  asignacionIndividual: string;
  asignacionTutor: string;
  plantilla: string;
  documentoGrupal: string;
  postulacionGrupalCerrada: string;
  /** Grupo del período abierto con postulación grupal pendiente. */
  estK: Cuenta;
  estL: Cuenta;
  grupoAbierto: string;
  postulacionGrupalAbierta: string;
}

/** Siembra el escenario compartido por las pruebas de control de acceso. */
export async function sembrarEscenario(attack: AttackApp): Promise<EscenarioBase> {
  const admin = await crearCuenta(attack, { rol: 'ADMIN' });
  const docente = await crearCuenta(attack, { rol: 'DOCENTE' });
  const docenteAjeno = await crearCuenta(attack, { rol: 'DOCENTE' });
  const [estA, estB, exIntegrante, estE, estK, estL] = await Promise.all(Array.from({ length: 6 }, () => crearCuenta(attack, { rol: 'ESTUDIANTE' })));
  const estC = await crearCuenta(attack, { rol: 'ESTUDIANTE', carrera: 'INGENIERIA_EN_SISTEMAS' });
  const sinPerfil = await crearCuenta(attack, { rol: 'ESTUDIANTE', perfil: false });

  const periodoCerrado = await crearPeriodo(attack);
  await habilitar(attack, periodoCerrado, estA!, estB!, exIntegrante!, estE!);
  const temaGrupal = await crearTema(attack, docente, 'PAREJA');
  const temaIndividual = await crearTema(attack, docente, 'INDIVIDUAL');
  const grupoAsignado = await crearGrupo(attack, periodoCerrado, estA!, [estB!], [exIntegrante!]);
  const postulacionGrupalCerrada = await crearPostulacion(attack, periodoCerrado, temaGrupal, estA!, [docente], { id: grupoAsignado, integrantes: 2 });
  const postulacionIndividual = await crearPostulacion(attack, periodoCerrado, temaIndividual, estE!, [docente]);
  await cerrarPostulacion(attack, periodoCerrado);
  await attack.db.query(`INSERT INTO ${attack.s}."config_carga_tutorial" ("periodo_id","docente_id","max_trabajos","bloquear_al_superar") VALUES ($1,NULL,20,false)`, [periodoCerrado]);
  const asignacionGrupal = await asignarTema(attack, admin, periodoCerrado, postulacionGrupalCerrada);
  const asignacionIndividual = await asignarTema(attack, admin, periodoCerrado, postulacionIndividual);
  const asignacionTutor = await asignarTutor(attack, admin, periodoCerrado, asignacionGrupal, docente);
  const plantilla = await crearPlantilla(attack, periodoCerrado, admin);
  const documentoGrupal = await crearDocumentoPat(attack, asignacionGrupal, plantilla, estA!);

  const periodoAbierto = await crearPeriodo(attack);
  await habilitar(attack, periodoAbierto, estK!, estL!);
  const temaAbierto = await crearTema(attack, docente, 'PAREJA');
  const grupoAbierto = await crearGrupo(attack, periodoAbierto, estK!, [estL!]);
  const postulacionGrupalAbierta = await crearPostulacion(attack, periodoAbierto, temaAbierto, estK!, [docente], { id: grupoAbierto, integrantes: 2 });

  return {
    admin, docente, docenteAjeno, periodoCerrado, periodoAbierto, estA: estA!, estB: estB!, exIntegrante: exIntegrante!, estE: estE!, estC, sinPerfil,
    grupoAsignado, asignacionGrupal, asignacionIndividual, asignacionTutor, plantilla, documentoGrupal, postulacionGrupalCerrada,
    estK: estK!, estL: estL!, grupoAbierto, postulacionGrupalAbierta,
  };
}

/**
 * Identificadores reales del estudiante dueño (estA) para la matriz de autorización por objeto.
 * En el período cerrado: su grupo W1 con postulación, asignación, tutor, documento PAT con revisión
 * y una notificación. En el período abierto: un grupo propio sin postulación (estA representante,
 * estB integrante, exIntegrante RETIRADO) con una invitación PENDIENTE, para que las mutaciones de
 * grupo e invitación lleguen a la comprobación de pertenencia y no a «composición cerrada».
 */
export interface EscenarioMatriz extends EscenarioBase {
  /** Integrante activo de otro grupo en ambos períodos (estK). */
  otroGrupo: Cuenta;
  grupoPropioAbierto: string;
  invitacionPropia: string;
  temaGrupal: string;
  temaAbierto: string;
  lineaTemaGrupal: string;
  notificacionPropia: string;
  /** Docente habilitado para tutoría, distinto del ya propuesto en W1 (cuerpo válido de tutores propuestos). */
  docenteTutor: Cuenta;
  /** Estudiante habilitado del período abierto sin grupo (destino válido de invitaciones). */
  estLibre: Cuenta;
  /** Período abierto donde estA tiene una postulación individual PENDIENTE sin tutores propuestos. */
  periodoIndividual: string;
  postulacionSinTutores: string;
}

export async function sembrarEscenarioMatriz(attack: AttackApp): Promise<EscenarioMatriz> {
  const base = await sembrarEscenario(attack);
  const { admin, estA, estB, exIntegrante, estK, periodoCerrado, periodoAbierto, documentoGrupal, asignacionGrupal, postulacionGrupalCerrada, postulacionGrupalAbierta } = base;
  const [estM, estX, estLibre] = await Promise.all(Array.from({ length: 3 }, () => crearCuenta(attack, { rol: 'ESTUDIANTE' })));
  const docenteTutor = await crearCuenta(attack, { rol: 'DOCENTE' });
  // Otro grupo en el período cerrado para estK (ya integra grupoAbierto en el período abierto).
  await habilitar(attack, periodoCerrado, estK, estM!);
  await crearGrupo(attack, periodoCerrado, estK, [estM!]);
  // Grupo propio de estA en el período abierto, con ex-integrante e invitación pendiente.
  await habilitar(attack, periodoAbierto, estA, estB, exIntegrante, estX!, estLibre!);
  const grupoPropioAbierto = await crearGrupo(attack, periodoAbierto, estA, [estB], [exIntegrante]);
  const invitacion = await request(attack.baseUrl).post(`/periodos/${periodoAbierto}/grupos/${grupoPropioAbierto}/invitaciones`)
    .set('Authorization', `Bearer ${await tokenDe(attack, estA)}`).send({ estudiante_destino_id: estX!.estudianteId });
  if (invitacion.status !== 201) throw new Error(`No se pudo crear la invitación del dueño (HTTP ${invitacion.status}): ${JSON.stringify(invitacion.body)}`);
  const revision = await request(attack.baseUrl).post(`/periodos/${periodoCerrado}/asignaciones-tema/${asignacionGrupal}/documentos-pat/${documentoGrupal}/revision`)
    .set('Authorization', `Bearer ${await tokenDe(attack, admin)}`).send({ resultado: 'APROBADO' });
  if (revision.status !== 201 && revision.status !== 200) throw new Error(`No se pudo registrar la revisión PAT (HTTP ${revision.status}): ${JSON.stringify(revision.body)}`);
  const [tema] = await attack.db.query(`SELECT t."id", t."linea_id" FROM ${attack.s}."postulacion" p JOIN ${attack.s}."tema" t ON t."id"=p."tema_id" WHERE p."id"=$1`, [postulacionGrupalCerrada]) as Array<{ id: string; linea_id: string }>;
  const [temaAbierto] = await attack.db.query(`SELECT "tema_id" FROM ${attack.s}."postulacion" WHERE "id"=$1`, [postulacionGrupalAbierta]) as Array<{ tema_id: string }>;
  const [notificacion] = await attack.db.query(`SELECT "id" FROM ${attack.s}."notificacion" WHERE "usuario_id"=$1 AND "canal"='EN_APP' ORDER BY "fecha_creacion" LIMIT 1`, [estA.usuarioId]) as Array<{ id: string }>;
  if (!notificacion) throw new Error('El escenario no generó ninguna notificación EN_APP para el estudiante dueño.');
  // Postulación individual PENDIENTE y sin tutores (como las anteriores a la regla de tutores) en un período abierto:
  // cancelarla o completar sus tutores solo depende de la pertenencia, no del plazo ni del estado.
  const periodoIndividual = await crearPeriodo(attack);
  await habilitar(attack, periodoIndividual, estA);
  const temaIndividual = await crearTema(attack, base.docente, 'INDIVIDUAL');
  await attack.db.query(`ALTER TABLE ${attack.s}."postulacion" DISABLE TRIGGER "TRG_postulacion_requiere_tutores"`);
  let postulacionSinTutores: string;
  try {
    const [row] = await attack.db.query(
      `INSERT INTO ${attack.s}."postulacion" ("tema_id","periodo_id","estudiante_id","num_integrantes","registrada_por_id","estado") VALUES ($1,$2,$3,1,$4,'PENDIENTE') RETURNING "id"`,
      [temaIndividual, periodoIndividual, estA.estudianteId, estA.usuarioId],
    ) as Array<{ id: string }>;
    postulacionSinTutores = row!.id;
  } finally {
    await attack.db.query(`ALTER TABLE ${attack.s}."postulacion" ENABLE TRIGGER "TRG_postulacion_requiere_tutores"`);
  }
  return {
    ...base, otroGrupo: estK, grupoPropioAbierto, invitacionPropia: (invitacion.body as { id: string }).id,
    periodoIndividual, postulacionSinTutores,
    temaGrupal: tema!.id, lineaTemaGrupal: tema!.linea_id, temaAbierto: temaAbierto!.tema_id, notificacionPropia: notificacion.id,
    docenteTutor, estLibre: estLibre!,
  };
}
