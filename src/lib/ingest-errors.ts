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

/**
 * The source cannot be prepared without user intervention. The queue keeps
 * the current task pending and pauses before it starts another document.
 */
export class IngestQueuePauseError extends Error {
  readonly pauseIngestQueue = true

  constructor(message: string) {
    super(message)
    this.name = "IngestQueuePauseError"
  }
}

export function isIngestQueuePauseError(error: unknown): boolean {
  return error instanceof IngestQueuePauseError
    || (
      typeof error === "object"
      && error !== null
      && "pauseIngestQueue" in error
      && (error as { pauseIngestQueue?: unknown }).pauseIngestQueue === true
    )
}
