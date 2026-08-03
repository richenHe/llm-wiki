//! Codex CLI subprocess transport.
//!
//! This mirrors the Claude Code CLI transport, but treats `codex` as a
//! local completion engine via `codex exec --json`. The webview can only
//! spawn this fixed command; it cannot execute arbitrary shell commands.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use base64::{engine::general_purpose::STANDARD as B64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::Mutex;

use super::cli_resolver::{child_path_env, find_cli_command};

#[derive(Default)]
pub struct CodexCliState {
    children: Arc<Mutex<HashMap<String, Child>>>,
}

#[derive(Serialize)]
pub struct DetectResult {
    installed: bool,
    version: Option<String>,
    path: Option<String>,
    error: Option<String>,
}

const DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 10;
const MIN_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 1;
const MAX_CODEX_SPAWN_TIMEOUT_MINUTES: u64 = 240;
const STDERR_LIMIT_BYTES: usize = 1024 * 1024;
const STDOUT_LIMIT_BYTES: usize = 1024 * 1024;
const MAX_CODEX_IMAGE_BYTES: usize = 5 * 1024 * 1024;
const MAX_CODEX_IMAGES: usize = 50;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexCliImage {
    media_type: String,
    data_base64: String,
}

struct MaterializedCodexImages {
    directory: PathBuf,
    paths: Vec<PathBuf>,
}

fn append_capped_line(collected: &mut String, line: &str, limit_bytes: usize) {
    if collected.len() >= limit_bytes {
        return;
    }
    for ch in line.chars() {
        if collected.len() + ch.len_utf8() > limit_bytes {
            break;
        }
        collected.push(ch);
    }
    if collected.len() < limit_bytes {
        collected.push('\n');
    }
}

async fn find_codex_command() -> Result<PathBuf, String> {
    find_cli_command("codex", &["codex.cmd", "codex.exe"]).await
}

fn suppress_windows_console(_cmd: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;
        _cmd.creation_flags(CREATE_NO_WINDOW);
    }
}

#[tauri::command]
pub async fn codex_cli_detect() -> Result<DetectResult, String> {
    let path = match find_codex_command().await {
        Ok(p) => p,
        Err(error) => {
            return Ok(DetectResult {
                installed: false,
                version: None,
                path: None,
                error: Some(error),
            });
        }
    };

    let path_str = path.to_string_lossy().to_string();
    let mut cmd = Command::new(&path);
    suppress_windows_console(&mut cmd);
    // `codex` is a node shim (`#!/usr/bin/env node`); under a GUI launch the
    // inherited PATH lacks node, so hand it the login shell PATH or its
    // shebang fails with `env: node: No such file or directory`.
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    let output = tokio::time::timeout(Duration::from_secs(3), cmd.arg("--version").output()).await;

    match output {
        Ok(Ok(out)) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
            Ok(DetectResult {
                installed: true,
                version: Some(stdout),
                path: Some(path_str),
                error: None,
            })
        }
        Ok(Ok(out)) => {
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            Ok(DetectResult {
                installed: false,
                version: None,
                path: Some(path_str),
                error: Some(if stderr.is_empty() {
                    format!("`codex --version` exited with {}", out.status)
                } else {
                    stderr
                }),
            })
        }
        Ok(Err(e)) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some(format!("Failed to spawn `codex`: {e}")),
        }),
        Err(_) => Ok(DetectResult {
            installed: false,
            version: None,
            path: Some(path_str),
            error: Some("`codex --version` timed out after 3s".to_string()),
        }),
    }
}

