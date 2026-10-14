// Errors whose message is safe to show in the UI (no clinical text, no internals).
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly httpStatus: number,
    readonly safeMessage: string,
  ) {
    super(safeMessage);
    this.name = "AppError";
  }
}

export const errors = {
  unauthorized: () => new AppError("UNAUTHORIZED", 401, "Sign in again."),
  forbidden: (msg = "You do not have access to this resource.") => new AppError("FORBIDDEN", 403, msg),
  notFound: (what: string) => new AppError("NOT_FOUND", 404, `${what} not found.`),
  conflict: (msg: string) => new AppError("CONFLICT", 409, msg),
  validation: (msg: string) => new AppError("VALIDATION_ERROR", 400, msg),
};

export function isConditionalCheckFailed(err: unknown): boolean {
  return err instanceof Error && err.name === "ConditionalCheckFailedException";
}

export function isTransactionConditionFailed(err: unknown): boolean {
  return (
    err instanceof Error &&
    err.name === "TransactionCanceledException" &&
    err.message.includes("ConditionalCheckFailed")
  );
}
