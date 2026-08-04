import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createTempProject, realFs } from "@/test-helpers/fs-temp"

vi.mock("@/commands/fs", () => realFs)

import {
  clearGenerationCheckpoint,
  completedGenerationCheckpointPaths,
  createGenerationCheckpoint,
  loadGenerationCheckpoint,
  renderGenerationCheckpoint,
  saveGenerationCheckpoint,
  storeGenerationCheckpointBlocks,
} from "./ingest-generation-checkpoint"

describe("ingest generation checkpoint", () => {
  let tmp: { path: string; cleanup: () => Promise<void> }

  beforeEach(async () => {
    tmp = await createTempProject("generation-checkpoint")
  })

  afterEach(async () => {
    await tmp.cleanup()
  })

  it("persists completed batches and resumes with only unfinished paths", async () => {
    const checkpoint = createGenerationCheckpoint({
      checkpointKey: "source-and-pipeline-v1",
      sourceIdentity: "books/history.pdf",
      analysis: "## Generation Contract\n- [[topics/a]]\n- [[topics/b]]",
      sourceContext: "Chapter evidence",
      requestedPaths: [
        "wiki/sources/history.md",
        "wiki/topics/a.md",
        "wiki/topics/b.md",
      ],
    })

    expect(storeGenerationCheckpointBlocks(checkpoint, [
      { path: "wiki/sources/history.md", content: "# History" },
      { path: "wiki/topics/a.md", content: "# Topic A" },
      { path: "wiki/topics/not-requested.md", content: "# Ignore" },
    ])).toEqual(["wiki/sources/history.md", "wiki/topics/a.md"])
    await saveGenerationCheckpoint(tmp.path, "history", checkpoint)

    const resumed = await loadGenerationCheckpoint(tmp.path, "history", {
      checkpointKey: "source-and-pipeline-v1",
      sourceIdentity: "books/history.pdf",
    })
    expect(resumed).not.toBeNull()
    expect(completedGenerationCheckpointPaths(resumed!)).toEqual(new Set([
      "wiki/sources/history.md",
      "wiki/topics/a.md",
    ]))
    expect(renderGenerationCheckpoint(resumed!)).toContain("---FILE: wiki/topics/a.md---")
    expect(renderGenerationCheckpoint(resumed!)).not.toContain("not-requested")
  })

  it("rejects stale progress after the source or pipeline changes", async () => {
    const checkpoint = createGenerationCheckpoint({
      checkpointKey: "old-key",
      sourceIdentity: "books/history.pdf",
      analysis: "analysis",
      sourceContext: "source context",
      requestedPaths: ["wiki/sources/history.md"],
    })
    await saveGenerationCheckpoint(tmp.path, "history", checkpoint)

    await expect(loadGenerationCheckpoint(tmp.path, "history", {
      checkpointKey: "new-key",
      sourceIdentity: "books/history.pdf",
    })).resolves.toBeNull()
  })

  it("does not let a later repair overwrite an already completed page", () => {
    const checkpoint = createGenerationCheckpoint({
      checkpointKey: "key",
      sourceIdentity: "books/history.pdf",
      analysis: "analysis",
      sourceContext: "source context",
      requestedPaths: ["wiki/topics/a.md", "wiki/topics/b.md"],
    })
    expect(storeGenerationCheckpointBlocks(checkpoint, [
      { path: "wiki/topics/a.md", content: "# First complete result" },
    ])).toEqual(["wiki/topics/a.md"])

    expect(storeGenerationCheckpointBlocks(checkpoint, [
      { path: "wiki/topics/a.md", content: "# Unsolicited replacement" },
      { path: "wiki/topics/b.md", content: "# Newly repaired page" },
    ])).toEqual(["wiki/topics/b.md"])
    expect(renderGenerationCheckpoint(checkpoint)).toContain("# First complete result")
    expect(renderGenerationCheckpoint(checkpoint)).not.toContain("# Unsolicited replacement")
  })

  it("clears progress only after a completed ingest", async () => {
    const checkpoint = createGenerationCheckpoint({
      checkpointKey: "key",
      sourceIdentity: "books/history.pdf",
      analysis: "analysis",
      sourceContext: "source context",
      requestedPaths: ["wiki/sources/history.md"],
    })
    await saveGenerationCheckpoint(tmp.path, "history", checkpoint)
    await clearGenerationCheckpoint(tmp.path, "history")
    await expect(loadGenerationCheckpoint(tmp.path, "history", {
      checkpointKey: "key",
      sourceIdentity: "books/history.pdf",
    })).resolves.toBeNull()
  })
})
