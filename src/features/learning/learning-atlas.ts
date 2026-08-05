import { buildWikiGraph, type GraphEdge, type GraphNode } from "@/lib/wiki-graph"
import type { LearningNode, LearningRegion, LearningRelation } from "./learning-data"

export interface LearningAtlas {
  nodes: LearningNode[]
  regions: LearningRegion[]
  relations: LearningRelation[]
  isSample: boolean
  totalConcepts: number
}

const COLORS: LearningRegion["color"][] = ["violet", "blue", "cyan"]
function glyph(title: string): string {
  return Array.from(title.trim())[0] ?? "知"
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
  const visibleRegionCount = rankedCommunities.length
  const nodes: LearningNode[] = []
  const regions: LearningRegion[] = []
  const relations: LearningRelation[] = graph.edges.map((edge) => ({
    sourceId: edge.source,
    targetId: edge.target,
    kind: "related",
    weight: edge.weight,
    reason: "知识库页面通过引用或内容关联相连。",
  }))

  rankedCommunities.forEach(([communityId, members], regionIndex) => {
    const ranked = [...members].sort((a, b) => b.linkCount - a.linkCount || a.label.localeCompare(b.label, "zh-CN"))
    const learningOrder = [...members].sort((a, b) => a.path.localeCompare(b.path, "zh-CN", { numeric: true }) || a.label.localeCompare(b.label, "zh-CN"))
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

    learningOrder.forEach((member) => {
      nodes.push({
        id: member.id,
        title: member.label,
        glyph: glyph(member.label),
        essence: member.summary ?? `理解“${member.label}”在当前知识体系中的含义与联系。`,
        parentId: regionId,
        prerequisiteIds: [],
        source: "当前项目知识库",
        sourceDetail: member.path,
        capabilities: ["理解概念", "连接知识"],
        mastery: "unseen",
        position: { x: 50, y: 50 },
        kind: "concept",
        sourcePath: member.path,
        linkCount: member.linkCount,
        semanticType: member.type,
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
          semanticType: member.type,
        })
      }
    })

    regions.push({
      id: regionId,
      title: regionTitle,
      color: COLORS[regionIndex % COLORS.length],
      position: regionPosition(regionIndex, visibleRegionCount),
      nodeIds: [regionId, ...learningOrder.map((member) => member.id)],
    })
  })

  return { nodes, regions, relations, isSample: false, totalConcepts: graph.nodes.length }
}

export async function loadProjectLearningAtlas(projectPath: string): Promise<LearningAtlas> {
  return buildLearningAtlasFromGraph(await buildWikiGraph(projectPath))
}
