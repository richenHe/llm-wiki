import { parseFrontmatter } from "@/lib/frontmatter"
import {
  parseFrontmatterArray,
  writeFrontmatterArray,
} from "@/lib/sources-merge"
import { isRepositoryFrameworkCapsule } from "@/lib/repository-capsule-policy"

export interface IngestPathPlan {
  aliases: string[]
  finalPath: string
}

export interface IngestPathRedirect {
  bodyTarget: string
  relatedTarget: string
}

export type IngestPathRedirects = ReadonlyMap<string, IngestPathRedirect>

export interface IngestReferenceRepairResult {
  content: string
  repairedCount: number
}

export interface SourceSummaryMetadataResult {
  content: string
  warnings: string[]
  repairedCount: number
}

function normalizeWikiReference(value: string): string {
  let decoded = value
  try {
    decoded = decodeURIComponent(value)
  } catch {
    // Keep malformed percent-encoding byte-identical. It is not a safe alias.
  }
  return decoded
    .normalize("NFKC")
    .trim()
    .replace(/^\[\[/, "")
    .replace(/\]\]$/, "")
    .replace(/\\/g, "/")
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
    .trim()
    .toLowerCase()
}

function wikiPathWithoutExtension(value: string): string {
  return value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^wiki\//i, "")
    .replace(/\.md$/i, "")
}

function basename(value: string): string {
  return wikiPathWithoutExtension(value).split("/").pop() ?? value
}

/**
 * Build redirects only when an input alias resolves to exactly one final path.
 *
 * Both path-qualified aliases (`entities/beanbot`) and bare aliases
 * (`beanbot`) are considered. If two generated pages share the same bare
 * alias, the bare redirect is intentionally omitted while the path-qualified
 * redirects remain usable.
 */
export function buildUniqueIngestPathRedirects(
  plans: readonly IngestPathPlan[],
  reservedAliases: readonly string[] = [],
): Map<string, IngestPathRedirect> {
  const candidates = new Map<string, Map<string, IngestPathRedirect>>()
  const reserved = new Set(
    reservedAliases.flatMap((value) => [
      normalizeWikiReference(value),
      normalizeWikiReference(basename(value)),
    ]),
  )

  for (const plan of plans) {
    const bodyTarget = wikiPathWithoutExtension(plan.finalPath)
    const relatedTarget = basename(plan.finalPath)
    const redirect = { bodyTarget, relatedTarget }
    const finalKey = normalizeWikiReference(plan.finalPath)

    for (const rawAlias of plan.aliases) {
      const pathAlias = normalizeWikiReference(rawAlias)
      const bareAlias = normalizeWikiReference(basename(rawAlias))
      for (const alias of new Set([pathAlias, bareAlias])) {
        if (!alias || alias === finalKey || alias === normalizeWikiReference(relatedTarget)) {
          continue
        }
        let targets = candidates.get(alias)
        if (!targets) {
          targets = new Map()
          candidates.set(alias, targets)
        }
        targets.set(normalizeWikiReference(bodyTarget), redirect)
      }
    }
  }

  const redirects = new Map<string, IngestPathRedirect>()
  for (const [alias, targets] of candidates) {
    // An exact on-disk page always wins over an alias from the current batch.
    if (reserved.has(alias)) continue
    if (targets.size !== 1) continue
    redirects.set(alias, targets.values().next().value as IngestPathRedirect)
  }
  return redirects
}

function rewriteWikilinks(
  text: string,
  redirects: IngestPathRedirects,
): { text: string; count: number } {
  let count = 0
  const rewritten = text.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+?))?\]\]/g,
    (full, rawTarget: string, label: string | undefined) => {
      const hashIndex = rawTarget.indexOf("#")
      const target = hashIndex >= 0 ? rawTarget.slice(0, hashIndex) : rawTarget
      const anchor = hashIndex >= 0 ? rawTarget.slice(hashIndex) : ""
      const redirect = redirects.get(normalizeWikiReference(target))
      if (!redirect) return full
      count += 1
      return `[[${redirect.bodyTarget}${anchor}${label === undefined ? "" : `|${label}`}]]`
    },
  )
  return { text: rewritten, count }
}

function rewriteOutsideInlineCode(
  line: string,
  redirects: IngestPathRedirects,
): { text: string; count: number } {
  const ticks = /`+/g
  let output = ""
  let cursor = 0
  let delimiterLength: number | null = null
  let count = 0
  let match: RegExpExecArray | null

  while ((match = ticks.exec(line)) !== null) {
    const segment = line.slice(cursor, match.index)
    if (delimiterLength === null) {
      const repaired = rewriteWikilinks(segment, redirects)
      output += repaired.text
      count += repaired.count
      delimiterLength = match[0].length
    } else {
      output += segment
      if (match[0].length === delimiterLength) delimiterLength = null
    }
    output += match[0]
    cursor = match.index + match[0].length
  }

  const tail = line.slice(cursor)
  if (delimiterLength === null) {
    const repaired = rewriteWikilinks(tail, redirects)
    output += repaired.text
    count += repaired.count
  } else {
    output += tail
  }
  return { text: output, count }
}

function rewriteMarkdownBody(
  body: string,
  redirects: IngestPathRedirects,
): { text: string; count: number } {
  const lines = body.split("\n")
  let fenceChar: "`" | "~" | null = null
  let fenceLength = 0
  let count = 0

  const output = lines.map((line) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/)
    if (fence) {
      const char = fence[1][0] as "`" | "~"
      const length = fence[1].length
      if (fenceChar === null) {
        fenceChar = char
        fenceLength = length
      } else if (fenceChar === char && length >= fenceLength) {
        fenceChar = null
        fenceLength = 0
      }
      return line
    }
    if (fenceChar !== null) return line
    const repaired = rewriteOutsideInlineCode(line, redirects)
    count += repaired.count
    return repaired.text
  })

  return { text: output.join("\n"), count }
}

