import { describe, expect, it } from "vitest"
import {
  isRepositoryFrameworkCapsule,
  repositoryCapsuleDirective,
} from "./repository-capsule-policy"

describe("repository framework capsule policy", () => {
  it("recognizes both supported repository report contracts", () => {
    expect(isRepositoryFrameworkCapsule(
      "---\nreport_contract: repository-framework-v1\n---",
    )).toBe(true)
    expect(isRepositoryFrameworkCapsule(
      "---\nreport_contract: repository-framework-v2\n---",
    )).toBe(true)
    expect(isRepositoryFrameworkCapsule("# ordinary note")).toBe(false)
  })

  it("protects provenance and evidence status without affecting ordinary Markdown", () => {
    const directive = repositoryCapsuleDirective(
      "---\nreport_contract: repository-framework-v2\n---",
    )
    expect(directive).toContain("protected source metadata")
    expect(directive).toContain("Do not upgrade project-claim")
    expect(directive).toContain("never infer replacements")
    expect(repositoryCapsuleDirective("# ordinary note")).toBe("")
  })
})
