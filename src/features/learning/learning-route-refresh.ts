import { readFile } from "@/commands/fs"
import { hasUsableLlm } from "@/lib/has-usable-llm"
import { getTaskLlmConfig } from "@/lib/llm-task-routing"
import { normalizePath } from "@/lib/path-utils"
import { buildWikiGraph, type GraphNode } from "@/lib/wiki-graph"
import { useWikiStore } from "@/stores/wiki-store"
import { generateReviewedLearningBoards, type LearningRouteCandidate } from "./learning-route-agent"
import { LEARNING_ROUTES_COMPLETED_EVENT, LEARNING_ROUTES_UPDATED_EVENT, type LearningRoutesCompletedDetail } from "./learning-route-events"
import { loadLearningRouteSnapshot, saveLearningRouteSnapshot } from "./learning-route-persistence"
import type { LearningRouteCommunitySnapshot, LearningRouteSnapshot } from "./learning-routes"

export interface LearningRouteProjectRef {
  id: string
  path: string
}

const INCLUDED_TYPES = new Set(["concept", "entity", "comparison"])
const ROUTE_GENERATOR_VERSION = 4
const STALE_RETRY_DELAY_MS = 20_000
const scheduledTimers = new Map<string, ReturnType<typeof setTimeout>>()
const activeControllers = new Map<string, AbortController>()

export function learningRoutesNeedRetry(snapshot: LearningRouteSnapshot): boolean {
  return snapshot.status === "stale" || snapshot.progress.processed < snapshot.progress.total
}

function normalizedProjectPath(path: string): string {
  return normalizePath(path).replace(/\/+$/, "")
}

function projectKey(project: LearningRouteProjectRef): string {
  return `${project.id}:${normalizedProjectPath(project.path).toLocaleLowerCase()}`
}

function isCurrentProject(project: LearningRouteProjectRef): boolean {
  const current = useWikiStore.getState().project
  return current?.id === project.id
    && normalizedProjectPath(current.path).toLocaleLowerCase() === normalizedProjectPath(project.path).toLocaleLowerCase()
}

function emitUpdated(projectPath: string): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LEARNING_ROUTES_UPDATED_EVENT, { detail: { projectPath } }))
}

function emitCompleted(detail: LearningRoutesCompletedDetail): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(LEARNING_ROUTES_COMPLETED_EVENT, { detail }))
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  operation: (value: T) => Promise<R>,
): Promise<R[]> {
  const result = new Array<R>(values.length)
  let nextIndex = 0
  const workers = Array.from({ length: Math.min(limit, values.length) }, async () => {
    while (nextIndex < values.length) {
      const index = nextIndex++
      result[index] = await operation(values[index])
    }
  })
  await Promise.all(workers)
  return result
}

function relevantNodes(nodes: readonly GraphNode[]): GraphNode[] {
  return nodes.filter((node) => INCLUDED_TYPES.has(node.type))
}

function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/\s+/g, " ").trim().slice(0, 800) || "串联模型处理失败。"
}

async function buildCandidates(
  members: readonly GraphNode[],
  neighborIdsByNode: ReadonlyMap<string, Set<string>>,
): Promise<LearningRouteCandidate[]> {
  return mapWithConcurrency(members, 12, async (node) => {
    let content = node.summary ?? ""
    try {
      content = await readFile(node.path)
    } catch {
      // The summary still allows a conservative decision. Missing detail makes
      // the reviewer more likely to reject the board instead of inventing it.
    }
    return {
      id: node.id,
      title: node.label,
      semanticType: node.type,
      summary: node.summary ?? "",
      sourcePath: node.path,
      outline: node.outline ?? [],
      neighborIds: [...(neighborIdsByNode.get(node.id) ?? [])],
      content,
    }
  })
}

async function communityIdentity(
  candidates: readonly LearningRouteCandidate[],
  internalEdges: readonly string[],
): Promise<{ key: string; fingerprint: string }> {
  const nodeIds = candidates.map((candidate) => candidate.id).sort()
  const key = await sha256(nodeIds.join("\n"))
  const fingerprint = await sha256(JSON.stringify({
    generatorVersion: ROUTE_GENERATOR_VERSION,
    nodes: [...candidates]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((candidate) => ({ id: candidate.id, content: candidate.content })),
    edges: [...internalEdges].sort(),
  }))
  return { key, fingerprint }
}

