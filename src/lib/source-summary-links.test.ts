import { describe, expect, it } from "vitest"
import { upsertSourceKnowledgeLinks } from "./source-summary-links"

describe("source summary knowledge links", () => {
  it("adds clickable links and replaces the owned section idempotently", () => {
    const first = upsertSourceKnowledgeLinks("# 教材\n", [
      { target: "concepts/安全意识", title: "安全意识" },
      { target: "concepts/生命韧性", title: "生命韧性" },
    ])
    expect(first).toContain("[[concepts/安全意识|安全意识]]")
    expect(first).toContain("## 本来源已整理的知识页面")
    const second = upsertSourceKnowledgeLinks(first, [
      { target: "concepts/安全意识", title: "安全意识" },
    ])
    expect(second.match(/llm-wiki:knowledge-links:start/g)).toHaveLength(1)
    expect(second).not.toContain("生命韧性")
  })
})
