import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppEnvironment } from '../config/environment.js';
import nodemailer from 'nodemailer';

export interface SmtpTlsInput { host: string; port: number; nodeEnv?: string; requireTls?: boolean }

/**
 * Opciones de transporte: TLS implícito en el puerto 465 de production; con SMTP_REQUIRE_TLS y
 * una conexión que no es implícita se exige STARTTLS (`requireTLS`) para que no pueda degradarse
 * a texto plano.
 */
export function smtpTransportOptions(input: SmtpTlsInput): { host: string; port: number; secure: boolean; requireTLS?: true } {
  const secure = input.nodeEnv === 'production' && input.port === 465;
  return {
    host: input.host, port: input.port, secure,
    ...(input.requireTls === true && !secure ? { requireTLS: true as const } : {}),
  };
}

@Injectable()
export class SmtpTransportService {
  constructor(private readonly config: ConfigService<AppEnvironment, true>) {}

  async send(input: { to: string; subject: string; text: string }): Promise<void> {
    const host = this.config.get('SMTP_HOST', { infer: true });
    const sender = this.config.get('SMTP_FROM', { infer: true });
    if (!host || !sender) throw new ServiceUnavailableException('El envío de correo aún no está configurado.');
    const port = this.config.get('SMTP_PORT', { infer: true });
    const environment = this.config.get('NODE_ENV', { infer: true });
    const username = this.config.get('SMTP_USERNAME', { infer: true });
    const password = this.config.get('SMTP_PASSWORD', { infer: true });
    const options = smtpTransportOptions({
      host, port, nodeEnv: environment, requireTls: this.config.get('SMTP_REQUIRE_TLS', { infer: true }),
    });
    const transport = nodemailer.createTransport({
      ...options,
      connectionTimeout: 30_000, greetingTimeout: 30_000, socketTimeout: 30_000,
      ...(username ? { auth: { user: username, pass: password ?? '' } } : {}),
    });
    try { await transport.sendMail({ from: sender, ...input }); }
    finally { transport.close(); }
  }
}
