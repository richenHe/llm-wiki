import { beforeEach, describe, expect, it, vi } from "vitest"
import { findLocalMarkdownImageRefs, renderAndSavePdfPages } from "./extract-source-images"

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }))

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }))

beforeEach(() => {
  invokeMock.mockReset()
})

describe("findLocalMarkdownImageRefs", () => {
  it("extracts Obsidian and markdown local image references", () => {
    const refs = findLocalMarkdownImageRefs(`
![[attachments/chart.png]]
![Figure](images/plot%201.jpg "title")
![Remote](https://example.com/a.png)
![[attachments/chart.png|400]]
`)
    expect(refs).toEqual(["attachments/chart.png", "images/plot 1.jpg"])
  })

  it("ignores non-image links and remote/data references", () => {
    const refs = findLocalMarkdownImageRefs(`
![Doc](notes/page.md)
![Data](data:image/png;base64,abc)
![[draft.txt]]
`)
    expect(refs).toEqual([])
  })
})

describe("renderAndSavePdfPages", () => {
  it("dispatches the strict PDF visual fallback to the Rust renderer", async () => {
    invokeMock.mockResolvedValue([{
      index: 1,
      mimeType: "image/png",
      page: 1,
      width: 1600,
      height: 2200,
      relPath: "media/book/pages/page-0001.png",
      absPath: "D:/wiki/wiki/media/book/pages/page-0001.png",
      sha256: "abc",
    }])

    await expect(renderAndSavePdfPages("D:/wiki", "D:/wiki/raw/sources/book.pdf", "book"))
      .resolves.toHaveLength(1)
    expect(invokeMock).toHaveBeenCalledWith("render_and_save_pdf_pages_cmd", {
      sourcePath: "D:/wiki/raw/sources/book.pdf",
      destDir: "D:/wiki/wiki/media/book/pages",
      relTo: "D:/wiki/wiki",
    })
  })

  it("does nothing for non-PDF sources", async () => {
    await expect(renderAndSavePdfPages("D:/wiki", "D:/wiki/raw/sources/book.docx"))
      .resolves.toEqual([])
    expect(invokeMock).not.toHaveBeenCalled()
  })
})
