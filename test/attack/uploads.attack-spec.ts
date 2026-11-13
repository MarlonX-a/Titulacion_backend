import { request as httpRequest } from 'node:http';
import { BadRequestException, UnsupportedMediaTypeException } from '@nestjs/common';
import request from 'supertest';
import { validatePlantillaFile } from '../../src/plantillas-pat/plantilla-pat-file.validator.js';
import {
  ARCHIVOS_MALICIOSOS, DOCX_MIME, PDF_MIME, docxBenigno, pdfActualizacionIncremental, pdfBenigno, pdfIccBasado, pdfLinealizado, pdfLongitudIndirecta,
  pdfModernoBenigno, pdfObjStmBenigno,
} from '../fixtures/attack/archivos-maliciosos.mjs';
import { crearCuenta, tokenDe, type Cuenta } from './support/actors.js';
import { sembrarEscenario, sembrarTrabajosIndividuales, type EscenarioBase, type TrabajoIndividual } from './support/escenario.js';
import { bootAttackApp, type AttackApp } from './support/harness.js';

const multerFile = (originalname: string, mimetype: string, buffer: Buffer) => ({ originalname, mimetype, buffer, size: buffer.length }) as Express.Multer.File;

describe('Subidas PAT (ataque)', () => {
  let attack: AttackApp;
  let e: EscenarioBase;
  let periodo: string;
  let plantilla: string;
  let trabajos: TrabajoIndividual[];

  const subir = async (cuenta: Cuenta, asignacionId: string, nombre: string, mime: string, contenido: Buffer) =>
    request(attack.baseUrl).post(`/periodos/${periodo}/asignaciones-tema/${asignacionId}/documentos-pat`)
      .set('Authorization', `Bearer ${await tokenDe(attack, cuenta)}`)
      .field('plantilla_id', plantilla)
      .attach('archivo', contenido, { filename: nombre, contentType: mime });
  const versiones = async (asignacionId: string) => (await attack.db.query(`SELECT count(*)::int AS total FROM ${attack.s}."documento_pat" WHERE "asignacion_tema_id"=$1`, [asignacionId]) as Array<{ total: number }>)[0]!.total;

  beforeAll(async () => {
    attack = await bootAttackApp();
    e = await sembrarEscenario(attack);
    ({ periodoId: periodo, plantillaId: plantilla, trabajos } = await sembrarTrabajosIndividuales(attack, e.admin, e.docente, ARCHIVOS_MALICIOSOS.length + 4));
  });
  afterAll(async () => { await attack?.close(); });
  beforeEach(async () => { await attack.flushLimiter(); });

  describe('[M5] validador de contenido', () => {
    it('[regresión] el validador acepta un PDF y un DOCX benignos', () => {
      expect(validatePlantillaFile(multerFile('pat.pdf', PDF_MIME, pdfBenigno())).extension).toBe('pdf');
      expect(validatePlantillaFile(multerFile('pat.docx', DOCX_MIME, docxBenigno())).extension).toBe('docx');
      expect(validatePlantillaFile(multerFile('moderno.pdf', PDF_MIME, pdfObjStmBenigno())).extension).toBe('pdf');
    });

    it('[regresión] el validador acepta PDF benignos con /Length indirecto, stream de referencias, actualización incremental, linealización y perfil ICC', () => {
      for (const contenido of [pdfLongitudIndirecta('correcto'), pdfModernoBenigno(), pdfActualizacionIncremental(), pdfLinealizado(), pdfIccBasado()]) {
        expect(validatePlantillaFile(multerFile('pat.pdf', PDF_MIME, contenido)).extension).toBe('pdf');
      }
    });

    for (const fixture of ARCHIVOS_MALICIOSOS) {
      it(`[M5] el validador rechaza ${fixture.nombre}`, () => {
        let error: unknown;
        try { validatePlantillaFile(multerFile(fixture.archivo, fixture.mime, fixture.contenido())); } catch (caught: unknown) { error = caught; }
        expect(error instanceof BadRequestException || error instanceof UnsupportedMediaTypeException, 'el archivo pasó la validación').toBe(true);
      });
    }
  });

  describe('[M5] subida HTTP real', () => {
    ARCHIVOS_MALICIOSOS.forEach((fixture, index) => {
      it(`[M5] la API rechaza la entrega de ${fixture.nombre}`, async () => {
        const trabajo = trabajos[index]!;
        const response = await subir(trabajo.titular, trabajo.asignacionId, fixture.archivo, fixture.mime, fixture.contenido());
        if (fixture.estado === undefined) expect([400, 415, 422]).toContain(response.status);
        else expect(response.status).toBe(fixture.estado);
        expect(await versiones(trabajo.asignacionId)).toBe(0);
      });
    });
  });

  describe('[A6] autorización y límites de subida', () => {
    it('[regresión] un estudiante no puede subir al trabajo de otro', async () => {
      const ajeno = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const trabajo = trabajos[ARCHIVOS_MALICIOSOS.length]!;
      const response = await subir(ajeno, trabajo.asignacionId, 'pat.pdf', PDF_MIME, pdfBenigno());
      expect([403, 404]).toContain(response.status);
      expect(await versiones(trabajo.asignacionId)).toBe(0);
    });

    it('[A6] una subida a un trabajo ajeno se rechaza antes de recibir el cuerpo', async () => {
      const ajeno = await crearCuenta(attack, { rol: 'ESTUDIANTE' });
      const trabajo = trabajos[ARCHIVOS_MALICIOSOS.length]!;
      const token = await tokenDe(attack, ajeno);
      const boundary = '----ataque-preautorizacion';
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="plantilla_id"\r\n\r\n${plantilla}\r\n--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="pat.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n`);
      const declared = 9 * 1024 * 1024;
      const status = await new Promise<number | 'sin respuesta'>((resolve) => {
        const req = httpRequest(`${attack.baseUrl}/periodos/${periodo}/asignaciones-tema/${trabajo.asignacionId}/documentos-pat`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(declared) },
        });
        const timer = setTimeout(() => { req.destroy(); resolve('sin respuesta'); }, 3_000);
        req.on('response', (response) => { clearTimeout(timer); response.resume(); req.destroy(); resolve(response.statusCode ?? 0); });
        req.on('error', () => undefined);
        req.write(head);
        req.write(Buffer.alloc(64 * 1024, 0x41));
      });
      expect(status, 'el servidor esperó el cuerpo completo antes de autorizar').not.toBe('sin respuesta');
      expect([401, 403, 404]).toContain(status);
    });

    it('[A6] subidas repetidas del mismo usuario alcanzan un límite (429)', async () => {
      const trabajo = trabajos[ARCHIVOS_MALICIOSOS.length + 1]!;
      const statuses: number[] = [];
      for (let i = 0; i < 15; i += 1) statuses.push((await subir(trabajo.titular, trabajo.asignacionId, `pat-${i}.pdf`, PDF_MIME, pdfBenigno())).status);
      expect(statuses).toContain(429);
    });
  });

  describe('[A6] una subida simultánea por usuario', () => {
    const cupo = (cuenta: Cuenta) => attack.redis.get(`titulacion:auth-rate:rl:subir-pat:concurrentes:${cuenta.usuarioId}`);
    const esperarCupo = async (cuenta: Cuenta, valor: (actual: string | null) => boolean) => {
      for (let i = 0; i < 200; i += 1) {
        if (valor(await cupo(cuenta))) return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error('El cupo de subida no alcanzó el estado esperado.');
    };

    /**
     * Abre una entrega PDF real y retiene el final del cuerpo: el servidor ya pasó los guards (cupo
     * tomado) y multer espera el resto. `terminar` envía lo que falta; `abortar` corta la conexión.
     */
    const subidaRetenida = async (cuenta: Cuenta, asignacionId: string) => {
      const boundary = '----ataque-concurrencia';
      const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="plantilla_id"\r\n\r\n${plantilla}\r\n--${boundary}\r\nContent-Disposition: form-data; name="archivo"; filename="pat.pdf"\r\nContent-Type: ${PDF_MIME}\r\n\r\n`);
      const contenido = pdfBenigno();
      const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
      const token = await tokenDe(attack, cuenta);
      const req = httpRequest(`${attack.baseUrl}/periodos/${periodo}/asignaciones-tema/${asignacionId}/documentos-pat`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': String(head.length + contenido.length + tail.length) },
      });
      const respuesta = new Promise<{ status: number; body: string }>((resolve, reject) => {
        req.on('response', (response) => {
          let body = '';
          response.setEncoding('utf8');
          response.on('data', (chunk: string) => { body += chunk; });
          response.on('end', () => resolve({ status: response.statusCode ?? 0, body }));
        });
        req.on('error', reject);
      });
      respuesta.catch(() => undefined);
      req.write(head);
      req.write(contenido.subarray(0, 8));
      return {
        terminar: () => { req.end(Buffer.concat([contenido.subarray(8), tail])); return respuesta; },
        abortar: () => { req.destroy(); },
      };
    };

    it('[A6] subidas simultáneas del mismo usuario: solo una se procesa y las demás reciben 429', async () => {
      const trabajo = trabajos[ARCHIVOS_MALICIOSOS.length + 2]!;
      const retenida = await subidaRetenida(trabajo.titular, trabajo.asignacionId);
      let primera: { status: number; body: string };
      try {
        await esperarCupo(trabajo.titular, (actual) => actual === '1');
        const simultaneas = await Promise.all(Array.from({ length: 5 }, (_, i) => subir(trabajo.titular, trabajo.asignacionId, `pat-${i}.pdf`, PDF_MIME, pdfBenigno())));
        expect(simultaneas.map((response) => response.status)).toEqual([429, 429, 429, 429, 429]);
        primera = await retenida.terminar();
      } finally {
        // Una conexión retenida impediría cerrar el servidor si la prueba falla a medias.
        retenida.abortar();
      }
      expect(primera.status).toBe(201);
      expect(await versiones(trabajo.asignacionId)).toBe(1);

      // Cupo devuelto al terminar: tras la revisión OBSERVADO, una entrega secuencial vuelve a procesarse.
      await esperarCupo(trabajo.titular, (actual) => actual === null || actual === '0');
      const documentoId = (JSON.parse(primera.body) as { id: string }).id;
      const revision = await request(attack.baseUrl).post(`/periodos/${periodo}/asignaciones-tema/${trabajo.asignacionId}/documentos-pat/${documentoId}/revision`)
        .set('Authorization', `Bearer ${await tokenDe(attack, e.admin)}`).send({ resultado: 'OBSERVADO', observaciones: 'Corregir el formato.' });
      expect(revision.status).toBe(201);
      expect((await subir(trabajo.titular, trabajo.asignacionId, 'pat-corregido.pdf', PDF_MIME, pdfBenigno())).status).toBe(201);
      expect(await versiones(trabajo.asignacionId)).toBe(2);
    });

    it('[A6] una subida abortada libera el cupo y la siguiente entrega se procesa', async () => {
      const trabajo = trabajos[ARCHIVOS_MALICIOSOS.length + 3]!;
      const retenida = await subidaRetenida(trabajo.titular, trabajo.asignacionId);
      try {
        await esperarCupo(trabajo.titular, (actual) => actual === '1');
      } finally {
        retenida.abortar();
      }
      await esperarCupo(trabajo.titular, (actual) => actual === null || actual === '0');
      expect((await subir(trabajo.titular, trabajo.asignacionId, 'pat.pdf', PDF_MIME, pdfBenigno())).status).toBe(201);
      expect(await versiones(trabajo.asignacionId)).toBe(1);
    });
  });

  describe('[B] tamaño de observaciones', () => {
    it('[B] una revisión con observaciones sin tope (50 000 caracteres) responde 400', async () => {
      const response = await request(attack.baseUrl)
        .post(`/periodos/${e.periodoCerrado}/asignaciones-tema/${e.asignacionGrupal}/documentos-pat/${e.documentoGrupal}/revision`)
        .set('Authorization', `Bearer ${await tokenDe(attack, e.admin)}`)
        .send({ resultado: 'OBSERVADO', observaciones: 'x'.repeat(50_000) });
      expect(response.status).toBe(400);
    });
  });
});
