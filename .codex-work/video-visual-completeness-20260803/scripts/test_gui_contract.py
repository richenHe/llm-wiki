import re
import unittest
from pathlib import Path


SOURCE = Path(__file__).with_name("video_knowledge_gui.cs")


class GuiSuccessContractTests(unittest.TestCase):
    def test_codex_success_uses_artifact_validation(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        success_branch = re.search(
            r"else if \(process\.ExitCode == 0\)\s*\{(?P<body>.*?)\n\s*\}",
            text,
            re.DOTALL,
        )
        self.assertIsNotNone(success_branch)
        body = success_branch.group("body")
        self.assertIn("await ValidateAndInject(job, token);", body)
        self.assertNotIn("WorkCommandStarted", body)

    def test_obsolete_video_command_gate_is_removed(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        self.assertNotIn("WorkCommandStarted", text)
        self.assertNotIn("Codex 未执行视频工具，仅返回了文字回复", text)

    def test_python_progress_is_streamed_instead_of_buffered(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        self.assertIn("PumpToolStream(job, process.StandardOutput", text)
        self.assertIn("PumpToolStream(job, process.StandardError", text)
        self.assertIn('const string prefix = "VIDEO_PROGRESS\\t";', text)
        self.assertIn("UpdateJob(job, parts[2], progress, JobState.Running);", text)
        run_tool = text[text.index("private async Task<CommandResult> RunPythonTool"):]
        run_tool = run_tool[:run_tool.index("private void HandleCodexEvent")]
        self.assertNotIn("ReadToEndAsync()", run_tool)

    def test_preparation_no_longer_starts_at_fixed_28_percent(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        self.assertIn('UpdateJob(job, "开始准备视频证据", 8, JobState.Running);', text)

    def test_each_gui_job_gets_an_isolated_package_suffix(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        self.assertIn('"--package-suffix", "task" + job.Number.ToString("00")', text)

    def test_exact_prepared_package_path_is_used_before_directory_scanning(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        find_knowledge = text[text.index("private string FindKnowledge(VideoJob job)"):]
        find_knowledge = find_knowledge[:find_knowledge.index("private async Task<CommandResult> RunPythonTool")]
        exact_lookup = 'Path.Combine(job.PackagePath, "knowledge.md")'
        fallback_scan = "Directory.GetDirectories(OutputRoot)"
        self.assertIn(exact_lookup, find_knowledge)
        self.assertIn('AppendTaskLog(job, "UI", "knowledge.md=" + exactPath + "（任务路径）")', find_knowledge)
        self.assertLess(find_knowledge.index(exact_lookup), find_knowledge.index(fallback_scan))

    def test_python_children_are_forced_to_utf8_and_unbuffered(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        self.assertIn('EnvironmentVariables["PYTHONUTF8"] = "1";', text)
        self.assertIn('EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";', text)
        self.assertIn('EnvironmentVariables["PYTHONUNBUFFERED"] = "1";', text)
        run_tool = text[text.index("private async Task<CommandResult> RunPythonTool"):]
        run_tool = run_tool[:run_tool.index("private void HandleCodexEvent")]
        self.assertIn("ConfigureUtf8Python(process.StartInfo);", run_tool)

    def test_codex_progress_has_artifact_fallbacks(self) -> None:
        text = SOURCE.read_text(encoding="utf-8")
        self.assertIn("MonitorPackageArtifacts(job, artifactMonitorCancellation.Token)", text)
        self.assertIn('Path.Combine(package, ".cache", "visual-review.json")', text)
        self.assertIn('Path.Combine(package, ".cache", "semantic-audit.json")', text)
        self.assertIn('Path.Combine(package, "knowledge.md")', text)
        self.assertIn('Path.Combine(package, ".cache", "coverage.json")', text)
        self.assertIn('UpdateJob(job, "逐段读取全部证据", 62, JobState.Running);', text)
        self.assertIn('"审阅关键帧 · " + reviewed + "/" + expected + " 张"', text)
        self.assertIn('"整理知识 · " + Math.Max(1, info.Length / 1024) + " KiB"', text)
        self.assertIn('semantic_coverage: audited', text)
        self.assertIn('![clear description](media/file.jpg)', text)
        self.assertIn('Every unique frame needs clear alt text and claim_ids', text)
        self.assertIn('each linked semantic claim must cite the same file in evidence_frames', text)
        self.assertIn('subject relevance, informational novelty, evidential support, and standalone searchability', text)
        self.assertIn('make the visual knowledge conceptually complete in knowledge.md', text)
        self.assertIn("A reader must be able to understand the image's knowledge without opening it", text)


if __name__ == "__main__":
    unittest.main()
