import { InjectQueue } from '@nestjs/bullmq';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import PDFDocument from 'pdfkit';
import { createHash } from 'node:crypto';
import { DataSource, QueryFailedError, Repository } from 'typeorm';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { AlmacenamientoService } from '../almacenamiento/almacenamiento.service.js';
import { ArchivoLimpiezaService } from '../almacenamiento/archivo-limpieza.service.js';
import { ArchivoPendiente } from '../almacenamiento/entities/archivo-pendiente.entity.js';
import { AuditoriaService } from '../auditoria/auditoria.service.js';
import { Usuario } from '../usuarios/entities/usuario.entity.js';
import { UsuarioRol } from '../usuarios/enums/usuario-rol.enum.js';
import { Estudiante } from '../estudiantes/entities/estudiante.entity.js';
import { EstudianteDatosPat } from './entities/estudiante-datos-pat.entity.js';
import { ContenidoPatEstudiante } from './entities/contenido-pat.entity.js';
import { GeneracionPat } from './entities/generacion-pat.entity.js';
import { ActualizarDatosPatDto, ActualizarContenidoPatDto, GenerarPatDto } from './dto/actualizar-datos-pat.dto.js';

export interface GeneracionJob { id: string; ciclo: number }
type Source = DataSource | import('typeorm').EntityManager;