/**
 * Rewrite same-batch wikilinks and `related` values using only unambiguous
 * path redirects. Code fences and inline code are left untouched.
 */
export function repairIngestReferences(
  content: string,
  redirects: IngestPathRedirects,
): IngestReferenceRepairResult {
  if (redirects.size === 0) return { content, repairedCount: 0 }

  let output = content
  let repairedCount = 0
  const related = parseFrontmatterArray(output, "related")
  if (related.length > 0) {
    const rewritten = related.map((value) => {
      const redirect = redirects.get(normalizeWikiReference(value))
      if (!redirect) return value
      repairedCount += 1
      return redirect.relatedTarget
    })
    const unique: string[] = []
    const seen = new Set<string>()
    for (const value of rewritten) {
      const key = value.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      unique.push(value)
    }
    if (
      unique.length !== related.length ||
      unique.some((value, index) => value !== related[index])
    ) {
      output = writeFrontmatterArray(output, "related", unique)
    }
  }

  const parsed = parseFrontmatter(output)
  if (parsed.rawBlock) {
    const repaired = rewriteMarkdownBody(parsed.body, redirects)
    repairedCount += repaired.count
    output = `${parsed.rawBlock}${repaired.text}`
  } else {
    const repaired = rewriteMarkdownBody(output, redirects)
    repairedCount += repaired.count
    output = repaired.text
  }

  return { content: output, repairedCount }
}

function sourceMetadataUrl(sourceContent: string): string | null {
  const frontmatter = parseFrontmatter(sourceContent).frontmatter
  const sourceUrl = frontmatter?.source_url
  if (typeof sourceUrl === "string" && sourceUrl.trim()) return sourceUrl.trim()
  const jinaUrl = sourceContent.match(/^URL Source:\s*(https?:\/\/\S+)\s*$/im)?.[1]
  return jinaUrl?.trim() || null
}

function replaceFrontmatterScalar(
  content: string,
  field: string,
  value: string,
): { content: string; changed: boolean } {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/)
  if (!match) return { content, changed: false }
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const line = new RegExp(`^${escaped}:\\s*[^\\r\\n]*$`, "m")
  if (!line.test(match[2])) return { content, changed: false }
  const body = match[2].replace(line, `${field}: ${JSON.stringify(value)}`)
  return {
    content: `${match[1]}${body}${match[3]}${content.slice(match[0].length)}`,
    changed: body !== match[2],
  }
}

function removeFrontmatterField(
  content: string,
  field: string,
): { content: string; changed: boolean } {
  const match = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/)
  if (!match) return { content, changed: false }
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const fieldBlock = new RegExp(
    `^${escaped}:[^\\r\\n]*(?:\\r?\\n(?=[ \\t])[^\\r\\n]*)*(?:\\r?\\n|$)`,
    "m",
  )
  if (!fieldBlock.test(match[2])) return { content, changed: false }
  const body = match[2].replace(fieldBlock, "")
  return {
    content: `${match[1]}${body.replace(/(?:\r?\n){3,}/g, "\n\n").trimEnd()}${match[3]}${content.slice(match[0].length)}`,
    changed: true,
  }
}

/**
 * Apply deterministic source-summary metadata repairs and return non-blocking
 * warnings. Ordinary source interpretation remains the model's responsibility.
 */
export function validateAndRepairSourceSummaryMetadata(
  content: string,
  sourceContent: string,
): SourceSummaryMetadataResult {
  let output = content
  const warnings: string[] = []
  let repairedCount = 0
  const authoritativeUrl = sourceMetadataUrl(sourceContent)
  const generated = parseFrontmatter(output).frontmatter
  const generatedUrl = generated?.url

  if (
    authoritativeUrl &&
    typeof generatedUrl === "string" &&
    generatedUrl.trim() &&
    generatedUrl.trim() !== authoritativeUrl
  ) {
    const repair = replaceFrontmatterScalar(output, "url", authoritativeUrl)
    if (repair.changed) {
      output = repair.content
      repairedCount += 1
      warnings.push(
        `Corrected source-summary URL to the authoritative raw source URL: ${authoritativeUrl}`,
      )
    }
  }

  if (isRepositoryFrameworkCapsule(sourceContent)) {
    const rawFrontmatter = parseFrontmatter(sourceContent).frontmatter ?? {}
    for (const field of [
      "author",
      "authors",
      "year",
      "published_at",
      "publication_date",
      "release_date",
    ]) {
      if (Object.prototype.hasOwnProperty.call(rawFrontmatter, field)) continue
      const repair = removeFrontmatterField(output, field)
      if (!repair.changed) continue
      output = repair.content
      repairedCount += 1
      warnings.push(
        `Removed unverified source-summary metadata "${field}" because the repository capsule does not provide it.`,
      )
    }
  }

  return { content: output, warnings, repairedCount }
}
