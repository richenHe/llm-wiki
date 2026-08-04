/**
 * The provider returned usable responses, but the source still needs a
 * targeted repair or a user/config change. Re-running the whole source
 * automatically would repeat completed paid work without changing the cause.
 */
export class IngestNeedsAttentionError extends Error {
  readonly retryable = false

  constructor(message: string) {
    super(message)
    this.name = "IngestNeedsAttentionError"
  }
}

export function isIngestNeedsAttentionError(error: unknown): boolean {
  return error instanceof IngestNeedsAttentionError
    || (
      typeof error === "object"
      && error !== null
      && "retryable" in error
      && (error as { retryable?: unknown }).retryable === false
    )
}
