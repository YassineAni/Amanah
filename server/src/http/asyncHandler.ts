import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not await async middleware/handlers. If one rejects, the
 * rejection reaches nothing — not Express's error middleware, not any
 * caller — and becomes an unhandled promise rejection, which terminates
 * the whole Node process (default since Node 15), taking down every
 * in-flight request, not just the failing one.
 *
 * Wrap every async handler in this so a thrown/rejected error is routed to
 * next(err) and handled by the app's error middleware instead.
 */
export function asyncHandler<Req extends Request = Request>(
  fn: (req: Req, res: Response, next: NextFunction) => unknown,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req as Req, res, next)).catch(next);
  };
}
