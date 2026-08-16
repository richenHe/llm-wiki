import { describe, expect, it } from "vitest"
import {
  buildSourceEvidenceIndex,
  evaluateCrossSourceMerge,
} from "./ingest-merge-boundary"

const page = (title: string, sources: string[]) => `---
type: comparison
title: ${title}
sources: [${sources.map((source) => JSON.stringify(source)).join(", ")}]
---

# ${title}
`

describe("cross-source ingest merge boundary", () => {
  it("blocks an unrelated math source from modifying an existing biology page", () => {
    const evidence = buildSourceEvidenceIndex(
      "二次函数的图象是一条抛物线。顶点和对称轴决定图象的位置。",
    )

    expect(evaluateCrossSourceMerge({
      existingContent: page("可遗传变异与不可遗传变异的对比", ["生物教材.pdf"]),
      incomingSourceIdentity: "数学教材.pdf",
      pagePath: "wiki/comparisons/可遗传变异与不可遗传变异的对比.md",
      evidence,
    })).toMatchObject({ allow: false })
  })

  it("allows a genuinely shared topic across two sources", () => {
    const evidence = buildSourceEvidenceIndex(
      "本章研究二次函数、抛物线、顶点及对称轴。",
    )

    expect(evaluateCrossSourceMerge({
      existingContent: page("二次函数", ["数学教材上册.pdf"]),
      incomingSourceIdentity: "数学教材下册.pdf",
      pagePath: "wiki/concepts/二次函数.md",
      evidence,
    })).toMatchObject({ allow: true })
  })

  it("allows a comparison title when both core subjects occur in the source", () => {
    const evidence = buildSourceEvidenceIndex(
      "可遗传变异涉及遗传物质改变，不可遗传变异通常由环境引起。",
    )

    expect(evaluateCrossSourceMerge({
      existingContent: page("可遗传变异与不可遗传变异的对比", ["生物讲义.md"]),
      incomingSourceIdentity: "生物教材.pdf",
      pagePath: "wiki/comparisons/可遗传变异与不可遗传变异的对比.md",
      evidence,
    })).toMatchObject({ allow: true })
  })

  it("allows a synthesized descriptive title when its core concept is explicit", () => {
    const evidence = buildSourceEvidenceIndex("本节讲解角平分线，并展示作图步骤。")

    expect(evaluateCrossSourceMerge({
      existingContent: page("角平分线尺规作图", ["几何讲义.md"]),
      incomingSourceIdentity: "数学教材.pdf",
      pagePath: "wiki/concepts/角平分线尺规作图.md",
      evidence,
    })).toMatchObject({ allow: true })
  })

  it("does not block re-ingesting a source already cited by a shared page", () => {
    const evidence = buildSourceEvidenceIndex("修订内容没有重复页面标题。")

    expect(evaluateCrossSourceMerge({
      existingContent: page("二次函数", ["旧资料.pdf", "数学教材.pdf"]),
      incomingSourceIdentity: "数学教材.pdf",
      pagePath: "wiki/concepts/二次函数.md",
      evidence,
    })).toMatchObject({ allow: true })
  })
})
