import { describe, expect, it } from "vitest"
import { extractNodeSource } from "./teaching-context"

describe("teaching source selection", () => {
  it("selects the requested heading and its children without leaking into the next peer section", () => {
    const source = `---\ntitle: 测试\n---\n# 页面\n\n## 第一节\n第一节正文。\n\n### 子节\n子节正文。\n\n## 第二节\n第二节正文。`
    expect(extractNodeSource(source, "page::heading:0")).toContain("子节正文")
    expect(extractNodeSource(source, "page::heading:0")).not.toContain("第二节正文")
    expect(extractNodeSource(source, "page::heading:2")).toContain("第二节正文")
  })

  it("caps whole-page context so one large file cannot consume the model window", () => {
    expect(extractNodeSource("x".repeat(20_000), "page")).toHaveLength(12_000)
  })
})
