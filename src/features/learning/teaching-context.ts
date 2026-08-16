import { readFile } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import type { LearningNode, LearningRelation } from "./learning-data"
import { getLearningBreadcrumb, getLearningChildren, getLearningSiblings } from "./learning-data"
import type { TeachingAttempt, TeachingContext } from "./teaching-types"

const MAX_SOURCE_CHARS = 12_000

function resolveSourcePath(projectPath: string, sourcePath?: string): string | undefined {
  if (!sourcePath) return undefined
  const normalized = normalizePath(sourcePath)
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) return normalized
  return `${normalizePath(projectPath).replace(/\/$/, "")}/wiki/${normalized.replace(/^wiki\//, "")}`
}

export function extractNodeSource(content: string, nodeId: string): string {
  const headingIndex = Number(nodeId.match(/::heading:(\d+)$/)?.[1])
  if (!Number.isInteger(headingIndex)) return content.slice(0, MAX_SOURCE_CHARS)
  const body = content.replace(/^---[\s\S]*?---\s*/m, "")
  const headings = [...body.matchAll(/^(#{2,6})\s+(.+)$/gm)]
  const heading = headings[headingIndex]
  if (!heading) return body.slice(0, MAX_SOURCE_CHARS)
  const level = heading[1].length
  const start = heading.index ?? 0
  let end = body.length
  for (let index = headingIndex + 1; index < headings.length; index++) {
    if (headings[index][1].length <= level) {
      end = headings[index].index ?? body.length
      break
    }
  }
  return body.slice(start, end).slice(0, MAX_SOURCE_CHARS)
}

async function fingerprint(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

function findSourceImage(sourceExcerpt: string, sourcePath?: string): string | undefined {
  const reference = sourceExcerpt.match(/!\[[^\]]*\]\((?:<)?([^)>\s]+)(?:>)?(?:\s+["'][^"']*["'])?\)/)?.[1]
  if (!reference) return undefined
  if (/^(?:https?:|data:)/i.test(reference) || /^[A-Za-z]:[\\/]/.test(reference) || reference.startsWith("/")) return reference
  if (!sourcePath) return reference
  const directory = normalizePath(sourcePath).replace(/\/[^/]*$/, "")
  return `${directory}/${reference}`
}

export async function buildTeachingContext(input: {
  projectPath: string
  node: LearningNode
  nodes: readonly LearningNode[]
  relations: readonly LearningRelation[]
  attempts: TeachingAttempt[]
  mastery: TeachingContext["currentMastery"]
}): Promise<TeachingContext> {
  const sourcePath = resolveSourcePath(input.projectPath, input.node.sourcePath)
  let sourceExcerpt = input.node.essence
  if (sourcePath) {
    try {
      sourceExcerpt = extractNodeSource(await readFile(sourcePath), input.node.id)
    } catch {
      sourceExcerpt = input.node.essence
    }
  }
  const relatedIds = new Set<string>()
  for (const relation of input.relations) {
    if (relation.sourceId === input.node.id) relatedIds.add(relation.targetId)
    if (relation.targetId === input.node.id) relatedIds.add(relation.sourceId)
  }
  const related = [...relatedIds]
    .map((id) => input.nodes.find((node) => node.id === id))
    .filter((node): node is LearningNode => Boolean(node))
    .slice(0, 8)
  const sourceFingerprint = await fingerprint(`${input.node.id}\n${sourceExcerpt}`)
  return {
    node: input.node,
    breadcrumb: getLearningBreadcrumb(input.node.id, input.nodes),
    prerequisites: input.node.prerequisiteIds.map((id) => input.nodes.find((node) => node.id === id)).filter((node): node is LearningNode => Boolean(node)),
    children: getLearningChildren(input.node.id, input.nodes).slice(0, 12),
    siblings: getLearningSiblings(input.node.id, input.nodes).filter((node) => node.id !== input.node.id).slice(0, 8),
    related,
    sourceExcerpt,
    sourcePath,
    sourceImage: findSourceImage(sourceExcerpt, sourcePath),
    sourceFingerprint,
    priorAttempts: input.attempts.filter((attempt) => attempt.nodeId === input.node.id).slice(-8),
    currentMastery: input.mastery,
  }
}
