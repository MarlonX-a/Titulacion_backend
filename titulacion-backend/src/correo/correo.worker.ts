import { createDecipheriv } from 'node:crypto';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Job } from 'bullmq';
import nodemailer from 'nodemailer';
import { verify } from 'argon2';
import { IsNull } from 'typeorm';
import { DataSource } from 'typeorm';
import type { AppEnvironment } from '../config/environment.js';
import { CorreoSalida } from '../auth/entities/correo-salida.entity.js';
import { CredencialUsuario } from '../auth/entities/credencial-usuario.entity.js';
import { SolicitudRecuperacion } from '../auth/entities/solicitud-recuperacion.entity.js';
import { readEncryptionKey, tokenDigest } from '../auth/credentials.js';

@Injectable()
@Processor('correo')
export class CorreoWorker extends WorkerHost {
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly dataSource: DataSource,
    config: ConfigService<AppEnvironment, true>,
  ) {
    super();
    const keyPath = config.get('OUTBOX_ENCRYPTION_KEY_PATH', { infer: true });
    this.encryptionKey = keyPath ? Buffer.from(readEncryptionKey(keyPath), 'base64') : Buffer.alloc(32);
  }

  async process(job: Job<{ id: string }>): Promise<void> {
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
    const host = process.env.SMTP_HOST;
    const sender = process.env.SMTP_FROM;
    if (!host || !sender) throw new ServiceUnavailableException('El envío de correo aún no está configurado.');
    const secret = this.decrypt(message);
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT ?? 1025),
      secure: process.env.NODE_ENV === 'production' && Number(process.env.SMTP_PORT) === 465,
      ...(process.env.SMTP_USERNAME ? { auth: { user: process.env.SMTP_USERNAME, pass: process.env.SMTP_PASSWORD ?? '' } } : {}),
    });
    try {
      await transport.sendMail({
        from: sender,
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
    } finally {
      transport.close();
    }
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
