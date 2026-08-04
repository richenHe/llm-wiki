import { buildWikiGraph, type GraphEdge, type GraphNode } from "@/lib/wiki-graph"
import type { LearningNode, LearningRegion } from "./learning-data"

export interface LearningAtlas {
  nodes: LearningNode[]
  regions: LearningRegion[]
  isSample: boolean
  totalConcepts: number
}

const COLORS: LearningRegion["color"][] = ["violet", "blue", "cyan"]
const TYPE_LABELS: Record<string, string> = {
  concept: "概念",
  entity: "实体",
  source: "来源",
  overview: "总览",
  synthesis: "综合",
  comparison: "比较",
  finding: "发现",
  thesis: "论点",
  methodology: "方法",
  other: "知识",
}

function glyph(title: string): string {
  return Array.from(title.trim())[0] ?? "知"
}

function position(index: number, count: number): { x: number; y: number } {
  const columns = Math.max(3, Math.ceil(Math.sqrt(Math.max(count, 1) * 1.4)))
  const rows = Math.max(2, Math.ceil(count / columns))
  return {
    x: 14 + (index % columns) * (72 / Math.max(columns - 1, 1)),
    y: 34 + Math.floor(index / columns) * (52 / Math.max(rows - 1, 1)),
  }
}

function regionPosition(index: number, count: number) {
  const columns = count <= 2 ? count : 3
  const rows = Math.ceil(count / columns)
  const width = columns === 1 ? 58 : (92 / columns) - 2
  const height = rows === 1 ? 70 : (88 / rows) - 3
  return {
    x: 3 + (index % columns) * (94 / columns),
    y: 5 + Math.floor(index / columns) * (90 / rows),
    width,
    height,
  }
}

function relatedIds(nodeId: string, edges: readonly GraphEdge[]): string[] {
  return edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 4)
    .map((edge) => edge.source === nodeId ? edge.target : edge.source)
}

export function buildLearningAtlasFromGraph(graph: {
  nodes: GraphNode[]
  edges: GraphEdge[]
}): LearningAtlas {
  const communities = new Map<number, GraphNode[]>()
  for (const node of graph.nodes) {
    const list = communities.get(node.community) ?? []
    list.push(node)
    communities.set(node.community, list)
  }

  const rankedCommunities = [...communities.entries()]
    .sort((a, b) => b[1].length - a[1].length)
  const visibleRegionCount = Math.min(9, rankedCommunities.length)
  const nodes: LearningNode[] = []
  const regions: LearningRegion[] = []

  rankedCommunities.forEach(([communityId, members], regionIndex) => {
    const ranked = [...members].sort((a, b) => b.linkCount - a.linkCount || a.label.localeCompare(b.label, "zh-CN"))
    const anchor = ranked[0]
    const regionId = `atlas-region-${communityId}`
    const regionTitle = anchor?.label ?? `主题 ${regionIndex + 1}`
    nodes.push({
      id: regionId,
      title: regionTitle,
      glyph: glyph(regionTitle),
      essence: `这一知识区域包含 ${members.length} 个相互关联的概念。`,
      parentId: null,
      prerequisiteIds: [],
      source: "当前项目知识库",
      sourceDetail: `${members.length} 个知识页`,
      capabilities: ["建立框架", "发现联系"],
      mastery: "unseen",
      position: { x: 50, y: 16 },
      kind: "region",
    })

    const typeGroups = new Map<string, GraphNode[]>()
    for (const member of ranked) {
      const group = typeGroups.get(member.type) ?? []
      group.push(member)
      typeGroups.set(member.type, group)
    }
    const groupEntries = [...typeGroups.entries()].sort((a, b) => b[1].length - a[1].length)
    const groupIds: string[] = []
    groupEntries.forEach(([type, group], groupIndex) => {
      const title = TYPE_LABELS[type] ?? type
      const groupId = `${regionId}:group:${type}`
      groupIds.push(groupId)
      nodes.push({
        id: groupId,
        title,
        glyph: glyph(title),
        essence: `按“${title}”整理的 ${group.length} 个知识点。`,
        parentId: regionId,
        prerequisiteIds: [],
        source: "当前项目知识库",
        sourceDetail: `${regionTitle} / ${title}`,
        capabilities: ["分类理解"],
        mastery: "unseen",
        position: position(groupIndex, Math.max(groupEntries.length, 4)),
        kind: "group",
      })
      group.forEach((member) => {
        nodes.push({
          id: member.id,
          title: member.label,
          glyph: glyph(member.label),
          essence: member.summary ?? `理解“${member.label}”在当前知识体系中的含义与联系。`,
          parentId: groupId,
          prerequisiteIds: relatedIds(member.id, graph.edges),
          source: "当前项目知识库",
          sourceDetail: member.path,
          capabilities: ["理解概念", "连接知识"],
          mastery: "unseen",
          position: { x: 50, y: 50 },
          kind: "concept",
          sourcePath: member.path,
          linkCount: member.linkCount,
        })
        for (const outline of member.outline ?? []) {
          nodes.push({
            id: outline.id,
            title: outline.title,
            glyph: glyph(outline.title),
            essence: outline.summary,
            parentId: outline.parentId ?? member.id,
            prerequisiteIds: [],
            source: member.label,
            sourceDetail: `${member.path} / ${outline.title}`,
            capabilities: ["逐层理解"],
            mastery: "unseen",
            position: { x: 50, y: 50 },
            kind: "concept",
            sourcePath: member.path,
            linkCount: 0,
          })
        }
      })
    })

    const visibleConcepts = ranked.slice(0, Math.max(8, 18 - groupIds.length))
    visibleConcepts.forEach((member, index) => {
      const target = nodes.find((node) => node.id === member.id)
      if (target) target.position = position(index + groupIds.length, visibleConcepts.length + groupIds.length)
    })
    if (regionIndex < visibleRegionCount) {
      regions.push({
        id: regionId,
        title: regionTitle,
        color: COLORS[regionIndex % COLORS.length],
        position: regionPosition(regionIndex, visibleRegionCount),
        nodeIds: [regionId, ...groupIds, ...visibleConcepts.map((member) => member.id)],
      })
    }
  })

  return { nodes, regions, isSample: false, totalConcepts: graph.nodes.length }
}

export async function loadProjectLearningAtlas(projectPath: string): Promise<LearningAtlas> {
  return buildLearningAtlasFromGraph(await buildWikiGraph(projectPath))
}
