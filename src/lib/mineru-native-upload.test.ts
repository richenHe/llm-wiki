import { beforeEach, describe, expect, it, vi } from "vitest"

const coreMocks = vi.hoisted(() => {
  class MockChannel<T> {
    onmessage?: (message: T) => void
  }
  return {
    invoke: vi.fn(),
    Channel: MockChannel,
  }
})

vi.mock("@tauri-apps/api/core", () => ({
  invoke: coreMocks.invoke,
  Channel: coreMocks.Channel,
}))

import { uploadMineruFile } from "./mineru-native-upload"

describe("uploadMineruFile", () => {
  beforeEach(() => {
    coreMocks.invoke.mockReset()
    coreMocks.invoke.mockResolvedValue(undefined)
  })

  it("passes only the file path to Rust and forwards native progress", async () => {
    const progress: Array<{ percent: number }> = []
    coreMocks.invoke.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "upload_mineru_file_cmd") {
        const channel = args?.onProgress as { onmessage?: (value: unknown) => void }
        channel.onmessage?.({ sentBytes: 5, totalBytes: 10, bytesPerSecond: 2 })
      }
    })

    await uploadMineruFile(
      "https://mineru.oss-cn-shanghai.aliyuncs.com/file",
      "D:/docs/book.pdf",
      1_500,
      undefined,
      (value) => progress.push(value),
    )

    expect(coreMocks.invoke).toHaveBeenCalledWith("upload_mineru_file_cmd", expect.objectContaining({
      path: "D:/docs/book.pdf",
      timeoutSeconds: 2,
    }))
    expect(progress).toEqual([expect.objectContaining({ percent: 50 })])
  })

  it("asks Rust to cancel the active upload when the ingest signal aborts", async () => {
    const controller = new AbortController()
    let rejectUpload: ((error: Error) => void) | undefined
    coreMocks.invoke.mockImplementation((command: string) => {
      if (command === "upload_mineru_file_cmd") {
        return new Promise((_resolve, reject) => {
          rejectUpload = reject
        })
      }
      if (command === "cancel_mineru_upload_cmd") {
        rejectUpload?.(new Error("cancelled by Rust"))
      }
      return Promise.resolve()
    })

    const upload = uploadMineruFile(
      "https://mineru.oss-cn-shanghai.aliyuncs.com/file",
      "D:/docs/book.pdf",
      10_000,
      controller.signal,
    )
    controller.abort()

    await expect(upload).rejects.toThrow("MinerU parsing cancelled")
    expect(coreMocks.invoke).toHaveBeenCalledWith(
      "cancel_mineru_upload_cmd",
      expect.objectContaining({ uploadId: expect.any(String) }),
    )
  })
})