@Injectable()
export class GeneracionesPatService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private publishing = false;
  private readonly testMode = process.env.NODE_ENV === 'test';
  constructor(
    private readonly db: DataSource,
    @InjectRepository(EstudianteDatosPat) private readonly datosRepo: Repository<EstudianteDatosPat>,
    @InjectRepository(ContenidoPatEstudiante) private readonly contenidoRepo: Repository<ContenidoPatEstudiante>,
    @InjectRepository(GeneracionPat) private readonly generacionesRepo: Repository<GeneracionPat>,
    private readonly storage: AlmacenamientoService,
    private readonly cleanup: ArchivoLimpiezaService,
    private readonly audit: AuditoriaService,
    @InjectQueue('generaciones-pat') private readonly queue: Queue<GeneracionJob>,
  ) {}

  onModuleInit(): void { if (!this.testMode) { this.timer = setInterval(() => void this.publicarPendientes(), 5000); this.timer.unref(); void this.publicarPendientes(); } }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async obtenerDatos(actor: Usuario) {
    const student = await this.studentFor(actor.id);
    const row = await this.datosRepo.findOneBy({ estudiante_id: student.id });
    const s=this.schema();
    const identidad=await this.db.query(`SELECT e."id",e."cedula",e."matricula",e."nivel",u."nombres",u."apellidos",u."email" AS correo_institucional,c."nombre" AS carrera,f."nombre" AS facultad FROM ${s}."estudiante" e JOIN ${s}."usuario" u ON u."id"=e."usuario_id" JOIN ${s}."carrera" c ON c."id"=e."carrera_id" JOIN ${s}."facultad" f ON f."id"=c."facultad_id" WHERE e."id"=$1`,[student.id]) as Array<Record<string,unknown>>;
    return { estudiante_id: student.id, identidad: identidad[0] ?? null, datos: row?.datos ?? {}, pendientes: this.pendingPersonal(row?.datos ?? {}) };
  }

  async actualizarDatos(dto: ActualizarDatosPatDto, actor: Usuario, ip: string | null) {
    const student = await this.studentFor(actor.id);
    const saved = await this.db.transaction(async (manager) => {
      await manager.query(`SELECT "id" FROM ${this.schema()}."estudiante" WHERE "id"=$1 FOR UPDATE`,[student.id]);
      const repo = manager.getRepository(EstudianteDatosPat);
      const before = await repo.findOneBy({ estudiante_id: student.id });
      const merged = { ...before?.datos, ...dto } as Record<string, unknown>;
      const keys = Object.keys(dto).filter((key) => key !== 'discapacidades' && !['grado_discapacidad', 'otra_discapacidad'].includes(key));
      if (dto.tiene_discapacidad === false) {
        delete merged.discapacidades; delete merged.grado_discapacidad; delete merged.otra_discapacidad;
        for (const key of ['discapacidades', 'grado_discapacidad', 'otra_discapacidad']) if (!keys.includes(key)) keys.push(key);
      }
      for (const key of ['curso','paralelo','sexo','nacionalidad','estado_civil','certificado_votacion','provincia','canton','parroquia','correo_personal','celular','telefono_convencional','grado_discapacidad','otra_discapacidad']) if(typeof merged[key]==='string') merged[key]=(merged[key] as string).trim();
      this.validatePersonal(merged, false);
      const row = await repo.save(repo.create({ estudiante_id: student.id, estudiante: student, datos: merged, actualizado_en: new Date() }));
      await this.audit.registrar(manager, { actor, accion: 'ACTUALIZAR_DATOS_PAT_ESTUDIANTE', entidad_tipo: 'estudiante_datos_pat', entidad_id: student.id, valores_anteriores: { campos: before ? Object.keys(dto).filter((k) => k in before.datos) : [] }, valores_nuevos: { campos: keys }, ip_origen: ip });
      return row;
    });
    return { estudiante_id: student.id, datos: saved.datos, pendientes: this.pendingPersonal(saved.datos) };
  }

  async obtenerContenido(periodoId: string, assignmentId: string, actor: Usuario) {
    const student = await this.authorizeParticipant(periodoId, assignmentId, actor);
    const row = await this.contenidoRepo.findOneBy({ asignacion_tema_id: assignmentId, estudiante_id: student.id });
    const suggestion=await this.db.query(`SELECT t."descripcion" FROM ${this.schema()}."asignacion_tema" a JOIN ${this.schema()}."tema" t ON t."id"=a."tema_id" WHERE a."id"=$1 AND a."periodo_id"=$2`,[assignmentId,periodoId]) as Array<{descripcion:string}>;
    const contenido=row?.contenido ?? (suggestion[0]?{problematica:suggestion[0].descripcion}:{});
    return { asignacion_tema_id: assignmentId, estudiante_id: student.id, contenido, problematica_sugerida: suggestion[0]?.descripcion ?? null, pendientes: this.pendingContent(contenido) };
  }

  async actualizarContenido(periodoId: string, assignmentId: string, dto: ActualizarContenidoPatDto, actor: Usuario, ip: string | null) {
    const student = await this.authorizeParticipant(periodoId, assignmentId, actor);
    const row = await this.db.transaction(async (manager) => {
      const schema = this.schema();
      const period = await manager.query(`SELECT "estado"::text AS estado FROM ${schema}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId]) as Array<{estado:string}>;
      if (!period[0]) throw new NotFoundException('No existe el período.');
      if (!['POSTULACION_CERRADA', 'EN_CURSO'].includes(period[0].estado)) throw new ConflictException('El contenido PAT solo puede editarse con postulaciones cerradas o durante titulación.');
      await this.assignment(manager, periodoId, assignmentId, true);
      await this.authorizeParticipant(periodoId, assignmentId, actor, manager);
      const repo = manager.getRepository(ContenidoPatEstudiante);
      const before = await repo.findOneBy({ asignacion_tema_id: assignmentId, estudiante_id: student.id });
      const contenido = { ...before?.contenido, ...dto };
      const saved = await repo.save(repo.create({ asignacion_tema_id: assignmentId, estudiante_id: student.id, asignacion_tema: { id: assignmentId } as never, estudiante: student, contenido, actualizado_en: new Date() }));
      await this.audit.registrar(manager, { actor, accion: 'ACTUALIZAR_CONTENIDO_PAT', entidad_tipo: 'contenido_pat_estudiante', entidad_id: saved.id, valores_anteriores: { campos: Object.keys(dto).filter((k) => k in (before?.contenido ?? {})) }, valores_nuevos: { campos: Object.keys(dto) }, ip_origen: ip });
      return saved;
    });
    return { asignacion_tema_id: assignmentId, estudiante_id: student.id, contenido: row.contenido, pendientes: this.pendingContent(row.contenido) };
  }

  async solicitar(periodoId: string, assignmentId: string, dto: GenerarPatDto, actor: Usuario, ip: string | null) {
    await this.authorizeParticipant(periodoId, assignmentId, actor);
    const generation = await this.db.transaction(async (manager) => {
      const s = this.schema();
      const p = await manager.query(`SELECT "estado"::text AS estado,"extension_pat" AS extension FROM ${s}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`, [periodoId]) as Array<{estado:string;extension:string|null}>;
      if (!p[0]) throw new NotFoundException('No existe el período.');
      if (!['POSTULACION_CERRADA','EN_CURSO'].includes(p[0].estado)) throw new ConflictException('El PAT solo puede generarse con postulaciones cerradas o durante titulación.');
      const assignment = await this.assignment(manager, periodoId, assignmentId, true);
      if (assignment.estado !== 'VIGENTE') throw new ConflictException('La asignación de tema ya no está vigente.');
      const freshStudent = await this.authorizeParticipant(periodoId, assignmentId, actor, manager);
      const personal = await manager.getRepository(EstudianteDatosPat).findOneBy({ estudiante_id: freshStudent.id });
      const content = await manager.getRepository(ContenidoPatEstudiante).findOneBy({ asignacion_tema_id: assignmentId, estudiante_id: freshStudent.id });
      const pending = [...this.pendingPersonal(personal?.datos ?? {}), ...this.pendingContent(content?.contenido ?? {})];
      if (!p[0].extension?.trim()) pending.push('extension_pat configurada por ADMIN');
      if (pending.length) throw new BadRequestException({ message: 'Completa los datos obligatorios antes de generar el PAT.', pendientes: pending });
      const participants = await manager.query(`SELECT e."id",u."nombres",u."apellidos",e."matricula" FROM ${s}."asignacion_tema" a JOIN ${s}."estudiante" e ON (e."id"=a."estudiante_id" OR EXISTS(SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=e."id" AND gi."estado"='ACTIVO')) JOIN ${s}."usuario" u ON u."id"=e."usuario_id" WHERE a."id"=$1 ORDER BY u."apellidos",u."nombres",e."id"`, [assignmentId]) as Array<{id:string;nombres:string;apellidos:string;matricula:string}>;
      let tutor = await manager.query(`SELECT d."id",u."nombres",u."apellidos" FROM ${s}."asignacion_tutor" at JOIN ${s}."docente" d ON d."id"=at."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE at."asignacion_tema_id"=$1 AND at."estado"='VIGENTE'`, [assignmentId]) as Array<{id:string;nombres:string;apellidos:string}>;
      let tutorPropuestoId: string | null = null;
      if (!tutor[0]) {
        if (!dto.tutor_propuesto_id) throw new BadRequestException('Selecciona un tutor propuesto; el trabajo todavía no tiene tutor asignado.');
        const proposed = await manager.query(`SELECT tp."id",u."nombres",u."apellidos" FROM ${s}."asignacion_tema" a JOIN ${s}."tutor_propuesto" tp ON tp."postulacion_id"=a."postulacion_id" JOIN ${s}."docente" d ON d."id"=tp."docente_id" JOIN ${s}."usuario" u ON u."id"=d."usuario_id" WHERE a."id"=$1 AND tp."id"=$2`, [assignmentId,dto.tutor_propuesto_id]) as Array<{id:string;nombres:string;apellidos:string}>;
        if (!proposed[0]) throw new BadRequestException('El tutor elegido no pertenece a las propuestas de esta postulación.');
        tutorPropuestoId = proposed[0].id; tutor = [{ id: proposed[0].id, nombres: proposed[0].nombres, apellidos: proposed[0].apellidos }];
      } else if (dto.tutor_propuesto_id) {
        throw new BadRequestException('El trabajo ya tiene un tutor vigente; no selecciones una propuesta.');
      }
      const rows = await manager.query(`SELECT a."id" AS asignacion_id,t."titulo",t."descripcion",p."codigo" AS periodo_codigo,p."nombre" AS periodo_nombre,p."extension_pat" AS extension,c."nombre" AS carrera,f."nombre" AS facultad,u."nombres",u."apellidos",u."email",e."cedula",e."matricula",e."nivel",d."datos" AS personal,cp."contenido",$3::jsonb AS participantes,$4::jsonb AS tutor FROM ${s}."asignacion_tema" a JOIN ${s}."tema" t ON t."id"=a."tema_id" JOIN ${s}."periodo_titulacion" p ON p."id"=a."periodo_id" JOIN ${s}."estudiante" e ON e."id"=$2 JOIN ${s}."usuario" u ON u."id"=e."usuario_id" JOIN ${s}."carrera" c ON c."id"=e."carrera_id" JOIN ${s}."facultad" f ON f."id"=c."facultad_id" LEFT JOIN ${s}."estudiante_datos_pat" d ON d."estudiante_id"=e."id" JOIN ${s}."contenido_pat_estudiante" cp ON cp."asignacion_tema_id"=a."id" AND cp."estudiante_id"=e."id" WHERE a."id"=$1`, [assignmentId,freshStudent.id,JSON.stringify(participants),JSON.stringify(tutor[0])]) as Array<Record<string,unknown>>;
      if (!rows[0]) throw new NotFoundException('No fue posible preparar la información del PAT.');
      const snapshot = { ...rows[0], personal: personal?.datos ?? {}, contenido: content?.contenido ?? {}, tutor_propuesto_id: tutorPropuestoId, generado_para: `${actor.nombres} ${actor.apellidos}`, version_diseno: 1, capturado_en: new Date().toISOString() };
      const repo = manager.getRepository(GeneracionPat);
      const saved = await repo.save(repo.create({ asignacion_tema_id: assignmentId, estudiante_id: freshStudent.id, solicitada_por_id: actor.id, version_diseno: 1, ciclo: 1, instantanea: snapshot, estado: 'EN_COLA', ruta_almacenamiento: null, tamano_bytes: null, hash_sha256: null, error_sanitizado: null }));
      await this.audit.registrar(manager, { actor, accion: 'SOLICITAR_GENERACION_PAT', entidad_tipo: 'generacion_pat', entidad_id: saved.id, valores_anteriores: null, valores_nuevos: { asignacion_tema_id: assignmentId, version_diseno: 1 }, ip_origen: ip });
      return saved;
    });
    await this.publicar(generation.id, generation.ciclo);
    return { id: generation.id, estado: generation.estado };
  }

  async porId(periodoId:string, assignmentId:string,id:string,actor:Usuario) {
    const student=await this.authorizeParticipant(periodoId,assignmentId,actor);
    const row=await this.generacionesRepo.findOneBy({id,asignacion_tema_id:assignmentId,estudiante_id:student.id});
    if(!row) throw new NotFoundException('No existe esa generación PAT.');
    return this.response(row);
  }
  async descarga(periodoId:string,assignmentId:string,id:string,actor:Usuario) {
    const row=await this.generationForStudent(periodoId,assignmentId,id,actor);
    if(row.estado!=='LISTO'||!row.ruta_almacenamiento) throw new ConflictException('La generación todavía no está disponible.');
    return {url:await this.storage.signPrivateDownload(row.ruta_almacenamiento,'PAT-sin-firma.pdf','application/pdf'),expira_en:new Date(Date.now()+300_000)};
  }

  async configurar(periodoId:string,extension:string,actor:Usuario,ip:string|null) {
    if(typeof extension!=='string'||!extension.trim()||extension.trim().length>150) throw new BadRequestException('La extensión o sede es obligatoria y admite hasta 150 caracteres.');
    try { await this.db.transaction(async m=>{const s=this.schema();const p=await m.query(`SELECT "estado"::text AS estado FROM ${s}."periodo_titulacion" WHERE "id"=$1 FOR UPDATE`,[periodoId]) as Array<{estado:string}>;if(!p[0])throw new NotFoundException('No existe el período.');if(p[0].estado==='ARCHIVADO')throw new ConflictException('No se puede editar un período archivado.');await m.query(`UPDATE ${s}."periodo_titulacion" SET "extension_pat"=$2 WHERE "id"=$1`,[periodoId,extension.trim()]);await this.audit.registrar(m,{actor,accion:'CONFIGURAR_FORMATO_PAT',entidad_tipo:'periodo_titulacion',entidad_id:periodoId,valores_anteriores:null,valores_nuevos:{extension_pat:extension.trim()},ip_origen:ip});});return {periodo_id:periodoId,extension_pat:extension.trim()};}catch(e){this.handleError(e);}
  }

  async procesar(id:string,ciclo:number) {
    const row=await this.db.transaction(async m=>{const repo=m.getRepository(GeneracionPat);const current=await repo.findOne({where:{id},lock:{mode:'pessimistic_write'}});if(!current||current.estado!=='EN_COLA'||current.ciclo!==ciclo)return null;current.estado='PROCESANDO';return repo.save(current);}); if(!row)return;
    const key=this.storage.createPrivateKey('generaciones-pat','pdf');
    await this.cleanup.registrar(null,key);
    try {
      const buffer=await this.render(row.instantanea);
      await this.storage.saveAtPrivateKey(key,buffer,'application/pdf');
      await this.db.transaction(async m=>{const repo=m.getRepository(GeneracionPat);const current=await repo.findOne({where:{id},lock:{mode:'pessimistic_write'}});if(!current||current.estado!=='PROCESANDO'||current.ciclo!==ciclo)return;current.estado='LISTO';current.ruta_almacenamiento=key;current.tamano_bytes=String(buffer.length);current.hash_sha256=createHash('sha256').update(buffer).digest('hex');current.generada_en=new Date();current.error_sanitizado=null;await repo.save(current);await m.getRepository(ArchivoPendiente).delete({ruta_almacenamiento:key});});
    } catch {
      await this.generacionesRepo.update({id,ciclo,estado:'PROCESANDO'},{estado:'FALLIDO',error_sanitizado:'No se pudo generar el archivo PAT.'});
      await this.cleanup.solicitar(undefined,key);
    }
  }

  async reintentar(periodoId:string,assignmentId:string,id:string,actor:Usuario,ip:string|null) {
    await this.authorizeParticipant(periodoId,assignmentId,actor);
    const row=await this.generacionesRepo.findOneBy({id,asignacion_tema_id:assignmentId,solicitada_por_id:actor.id});if(!row)throw new NotFoundException('No existe esa generación PAT.');if(row.estado!=='FALLIDO')throw new ConflictException('Solo se pueden reintentar generaciones fallidas.');
    const cycle=row.ciclo+1;await this.db.transaction(async m=>{await m.getRepository(GeneracionPat).update({id,estado:'FALLIDO',ciclo:row.ciclo},{estado:'EN_COLA',ciclo:cycle,error_sanitizado:null});await this.audit.registrar(m,{actor,accion:'REINTENTAR_GENERACION_PAT',entidad_tipo:'generacion_pat',entidad_id:id,valores_anteriores:{estado:row.estado,ciclo:row.ciclo},valores_nuevos:{estado:'EN_COLA',ciclo:cycle},ip_origen:ip});});await this.publicar(id,cycle);return {id,estado:'EN_COLA'};
  }

  private async publicarPendientes(){if(this.publishing)return;this.publishing=true;try{const rows=await this.generacionesRepo.find({where:{estado:'EN_COLA'},take:50,order:{solicitada_en:'ASC'}});for(const row of rows)await this.publicar(row.id,row.ciclo);}catch{}finally{this.publishing=false;}}
  private async publicar(id:string,ciclo:number){try{await this.queue.add('generar-pat',{id,ciclo},{jobId:`pat-${id}-${ciclo}`,attempts:3,backoff:{type:'exponential',delay:3000},removeOnComplete:true,removeOnFail:false});}catch{/* El registro EN_COLA se publicará de nuevo desde PostgreSQL. */}}

  private async render(x:Record<string,unknown>):Promise<Buffer>{return new Promise((resolve,reject)=>{const doc=new PDFDocument({size:'A4',margin:46,bufferPages:true});const chunks:Buffer[]=[];doc.on('data',(chunk:Buffer)=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);const p=(x['personal']??{}) as Record<string,unknown>;const c=(x['contenido']??{}) as Record<string,unknown>;const participants=(x['participantes']??[]) as Array<Record<string,unknown>>;const tutor=(x['tutor']??{}) as Record<string,unknown>;const val=(o:Record<string,unknown>,k:string)=>String(o[k]??'');
    doc.fontSize(10).fillColor('#374151').text('UNIVERSIDAD LAICA ELOY ALFARO DE MANABÍ',{align:'center'}).moveDown(.25);doc.fontSize(15).fillColor('#0f3d68').text('PLAN DE TRABAJO DE TITULACIÓN',{align:'center'});doc.fontSize(9).fillColor('#555').text('Formulario individual · Documento generado sin firma',{align:'center'}).moveDown();
    const section=(title:string)=>{doc.moveDown(.45).fontSize(11).fillColor('#0f3d68').text(title,{underline:true}).moveDown(.2).fontSize(9).fillColor('#111');};
    section('1. INFORMACIÓN ACADÉMICA');doc.text(`Período: ${val(x,'periodo_nombre')} (${val(x,'periodo_codigo')})`);doc.text(`Facultad: ${val(x,'facultad')}    Carrera: ${val(x,'carrera')}`);doc.text(`Estudiante: ${val(x,'apellidos')} ${val(x,'nombres')}    Cédula: ${val(x,'cedula')}`);doc.text(`Matrícula: ${val(x,'matricula')}    Nivel: ${val(x,'nivel')}    Curso: ${val(p,'curso')}    Paralelo: ${val(p,'paralelo')}`);doc.text(`Correo institucional: ${val(x,'email')}    Correo personal: ${val(p,'correo_personal')||'No aplica'}`);doc.text(`Tema: ${val(x,'titulo')}`);doc.text(`Tutor: ${val(tutor,'nombres')} ${val(tutor,'apellidos')}`);doc.text(`Integrantes del trabajo: ${participants.map(a=>`${val(a,'nombres')} ${val(a,'apellidos')}`).join('; ')}`);
    section('2. DATOS PERSONALES');const birth=val(p,'fecha_nacimiento');let age='';if(birth){const b=new Date(`${birth}T00:00:00`),now=new Date(String(x['capturado_en']??Date.now()));let years=now.getFullYear()-b.getFullYear();if(now.getMonth()<b.getMonth()||(now.getMonth()===b.getMonth()&&now.getDate()<b.getDate()))years--;age=`${years} años`;}doc.text(`Fecha de nacimiento: ${birth}    Edad: ${age}    Sexo: ${val(p,'sexo')}`);doc.text(`Nacionalidad: ${val(p,'nacionalidad')}    Estado civil: ${val(p,'estado_civil')}`);doc.text(`Residencia: ${val(p,'provincia')} / ${val(p,'canton')} / ${val(p,'parroquia')}`);doc.text(`Certificado de votación: ${val(p,'certificado_votacion')||'No aplica'}    Celular: ${val(p,'celular')}    Convencional: ${val(p,'telefono_convencional')||'No aplica'}`);const disabilities=Array.isArray(p['discapacidades'])?p['discapacidades'].join(', '):'No';doc.text(`Discapacidad declarada: ${disabilities}${val(p,'otra_discapacidad')?` (${val(p,'otra_discapacidad')})`:''}    Grado: ${val(p,'grado_discapacidad')}`);
    section('3. PLAN DE TRABAJO');doc.text(`Modalidad académica: ${val(c,'modalidad_academica')}`);doc.text('Título provisional: '+val(x,'titulo'));doc.text('Problemática:',{continued:true}).text(' '+val(c,'problematica'),{align:'justify'});const links=Array.isArray(c['articulaciones'])?c['articulaciones'].join(', '):'';doc.text(`Articulación: ${links}`);doc.text('Tipo de trabajo: Trabajo de Integración Curricular.');doc.moveDown(1.8).text('__________________________________',{align:'center'}).text(`${val(x,'nombres')} ${val(x,'apellidos')}`,{align:'center'}).text('Firma del estudiante',{align:'center'});doc.moveDown().fontSize(8).fillColor('#777').text('Generado electrónicamente a partir de la información registrada por el estudiante. Revise los datos, descargue, firme y cargue el documento firmado.',{align:'center'});
    const range=doc.bufferedPageRange();for(let i=0;i<range.count;i++){doc.switchToPage(i);if(i>0)doc.fontSize(8).fillColor('#666').text('PLAN DE TRABAJO DE TITULACIÓN · CONTINUACIÓN',46,24,{align:'center',lineBreak:false});doc.fontSize(8).fillColor('#666').text(`Extensión / sede: ${val(x,'extension')}`,46,doc.page.height-38,{align:'left',lineBreak:false});doc.text(`PAT · ${i+1} / ${range.count}`,doc.page.width-115,doc.page.height-38,{align:'right',lineBreak:false});}doc.end();});}

  private async generationForStudent(periodoId:string,assignmentId:string,id:string,actor:Usuario){const student=await this.authorizeParticipant(periodoId,assignmentId,actor);const row=await this.generacionesRepo.findOneBy({id,asignacion_tema_id:assignmentId,estudiante_id:student.id});if(!row)throw new NotFoundException('No existe esa generación PAT.');return row;}
  private response(r:GeneracionPat){return {id:r.id,asignacion_tema_id:r.asignacion_tema_id,estudiante_id:r.estudiante_id,version_diseno:r.version_diseno,estado:r.estado,tamano_bytes:r.tamano_bytes?Number(r.tamano_bytes):null,hash_sha256:r.hash_sha256,solicitada_en:r.solicitada_en,generada_en:r.generada_en,error:r.estado==='FALLIDO'?r.error_sanitizado:null};}
  private pendingPersonal(d:Record<string,unknown>):string[]{const fields=['fecha_nacimiento','curso','paralelo','sexo','nacionalidad','estado_civil','provincia','canton','parroquia','celular','tiene_discapacidad'];const missing=fields.filter(k=>d[k]===undefined||d[k]===null||d[k]==='');if(!d['correo_personal']&&d['correo_personal_no_aplica']!==true)missing.push('correo_personal o correo_personal_no_aplica');if(!d['telefono_convencional']&&d['telefono_convencional_no_aplica']!==true)missing.push('telefono_convencional o telefono_convencional_no_aplica');if(!d['certificado_votacion']&&d['certificado_votacion_no_aplica']!==true)missing.push('certificado_votacion o certificado_votacion_no_aplica');if(d['tiene_discapacidad']===true){if(!Array.isArray(d['discapacidades'])||!(d['discapacidades'] as unknown[]).length)missing.push('discapacidades');if(!d['grado_discapacidad'])missing.push('grado_discapacidad');if((d['discapacidades'] as unknown[]|undefined)?.includes('OTRA')&&!d['otra_discapacidad'])missing.push('otra_discapacidad');}return missing;}
  private pendingContent(c:Record<string,unknown>):string[]{const m=['modalidad_academica','problematica','articulaciones','confirma_problematica'].filter(k=>c[k]===undefined||c[k]===null||c[k]==='');if(c['confirma_problematica']!==true)m.push('confirma_problematica');if(Array.isArray(c['articulaciones'])&&((c['articulaciones'] as string[]).includes('NINGUNA')&&(c['articulaciones'] as string[]).length>1))m.push('articulaciones_excluyentes');return [...new Set(m)];}
  private validatePersonal(d:Record<string,unknown>,complete:boolean){if(d['fecha_nacimiento']!==undefined){const value=String(d['fecha_nacimiento']);if(!/^\d{4}-\d{2}-\d{2}$/.test(value)){throw new BadRequestException('fecha_nacimiento debe ser una fecha ISO válida.');}const parsed=new Date(`${value}T00:00:00Z`);if(Number.isNaN(parsed.valueOf())||parsed.toISOString().slice(0,10)!==value||parsed.getTime()>Date.now())throw new BadRequestException('fecha_nacimiento debe ser una fecha real que no esté en el futuro.');}if(d['tiene_discapacidad']===false&&(d['discapacidades']||d['grado_discapacidad']||d['otra_discapacidad']))throw new BadRequestException('No se admiten detalles de discapacidad cuando se declara que no tiene.');const allowed=['VISUAL','FISICA','AUDITIVA','INTELECTUAL','PSICOLOGICA','LENGUAJE','OTRA'];if(Array.isArray(d['discapacidades'])&&(d['discapacidades'] as unknown[]).some(v=>typeof v!=='string'||!allowed.includes(v)))throw new BadRequestException('La selección de discapacidad incluye una categoría inválida.');if(d['correo_personal_no_aplica']===true&&d['correo_personal'])throw new BadRequestException('Indica el correo personal o marca que no aplica, no ambos.');if(d['telefono_convencional_no_aplica']===true&&d['telefono_convencional'])throw new BadRequestException('Indica el teléfono convencional o marca que no aplica, no ambos.');if(d['certificado_votacion_no_aplica']===true&&d['certificado_votacion'])throw new BadRequestException('Indica el certificado o marca que no aplica, no ambos.');if(complete&&this.pendingPersonal(d).length)throw new BadRequestException('Faltan datos personales obligatorios.');}
  private async studentFor(userId:string):Promise<Estudiante>{const rows=await this.db.query(`SELECT "id" FROM ${this.schema()}."estudiante" WHERE "usuario_id"=$1`,[userId]) as Array<{id:string}>;if(!rows[0])throw new NotFoundException('No existe perfil de estudiante para la cuenta.');return this.db.getRepository(Estudiante).findOneByOrFail({id:rows[0].id});}
  private async authorizeParticipant(periodoId:string,assignmentId:string,actor:Usuario,source:Source=this.db):Promise<Estudiante>{if(actor.rol!==UsuarioRol.ESTUDIANTE)throw new ForbiddenException('Solo el estudiante titular puede gestionar su PAT.');const student=await this.studentFor(actor.id);const s=this.schema();const rows=await source.query(`SELECT 1 FROM ${s}."asignacion_tema" a WHERE a."id"=$1 AND a."periodo_id"=$2 AND a."estado"='VIGENTE' AND (a."estudiante_id"=$3 OR EXISTS(SELECT 1 FROM ${s}."grupo_integrante" gi WHERE gi."grupo_id"=a."grupo_id" AND gi."estudiante_id"=$3 AND gi."estado"='ACTIVO'))`,[assignmentId,periodoId,student.id]) as unknown[];if(!rows.length)throw new NotFoundException('No existe una asignación vigente propia.');return student;}
  private async assignment(source:Source,periodoId:string,id:string,lock=false){const rows=await source.query(`SELECT "id","periodo_id","estado"::text AS estado FROM ${this.schema()}."asignacion_tema" WHERE "id"=$1 AND "periodo_id"=$2 ${lock?'FOR UPDATE':''}`,[id,periodoId]) as Array<{id:string;periodo_id:string;estado:string}>;if(!rows[0])throw new NotFoundException('No existe la asignación del período.');return rows[0];}
  private schema(){const n=(this.db.options as PostgresConnectionOptions).schema??'public';if(!/^[a-z][a-z0-9_]{0,62}$/.test(n))throw new ServiceUnavailableException('Esquema PostgreSQL inválido.');return `"${n}"`;}
  private handleError(e:unknown):never{if(e instanceof Error&&'getStatus'in e)throw e;if(e instanceof QueryFailedError){const code=(e.driverError as {code?:string}).code;if(code==='23505')throw new ConflictException('Ya existe el registro PAT solicitado.');if(['23503','23514'].includes(code??''))throw new ConflictException('La operación no cumple las reglas vigentes del PAT.');if(['40001','40P01'].includes(code??''))throw new ConflictException('Otra operación simultánea cambió el PAT; vuelve a intentarlo.');}throw new ServiceUnavailableException('No fue posible completar la operación PAT.',{cause:e});}
}
