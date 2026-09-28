/**
 * An error whose message is safe to show to API clients. Anything that is not an AppError is
 * reported to clients as a generic 500.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const Errors = {
  invalidToken: () => new AppError(400, 'Invalid or expired token'),
  invalidCredentials: () => new AppError(401, 'Invalid email or password'),
  unauthenticated: () => new AppError(401, 'Authentication required'),
  unauthorized: () => new AppError(401, 'Unauthorized'),
  forbidden: (message = 'Forbidden') => new AppError(403, message),
  notFound: (message = 'Not found') => new AppError(404, message),
  conflict: (message: string) => new AppError(409, message),
  emailDeliveryFailed: () => new AppError(502, 'Failed to send email. Please try again later.'),
};