#[tauri::command]
pub async fn codex_cli_spawn(
    app: AppHandle,
    state: State<'_, CodexCliState>,
    stream_id: String,
    model: String,
    prompt: String,
    images: Vec<CodexCliImage>,
    isolate_local_config: bool,
    timeout_minutes: Option<u64>,
    working_directory: Option<String>,
) -> Result<(), String> {
    if prompt.trim().is_empty() {
        return Err("No prompt to send to codex CLI".to_string());
    }

    let working_directory = resolve_codex_working_directory(working_directory).await?;
    let codex = find_codex_command().await?;
    let materialized_images = materialize_codex_images(&images).await?;
    let image_paths = materialized_images
        .as_ref()
        .map(|materialized| materialized.paths.as_slice())
        .unwrap_or(&[]);
    let mut cmd = Command::new(&codex);
    suppress_windows_console(&mut cmd);
    // See `codex_cli_detect`: the node shim needs the login shell PATH at run
    // time so its shebang resolves `node` under a GUI launch.
    if let Some(path_env) = child_path_env().await {
        cmd.env("PATH", path_env);
    }
    cmd.args(build_codex_cli_args(
        &model,
        isolate_local_config,
        image_paths,
    ));
    cmd.current_dir(&working_directory);

    cmd.stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(e) => {
            cleanup_materialized_codex_images(&materialized_images).await;
            return Err(format!("Failed to spawn codex: {e}"));
        }
    };

    let mut stdin = match child.stdin.take() {
        Some(stdin) => stdin,
        None => {
            let _ = child.start_kill();
            cleanup_materialized_codex_images(&materialized_images).await;
            return Err("Missing stdin handle".to_string());
        }
    };
    let stdout = match child.stdout.take() {
        Some(stdout) => stdout,
        None => {
            let _ = child.start_kill();
            cleanup_materialized_codex_images(&materialized_images).await;
            return Err("Missing stdout handle".to_string());
        }
    };
    let stderr = match child.stderr.take() {
        Some(stderr) => stderr,
        None => {
            let _ = child.start_kill();
            cleanup_materialized_codex_images(&materialized_images).await;
            return Err("Missing stderr handle".to_string());
        }
    };

    if let Err(e) = stdin.write_all(prompt.as_bytes()).await {
        let _ = child.start_kill();
        cleanup_materialized_codex_images(&materialized_images).await;
        return Err(format!("Failed to write to codex stdin: {e}"));
    }
    if let Err(e) = stdin.flush().await {
        let _ = child.start_kill();
        cleanup_materialized_codex_images(&materialized_images).await;
        return Err(format!("Failed to flush codex stdin: {e}"));
    }
    drop(stdin);

    state.children.lock().await.insert(stream_id.clone(), child);

    let children = Arc::clone(&state.children);
    let timeout_children = Arc::clone(&state.children);
    let timed_out = Arc::new(AtomicBool::new(false));
    let timeout_flag = Arc::clone(&timed_out);
    let timeout_stream_id = stream_id.clone();
    let timeout_minutes = codex_spawn_timeout_minutes(timeout_minutes);
    let timeout_duration = Duration::from_secs(timeout_minutes * 60);
    let app_for_task = app.clone();
    let stream_id_task = stream_id.clone();
    let image_directory = materialized_images.map(|materialized| materialized.directory);
    let topic = format!("codex-cli:{stream_id}");
    let done_topic = format!("codex-cli:{stream_id}:done");

    tokio::spawn(async move {
        tokio::time::sleep(timeout_duration).await;
        if let Some(mut child) = timeout_children.lock().await.remove(&timeout_stream_id) {
            timeout_flag.store(true, Ordering::SeqCst);
            let _ = child.start_kill();
        }
    });

    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout).lines();
        let mut stderr_reader = BufReader::new(stderr).lines();
        let app = app_for_task;

        let stderr_task = tokio::spawn(async move {
            let mut collected = String::new();
            while let Ok(Some(line)) = stderr_reader.next_line().await {
                eprintln!("[codex-cli stderr] {line}");
                append_capped_line(&mut collected, &line, STDERR_LIMIT_BYTES);
            }
            collected
        });

        let mut stdout_text = String::new();
        loop {
            match reader.next_line().await {
                Ok(Some(line)) => {
                    append_capped_line(&mut stdout_text, &line, STDOUT_LIMIT_BYTES);
                    if app.emit(&topic, line).is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    eprintln!("[codex-cli stdout] read error: {e}");
                    break;
                }
            }
        }

        let child_opt = children.lock().await.remove(&stream_id_task);
        let exit_code = if let Some(mut child) = child_opt {
            match child.wait().await {
                Ok(status) => status.code(),
                Err(_) => None,
            }
        } else {
            None
        };

        let mut stderr_text = stderr_task.await.unwrap_or_default();
        if timed_out.load(Ordering::SeqCst) {
            if !stderr_text.is_empty() {
                stderr_text.push('\n');
            }
            stderr_text.push_str(&format!(
                "Codex CLI timed out after {timeout_minutes} minutes."
            ));
        } else if stderr_text.len() >= STDERR_LIMIT_BYTES {
            stderr_text.push_str("\n[stderr truncated]");
        }
        if stdout_text.len() >= STDOUT_LIMIT_BYTES {
            stdout_text.push_str("\n[stdout truncated]");
        }

        let code = if timed_out.load(Ordering::SeqCst) {
            Some(-1)
        } else {
            exit_code
        };

        if let Some(directory) = image_directory {
            if let Err(e) = tokio::fs::remove_dir_all(&directory).await {
                eprintln!(
                    "[codex-cli] failed to remove temporary image directory {}: {e}",
                    directory.display()
                );
            }
        }

        let _ = app.emit(
            &done_topic,
            serde_json::json!({
                "code": code,
                "stderr": stderr_text,
                "stdout": stdout_text,
            }),
        );
    });

    Ok(())
}

