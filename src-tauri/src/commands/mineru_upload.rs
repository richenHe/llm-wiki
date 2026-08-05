use futures::stream;
use reqwest::{redirect::Policy, Body, Url};
use serde::Serialize;
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::State;
use tokio::io::AsyncReadExt;

const MAX_MINERU_UPLOAD_BYTES: u64 = 200 * 1024 * 1024;
const UPLOAD_CHUNK_BYTES: usize = 1024 * 1024;

#[derive(Default)]
pub struct MineruUploadState {
    cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

struct UploadRegistration {
    upload_id: String,
    cancellations: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
    cancelled: Arc<AtomicBool>,
}

impl UploadRegistration {
    fn new(upload_id: String, state: &MineruUploadState) -> Result<Self, String> {
        let mut cancellations = state
            .cancellations
            .lock()
            .map_err(|_| "MinerU upload cancellation registry is unavailable".to_string())?;
        let cancelled = match cancellations.get(&upload_id) {
            Some(existing) if existing.load(Ordering::SeqCst) => existing.clone(),
            Some(_) => return Err("A MinerU upload with this ID is already running".to_string()),
            None => {
                let flag = Arc::new(AtomicBool::new(false));
                cancellations.insert(upload_id.clone(), flag.clone());
                flag
            }
        };
        drop(cancellations);
        Ok(Self {
            upload_id,
            cancellations: state.cancellations.clone(),
            cancelled,
        })
    }
}

impl MineruUploadState {
    fn cancel(&self, upload_id: String) -> bool {
        let Ok(mut cancellations) = self.cancellations.lock() else {
            return false;
        };
        let cancelled = cancellations
            .entry(upload_id)
            .or_insert_with(|| Arc::new(AtomicBool::new(true)))
            .clone();
        cancelled.store(true, Ordering::SeqCst);
        true
    }
}

impl Drop for UploadRegistration {
    fn drop(&mut self) {
        if let Ok(mut cancellations) = self.cancellations.lock() {
            cancellations.remove(&self.upload_id);
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MineruUploadProgress {
    sent_bytes: u64,
    total_bytes: u64,
    bytes_per_second: u64,
}

fn validate_mineru_upload_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw).map_err(|error| format!("invalid MinerU upload URL: {error}"))?;
    let host = url
        .host_str()
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "MinerU upload URL has no host".to_string())?;
    let allowed_host = host == "oss-mineru.openxlab.org.cn"
        || host.ends_with(".openxlab.org.cn")
        || (host.starts_with("mineru.") && host.ends_with(".aliyuncs.com"));
    if url.scheme() != "https"
        || url.port().is_some_and(|port| port != 443)
        || !url.username().is_empty()
        || url.password().is_some()
        || !allowed_host
    {
        return Err("MinerU upload is restricted to official HTTPS storage hosts".to_string());
    }
    Ok(url)
}

async fn validate_upload_file(path: &Path) -> Result<u64, String> {
    if !path.is_absolute() {
        return Err("MinerU upload requires an absolute file path".to_string());
    }
    let metadata = tokio::fs::metadata(path)
        .await
        .map_err(|error| format!("could not read MinerU upload file metadata: {error}"))?;
    if !metadata.is_file() {
        return Err("MinerU upload path is not a file".to_string());
    }
    if metadata.len() > MAX_MINERU_UPLOAD_BYTES {
        return Err("MinerU accurate parsing supports files up to 200 MB".to_string());
    }
    Ok(metadata.len())
}

fn upload_body(
    file: tokio::fs::File,
    total_bytes: u64,
    cancelled: Arc<AtomicBool>,
    on_progress: Channel<MineruUploadProgress>,
) -> Body {
    let started = Instant::now();
    let stream = stream::try_unfold(
        (file, 0_u64, vec![0_u8; UPLOAD_CHUNK_BYTES]),
        move |(mut file, sent_bytes, mut buffer)| {
            let cancelled = cancelled.clone();
            let on_progress = on_progress.clone();
            async move {
                if cancelled.load(Ordering::SeqCst) {
                    return Err(io::Error::new(
                        io::ErrorKind::Interrupted,
                        "MinerU upload cancelled",
                    ));
                }
                let read = file.read(&mut buffer).await?;
                if read == 0 {
                    return Ok(None);
                }
                let next_sent = sent_bytes.saturating_add(read as u64);
                let elapsed = started.elapsed().as_secs_f64().max(0.001);
                let _ = on_progress.send(MineruUploadProgress {
                    sent_bytes: next_sent,
                    total_bytes,
                    bytes_per_second: (next_sent as f64 / elapsed) as u64,
                });
                let chunk = buffer[..read].to_vec();
                Ok(Some((chunk, (file, next_sent, buffer))))
            }
        },
    );
    Body::wrap_stream(stream)
}

async fn wait_until_cancelled(cancelled: Arc<AtomicBool>) {
    while !cancelled.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

#[tauri::command]
pub async fn upload_mineru_file_cmd(
    upload_id: String,
    url: String,
    path: String,
    timeout_seconds: u64,
    on_progress: Channel<MineruUploadProgress>,
    state: State<'_, MineruUploadState>,
) -> Result<(), String> {
    let registration = UploadRegistration::new(upload_id, &state)?;
    if registration.cancelled.load(Ordering::SeqCst) {
        return Err("MinerU upload cancelled".to_string());
    }
    let url = validate_mineru_upload_url(&url)?;
    let path = PathBuf::from(path);
    let total_bytes = validate_upload_file(&path).await?;
    let file = tokio::fs::File::open(&path)
        .await
        .map_err(|error| format!("could not open MinerU upload file: {error}"))?;
    let body = upload_body(
        file,
        total_bytes,
        registration.cancelled.clone(),
        on_progress,
    );
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .redirect(Policy::none())
        .build()
        .map_err(|error| format!("could not create MinerU upload client: {error}"))?;
    let request = client
        .put(url)
        .header(reqwest::header::CONTENT_LENGTH, total_bytes)
        .body(body)
        .send();
    let timeout_seconds = timeout_seconds.clamp(1, 600);

    let response = tokio::select! {
        result = request => result.map_err(|error| format!("MinerU file upload failed: {error}"))?,
        _ = tokio::time::sleep(Duration::from_secs(timeout_seconds)) => {
            return Err(format!("MinerU file upload timed out after {timeout_seconds} seconds"));
        }
        _ = wait_until_cancelled(registration.cancelled.clone()) => {
            return Err("MinerU upload cancelled".to_string());
        }
    };

    if !matches!(response.status().as_u16(), 200 | 201) {
        return Err(format!(
            "MinerU file upload failed: HTTP {}",
            response.status()
        ));
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_mineru_upload_cmd(upload_id: String, state: State<'_, MineruUploadState>) -> bool {
    state.cancel(upload_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_official_mineru_storage_hosts() {
        assert!(validate_mineru_upload_url(
            "https://mineru.oss-cn-shanghai.aliyuncs.com/api-upload/file.pdf?signature=ok"
        )
        .is_ok());
        assert!(validate_mineru_upload_url(
            "https://oss-mineru.openxlab.org.cn/agent/file.pdf?signature=ok"
        )
        .is_ok());
        assert!(
            validate_mineru_upload_url("http://mineru.oss-cn-shanghai.aliyuncs.com/file").is_err()
        );
        assert!(validate_mineru_upload_url("https://127.0.0.1/file").is_err());
        assert!(validate_mineru_upload_url("https://example.com/file").is_err());
    }

    #[tokio::test]
    async fn rejects_relative_and_oversized_files_before_upload() {
        assert!(validate_upload_file(Path::new("relative.pdf"))
            .await
            .is_err());

        let path =
            std::env::temp_dir().join(format!("llmwiki-mineru-large-{}.pdf", uuid::Uuid::new_v4()));
        let file = std::fs::File::create(&path).expect("create sparse test file");
        file.set_len(MAX_MINERU_UPLOAD_BYTES + 1)
            .expect("resize sparse test file");
        let error = validate_upload_file(&path)
            .await
            .expect_err("oversized file must fail");
        std::fs::remove_file(&path).expect("remove sparse test file");
        assert!(error.contains("200 MB"));
    }

    #[test]
    fn marks_a_registered_upload_as_cancelled_and_cleans_it_up() {
        let state = MineruUploadState::default();
        let registration =
            UploadRegistration::new("upload-1".to_string(), &state).expect("register upload");
        assert!(!registration.cancelled.load(Ordering::SeqCst));

        assert!(state.cancel("upload-1".to_string()));
        assert!(registration.cancelled.load(Ordering::SeqCst));

        drop(registration);
        assert!(state
            .cancellations
            .lock()
            .expect("registry lock")
            .is_empty());
    }
}
