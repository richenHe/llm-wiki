import { listDirectory, readFile, writeFileAtomic } from "@/commands/fs"
import { parseFrontmatter } from "@/lib/frontmatter"
import { normalizePath } from "@/lib/path-utils"
import type { FileNode } from "@/types/wiki"

const CATALOG_START = "<!-- llm-wiki:catalog:start -->"
const CATALOG_END = "<!-- llm-wiki:catalog:end -->"
const RECENT_HEADING = "## Recently Updated"
const RECENT_LIMIT = 200

const STANDARD_GROUPS = [
  ["entity", "Entities"],
  ["concept", "Concepts"],
  ["source", "Sources"],
  ["query", "Queries"],
  ["comparison", "Comparisons"],
  ["synthesis", "Synthesis"],
] as const

const STANDARD_GROUP_LABELS = new Map<string, string>(STANDARD_GROUPS)
const STANDARD_GROUP_ORDER = new Map<string, number>(
  STANDARD_GROUPS.map(([type], index) => [type, index]),
)

export interface WikiIndexPage {
  target: string
  title: string
  type: string
}

function normalizeTarget(value: string): string {
  return normalizePath(value)
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
    .toLowerCase()
}

function fallbackType(target: string): string {
  const directory = target.split("/")[0]?.toLowerCase() ?? "other"
  if (directory === "entities") return "entity"
  if (directory === "concepts") return "concept"
  if (directory === "sources") return "source"
  if (directory === "queries") return "query"
  if (directory === "comparisons") return "comparison"
  if (directory === "synthesis") return "synthesis"
  return directory.replace(/s$/i, "") || "other"
}

function groupLabel(type: string): string {
  return STANDARD_GROUP_LABELS.get(type) ?? type
}

function buildCatalog(pages: readonly WikiIndexPage[]): string {
  const groups = new Map<string, WikiIndexPage[]>()
  for (const page of pages) {
    const type = page.type.trim().toLowerCase() || fallbackType(page.target)
    const bucket = groups.get(type)
    if (bucket) bucket.push(page)
    else groups.set(type, [page])
  }

  const orderedGroups = [...groups.entries()].sort(([left], [right]) => {
    const leftOrder = STANDARD_GROUP_ORDER.get(left) ?? Number.MAX_SAFE_INTEGER
    const rightOrder = STANDARD_GROUP_ORDER.get(right) ?? Number.MAX_SAFE_INTEGER
    return leftOrder - rightOrder || left.localeCompare(right)
  })
  const lines = [CATALOG_START]
  for (const [type, groupPages] of orderedGroups) {
    lines.push(`## ${groupLabel(type)}`, "")
    groupPages.sort((left, right) =>
      left.title.localeCompare(right.title, undefined, { sensitivity: "base" })
      || left.target.localeCompare(right.target),
    )
    for (const page of groupPages) {
      lines.push(`- [[${page.target}]] — ${page.title}`)
    }
    lines.push("")
  }
  lines.push(CATALOG_END)
  return lines.join("\n")
}

