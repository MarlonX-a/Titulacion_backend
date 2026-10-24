import { createDecipheriv, randomUUID } from 'node:crypto';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Job } from 'bullmq';
import { verify } from 'argon2';
import { IsNull } from 'typeorm';
import { DataSource } from 'typeorm';
import type { AppEnvironment } from '../config/environment.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { SolicitudRecuperacion } from '../auth/entities/solicitud-recuperacion.entity.js';
import { readEncryptionKey, tokenDigest } from '../auth/credentials.js';
import { EntregaCorreoEstado } from '../notificaciones/enums/entrega-correo-estado.enum.js';
import { SmtpTransportService } from './smtp-transport.service.js';
import type { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';

interface NotificationJob { id: string; generation?: number }
interface ClaimedDelivery { notificacion_id: string; usuario_id: string; email: string; titulo: string; mensaje: string; intentos: number; reserva_token: string }

@Injectable()
@Processor('correo')
export class CorreoWorker extends WorkerHost {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService<AppEnvironment, true>,
    private readonly smtp: SmtpTransportService,
  ) {
    super();
    const keyPath = config.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
    this.encryptionKey = keyPath ? Buffer.from(readEncryptionKey(keyPath), 'base64') : Buffer.alloc(32);
  }

  async process(job: Job<NotificationJob>): Promise<void> {
    if (job.name === 'enviar-notificacion') return this.sendNotification(job.data.id, job.data.generation ?? 0);
    const repo = this.dataSource.getRepository(CorreoSalida);
    const message = await repo.findOne({ where: { id: job.data.id }, relations: { usuario: true } });
    if (!message || message.enviado_en || message.expira_en <= new Date()) return;
    if (!await this.isCurrent(message)) {
      message.secreto_cifrado = '';
      message.tag = '';
      message.nonce = '';
      await repo.save(message);
      return;
    }
    const secret = this.decrypt(message);
    try {
      await this.smtp.send({
        to: message.usuario.email,
        subject: message.tipo === 'ACCESO' ? 'Acceso al Sistema de Titulación' : 'Recuperación de contraseña',
        text: message.tipo === 'ACCESO'
          ? `Tu contraseña temporal es: ${secret}\nVence en 72 horas. Inicia sesión y define una contraseña personal.`
          : `Tu código para restablecer la contraseña es: ${secret}\nVence en 30 minutos. Si no solicitaste este cambio, ignora este correo.`,
      });
      message.enviado_en = new Date();
      message.secreto_cifrado = '';
      message.tag = '';
      message.nonce = '';
      await repo.save(message);
    } catch (error: unknown) {
      message.intentos += 1;
      await repo.save(message).catch(() => undefined);
      throw error;
    }
  }

  private async sendNotification(id: string, generation: number): Promise<void> {
    const s = this.schema();
    const reservationToken = randomUUID();
    const result: unknown = await this.dataSource.query(`
      UPDATE ${s}."entrega_correo_notificacion" e SET "estado"='PROCESANDO', "intentos"=e."intentos"+1,
        "reserva_hasta"=CURRENT_TIMESTAMP + INTERVAL '2 minutes', "reserva_token"=$3, "actualizada_en"=CURRENT_TIMESTAMP, "ultimo_error"=NULL
      FROM ${s}."notificacion" n JOIN ${s}."usuario" u ON u."id"=n."usuario_id"
      WHERE e."id"=$1 AND e."generacion_reintento"=$2 AND e."notificacion_id"=n."id" AND n."canal"='EMAIL' AND u."estado"='ACTIVO'
        AND e."estado"='PENDIENTE' AND e."intentos"<5
      RETURNING n."id" AS notificacion_id, n."usuario_id", u."email", n."titulo", n."mensaje", e."intentos", e."reserva_token"`, [id, generation, reservationToken]);
    const delivery = this.queryRows<ClaimedDelivery>(result)[0];
    if (!delivery) {
      await this.dataSource.query(`UPDATE ${s}."entrega_correo_notificacion" e SET "estado"='OMITIDO', "reserva_hasta"=NULL, "reserva_token"=NULL, "actualizada_en"=CURRENT_TIMESTAMP WHERE e."id"=$1 AND e."generacion_reintento"=$2 AND e."estado"='PENDIENTE' AND NOT EXISTS (SELECT 1 FROM ${s}."notificacion" n JOIN ${s}."usuario" u ON u."id"=n."usuario_id" WHERE n."id"=e."notificacion_id" AND u."estado"='ACTIVO')`, [id, generation]);
      return;
    }
    const account = await this.dataSource.query(`SELECT 1 FROM ${s}."usuario" WHERE "id"=$1 AND "estado"='ACTIVO'`, [delivery.usuario_id]) as unknown[];
    if (!account.length) {
      await this.dataSource.query(`UPDATE ${s}."entrega_correo_notificacion" SET "estado"='OMITIDO', "reserva_hasta"=NULL, "reserva_token"=NULL, "actualizada_en"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "estado"='PROCESANDO' AND "reserva_token"=$2`, [id, reservationToken]);
      return;
    }
    try {
      await this.smtp.send({ to: delivery.email, subject: delivery.titulo, text: `${delivery.mensaje}\n\nConsulta los detalles ingresando al Sistema de Titulación.` });
      await this.dataSource.transaction(async (manager) => {
        const result: unknown = await manager.query(`UPDATE ${s}."entrega_correo_notificacion" SET "estado"='ENVIADO', "enviada_en"=CURRENT_TIMESTAMP, "reserva_hasta"=NULL, "reserva_token"=NULL, "actualizada_en"=CURRENT_TIMESTAMP WHERE "id"=$1 AND "estado"='PROCESANDO' AND "reserva_token"=$2 RETURNING "notificacion_id"`, [id, reservationToken]);
        if (this.queryRows<{ notificacion_id: string }>(result).length) await manager.query(`UPDATE ${s}."notificacion" SET "fecha_envio"=CURRENT_TIMESTAMP WHERE "id"=$1`, [delivery.notificacion_id]);
      });
    } catch {
      const state = delivery.intentos >= 5 ? EntregaCorreoEstado.FALLIDO : EntregaCorreoEstado.PENDIENTE;
      await this.dataSource.query(`UPDATE ${s}."entrega_correo_notificacion" SET "estado"=$3, "reserva_hasta"=NULL, "reserva_token"=NULL, "actualizada_en"=CURRENT_TIMESTAMP, "ultimo_error"='No fue posible entregar el correo.' WHERE "id"=$1 AND "estado"='PROCESANDO' AND "reserva_token"=$2`, [id, reservationToken, state]);
      throw new ServiceUnavailableException('No fue posible entregar el correo de notificación.');
    }
  }

  private schema(): string {
    const schema = (this.dataSource.options as PostgresConnectionOptions).schema ?? 'public';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new ServiceUnavailableException('El esquema PostgreSQL configurado no es válido.');
    return `"${schema}"`;
  }

  private queryRows<T>(result: unknown): T[] {
    if (!Array.isArray(result)) return [];
    return (Array.isArray(result[0]) ? result[0] : result) as T[];
  }

  private async isCurrent(message: CorreoSalida): Promise<boolean> {
    if (message.tipo === 'ACCESO') {
      const credential = await this.dataSource.getRepository(CredencialUsuario).findOneBy({ usuario_id: message.usuario_id });
      if (!credential?.requiere_cambio || !credential.password_hash || !credential.temporal_expira_en || credential.temporal_expira_en <= new Date()) return false;
      return verify(credential.password_hash, this.decrypt(message)).catch(() => false);
    }
    const reset = await this.dataSource.getRepository(SolicitudRecuperacion).findOneBy({ usuario_id: message.usuario_id, codigo_hash: tokenDigest(this.decrypt(message)), usada_en: IsNull() });
    return Boolean(reset?.expira_en && reset.expira_en > new Date());
  }

  private decrypt(message: CorreoSalida): string {
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(message.nonce, 'hex'));
    decipher.setAuthTag(Buffer.from(message.tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(message.secreto_cifrado, 'base64')), decipher.final()]).toString('utf8');
  }
}
