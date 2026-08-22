import { describe, expect, it } from "vitest"
import { buildLearningRouteProposalScopes, sanitizeBoardProposals, sanitizeProposalNodeDecisions, sanitizeReviewedBoards, type LearningRouteCandidate } from "./learning-route-agent"

const IDS = new Set(["inheritance", "variation", "heritable", "environmental"])

describe("learning route AI result validation", () => {
  it("rejects a proposal response when even one candidate lacks a decision", () => {
    const proposals = sanitizeBoardProposals([{
      title: "遗传与变异",
      centralQuestion: "亲代信息和后代差异有什么关系？",
      kind: "prerequisite",
      nodeIds: ["inheritance", "variation"],
      orderedNodeIds: ["inheritance", "variation"],
      reason: "后项依赖前项。",
      confidence: 0.9,
    }], IDS)

    expect(sanitizeProposalNodeDecisions([
      { nodeId: "inheritance", status: "proposed", reason: "进入候选板块。" },
      { nodeId: "variation", status: "proposed", reason: "进入候选板块。" },
      { nodeId: "heritable", status: "unlinked", reason: "当前批次证据不足。" },
    ], IDS, proposals)).toBeNull()
    expect(sanitizeProposalNodeDecisions([
      { nodeId: "inheritance", status: "proposed", reason: "进入候选板块。" },
      { nodeId: "variation", status: "proposed", reason: "进入候选板块。" },
      { nodeId: "heritable", status: "unlinked", reason: "当前批次证据不足。" },
      { nodeId: "environmental", status: "unlinked", reason: "当前批次证据不足。" },
    ], IDS, proposals)).toHaveLength(4)
  })

  it("splits an oversized mixed area while keeping adjacent topic titles together", () => {
    const candidates: LearningRouteCandidate[] = [
      ...Array.from({ length: 24 }, (_, index) => ({ id: `before-${index}`, title: `甲类知识${String(index).padStart(2, "0")}`, semanticType: "concept", summary: "", sourcePath: "", outline: [], neighborIds: [], content: "" })),
      { id: "quadratic", title: "二次函数", semanticType: "concept", summary: "", sourcePath: "", outline: [], neighborIds: [], content: "" },
      { id: "quadratic-equation", title: "二次函数与一元二次方程的关系", semanticType: "concept", summary: "", sourcePath: "", outline: [], neighborIds: [], content: "" },
      ...Array.from({ length: 24 }, (_, index) => ({ id: `after-${index}`, title: `乙类知识${String(index).padStart(2, "0")}`, semanticType: "concept", summary: "", sourcePath: "", outline: [], neighborIds: [], content: "" })),
    ]

    const scopes = buildLearningRouteProposalScopes(candidates)

    expect(scopes.every((scope) => scope.length <= 20)).toBe(true)
    expect(new Set(scopes.flatMap((scope) => scope.map((candidate) => candidate.id))).size).toBe(candidates.length)
    expect(scopes.some((scope) => scope.some((candidate) => candidate.id === "quadratic") && scope.some((candidate) => candidate.id === "quadratic-equation"))).toBe(true)
  })

  it("adds a focused scope when a graph relation crosses two title windows", () => {
    const candidates: LearningRouteCandidate[] = Array.from({ length: 42 }, (_, index) => ({
      id: `node-${index}`,
      title: `知识${String(index).padStart(2, "0")}`,
      semanticType: "concept",
      summary: "",
      sourcePath: "",
      outline: [],
      neighborIds: index === 0 ? ["node-41"] : index === 41 ? ["node-0"] : [],
      content: "",
    }))

    const scopes = buildLearningRouteProposalScopes(candidates)

    expect(scopes.some((scope) => scope.some((candidate) => candidate.id === "node-0") && scope.some((candidate) => candidate.id === "node-41"))).toBe(true)
  })

  it("keeps category members parallel instead of accepting a fabricated arrow order", () => {
    const result = sanitizeBoardProposals([{
      title: "变异类型",
      centralQuestion: "变异按遗传物质是否变化可以分成哪些类型？",
      kind: "category",
      nodeIds: ["heritable", "environmental"],
      orderedNodeIds: ["environmental", "heritable"],
      reason: "两者使用同一分类标准。",
      confidence: 0.95,
    }], IDS)

    expect(result).toHaveLength(1)
    expect(result[0].orderedNodeIds).toEqual(["heritable", "environmental"])
  })

  it("rejects a long catch-all board instead of silently trimming it", () => {
    const ids = new Set(Array.from({ length: 63 }, (_, index) => `node-${index}`))
    const result = sanitizeBoardProposals([{
      title: "全部生物知识",
      centralQuestion: "生物学有哪些知识？",
      kind: "category",
      nodeIds: [...ids],
      orderedNodeIds: [...ids],
      reason: "都来自生物教材。",
      confidence: 0.99,
    }], ids)

    expect(result).toEqual([])
  })

  it("rejects a process when its order omits a member", () => {
    const result = sanitizeBoardProposals([{
      title: "遗传与变异",
      centralQuestion: "亲代信息和后代差异如何理解？",
      kind: "prerequisite",
      nodeIds: ["inheritance", "variation", "heritable"],
      orderedNodeIds: ["inheritance", "variation"],
      reason: "先理解遗传与变异。",
      confidence: 0.9,
    }], IDS)

    expect(result).toEqual([])
  })

  it("accepts only reviewed boards whose evidence and mnemonic cover every member", () => {
    const base = {
      approved: true,
      title: "遗传与变异",
      centralQuestion: "怎样判断变异能否遗传？",
      kind: "prerequisite",
      nodeIds: ["inheritance", "variation", "heritable"],
      orderedNodeIds: ["inheritance", "variation", "heritable"],
      reason: "后项理解依赖前项定义。",
      confidence: 0.91,
      evidence: [
        { nodeId: "inheritance", detail: "亲代信息传给子代。" },
        { nodeId: "variation", detail: "子代与亲代存在差异。" },
        { nodeId: "heritable", detail: "遗传物质变化可传给后代。" },
      ],
      mnemonic: "先看遗传，再辨差异，基因改变才能传。",
      mnemonicParts: [
        { nodeId: "inheritance", phrase: "先看遗传" },
        { nodeId: "variation", phrase: "再辨差异" },
        { nodeId: "heritable", phrase: "基因改变才能传" },
      ],
    }

    expect(sanitizeReviewedBoards([base], IDS)).toHaveLength(1)
    expect(sanitizeReviewedBoards([{ ...base, mnemonicParts: base.mnemonicParts.slice(0, 2) }], IDS)).toEqual([])
    expect(sanitizeReviewedBoards([{ ...base, evidence: base.evidence.slice(0, 2) }], IDS)).toEqual([])
    expect(sanitizeReviewedBoards([{ ...base, confidence: 0.7 }], IDS)).toEqual([])
  })
})
