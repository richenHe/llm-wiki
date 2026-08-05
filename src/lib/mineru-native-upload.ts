import { Channel, invoke } from "@tauri-apps/api/core"

interface NativeUploadProgress {
  sentBytes: number
  totalBytes: number
  bytesPerSecond: number
}

export interface MineruUploadProgress extends NativeUploadProgress {
  percent: number
}

export async function uploadMineruFile(
  url: string,
  path: string,
  timeoutMs: number,
  signal?: AbortSignal,
  onProgress?: (progress: MineruUploadProgress) => void,
): Promise<void> {
  if (signal?.aborted) throw new Error("MinerU parsing cancelled")
  const uploadId = crypto.randomUUID()
  const progressChannel = new Channel<NativeUploadProgress>()
  progressChannel.onmessage = (progress) => {
    const percent = progress.totalBytes > 0
      ? Math.min(100, (progress.sentBytes / progress.totalBytes) * 100)
      : 0
    onProgress?.({ ...progress, percent })
  }
  const cancel = () => {
    void invoke("cancel_mineru_upload_cmd", { uploadId }).catch(() => undefined)
  }
  signal?.addEventListener("abort", cancel, { once: true })
  try {
    await invoke("upload_mineru_file_cmd", {
      uploadId,
      url,
      path,
      timeoutSeconds: Math.max(1, Math.ceil(timeoutMs / 1_000)),
      onProgress: progressChannel,
    })
  } catch (error) {
    if (signal?.aborted) throw new Error("MinerU parsing cancelled")
    throw error
  } finally {
    signal?.removeEventListener("abort", cancel)
  }
}
