export interface StructuralGraphNode {
  id: string
  path: string
  type: string
}

const STRUCTURAL_IDS = new Set(["index", "overview", "log", "schema", "purpose"])

export function isStructuralGraphNode(node: StructuralGraphNode): boolean {
  const id = node.id.toLowerCase()
  if (STRUCTURAL_IDS.has(id)) return true
  if (node.type === "overview") return true

  const normalizedPath = node.path.replace(/\\/g, "/").toLowerCase()
  return (
    normalizedPath.endsWith("/wiki/index.md") ||
    normalizedPath.endsWith("/wiki/overview.md") ||
    normalizedPath.endsWith("/wiki/log.md") ||
    normalizedPath.endsWith("/purpose.md") ||
    normalizedPath.endsWith("/schema.md")
  )
}