fn codex_spawn_timeout_minutes(value: Option<u64>) -> u64 {
    value.unwrap_or(DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES).clamp(
        MIN_CODEX_SPAWN_TIMEOUT_MINUTES,
        MAX_CODEX_SPAWN_TIMEOUT_MINUTES,
    )
}

fn build_codex_cli_args(
    model: &str,
    isolate_local_config: bool,
    image_paths: &[PathBuf],
) -> Vec<String> {
    let mut args = vec!["-a".to_string(), "never".to_string(), "exec".to_string()];

    if isolate_local_config {
        args.extend([
            "--ignore-user-config".to_string(),
            "--ignore-rules".to_string(),
        ]);
    }

    for path in image_paths {
        args.push("--image".to_string());
        args.push(path.to_string_lossy().to_string());
    }

    args.extend([
        "--json".to_string(),
        "--skip-git-repo-check".to_string(),
        "--sandbox".to_string(),
        "read-only".to_string(),
        "--ephemeral".to_string(),
        "--model".to_string(),
        model.to_string(),
        "-".to_string(),
    ]);
    args
}

fn codex_image_extension(media_type: &str) -> Option<&'static str> {
    match media_type.trim().to_ascii_lowercase().as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/webp" => Some("webp"),
        "image/gif" => Some("gif"),
        _ => None,
    }
}

async fn materialize_codex_images(
    images: &[CodexCliImage],
) -> Result<Option<MaterializedCodexImages>, String> {
    if images.is_empty() {
        return Ok(None);
    }
    if images.len() > MAX_CODEX_IMAGES {
        return Err(format!(
            "Codex CLI accepts at most {MAX_CODEX_IMAGES} images per request"
        ));
    }

    let directory =
        std::env::temp_dir().join(format!("llm-wiki-codex-images-{}", uuid::Uuid::new_v4()));
    tokio::fs::create_dir(&directory).await.map_err(|e| {
        format!(
            "Failed to create temporary Codex image directory {}: {e}",
            directory.display()
        )
    })?;

    let mut paths = Vec::with_capacity(images.len());
    for (index, image) in images.iter().enumerate() {
        let extension = match codex_image_extension(&image.media_type) {
            Some(extension) => extension,
            None => {
                let _ = tokio::fs::remove_dir_all(&directory).await;
                return Err(format!(
                    "Unsupported Codex CLI image type: {}",
                    image.media_type
                ));
            }
        };
        let bytes = match B64.decode(image.data_base64.trim()) {
            Ok(bytes) => bytes,
            Err(e) => {
                let _ = tokio::fs::remove_dir_all(&directory).await;
                return Err(format!(
                    "Invalid base64 for Codex CLI image {}: {e}",
                    index + 1
                ));
            }
        };
        if bytes.len() > MAX_CODEX_IMAGE_BYTES {
            let _ = tokio::fs::remove_dir_all(&directory).await;
            return Err(format!(
                "Codex CLI image {} exceeds the 5 MB limit",
                index + 1
            ));
        }

        let path = directory.join(format!("image-{}.{}", index + 1, extension));
        if let Err(e) = tokio::fs::write(&path, bytes).await {
            let _ = tokio::fs::remove_dir_all(&directory).await;
            return Err(format!(
                "Failed to write temporary Codex CLI image {}: {e}",
                path.display()
            ));
        }
        paths.push(path);
    }

    Ok(Some(MaterializedCodexImages { directory, paths }))
}

