import { describe, expect, it } from "vitest"
import { stripManagedEmbeddedImagesForIndex } from "./embedded-images"

describe("stripManagedEmbeddedImagesForIndex", () => {
  it("keeps source prose but removes the managed image appendix", () => {
    const input = `---\ntitle: 教材\n---\n\n# 核心摘要\n\n二次函数。\n\n<!-- llm-wiki:embedded-images -->\n## Embedded Images\n![噪音说明](media/page.png)\n<!-- llm-wiki:embedded-images -->\n`

    const output = stripManagedEmbeddedImagesForIndex(input)
    expect(output).toContain("二次函数")
    expect(output).not.toContain("噪音说明")
    expect(output).not.toContain("media/page.png")
  })

  it("leaves ordinary user-authored images untouched", () => {
    const input = "# 概念\n\n![关键图](media/key.png)"
    expect(stripManagedEmbeddedImagesForIndex(input)).toBe(input)
  })

  it("drops an unterminated managed tail defensively", () => {
    const input = "# 摘要\n正文\n<!-- llm-wiki:embedded-images -->\n大量自动图片说明"
    expect(stripManagedEmbeddedImagesForIndex(input)).toBe("# 摘要\n正文\n")
  })
})
