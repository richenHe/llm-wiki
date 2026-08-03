import { describe, expect, it } from "vitest"

import {
  buildCuratedPassthroughSourceSummary,
  isCuratedPassthroughSource,
} from "./ingest"

describe("curated source passthrough", () => {
  const curated = `---
title: Complete lecture
ingest_mode: curated_passthrough
coverage_status: complete
---

# Complete lecture

Exact detail C000001-C000010 and identifier micrograd.Value.

![frame](.cache/archive/package/media/00-01-10.jpg)
`

  it("requires both explicit audit fields", () => {
    expect(isCuratedPassthroughSource(curated)).toBe(true)
    expect(isCuratedPassthroughSource(curated.replace("complete", "incomplete"))).toBe(false)
    expect(isCuratedPassthroughSource("# Ordinary markdown")).toBe(false)
  })

  it("preserves the complete curated body in the source page", () => {
    const result = buildCuratedPassthroughSourceSummary(
      "video-knowledge/lecture.md",
      curated,
      "2026-07-31",
    )
    expect(result).toContain("type: source")
    expect(result).toContain('title: "Complete lecture"')
    expect(result).toContain("Exact detail C000001-C000010 and identifier micrograd.Value.")
    expect(result).toContain("../../raw/sources/video-knowledge/.cache/archive/package/media/00-01-10.jpg")
    expect(result).not.toContain("ingest_mode: curated_passthrough")
  })

  it("returns null for ordinary sources", () => {
    expect(buildCuratedPassthroughSourceSummary(
      "notes.md",
      "# Ordinary markdown",
      "2026-07-31",
    )).toBeNull()
  })
})
