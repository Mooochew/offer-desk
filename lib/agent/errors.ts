/**
 * An error the model can act on (fix its call, or ask the user). Returned to the model as
 * `{ error: { code, message } }`; never thrown to the user as a crash.
 */
export class ToolError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
