import { getFileName, normalizePath } from "@/lib/path-utils"

export interface SourceCachePaths {
  previewText: string
  legacyMineruMetadata: string
  mineruMarkdown: string
  mineruMetadata: string
  mineruParts: string
}

/**
 * Keep generic preview/search extraction separate from the authoritative
 * MinerU result. Both used to share `<parent>/.cache/<file>.txt`, so a late
 * preview extraction could overwrite verified MinerU Markdown while leaving
 * MinerU metadata behind.
 */
export function sourceCachePaths(sourcePath: string): SourceCachePaths {
  const normalized = normalizePath(sourcePath)
  const slash = normalized.lastIndexOf("/")
  const parent = slash >= 0 ? normalized.slice(0, slash) : "."
  const fileName = getFileName(normalized)
  const previewText = `${parent}/.cache/${fileName}.txt`
  const mineruMarkdown = `${parent}/.cache/mineru/${fileName}.md`
  return {
    previewText,
    legacyMineruMetadata: `${previewText}.meta.json`,
    mineruMarkdown,
    mineruMetadata: `${mineruMarkdown}.meta.json`,
    mineruParts: `${mineruMarkdown}.parts`,
  }
}