async fn cleanup_materialized_codex_images(images: &Option<MaterializedCodexImages>) {
    if let Some(images) = images {
        let _ = tokio::fs::remove_dir_all(&images.directory).await;
    }
}

async fn resolve_codex_working_directory(value: Option<String>) -> Result<PathBuf, String> {
    let raw = value
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string)
        .ok_or_else(|| "Codex CLI requires an active project working directory".to_string())?;
    let path = Path::new(raw.as_str());
    if !path.is_absolute() {
        return Err("Codex CLI working directory must be an absolute project path".to_string());
    }
    let path_meta = tokio::fs::metadata(path).await.map_err(|e| {
        eprintln!("[codex-cli] failed to read working directory metadata {raw}: {e}");
        format!("Codex CLI working directory does not exist or cannot be read: {raw}")
    })?;
    if !path_meta.is_dir() {
        return Err(format!(
            "Codex CLI working directory is not a directory: {raw}"
        ));
    }
    let index_path = path.join("wiki").join("index.md");
    let index_meta = tokio::fs::metadata(&index_path).await.map_err(|e| {
        eprintln!("[codex-cli] failed to read wiki/index.md metadata for {raw}: {e}");
        format!("Codex CLI working directory must be an LLM Wiki project containing wiki/index.md: {raw}")
    })?;
    if !index_meta.is_file() {
        return Err(format!(
            "Codex CLI working directory must be an LLM Wiki project containing wiki/index.md: {raw}"
        ));
    }
    tokio::fs::canonicalize(path)
        .await
        .map_err(|e| format!("Failed to canonicalize Codex CLI working directory {raw}: {e}"))
}