function staleSnapshot(
  previous: LearningRouteSnapshot | null,
  model: string,
  error: string,
): LearningRouteSnapshot {
  return {
    schemaVersion: 2,
    generatedAt: previous?.generatedAt ?? new Date(0).toISOString(),
    model: previous?.model ?? model,
    status: "stale",
    progress: previous?.progress ?? { processed: 0, total: 0 },
    communities: previous?.communities ?? [],
    lastError: error,
  }
}

export async function refreshLearningRoutes(
  project: LearningRouteProjectRef,
  signal?: AbortSignal,
): Promise<LearningRouteSnapshot> {
  const projectPath = normalizedProjectPath(project.path)
  const previous = await loadLearningRouteSnapshot(projectPath)
  const config = getTaskLlmConfig("learn")
  const model = config.model || config.provider
  if (!hasUsableLlm(config)) {
    const snapshot = staleSnapshot(previous, model, "教学模型尚未配置，已保留上一版串联结果。")
    await saveLearningRouteSnapshot(projectPath, snapshot)
    return snapshot
  }

  const graph = await buildWikiGraph(projectPath)
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  const nodes = relevantNodes(graph.nodes)
  const allowedIds = new Set(nodes.map((node) => node.id))
  const neighborIdsByNode = new Map<string, Set<string>>()
  for (const edge of graph.edges) {
    if (!allowedIds.has(edge.source) || !allowedIds.has(edge.target)) continue
    const sourceNeighbors = neighborIdsByNode.get(edge.source) ?? new Set<string>()
    sourceNeighbors.add(edge.target)
    neighborIdsByNode.set(edge.source, sourceNeighbors)
    const targetNeighbors = neighborIdsByNode.get(edge.target) ?? new Set<string>()
    targetNeighbors.add(edge.source)
    neighborIdsByNode.set(edge.target, targetNeighbors)
  }

  const grouped = new Map<number, GraphNode[]>()
  for (const node of nodes) {
    const members = grouped.get(node.community) ?? []
    members.push(node)
    grouped.set(node.community, members)
  }
  const previousByKey = new Map(previous?.communities.map((community) => [community.key, community]) ?? [])
  const communities: LearningRouteCommunitySnapshot[] = []
  const processedKeys = new Set<string>()
  const totalCommunities = grouped.size
  let regenerated = false

  const saveProgress = async () => {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    if (!isCurrentProject(project)) throw new DOMException("Project changed", "AbortError")
    const retained = previous?.communities.filter((community) => !processedKeys.has(community.key)) ?? []
    const processed = new Set(communities.flatMap((community) => community.decisions.map((decision) => decision.nodeId))).size
    await saveLearningRouteSnapshot(projectPath, {
      schemaVersion: 2,
      generatedAt: new Date().toISOString(),
      model,
      status: "processing",
      progress: { processed, total: nodes.length },
      communities: [...communities, ...retained],
      lastError: `AI 已完成 ${communities.length}/${totalCommunities} 个知识区域，结果正在逐步保存。`,
    })
    emitUpdated(projectPath)
  }

  for (const members of grouped.values()) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
    const memberIds = new Set(members.map((node) => node.id))
    const internalEdges = graph.edges
      .filter((edge) => memberIds.has(edge.source) && memberIds.has(edge.target))
      .map((edge) => `${edge.source}->${edge.target}:${edge.weight}`)
    const candidates = await buildCandidates(members, neighborIdsByNode)
    const identity = await communityIdentity(candidates, internalEdges)
    processedKeys.add(identity.key)
    const cached = previousByKey.get(identity.key)
    const cachedDecisionIds = new Set(cached?.decisions.map((decision) => decision.nodeId) ?? [])
    if (
      cached?.status === "ready" && cached.fingerprint === identity.fingerprint
      && candidates.every((candidate) => cachedDecisionIds.has(candidate.id))
    ) {
      communities.push(cached)
      continue
    }

    try {
      regenerated = true
      const generated = candidates.length < 2
        ? {
          boards: [],
          decisions: candidates.map((candidate) => ({
            nodeId: candidate.id,
            status: "unlinked" as const,
            boardIds: [],
            reason: "当前知识区域只有一个候选知识点，无法形成至少包含两项的可靠串联。",
          })),
        }
        : await generateReviewedLearningBoards({ candidates, config, signal })
      communities.push({
        key: identity.key,
        fingerprint: identity.fingerprint,
        nodeIds: candidates.map((candidate) => candidate.id),
        status: "ready",
        boards: generated.boards,
        decisions: generated.decisions,
      })
    } catch (error) {
      if (signal?.aborted) throw error
      const existingBoards = cached?.boards.filter((board) => board.nodeIds.every((id) => memberIds.has(id))) ?? []
      communities.push({
        key: identity.key,
        fingerprint: identity.fingerprint,
        nodeIds: candidates.map((candidate) => candidate.id),
        status: "stale",
        boards: existingBoards,
        decisions: cached?.decisions.filter((decision) => memberIds.has(decision.nodeId)) ?? [],
        lastError: cleanError(error),
      })
    }
    await saveProgress()
  }

  const failed = communities.filter((community) => {
    const decisionIds = new Set(community.decisions.map((decision) => decision.nodeId))
    return community.status === "stale" || !community.nodeIds.every((id) => decisionIds.has(id))
  })
  const processed = new Set(communities.flatMap((community) => community.decisions.map((decision) => decision.nodeId))).size
  if (!regenerated && previous?.status === "ready") return previous
  const snapshot: LearningRouteSnapshot = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    model,
    status: failed.length === 0 ? "ready" : "stale",
    progress: { processed, total: nodes.length },
    communities,
    lastError: failed.length > 0 ? `${failed.length} 个知识板块区域尚未更新，已保留可用旧结果。` : undefined,
  }
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError")
  if (!isCurrentProject(project)) throw new DOMException("Project changed", "AbortError")
  await saveLearningRouteSnapshot(projectPath, snapshot)
  if (snapshot.status === "ready" && regenerated) {
    const decisions = snapshot.communities.flatMap((community) => community.decisions)
    emitCompleted({
      projectPath,
      processed: snapshot.progress.processed,
      total: snapshot.progress.total,
      boardCount: snapshot.communities.reduce((total, community) => total + community.boards.length, 0),
      linkedCount: decisions.filter((decision) => decision.status === "linked").length,
      unlinkedCount: decisions.filter((decision) => decision.status === "unlinked").length,
    })
  }
  return snapshot
}

