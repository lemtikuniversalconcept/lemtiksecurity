type LoggedError = {
  message?: string;
  code?: string;
  details?: string;
  hint?: string;
};

export function throwSafeError(scope: string, error: LoggedError, publicMessage = "Operation failed. Please try again."): never {
  console.error(`[${scope}]`, {
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });
  throw new Error(publicMessage);
}