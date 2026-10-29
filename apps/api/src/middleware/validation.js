import { z } from 'zod';
export const id = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid identifier');
export const text = (max = 200) => z.string().trim().min(1).max(max);
export function validate(schema, source = 'body') {
  return (req, res, next) => {
    const parsed = schema.safeParse(req[source]);
    if (!parsed.success) return next(parsed.error);
    req.validated ??= {};
    req.validated[source] = parsed.data;
    next();
  };
}
export const validateId = validate(z.object({ id }), 'params');
