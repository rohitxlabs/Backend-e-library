/** Consistent success envelope: { success: true, data }. Errors are shaped by error.middleware. */
export function sendSuccess(res, data, statusCode = 200) {
    res.status(statusCode).json({ success: true, data });
}
//# sourceMappingURL=http.js.map