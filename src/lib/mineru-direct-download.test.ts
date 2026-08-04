import { beforeEach, describe, expect, it, vi } from "vitest"

const invokeMock = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}))

import { downloadMineruZipDirect } from "./mineru-direct-download"

describe("downloadMineruZipDirect", () => {
  beforeEach(() => invokeMock.mockReset())

  it("invokes the restricted native command and decodes its ZIP bytes", async () => {
    invokeMock.mockResolvedValueOnce(btoa("PK\x03\x04zip"))

    const result = new Uint8Array(await downloadMineruZipDirect(
      "https://cdn-mineru.openxlab.org.cn/result.zip",
    ))

    expect(invokeMock).toHaveBeenCalledWith("download_mineru_zip_direct_cmd", {
      url: "https://cdn-mineru.openxlab.org.cn/result.zip",
    })
    expect([...result]).toEqual([...new TextEncoder().encode("PK\x03\x04zip")])
  })
})
