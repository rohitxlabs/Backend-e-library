import { resendPasswordSetupEmail } from '../services/password-setup-email.service.js';
import { getEmailStatusCounts, listUsers } from '../services/user.service.js';
import { sendSuccess } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { listUsersQuerySchema, userIdParamSchema } from '../validators/admin.validator.js';
/** GET /api/admin/users?page=1&pageSize=50&status=pending&search=example.com */
export async function getUsers(req, res) {
    const query = listUsersQuerySchema.parse(req.query);
    const { users, total } = await listUsers(query);
    sendSuccess(res, {
        users,
        pagination: {
            page: query.page,
            pageSize: query.pageSize,
            total,
            totalPages: Math.ceil(total / query.pageSize),
        },
    });
}
/** GET /api/admin/email-status */
export async function getEmailStatus(_req, res) {
    sendSuccess(res, await getEmailStatusCounts());
}
/** POST /api/admin/resend-password-setup/:userId */
export async function resendPasswordSetup(req, res) {
    const { userId } = userIdParamSchema.parse(req.params);
    await resendPasswordSetupEmail(userId);
    logger.info('Admin resent password setup email', { userId });
    sendSuccess(res, { sent: true });
}
//# sourceMappingURL=admin.controller.js.map