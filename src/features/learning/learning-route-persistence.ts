import { fileExists, readFile, writeFileAtomic } from "@/commands/fs"
import type {
  LearningBoard,
  LearningBoardKind,
  LearningRouteCommunitySnapshot,
  LearningRouteNodeDecision,
  LearningRouteSnapshot,
} from "./learning-routes"

const ROUTES_RELATIVE_PATH = ".llm-wiki/learning/routes.json"
const BOARD_KINDS = new Set<LearningBoardKind>(["category", "process", "prerequisite"])

function routesPath(projectPath: string): string {
  return `${projectPath.replace(/[\\/]+$/, "")}/${ROUTES_RELATIVE_PATH}`
}

function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
}

function previewStorageKey(projectPath: string): string {
  return `llm-wiki:learning-routes:${projectPath}`
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && Boolean(value.trim())
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(nonEmptyString).map((item) => item.trim()))]
}

function parseBoard(value: unknown): LearningBoard | null {
  if (!value || typeof value !== "object") return null
  const board = value as Record<string, unknown>
  const kind = BOARD_KINDS.has(board.kind as LearningBoardKind) ? board.kind as LearningBoardKind : null
  const nodeIds = stringArray(board.nodeIds)
  const orderedNodeIds = stringArray(board.orderedNodeIds)
  const evidence = Array.isArray(board.evidence)
    ? board.evidence.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const entry = item as Record<string, unknown>
      return nonEmptyString(entry.nodeId) && nonEmptyString(entry.detail)
        ? [{ nodeId: entry.nodeId.trim(), detail: entry.detail.trim() }]
        : []
    })
    : []
  const mnemonicParts = Array.isArray(board.mnemonicParts)
    ? board.mnemonicParts.flatMap((item) => {
      if (!item || typeof item !== "object") return []
      const entry = item as Record<string, unknown>
      return nonEmptyString(entry.nodeId) && nonEmptyString(entry.phrase)
        ? [{ nodeId: entry.nodeId.trim(), phrase: entry.phrase.trim() }]
        : []
    })
    : []
  if (
    !kind || !nonEmptyString(board.id) || !nonEmptyString(board.title)
    || !nonEmptyString(board.centralQuestion) || !nonEmptyString(board.reason)
    || !nonEmptyString(board.mnemonic) || nodeIds.length < 2 || nodeIds.length > 8
  ) return null
  const nodeIdSet = new Set(nodeIds)
  const effectiveOrder = kind === "category" ? nodeIds : orderedNodeIds
  if (effectiveOrder.length !== nodeIds.length || !effectiveOrder.every((id) => nodeIdSet.has(id))) return null
  if (!nodeIds.every((id) => evidence.some((entry) => entry.nodeId === id))) return null
  if (!nodeIds.every((id) => mnemonicParts.some((entry) => entry.nodeId === id))) return null
  const confidence = Number(board.confidence)
  if (!Number.isFinite(confidence) || confidence < 0.78) return null
  return {
    id: board.id.trim(),
    title: board.title.trim(),
    centralQuestion: board.centralQuestion.trim(),
    kind,
    nodeIds,
    orderedNodeIds: effectiveOrder,
    reason: board.reason.trim(),
    evidence,
    confidence: Math.min(1, confidence),
    mnemonic: board.mnemonic.trim(),
    mnemonicParts,
  }
}

function parseDecision(value: unknown, boardIds: ReadonlySet<string>): LearningRouteNodeDecision | null {
  if (!value || typeof value !== "object") return null
  const decision = value as Record<string, unknown>
  const nodeId = nonEmptyString(decision.nodeId) ? decision.nodeId.trim() : ""
  const status = decision.status === "linked" || decision.status === "unlinked" ? decision.status : null
  const ids = stringArray(decision.boardIds)
  const reason = nonEmptyString(decision.reason) ? decision.reason.trim() : ""
  if (!nodeId || !status || !reason) return null
  if (status === "linked" && (ids.length === 0 || !ids.every((id) => boardIds.has(id)))) return null
  if (status === "unlinked" && ids.length > 0) return null
  return { nodeId, status, boardIds: ids, reason }
}

