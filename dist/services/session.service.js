import { env } from '../config/env.js';
import { query } from '../config/database.js';
import { generateSecureToken, hashToken } from '../utils/crypto.js';
export async function createSession(userId) {
    const sessionId = generateSecureToken();
    const result = await query(`INSERT INTO user_sessions (user_id, session_hash, expires_at)
     VALUES ($1, $2, NOW() + make_interval(hours => $3))
     RETURNING expires_at`, [userId, hashToken(sessionId), env.SESSION_TTL_HOURS]);
    return { sessionId, expiresAt: result.rows[0].expires_at };
}
/** Returns the session's user if the session exists and has not expired. */
export async function findSessionUser(sessionId) {
    const result = await query(`SELECT u.id, u.email
     FROM user_sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.session_hash = $1 AND s.expires_at > NOW() AND u.is_password_set = TRUE`, [hashToken(sessionId)]);
    return result.rows[0] ?? null;
}
export async function deleteSession(sessionId) {
    await query('DELETE FROM user_sessions WHERE session_hash = $1', [hashToken(sessionId)]);
}
export async function deleteExpiredSessions() {
    const result = await query('DELETE FROM user_sessions WHERE expires_at <= NOW()');
    return result.rowCount ?? 0;
}
//# sourceMappingURL=session.service.js.map