function removeSection(content: string, heading: string): { content: string; lines: string[] } {
  const lines = content.split("\n")
  const start = lines.findIndex((line) => line.trim() === heading)
  if (start < 0) return { content, lines: [] }
  const end = lines.findIndex((line, index) => index > start && /^##\s+/.test(line))
  const sectionEnd = end >= 0 ? end : lines.length
  return {
    content: [...lines.slice(0, start), ...lines.slice(sectionEnd)].join("\n"),
    lines: lines.slice(start + 1, sectionEnd).filter((line) => /^-\s+/.test(line)),
  }
}

function removeManagedCatalog(content: string): string {
  const start = content.indexOf(CATALOG_START)
  const end = content.indexOf(CATALOG_END)
  if (start < 0 || end < start) return content
  return `${content.slice(0, start)}${content.slice(end + CATALOG_END.length)}`
}

function removeEmptyLegacyHeadings(content: string): string {
  const headings = STANDARD_GROUPS.map(([, label]) => label).join("|")
  const pattern = new RegExp(`^## (?:${headings})\\s*\\n(?=## |$)`, "gm")
  let output = content
  while (pattern.test(output)) output = output.replace(pattern, "")
  return output
}

function targetFromIndexLine(line: string): string | null {
  const target = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/.exec(line)?.[1]
  return target ? normalizeTarget(target) : null
}

export function buildManagedWikiIndex(
  existing: string,
  pages: readonly WikiIndexPage[],
  recentlyWrittenTargets: readonly string[],
): string {
  const uniquePages = new Map<string, WikiIndexPage>()
  for (const page of pages) uniquePages.set(normalizeTarget(page.target), page)
  const allPages = [...uniquePages.values()]

  const withoutCatalog = removeManagedCatalog(existing)
  const recentRemoval = removeSection(withoutCatalog, RECENT_HEADING)
  let preserved = removeEmptyLegacyHeadings(recentRemoval.content).trim()
  if (!/^#\s+Wiki Index\s*$/m.test(preserved)) {
    preserved = `# Wiki Index${preserved ? `\n\n${preserved}` : ""}`
  }

  const pageByTarget = new Map(
    allPages.map((page) => [normalizeTarget(page.target), page]),
  )
  const recentLines: string[] = []
  const seenRecent = new Set<string>()
  const candidates = [
    ...recentlyWrittenTargets.map(normalizeTarget),
    ...recentRemoval.lines.map(targetFromIndexLine).filter((target): target is string => Boolean(target)),
  ]
  for (const target of candidates) {
    if (seenRecent.has(target)) continue
    const page = pageByTarget.get(target)
    if (!page) continue
    seenRecent.add(target)
    recentLines.push(`- [[${page.target}]] — ${page.title}`)
    if (recentLines.length >= RECENT_LIMIT) break
  }

  return [
    preserved,
    "",
    buildCatalog(allPages),
    ...(recentLines.length > 0 ? ["", RECENT_HEADING, ...recentLines] : []),
    "",
  ].join("\n").replace(/\n{4,}/g, "\n\n\n")
}

async function collectWikiIndexPages(projectPath: string): Promise<WikiIndexPage[]> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const wikiRoot = `${pp}/wiki`
  const tree = await listDirectory(wikiRoot)
  const files: FileNode[] = []
  const walk = (nodes: FileNode[]) => {
    for (const node of nodes) {
      if (node.is_dir) walk(node.children ?? [])
      else if (node.name.toLowerCase().endsWith(".md")) files.push(node)
    }
  }
  walk(tree)

  const pages: WikiIndexPage[] = []
  for (const file of files) {
    const normalizedFile = normalizePath(file.path)
    const target = normalizedFile
      .replace(new RegExp(`^${wikiRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?`, "i"), "")
      .replace(/\.md$/i, "")
    if (!target || ["index", "log", "overview"].includes(target.toLowerCase())) continue
    const content = await readFile(file.path)
    const frontmatter = parseFrontmatter(content).frontmatter
    const fallbackTitle = file.name.replace(/\.md$/i, "")
    pages.push({
      target,
      title: typeof frontmatter?.title === "string" && frontmatter.title.trim()
        ? frontmatter.title.trim()
        : fallbackTitle,
      type: typeof frontmatter?.type === "string" && frontmatter.type.trim()
        ? frontmatter.type.trim()
        : fallbackType(target),
    })
  }
  return pages
}

export async function rebuildManagedWikiIndex(
  projectPath: string,
  recentlyWrittenPaths: readonly string[],
): Promise<boolean> {
  const pp = normalizePath(projectPath).replace(/\/$/, "")
  const indexPath = `${pp}/wiki/index.md`
  const [existing, pages] = await Promise.all([
    readFile(indexPath).catch(() => "# Wiki Index\n"),
    collectWikiIndexPages(pp),
  ])
  const next = buildManagedWikiIndex(existing, pages, recentlyWrittenPaths)
  if (next === existing) return false
  await writeFileAtomic(indexPath, next)
  return true
}
