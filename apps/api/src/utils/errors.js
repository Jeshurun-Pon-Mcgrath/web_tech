export class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}
export function assert(condition, status, code, message) {
  if (!condition) throw new AppError(status, code, message);
}
