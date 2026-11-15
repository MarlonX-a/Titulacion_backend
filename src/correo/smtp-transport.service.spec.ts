import { smtpTransportOptions } from './smtp-transport.service.js';

describe('smtpTransportOptions', () => {
  it('exige STARTTLS cuando SMTP_REQUIRE_TLS está activo y la conexión no es implícita', () => {
    expect(smtpTransportOptions({ host: 'smtp', port: 587, nodeEnv: 'production', requireTls: true }))
      .toEqual({ host: 'smtp', port: 587, secure: false, requireTLS: true });
  });

  it('usa TLS implícito en 465 de production sin requireTLS redundante', () => {
    expect(smtpTransportOptions({ host: 'smtp', port: 465, nodeEnv: 'production', requireTls: true }))
      .toEqual({ host: 'smtp', port: 465, secure: true });
  });

  it('no exige TLS cuando SMTP_REQUIRE_TLS está desactivado (Mailpit local)', () => {
    expect(smtpTransportOptions({ host: '127.0.0.1', port: 1025, nodeEnv: 'development', requireTls: false }))
      .toEqual({ host: '127.0.0.1', port: 1025, secure: false });
  });
});
