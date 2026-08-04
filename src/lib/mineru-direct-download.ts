import { invoke } from "@tauri-apps/api/core"

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes.buffer
}

/**
 * Download an official MinerU result through a native direct connection.
 * The Rust command validates the host, resolves public CDN addresses, keeps
 * hostname-based TLS verification, applies a size cap, and checks ZIP magic.
 */
export async function downloadMineruZipDirect(url: string): Promise<ArrayBuffer> {
  const base64 = await invoke<string>("download_mineru_zip_direct_cmd", { url })
  return base64ToArrayBuffer(base64)
}
