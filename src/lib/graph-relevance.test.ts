import { beforeEach, describe, expect, it, vi } from "vitest"
import type { FileNode } from "@/types/wiki"

const mockListDirectory = vi.fn()
const mockReadFile = vi.fn()

vi.mock("@/commands/fs", () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))

import { buildRetrievalGraph, clearGraphCache } from "./graph-relevance"

function mdFile(directory: string, name: string): FileNode {
  return { name, path: `/project/wiki/${directory}/${name}`, is_dir: false }
}

describe("buildRetrievalGraph related frontmatter", () => {
  beforeEach(() => {
    clearGraphCache()
    mockListDirectory.mockReset()
    mockReadFile.mockReset()
  })

  it("uses related entries as direct retrieval links", async () => {
    mockListDirectory.mockResolvedValue([
      {
        name: "entities",
        path: "/project/wiki/entities",
        is_dir: true,
        children: [mdFile("entities", "deepseek-harness.md")],
      },
      {
        name: "concepts",
        path: "/project/wiki/concepts",
        is_dir: true,
        children: [mdFile("concepts", "ptc.md")],
      },
    ])
    mockReadFile.mockImplementation(async (path: string) => {
      if (path.includes("deepseek-harness")) {
        return "---\ntitle: DeepSeek Harness\ntype: entity\nrelated: [ptc]\nsources: [video.md]\n---\n# DeepSeek Harness\n\n核心产品页面。"
      }
      return "---\ntitle: PTC\ntype: concept\nrelated: []\nsources: [video.md]\n---\n# PTC\n\n程序化工具调用。"
    })

    const graph = await buildRetrievalGraph("/project", 1)

    expect(graph.nodes.get("deepseek-harness")?.outLinks.has("ptc")).toBe(true)
    expect(graph.nodes.get("ptc")?.inLinks.has("deepseek-harness")).toBe(true)
  })
})
