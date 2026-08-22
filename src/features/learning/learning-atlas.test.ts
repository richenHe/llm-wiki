import { describe, expect, it } from "vitest"
import { buildLearningAtlasFromGraph } from "./learning-atlas"

describe("project learning atlas", () => {
  it("keeps visible learning nodes aligned with real wiki pages", () => {
    const atlas = buildLearningAtlasFromGraph({
      nodes: [
        { id: "contract", label: "合同", type: "concept", path: "/wiki/contract.md", linkCount: 2, community: 0, summary: "合同是当事人之间设立、变更或终止权利义务的协议。", outline: [{ id: "contract::heading:0", title: "合同成立", level: 2, parentId: null, summary: "合同成立需要当事人意思表示一致。" }, { id: "contract::heading:1", title: "承诺", level: 3, parentId: "contract::heading:0", summary: "承诺是受要约人同意要约的意思表示。" }] },
        { id: "offer", label: "要约", type: "concept", path: "/wiki/offer.md", linkCount: 1, community: 0, summary: "要约是希望和他人订立合同的意思表示。" },
        { id: "court", label: "法院", type: "entity", path: "/wiki/court.md", linkCount: 0, community: 1, summary: "法院依法审理案件并作出裁判。" },
      ],
      edges: [{ source: "contract", target: "offer", weight: 1 }],
    })

    expect(atlas.isSample).toBe(false)
    expect(atlas.totalConcepts).toBe(3)
    expect(atlas.regions).toHaveLength(2)
    expect(atlas.nodes.map((node) => node.id).sort()).toEqual(["contract", "court", "offer"])
    expect(atlas.nodes.find((node) => node.id === "contract")?.essence).toContain("权利义务")
    expect(atlas.nodes.find((node) => node.id === "contract")?.parentId).toBeNull()
    expect(atlas.nodes.find((node) => node.id === "offer")?.parentId).toBe("contract")
    expect(atlas.nodes.find((node) => node.id === "court")?.semanticType).toBe("entity")
    expect(atlas.relations).toEqual(expect.arrayContaining([expect.objectContaining({ sourceId: "contract", targetId: "offer", kind: "related" })]))
    expect(atlas.nodes.some((node) => node.id.includes("::heading:"))).toBe(false)
    expect(atlas.nodes.some((node) => node.id.startsWith("atlas-region-"))).toBe(false)
  })

  it("keeps every community available instead of imposing a nine-region layout", () => {
    const nodes = Array.from({ length: 12 }, (_, index) => ({
      id: `node-${index}`,
      label: `知识 ${index}`,
      type: "concept",
      path: `/wiki/node-${index}.md`,
      linkCount: 0,
      community: index,
      summary: `第 ${index} 个知识区域的详细解释。`,
    }))
    const atlas = buildLearningAtlasFromGraph({ nodes, edges: [] })
    expect(atlas.regions).toHaveLength(12)
    expect(atlas.nodes.some((node) => node.id === "node-11")).toBe(true)
  })
})
