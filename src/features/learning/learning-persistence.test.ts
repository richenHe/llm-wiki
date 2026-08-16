import { describe, expect, it } from "vitest"
import { parseLearningSnapshot } from "./learning-persistence"

describe("learning progress migration", () => {
  it("migrates the old length-based status without preserving unsupported attempts", () => {
    const result = parseLearningSnapshot(JSON.stringify({
      schemaVersion: 2,
      selectedNodeId: "cache",
      masteryByNode: { cache: "practiced", old: "understood" },
      attempts: [{ nodeId: "cache", answer: "old", kind: "self-explanation" }],
      updatedAt: "2026-08-01T00:00:00.000Z",
    }))
    expect(result?.schemaVersion).toBe(3)
    expect(result?.masteryByNode).toEqual({ cache: "learning", old: "learning" })
    expect(result?.attempts).toEqual([])
  })
})
