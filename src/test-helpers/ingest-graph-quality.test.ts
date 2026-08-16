import { describe, expect, it } from "vitest"
import {
  evaluateIngestGraphQuality,
  PHYSICS_RELATION_BOUNDARY,
  type WikiPageForGraphQuality,
} from "./ingest-graph-quality"

function page(title: string, related: string[]): WikiPageForGraphQuality {
  return {
    path: `wiki/${title}.md`,
    content: `---\ntype: concept\ntitle: ${title}\nrelated: [${related.join(", ")}]\n---\n\n# ${title}\n`,
  }
}

describe("ingest graph quality regression: physics topic boundaries", () => {
  it("rejects same-batch relations even when useful relations also exist", () => {
    const report = evaluateIngestGraphQuality(
      [
        page("热导率", ["微波通信"]),
        page("安全用电", ["核能"]),
        page("FAST", ["沈括"]),
        page("欧姆定律", ["焦耳定律"]),
        page("电磁感应", ["发电机"]),
      ],
      PHYSICS_RELATION_BOUNDARY,
    )

    expect(report.passes).toBe(false)
    expect(report.forbiddenHits).toEqual([
      { left: "热导率", right: "微波中继通信" },
      { left: "安全用电", right: "核能" },
      { left: "FAST", right: "沈括" },
    ])
    expect(report.expectedHits).toHaveLength(2)
  })

  it("accepts a concise graph that keeps meaningful physics relations", () => {
    const report = evaluateIngestGraphQuality(
      [
        page("欧姆定律", ["焦耳定律"]),
        page("比热容", ["内能"]),
        page("电磁感应", ["发电机"]),
        page("电磁波", ["wiki/entities/地球同步卫星通信.md"]),
        page("热导率", []),
        page("FAST", []),
      ],
      PHYSICS_RELATION_BOUNDARY,
    )

    expect(report.passes).toBe(true)
    expect(report.forbiddenHits).toEqual([])
    expect(report.expectedHits).toHaveLength(4)
  })

  it("rejects an empty graph so de-noising cannot pass by deleting everything", () => {
    const report = evaluateIngestGraphQuality(
      [page("热导率", []), page("电磁感应", []), page("电磁波", [])],
      PHYSICS_RELATION_BOUNDARY,
    )

    expect(report.passes).toBe(false)
    expect(report.forbiddenHits).toEqual([])
    expect(report.expectedHits).toEqual([])
  })
})
