/** An error the client may see: the message is written for it and the status says what to do. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}
