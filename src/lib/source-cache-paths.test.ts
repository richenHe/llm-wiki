import { describe, expect, it } from "vitest"

import { sourceCachePaths } from "./source-cache-paths"

describe("sourceCachePaths", () => {
  it("separates preview text from authoritative MinerU Markdown", () => {
    const paths = sourceCachePaths("D:/wiki/raw/sources/books/report.pdf")

    expect(paths.previewText).toBe("D:/wiki/raw/sources/books/.cache/report.pdf.txt")
    expect(paths.mineruMarkdown).toBe("D:/wiki/raw/sources/books/.cache/mineru/report.pdf.md")
    expect(paths.mineruMetadata).toBe("D:/wiki/raw/sources/books/.cache/mineru/report.pdf.md.meta.json")
    expect(paths.mineruParts).toBe("D:/wiki/raw/sources/books/.cache/mineru/report.pdf.md.parts")
    expect(paths.mineruMarkdown).not.toBe(paths.previewText)
  })

  it("keeps the legacy metadata path available for safe cleanup", () => {
    const paths = sourceCachePaths("D:\\wiki\\raw\\sources\\report.pdf")

    expect(paths.legacyMineruMetadata).toBe("D:/wiki/raw/sources/.cache/report.pdf.txt.meta.json")
  })
})
