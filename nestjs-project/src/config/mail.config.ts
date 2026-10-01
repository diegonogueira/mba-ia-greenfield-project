import { registerAs } from '@nestjs/config';

const MAIL_FROM_NAME = 'StreamTube';

// MAIL_FROM holds only the address so `.env` stays shell-safe (no `<`/`>`);
// the display name is composed here. A full `"Name" <address>` value is kept as-is.
function composeFrom(address: string): string {
  return address.includes('<') ? address : `"${MAIL_FROM_NAME}" <${address}>`;
}

export default registerAs('mail', () => ({
  host: process.env.MAIL_HOST || 'mailpit',
  port: parseInt(process.env.MAIL_PORT || '1025', 10),
  from: composeFrom(process.env.MAIL_FROM || 'noreply@streamtube.com'),
}));
