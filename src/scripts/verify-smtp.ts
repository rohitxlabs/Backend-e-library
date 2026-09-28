/**
 * Checks that the SMTP settings in .env work, without sending any email.
 *
 *   npm run email:verify-smtp
 */
import { closeEmailTransport, verifyEmailTransport } from '../services/email.service.js';
import { logger } from '../utils/logger.js';

const ok = await verifyEmailTransport();
if (ok) logger.info('SMTP connection and authentication OK');
closeEmailTransport();
process.exit(ok ? 0 : 1);
