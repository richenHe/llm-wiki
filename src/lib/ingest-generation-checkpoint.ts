import {
  createDirectory,
  deleteFile,
  fileExists,
  readFile,
  writeFileAtomic,
} from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"

export interface StoredGenerationBlock {
  path: string
  content: string
}

export interface StoredWrittenFile {
  inputPath: string
  finalPath: string
  contentHash: string
}

export interface IngestGenerationCheckpoint {
  version: 1
  checkpointKey: string
  sourceIdentity: string
  analysis: string
  sourceContext: string
  requestedPaths: string[]
  blocks: Record<string, StoredGenerationBlock>
  writtenFiles?: Record<string, StoredWrittenFile>
  reviewCompleted?: boolean
  reviewSuggestionOutput?: string
  updatedAt: number
}

function checkpointDirectory(projectPath: string): string {
  return `${normalizePath(projectPath)}/.llm-wiki/ingest-checkpoints`
}

export function generationCheckpointPath(
  projectPath: string,
  sourceSummarySlug: string,
): string {
  return `${checkpointDirectory(projectPath)}/${sourceSummarySlug}-generation.json`
}

function pathKey(path: string): string {
  return normalizePath(path).toLowerCase()
}

export function createGenerationCheckpoint(params: {
  checkpointKey: string
  sourceIdentity: string
  analysis: string
  sourceContext: string
  requestedPaths: readonly string[]
}): IngestGenerationCheckpoint {
  return {
    version: 1,
    checkpointKey: params.checkpointKey,
    sourceIdentity: params.sourceIdentity,
    analysis: params.analysis,
    sourceContext: params.sourceContext,
    requestedPaths: [...params.requestedPaths],
    blocks: {},
    writtenFiles: {},
    updatedAt: Date.now(),
  }
}

export function storeGenerationCheckpointWrittenFile(
  checkpoint: IngestGenerationCheckpoint,
  writtenFile: StoredWrittenFile,
): void {
  checkpoint.writtenFiles ??= {}
  checkpoint.writtenFiles[pathKey(writtenFile.inputPath)] = {
    inputPath: normalizePath(writtenFile.inputPath),
    finalPath: normalizePath(writtenFile.finalPath),
    contentHash: writtenFile.contentHash,
  }
  checkpoint.updatedAt = Date.now()
}

export function completedGenerationCheckpointPaths(
  checkpoint: IngestGenerationCheckpoint,
): Set<string> {
  return new Set(Object.keys(checkpoint.blocks))
}

export function storeGenerationCheckpointBlocks(
  checkpoint: IngestGenerationCheckpoint,
  blocks: readonly StoredGenerationBlock[],
): string[] {
  const allowed = new Set(checkpoint.requestedPaths.map(pathKey))
  const stored: string[] = []
  for (const block of blocks) {
    const key = pathKey(block.path)
    if (!allowed.has(key) || !block.content.trim()) continue
    // Repair prompts may echo an earlier page. A completed page is immutable
    // within this ingest run so targeted recovery cannot replace good work.
    if (checkpoint.blocks[key]) continue
    checkpoint.blocks[key] = {
      path: normalizePath(block.path),
      content: block.content.trimEnd(),
    }
    stored.push(normalizePath(block.path))
  }
  checkpoint.updatedAt = Date.now()
  return stored
}

export function renderGenerationCheckpoint(
  checkpoint: IngestGenerationCheckpoint,
): string {
  return checkpoint.requestedPaths
    .map((path) => checkpoint.blocks[pathKey(path)])
    .filter((block): block is StoredGenerationBlock => Boolean(block))
    .map((block) => [
      `---FILE: ${block.path}---`,
      block.content,
      "---END FILE---",
    ].join("\n"))
    .join("\n\n")
}

export async function loadGenerationCheckpoint(
  projectPath: string,
  sourceSummarySlug: string,
  expected: { checkpointKey: string; sourceIdentity: string },
): Promise<IngestGenerationCheckpoint | null> {
  const path = generationCheckpointPath(projectPath, sourceSummarySlug)
  try {
    if (!(await fileExists(path))) return null
    const parsed = JSON.parse(await readFile(path)) as IngestGenerationCheckpoint
    if (
      parsed.version !== 1
      || parsed.checkpointKey !== expected.checkpointKey
      || parsed.sourceIdentity !== expected.sourceIdentity
      || typeof parsed.analysis !== "string"
      || typeof parsed.sourceContext !== "string"
      || !Array.isArray(parsed.requestedPaths)
      || !parsed.blocks
      || typeof parsed.blocks !== "object"
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export async function saveGenerationCheckpoint(
  projectPath: string,
  sourceSummarySlug: string,
  checkpoint: IngestGenerationCheckpoint,
): Promise<void> {
  const dir = checkpointDirectory(projectPath)
  await createDirectory(dir)
  checkpoint.updatedAt = Date.now()
  await writeFileAtomic(
    generationCheckpointPath(projectPath, sourceSummarySlug),
    JSON.stringify(checkpoint, null, 2),
  )
}

export async function clearGenerationCheckpoint(
  projectPath: string,
  sourceSummarySlug: string,
): Promise<void> {
  const path = generationCheckpointPath(projectPath, sourceSummarySlug)
  try {
    if (await fileExists(path)) await deleteFile(path)
  } catch {
    // A stale checkpoint is harmless because its key must match before reuse.
  }
}
