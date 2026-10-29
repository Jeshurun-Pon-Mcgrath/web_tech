import { ZodError } from 'zod';
import { logger } from '../utils/logger.js';
export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  let status = error.status || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.message;
  let details;
  if (error instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Check the submitted fields.';
    details = error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
  }
  if (error.code === 11000) {
    status = 409;
    code = 'CONFLICT';
    message = 'A record with these details already exists. Refresh and try again.';
  }
  if (error.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = 'Invalid record identifier.';
  }
  if (status >= 500) {
    logger.error(
      {
        errorType: error.name,
        errorCode: typeof error.code === 'number' ? error.code : undefined,
        requestId: req.id,
      },
      'Request failed',
    );
    message = 'An unexpected error occurred. Please try again.';
    code = 'INTERNAL_ERROR';
  }
  res
    .status(status)
    .json({ error: { code, message, ...(details ? { details } : {}), requestId: req.id } });
}
