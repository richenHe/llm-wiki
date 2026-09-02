import {
  createDirectory,
  deleteFile,
  fileExists,
  getFileSize,
  getPdfPageCount,
  splitPdfRange,
} from "@/commands/fs"
import type { SavedImage } from "@/lib/extract-source-images"

export const MINERU_BATCH_MAX_PAGES = 180
export const MINERU_BATCH_MAX_BYTES = 190 * 1024 * 1024

export interface MineruPdfPart {
  startPage: number
  endPage: number
  path: string
  key: string
}

export interface MineruBatchResult {
  part: MineruPdfPart
  markdown: string
  savedImages: SavedImage[]
  processedPageCount: number | null
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("MinerU parsing cancelled")
}

export function mineruPdfPartKey(startPage: number, endPage: number): string {
  return `pages-${String(startPage).padStart(6, "0")}-${String(endPage).padStart(6, "0")}`
}

export function initialMineruPageRanges(
  totalPages: number,
  maxPages = MINERU_BATCH_MAX_PAGES,
): Array<{ startPage: number; endPage: number }> {
  if (!Number.isInteger(totalPages) || totalPages < 1) {
    throw new Error(`Cannot split a PDF with invalid page count: ${totalPages}`)
  }
  if (!Number.isInteger(maxPages) || maxPages < 1) {
    throw new Error(`Invalid MinerU batch page limit: ${maxPages}`)
  }
  const ranges: Array<{ startPage: number; endPage: number }> = []
  for (let startPage = 1; startPage <= totalPages; startPage += maxPages) {
    ranges.push({ startPage, endPage: Math.min(totalPages, startPage + maxPages - 1) })
  }
  return ranges
}

export async function prepareMineruPdfParts(
  sourcePath: string,
  partsDir: string,
  totalPages: number,
  options: {
    reuseExisting?: boolean
    maxPages?: number
    maxBytes?: number
    signal?: AbortSignal
    onProgress?: (message: string) => void
  } = {},
): Promise<MineruPdfPart[]> {
  const maxPages = options.maxPages ?? MINERU_BATCH_MAX_PAGES
  const maxBytes = options.maxBytes ?? MINERU_BATCH_MAX_BYTES
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new Error(`Invalid MinerU batch byte limit: ${maxBytes}`)
  }
  await createDirectory(partsDir)

  const materialize = async (startPage: number, endPage: number): Promise<MineruPdfPart[]> => {
    throwIfCancelled(options.signal)
    const key = mineruPdfPartKey(startPage, endPage)
    const path = `${partsDir}/${key}.pdf`
    const expectedPages = endPage - startPage + 1
    let canReuse = false
    if (options.reuseExisting && await fileExists(path)) {
      try {
        canReuse = await getPdfPageCount(path) === expectedPages
      } catch {
        canReuse = false
      }
    }
    if (!canReuse) {
      options.onProgress?.(`Preparing PDF pages ${startPage}-${endPage} for MinerU...`)
      const writtenPages = await splitPdfRange(sourcePath, path, startPage, endPage)
      if (writtenPages !== expectedPages) {
        throw new Error(
          `PDF split pages ${startPage}-${endPage} produced ${writtenPages}/${expectedPages} page(s)`,
        )
      }
    }

    const byteLength = await getFileSize(path)
    if (byteLength <= maxBytes) return [{ startPage, endPage, path, key }]
    if (startPage === endPage) {
      throw new Error(
        `PDF page ${startPage} is ${(byteLength / (1024 * 1024)).toFixed(1)} MB by itself, which exceeds the safe MinerU batch limit of ${(maxBytes / (1024 * 1024)).toFixed(0)} MB`,
      )
    }
    const midpoint = Math.floor((startPage + endPage) / 2)
    options.onProgress?.(
      `PDF pages ${startPage}-${endPage} are too large; splitting that batch again...`,
    )
    const smallerParts = [
      ...await materialize(startPage, midpoint),
      ...await materialize(midpoint + 1, endPage),
    ]
    try {
      await deleteFile(path)
    } catch {
      // The unused oversized cache file is harmless if Windows still has it open.
    }
    return smallerParts
  }

  const parts: MineruPdfPart[] = []
  for (const range of initialMineruPageRanges(totalPages, maxPages)) {
    parts.push(...await materialize(range.startPage, range.endPage))
  }
  return parts
}

export function mergeMineruBatchResults(
  results: MineruBatchResult[],
  totalPages: number,
): { markdown: string; savedImages: SavedImage[]; processedPageCount: number } {
  if (results.length === 0) throw new Error("MinerU batch parsing returned no parts")
  const ordered = [...results].sort((a, b) => a.part.startPage - b.part.startPage)
  let expectedStart = 1
  const markdownParts: string[] = []
  const savedImages: SavedImage[] = []
  const imagePaths = new Set<string>()

  for (const result of ordered) {
    const { startPage, endPage } = result.part
    const expectedCount = endPage - startPage + 1
    if (startPage !== expectedStart || endPage < startPage) {
      throw new Error(
        `MinerU batch page coverage is not continuous at source page ${expectedStart}`,
      )
    }
    if (result.processedPageCount !== expectedCount) {
      const actual = result.processedPageCount === null ? "unknown" : String(result.processedPageCount)
      throw new Error(
        `MinerU batch pages ${startPage}-${endPage} covered ${actual}/${expectedCount} page(s)`,
      )
    }
    if (!result.markdown.trim()) {
      throw new Error(`MinerU batch pages ${startPage}-${endPage} returned empty Markdown`)
    }
    markdownParts.push([
      `<!-- llm-wiki: source-pages=${startPage}-${endPage} -->`,
      result.markdown.trim(),
    ].join("\n"))
    for (const image of result.savedImages) {
      if (imagePaths.has(image.relPath)) {
        throw new Error(`MinerU batches produced a duplicate image path: ${image.relPath}`)
      }
      imagePaths.add(image.relPath)
      savedImages.push({ ...image, index: savedImages.length })
    }
    expectedStart = endPage + 1
  }

  if (expectedStart !== totalPages + 1) {
    throw new Error(
      `MinerU batch page coverage stopped at page ${expectedStart - 1}/${totalPages}`,
    )
  }
  return {
    markdown: markdownParts.join("\n\n"),
    savedImages,
    processedPageCount: totalPages,
  }
}
