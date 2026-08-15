import type { SavedImage } from "@/lib/extract-source-images"

export const DOCUMENT_INGEST_PIPELINE_VERSION = 7

export type DocumentExtractionMode = "mineru" | "builtin" | "text"

/** The single hand-off from document extraction to knowledge generation. */
export interface DocumentIngestResult {
  content: string
  extractionMode: DocumentExtractionMode
  sourcePageCount: number | null
  processedPageCount: number | null
  savedImages: SavedImage[]
  degraded: boolean
  warnings: string[]
}

export function countBuiltinPdfPages(markdown: string): number | null {
  const pages = new Set<number>()
  for (const match of markdown.matchAll(/^## Page\s+(\d+)\s*$/gim)) {
    const page = Number.parseInt(match[1], 10)
    if (Number.isFinite(page) && page > 0) pages.add(page)
  }
  return pages.size > 0 ? pages.size : null
}

export function documentIntegrityFailures(result: DocumentIngestResult): string[] {
  const failures: string[] = []
  if (!result.content.trim()) {
    failures.push("Document extraction produced no usable text or Markdown content.")
  }
  if (
    result.sourcePageCount !== null &&
    result.processedPageCount === null &&
    result.extractionMode !== "text"
  ) {
    failures.push(
      `Document page coverage could not be verified against the ${result.sourcePageCount}-page source.`,
    )
  } else if (
    result.sourcePageCount !== null &&
    result.processedPageCount !== null &&
    result.sourcePageCount !== result.processedPageCount
  ) {
    failures.push(
      `Document page coverage is incomplete: processed ${result.processedPageCount}/${result.sourcePageCount} page(s).`,
    )
  }
  return failures
}

export function buildDocumentPipelineSignature(input: {
  mineruEnabled: boolean
  mineruBackend: string
  mineruModelVersion: string
  imageCaptioningEnabled: boolean
  imageCaptionProvider: string
  imageCaptionModel: string
  ingestProvider: string
  ingestModel: string
}): string {
  return JSON.stringify({
    version: DOCUMENT_INGEST_PIPELINE_VERSION,
    ...input,
  })
}
