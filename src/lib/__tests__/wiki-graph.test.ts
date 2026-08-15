/**
 * wiki-graph.test.ts — regression tests for frontmatter-scoped title/type extraction
 *
 * extractTitle/extractType previously searched for `title:`/`type:` anywhere in the
 * whole file content, not just inside the `---...---` frontmatter block, because the
 * lazy `[\s\S]*?` in their regexes was never required to stop at the closing `---`.
 * A body line that merely starts with `title:` or `type:` (plain prose, not YAML)
 * could be misread as the frontmatter value.
 */
import { describe, it, expect, vi } from "vitest"
import type { FileNode } from "@/types/wiki"

const mockListDirectory = vi.fn()
const mockReadFile = vi.fn()

vi.mock("@/commands/fs", () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))

async function loadBuildWikiGraph() {
  const mod = await import("../wiki-graph")
  return mod.buildWikiGraph
}

function mdFile(name: string): FileNode {
  return { name, path: `/project/wiki/${name}`, is_dir: false }
}

function mdFileAt(directory: string, name: string): FileNode {
  return { name, path: `/project/wiki/${directory}/${name}`, is_dir: false }
}

describe("buildWikiGraph frontmatter extraction", () => {
  it("does not read a title: line from the document body as the frontmatter title", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      "---\ntype: entity\n---\n# Real Heading\n\nSome text.\ntitle: not-frontmatter-at-all\n",
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].label).toBe("Real Heading")
  })

  it("does not read a type: line from the document body as the frontmatter type", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      "---\ntitle: Real Page\n---\n# Real Page\n\nSome text.\ntype: query\nMore text.\n",
    )

    const graph = await buildWikiGraph("/project")

    // A misread type of "query" would match HIDDEN_TYPES and silently drop the page.
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0].type).toBe("other")
  })

  it("parses CRLF frontmatter consistently with the rest of the application", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      "---\r\ntitle: CRLF Page\r\ntype: entity\r\n---\r\n# Fallback Heading\r\n",
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({ label: "CRLF Page", type: "entity" })
  })

  it("uses YAML parsing for quoted values that contain a colon", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("page.md")])
    mockReadFile.mockResolvedValue(
      '---\ntitle: "Attention: Architecture"\ntype: "Concept"\n---\n# Fallback Heading\n',
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({ label: "Attention: Architecture", type: "concept" })
  })

  it("preserves arbitrary markdown heading depth for progressive learning", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([mdFile("contract.md")])
    mockReadFile.mockResolvedValue(
      "# 合同法\n\n## 合同成立\n\n当事人的意思表示需要一致。\n\n### 承诺\n\n受要约人同意要约。\n\n#### 到达规则\n\n承诺到达要约人时生效。\n",
    )

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes[0].outline?.map((item) => [item.title, item.parentId])).toEqual([
      ["合同成立", null],
      ["承诺", "contract::heading:0"],
      ["到达规则", "contract::heading:1"],
    ])
  })

  it("keeps same-named pages in different wiki directories", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([
      { name: "concepts", path: "/project/wiki/concepts", is_dir: true, children: [mdFileAt("concepts", "index.md")] },
      { name: "entities", path: "/project/wiki/entities", is_dir: true, children: [mdFileAt("entities", "index.md")] },
      mdFile("overview.md"),
    ])
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("concepts")) return "---\ntitle: 概念索引\ntype: concept\n---\n# 概念索引\n\n概念索引的详细说明。"
      if (path.includes("entities")) return "---\ntitle: 实体索引\ntype: entity\n---\n# 实体索引\n\n实体索引的详细说明。"
      return "# 总览\n\n关联到 [[concepts/index]]。"
    })

    const graph = await buildWikiGraph("/project")

    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["concepts/index", "entities/index", "overview"])
    expect(graph.edges).toContainEqual(expect.objectContaining({ source: "overview", target: "concepts/index" }))
  })

  it("builds graph edges from related frontmatter without requiring a body wikilink", async () => {
    const buildWikiGraph = await loadBuildWikiGraph()
    mockListDirectory.mockResolvedValue([
      { name: "entities", path: "/project/wiki/entities", is_dir: true, children: [mdFileAt("entities", "deepseek-harness.md")] },
      { name: "concepts", path: "/project/wiki/concepts", is_dir: true, children: [mdFileAt("concepts", "ptc.md")] },
    ])
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("deepseek-harness")) {
        return "---\ntitle: DeepSeek Harness\ntype: entity\nrelated: [ptc]\n---\n# DeepSeek Harness\n\n核心产品页面。"
      }
      return "---\ntitle: PTC\ntype: concept\nrelated: []\n---\n# PTC\n\n程序化工具调用。"
    })

    const graph = await buildWikiGraph("/project")

    expect(graph.edges).toContainEqual(expect.objectContaining({
      source: "entities/deepseek-harness",
      target: "concepts/ptc",
    }))
  })
})
