import { z } from 'zod';
export const userIdParamSchema = z.object({
    userId: z.coerce.number().int().positive().max(2_147_483_647),
});
export const listUsersQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    status: z.enum(['pending', 'sent', 'failed', 'password_set']).optional(),
    search: z.string().trim().min(1).max(255).optional(),
});
//# sourceMappingURL=admin.validator.js.map