// One small error type so routes can say "this is a 400" or "this is a 404" by throwing,
// instead of every route repeating res.status(...).json({ error: ... }).

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