#[tauri::command]
pub async fn codex_cli_kill(
    state: State<'_, CodexCliState>,
    stream_id: String,
) -> Result<(), String> {
    if let Some(mut child) = state.children.lock().await.remove(&stream_id) {
        let _ = child.start_kill();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn append_capped_line_appends_newline_when_space_remains() {
        let mut out = String::new();
        append_capped_line(&mut out, "hello", 16);
        assert_eq!(out, "hello\n");
    }

    #[test]
    fn append_capped_line_never_exceeds_limit() {
        let mut out = String::new();
        append_capped_line(&mut out, "abcdef", 4);
        assert_eq!(out, "abcd");
        assert_eq!(out.len(), 4);
        append_capped_line(&mut out, "ignored", 4);
        assert_eq!(out, "abcd");
    }

    #[test]
    fn append_capped_line_preserves_utf8_boundaries() {
        let mut out = String::new();
        append_capped_line(&mut out, "é水x", 5);
        assert_eq!(out, "é水");
        assert_eq!(out.len(), 5);
        assert!(std::str::from_utf8(out.as_bytes()).is_ok());
    }

    #[test]
    fn codex_spawn_timeout_minutes_defaults_and_clamps() {
        assert_eq!(
            codex_spawn_timeout_minutes(None),
            DEFAULT_CODEX_SPAWN_TIMEOUT_MINUTES
        );
        assert_eq!(
            codex_spawn_timeout_minutes(Some(0)),
            MIN_CODEX_SPAWN_TIMEOUT_MINUTES
        );
        assert_eq!(codex_spawn_timeout_minutes(Some(42)), 42);
        assert_eq!(
            codex_spawn_timeout_minutes(Some(999)),
            MAX_CODEX_SPAWN_TIMEOUT_MINUTES
        );
    }

    #[test]
    fn codex_args_do_not_isolate_local_config_by_default() {
        let args = build_codex_cli_args("gpt-5", false, &[]);

        assert!(args
            .windows(3)
            .any(|pair| pair[0] == "-a" && pair[1] == "never" && pair[2] == "exec"));
        assert!(args.contains(&"--model".to_string()));
        assert!(args.contains(&"gpt-5".to_string()));
        assert!(!args.contains(&"--ignore-user-config".to_string()));
        assert!(!args.contains(&"--ignore-rules".to_string()));
    }

    #[test]
    fn codex_args_can_isolate_user_config_and_rules() {
        let args = build_codex_cli_args("gpt-5", true, &[]);
        let exec_pos = args.iter().position(|arg| arg == "exec").expect("exec arg");
        let ignore_config_pos = args
            .iter()
            .position(|arg| arg == "--ignore-user-config")
            .expect("ignore-user-config arg");
        let ignore_rules_pos = args
            .iter()
            .position(|arg| arg == "--ignore-rules")
            .expect("ignore-rules arg");

        assert!(ignore_config_pos > exec_pos);
        assert!(ignore_rules_pos > exec_pos);
    }

    #[test]
    fn codex_args_attach_each_image_before_the_prompt() {
        let paths = vec![PathBuf::from("first.png"), PathBuf::from("second.jpg")];
        let args = build_codex_cli_args("gpt-5.6-sol", false, &paths);

        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--image" && pair[1] == "first.png"));
        assert!(args
            .windows(2)
            .any(|pair| pair[0] == "--image" && pair[1] == "second.jpg"));
        assert_eq!(args.last().map(String::as_str), Some("-"));
    }

    #[tokio::test]
    async fn materializes_supported_images_for_codex_cli() {
        let result = materialize_codex_images(&[CodexCliImage {
            media_type: "image/png".to_string(),
            data_base64: B64.encode(b"png bytes"),
        }])
        .await
        .expect("materialize")
        .expect("images");

        assert_eq!(result.paths.len(), 1);
        assert_eq!(
            tokio::fs::read(&result.paths[0]).await.expect("read image"),
            b"png bytes"
        );
        tokio::fs::remove_dir_all(result.directory)
            .await
            .expect("cleanup");
    }

    struct TestDir(PathBuf);

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[tokio::test]
    async fn codex_working_directory_requires_absolute_existing_project() {
        assert!(resolve_codex_working_directory(None)
            .await
            .unwrap_err()
            .contains("requires an active project"));
        assert!(resolve_codex_working_directory(Some("".to_string()))
            .await
            .unwrap_err()
            .contains("requires an active project"));
        assert!(resolve_codex_working_directory(Some("   ".to_string()))
            .await
            .unwrap_err()
            .contains("requires an active project"));
        assert!(
            resolve_codex_working_directory(Some("relative/project".to_string()))
                .await
                .unwrap_err()
                .contains("absolute")
        );

        let missing =
            std::env::temp_dir().join(format!("llm-wiki-codex-cli-missing-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&missing);
        assert!(
            resolve_codex_working_directory(Some(missing.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("does not exist or cannot be read")
        );

        let file_path =
            std::env::temp_dir().join(format!("llm-wiki-codex-cli-file-{}", std::process::id()));
        let _ = std::fs::remove_file(&file_path);
        std::fs::write(&file_path, "not a directory").expect("temp file");
        struct TestFile(PathBuf);
        impl Drop for TestFile {
            fn drop(&mut self) {
                let _ = std::fs::remove_file(&self.0);
            }
        }
        let _file_guard = TestFile(file_path.clone());
        assert!(
            resolve_codex_working_directory(Some(file_path.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("not a directory")
        );

        let dir =
            std::env::temp_dir().join(format!("llm-wiki-codex-cli-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("tempdir");
        let _guard = TestDir(dir.clone());
        assert!(
            resolve_codex_working_directory(Some(dir.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("wiki/index.md")
        );

        let wiki_dir = dir.join("wiki");
        std::fs::create_dir_all(&wiki_dir).expect("wiki dir");
        let index_dir = wiki_dir.join("index.md");
        std::fs::create_dir_all(&index_dir).expect("index dir");
        assert!(
            resolve_codex_working_directory(Some(dir.to_string_lossy().to_string()))
                .await
                .unwrap_err()
                .contains("wiki/index.md")
        );
        std::fs::remove_dir_all(&index_dir).expect("remove index dir");
        std::fs::write(wiki_dir.join("index.md"), "# Index\n").expect("index");
        let resolved = resolve_codex_working_directory(Some(dir.to_string_lossy().to_string()))
            .await
            .expect("valid project path");
        assert_eq!(resolved, dir.canonicalize().expect("canonical tempdir"));
    }
}