async function runScheduledRefresh(project: LearningRouteProjectRef): Promise<void> {
  const key = projectKey(project)
  const { getQueueSummary } = await import("@/lib/ingest-queue")
  const queue = getQueueSummary()
  if (queue.pending > 0 || queue.processing > 0) {
    scheduleLearningRouteRefresh(project, 5_000)
    return
  }
  const controller = new AbortController()
  activeControllers.set(key, controller)
  let shouldRetry = false
  try {
    if (!isCurrentProject(project)) return
    const snapshot = await refreshLearningRoutes(project, controller.signal)
    shouldRetry = learningRoutesNeedRetry(snapshot)
    emitUpdated(project.path)
  } catch (error) {
    if (!controller.signal.aborted) {
      shouldRetry = true
      console.error("[learning-routes] refresh failed", error)
    }
  } finally {
    if (activeControllers.get(key) === controller) activeControllers.delete(key)
  }
  if (shouldRetry && isCurrentProject(project)) scheduleLearningRouteRefresh(project, STALE_RETRY_DELAY_MS)
}

export function scheduleLearningRouteRefresh(
  project: LearningRouteProjectRef,
  delayMs = 4_000,
): void {
  const key = projectKey(project)
  const existingTimer = scheduledTimers.get(key)
  if (existingTimer) clearTimeout(existingTimer)
  const active = activeControllers.get(key)
  if (active) active.abort()
  const timer = setTimeout(() => {
    scheduledTimers.delete(key)
    return runScheduledRefresh(project)
  }, Math.max(0, delayMs))
  scheduledTimers.set(key, timer)
}

export function scheduleLearningRouteRefreshForWikiPath(path: string, delayMs = 3_000): void {
  const project = useWikiStore.getState().project
  if (!project) return
  const projectPath = normalizedProjectPath(project.path)
  const normalized = normalizePath(path)
  if (!normalized.toLocaleLowerCase().startsWith(`${projectPath.toLocaleLowerCase()}/wiki/`)) return
  if (!normalized.toLocaleLowerCase().endsWith(".md")) return
  scheduleLearningRouteRefresh({ id: project.id, path: project.path }, delayMs)
}

export function cancelLearningRouteRefreshes(): void {
  for (const timer of scheduledTimers.values()) clearTimeout(timer)
  scheduledTimers.clear()
  for (const controller of activeControllers.values()) controller.abort()
  activeControllers.clear()
}