function parseCommunity(value: unknown, legacy = false): LearningRouteCommunitySnapshot | null {
  if (!value || typeof value !== "object") return null
  const community = value as Record<string, unknown>
  if (!nonEmptyString(community.key) || !nonEmptyString(community.fingerprint)) return null
  const nodeIds = stringArray(community.nodeIds)
  const boards = Array.isArray(community.boards) ? community.boards.map(parseBoard).filter((board): board is LearningBoard => Boolean(board)) : []
  const boardIds = new Set(boards.map((board) => board.id))
  let decisions = Array.isArray(community.decisions)
    ? community.decisions.map((decision) => parseDecision(decision, boardIds)).filter((decision): decision is LearningRouteNodeDecision => Boolean(decision))
    : []
  if (legacy && decisions.length === 0) {
    const boardIdsByNode = new Map<string, string[]>()
    for (const board of boards) {
      for (const nodeId of board.nodeIds) {
        const ids = boardIdsByNode.get(nodeId) ?? []
        ids.push(board.id)
        boardIdsByNode.set(nodeId, ids)
      }
    }
    decisions = [...boardIdsByNode].map(([nodeId, ids]) => ({
      nodeId,
      status: "linked" as const,
      boardIds: ids,
      reason: "由旧版已审核板块迁移，等待新版逐项账本重新确认。",
    }))
  }
  const decisionIds = new Set(decisions.map((decision) => decision.nodeId))
  const status = community.status === "ready" && nodeIds.every((id) => decisionIds.has(id)) ? "ready" : "stale"
  return {
    key: community.key.trim(),
    fingerprint: community.fingerprint.trim(),
    nodeIds,
    status,
    boards,
    decisions,
    lastError: nonEmptyString(community.lastError) ? community.lastError.trim() : undefined,
  }
}

export function parseLearningRouteSnapshot(raw: string): LearningRouteSnapshot | null {
  try {
    const value = JSON.parse(raw) as Record<string, unknown>
    const sourceVersion = Number(value.schemaVersion)
    if (![1, 2].includes(sourceVersion) || !Array.isArray(value.communities)) return null
    const communities = value.communities.map((community) => parseCommunity(community, sourceVersion === 1)).filter((item): item is LearningRouteCommunitySnapshot => Boolean(item))
    const candidateCount = new Set(communities.flatMap((community) => community.nodeIds)).size
    const decidedCount = new Set(communities.flatMap((community) => community.decisions.map((decision) => decision.nodeId))).size
    const total = sourceVersion === 1 ? candidateCount : Math.max(0, Number((value.progress as Record<string, unknown> | undefined)?.total) || 0)
    const processed = sourceVersion === 1 ? decidedCount : Math.min(total, Math.max(0, Number((value.progress as Record<string, unknown> | undefined)?.processed) || 0))
    const complete = processed === total && total === candidateCount && communities.every((item) => item.status === "ready")
    const status = sourceVersion === 2 && value.status === "ready" && complete ? "ready" : sourceVersion === 2 && value.status === "processing" ? "processing" : "stale"
    return {
      schemaVersion: 2,
      generatedAt: nonEmptyString(value.generatedAt) ? value.generatedAt.trim() : new Date(0).toISOString(),
      model: nonEmptyString(value.model) ? value.model.trim() : "unknown",
      status,
      progress: { processed, total },
      communities,
      lastError: nonEmptyString(value.lastError) ? value.lastError.trim() : undefined,
    }
  } catch {
    return null
  }
}

export async function loadLearningRouteSnapshot(projectPath: string): Promise<LearningRouteSnapshot | null> {
  try {
    if (!hasTauriRuntime()) {
      const raw = localStorage.getItem(previewStorageKey(projectPath))
      return raw ? parseLearningRouteSnapshot(raw) : null
    }
    const path = routesPath(projectPath)
    if (!(await fileExists(path))) return null
    return parseLearningRouteSnapshot(await readFile(path))
  } catch (error) {
    console.warn("[learning-routes] failed to load", error)
    return null
  }
}

export async function saveLearningRouteSnapshot(projectPath: string, snapshot: LearningRouteSnapshot): Promise<void> {
  const contents = `${JSON.stringify(snapshot, null, 2)}\n`
  if (!hasTauriRuntime()) {
    localStorage.setItem(previewStorageKey(projectPath), contents)
    return
  }
  await writeFileAtomic(routesPath(projectPath), contents)
}
