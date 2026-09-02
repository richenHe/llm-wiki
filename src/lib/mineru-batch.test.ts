import { beforeEach, describe, expect, it, vi } from "vitest"

const fsMocks = vi.hoisted(() => ({
  createDirectory: vi.fn<() => Promise<void>>(),
  deleteFile: vi.fn<(path: string) => Promise<void>>(),
  fileExists: vi.fn<(path: string) => Promise<boolean>>(),
  getFileSize: vi.fn<(path: string) => Promise<number>>(),
  getPdfPageCount: vi.fn<(path: string) => Promise<number>>(),
  splitPdfRange: vi.fn<(
    sourcePath: string,
    destinationPath: string,
    startPage: number,
    endPage: number,
  ) => Promise<number>>(),
}))

vi.mock("@/commands/fs", () => fsMocks)

import {
  initialMineruPageRanges,
  mergeMineruBatchResults,
  prepareMineruPdfParts,
  type MineruBatchResult,
} from "./mineru-batch"

beforeEach(() => {
  fsMocks.createDirectory.mockReset().mockResolvedValue(undefined)
  fsMocks.deleteFile.mockReset().mockResolvedValue(undefined)
  fsMocks.fileExists.mockReset().mockResolvedValue(false)
  fsMocks.getFileSize.mockReset().mockResolvedValue(10)
  fsMocks.getPdfPageCount.mockReset().mockResolvedValue(1)
  fsMocks.splitPdfRange.mockReset().mockImplementation(
    async (_source, _destination, startPage, endPage) => endPage - startPage + 1,
  )
})

describe("MinerU PDF batch planning", () => {
  it("splits 450 pages into 180, 180, and 90 page ranges", () => {
    expect(initialMineruPageRanges(450)).toEqual([
      { startPage: 1, endPage: 180 },
      { startPage: 181, endPage: 360 },
      { startPage: 361, endPage: 450 },
    ])
  })

  it("bisects a page-safe batch when its generated PDF is too large", async () => {
    fsMocks.getFileSize.mockImplementation(async (path) => (
      path.includes("000001-000180") ? 201 : 50
    ))

    const parts = await prepareMineruPdfParts("C:/source.pdf", "C:/parts", 200, {
      maxBytes: 190,
    })

    expect(parts.map(({ startPage, endPage }) => [startPage, endPage])).toEqual([
      [1, 90],
      [91, 180],
      [181, 200],
    ])
    expect(fsMocks.deleteFile).toHaveBeenCalledWith(
      "C:/parts/pages-000001-000180.pdf",
    )
  })

  it("reuses a verified split file without rewriting it", async () => {
    fsMocks.fileExists.mockResolvedValue(true)
    fsMocks.getPdfPageCount.mockResolvedValue(20)

    const parts = await prepareMineruPdfParts("C:/source.pdf", "C:/parts", 20, {
      reuseExisting: true,
    })

    expect(parts).toHaveLength(1)
    expect(fsMocks.splitPdfRange).not.toHaveBeenCalled()
  })

  it("reports the original page when one page alone is oversized", async () => {
    fsMocks.getFileSize.mockResolvedValue(191)

    await expect(prepareMineruPdfParts("C:/source.pdf", "C:/parts", 1, {
      maxBytes: 190,
    })).rejects.toThrow("PDF page 1")
  })
})

function result(startPage: number, endPage: number, markdown: string): MineruBatchResult {
  const key = `part-${startPage}-${endPage}`
  return {
    part: { startPage, endPage, key, path: `C:/parts/${key}.pdf` },
    markdown,
    savedImages: [],
    processedPageCount: endPage - startPage + 1,
  }
}

describe("MinerU PDF batch merging", () => {
  it("orders batches by original page range and preserves boundary markers", () => {
    const merged = mergeMineruBatchResults([
      result(181, 200, "second"),
      result(1, 180, "first"),
    ], 200)

    expect(merged.processedPageCount).toBe(200)
    expect(merged.markdown).toBe([
      "<!-- llm-wiki: source-pages=1-180 -->",
      "first",
      "",
      "<!-- llm-wiki: source-pages=181-200 -->",
      "second",
    ].join("\n"))
  })

  it("rejects a missing page range instead of generating partial knowledge", () => {
    expect(() => mergeMineruBatchResults([
      result(1, 180, "first"),
      result(182, 200, "third"),
    ], 200)).toThrow("not continuous")
  })

  it("rejects duplicate image paths across batches", () => {
    const first = result(1, 1, "![one](media/doc/mineru/part-1/image.png)")
    const second = result(2, 2, "![two](media/doc/mineru/part-1/image.png)")
    const image = {
      index: 0,
      mimeType: "image/png",
      page: null,
      width: 1,
      height: 1,
      relPath: "media/doc/mineru/part-1/image.png",
      absPath: "C:/wiki/media/doc/mineru/part-1/image.png",
      sha256: "hash",
    }
    first.savedImages = [image]
    second.savedImages = [image]

    expect(() => mergeMineruBatchResults([first, second], 2)).toThrow("duplicate image path")
  })
})
