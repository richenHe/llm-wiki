/*
THESIS: One compact queue turns comma-separated video links into visible Codex work, refusing configuration clutter.
OWN-WORLD: Paper-white canvas, graphite text, cobalt progress, thin dividers, and dense native Windows typography.
STORY: Paste links, press once, then watch every video advance through evidence, understanding, knowledge, and ingestion.
FIRST VIEWPORT: A short link field and one action sit above a scrollable progress ledger; no secondary controls compete.
FORM: Compact operator ledger, chosen directly from the user’s precise one-button brief; no concept seed was needed.
*/

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using System.Web.Script.Serialization;

namespace VideoKnowledgeTool
{
    internal enum JobState
    {
        Queued,
        Running,
        Completed,
        Failed,
        Cancelled
    }

    internal sealed class VideoJob
    {
        public int Number;
        public string Link;
        public bool IsLocalFile;
        public string LocalFilePath;
        public string DisplayText;
        public int Progress;
        public JobState State;
        public JobRow Row;
        public string LastError;
        public string LogPath;
        public DateTime StartedAt;
        public string Stage;
        public string TaskToken;
        public string PackagePath;
        public readonly object LogLock = new object();
    }

    internal sealed class CommandResult
    {
        public int ExitCode;
        public string Output;
        public string Error;
    }

    internal sealed class JobRow : Panel
    {
        private readonly Label indexLabel;
        private readonly Label linkLabel;
        private readonly Label stageLabel;
        private readonly Label percentLabel;
        private readonly ProgressBar progressBar;
        private readonly ToolTip toolTip;
        private readonly Color ink = Color.FromArgb(28, 37, 54);
        private readonly Color muted = Color.FromArgb(91, 101, 119);

        public JobRow(int number, string link)
        {
            Height = 72;
            Margin = new Padding(0);
            BackColor = Color.White;

            indexLabel = new Label
            {
                Text = number.ToString("00"),
                AutoSize = false,
                Size = new Size(36, 36),
                Location = new Point(12, 12),
                TextAlign = ContentAlignment.MiddleCenter,
                BackColor = Color.FromArgb(237, 242, 252),
                ForeColor = Color.FromArgb(42, 91, 178),
                Font = new Font("Microsoft YaHei UI", 8F, FontStyle.Bold)
            };
            linkLabel = new Label
            {
                Text = link,
                AutoEllipsis = true,
                Location = new Point(60, 8),
                Height = 21,
                ForeColor = ink,
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
                Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top
            };
            stageLabel = new Label
            {
                Text = "等待并发槽位",
                AutoEllipsis = true,
                Location = new Point(60, 32),
                Height = 19,
                ForeColor = muted,
                Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top
            };
            percentLabel = new Label
            {
                Text = "0%",
                AutoSize = false,
                Size = new Size(48, 19),
                TextAlign = ContentAlignment.MiddleRight,
                Location = new Point(0, 32),
                ForeColor = muted,
                Font = new Font("Microsoft YaHei UI", 8F, FontStyle.Bold),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            progressBar = new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Height = 6,
                Anchor = AnchorStyles.Left | AnchorStyles.Right | AnchorStyles.Top,
                Style = ProgressBarStyle.Continuous
            };
            toolTip = new ToolTip { AutoPopDelay = 12000, InitialDelay = 300, ReshowDelay = 100 };
            toolTip.SetToolTip(linkLabel, link);

            Controls.Add(indexLabel);
            Controls.Add(linkLabel);
            Controls.Add(stageLabel);
            Controls.Add(percentLabel);
            Controls.Add(progressBar);
            Resize += delegate
            {
                int right = Math.Max(120, ClientSize.Width - 16);
                linkLabel.Width = Math.Max(80, right - 60);
                percentLabel.Location = new Point(right - percentLabel.Width, 32);
                stageLabel.Width = Math.Max(60, percentLabel.Left - 68);
                progressBar.Location = new Point(60, 56);
                progressBar.Width = Math.Max(80, right - 60);
            };
        }

        public void SetStage(string text, int progress, JobState state)
        {
            progress = Math.Max(0, Math.Min(100, progress));
            progressBar.Value = progress;
            stageLabel.Text = text;
            percentLabel.Text = progress + "%";
            toolTip.SetToolTip(stageLabel, text);

            if (state == JobState.Completed)
            {
                indexLabel.BackColor = Color.FromArgb(228, 246, 235);
                indexLabel.ForeColor = Color.FromArgb(29, 125, 72);
                stageLabel.ForeColor = Color.FromArgb(29, 125, 72);
                percentLabel.ForeColor = Color.FromArgb(29, 125, 72);
            }
            else if (state == JobState.Failed)
            {
                indexLabel.BackColor = Color.FromArgb(253, 235, 232);
                indexLabel.ForeColor = Color.FromArgb(176, 61, 50);
                stageLabel.ForeColor = Color.FromArgb(176, 61, 50);
                percentLabel.ForeColor = Color.FromArgb(176, 61, 50);
            }
            else if (state == JobState.Cancelled)
            {
                indexLabel.BackColor = Color.FromArgb(238, 240, 244);
                indexLabel.ForeColor = muted;
                stageLabel.ForeColor = muted;
                percentLabel.ForeColor = muted;
            }
            else
            {
                stageLabel.ForeColor = muted;
                percentLabel.ForeColor = Color.FromArgb(42, 91, 178);
            }
        }
    }

    internal sealed class MainForm : Form
    {
        private readonly Color ink = Color.FromArgb(28, 37, 54);
        private readonly Color muted = Color.FromArgb(91, 101, 119);
        private readonly Color accent = Color.FromArgb(36, 105, 235);
        private readonly Color canvas = Color.FromArgb(246, 248, 252);
        private readonly Color divider = Color.FromArgb(224, 229, 238);

        private TextBox linksBox;
        private Button localFilesButton;
        private Label localFilesLabel;
        private Panel jobsPanel;
        private Label summaryLabel;
        private Label runtimeLabel;
        private Label quotaLabel;
        private ProgressBar overallProgress;
        private Button actionButton;
        private readonly List<VideoJob> jobs = new List<VideoJob>();
        private readonly List<string> selectedLocalFiles = new List<string>();
        private readonly Dictionary<int, Process> activeProcesses = new Dictionary<int, Process>();
        private readonly object processLock = new object();
        private CancellationTokenSource cancellation;
        private bool isRunning;
        private bool stopRequested;
        private bool forceClose;
        private string codexPath;

        private string ProjectRoot { get { return @"D:\project\llmwiki"; } }
        private string OutputRoot { get { return @"D:\video"; } }
        private string RuntimeRoot { get { return @"D:\video-knowledge-runtime"; } }
        private string TaskLogRoot { get { return Path.Combine(RuntimeRoot, "tasklogs"); } }
        private string SkillRoot
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
                    ".codex", "skills", "download-cn-video");
            }
        }
        private string PythonPath { get { return Path.Combine(SkillRoot, ".venv", "Scripts", "python.exe"); } }
        private string CodexRunnerPath { get { return Path.Combine(SkillRoot, "scripts", "codex_cli_runner.py"); } }
        private string OpenCliPackageRoot
        {
            get
            {
                return Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                    "npm", "node_modules", "@jackwener", "opencli");
            }
        }

        public MainForm()
        {
            Directory.CreateDirectory(RuntimeRoot);
            Directory.CreateDirectory(TaskLogRoot);
            string startupCleanupError = CleanOutputRoot();
            Text = "视频知识整理器";
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = canvas;
            ForeColor = ink;
            Font = new Font("Microsoft YaHei UI", 9F);
            Size = new Size(760, 620);
            MinimumSize = new Size(640, 500);
            AutoScaleMode = AutoScaleMode.Dpi;
            BuildInterface();
            codexPath = FindCodex();
            RefreshRuntimeLabel();
            Shown += async delegate { await RefreshCodexStatus(); };
            FormClosing += OnFormClosing;
            if (!String.IsNullOrWhiteSpace(startupCleanupError))
            {
                Shown += delegate
                {
                    MessageBox.Show(this, "旧的中转文件未能全部删除：\n" + startupCleanupError,
                        "中转目录清理失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                };
            }
        }

        private void BuildInterface()
        {
            var root = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(24, 20, 24, 20),
                ColumnCount = 1,
                RowCount = 5
            };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 58));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 48));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 54));
            Controls.Add(root);

            root.Controls.Add(BuildHeader(), 0, 0);
            root.Controls.Add(BuildInput(), 0, 1);
            root.Controls.Add(BuildProgressHeader(), 0, 2);
            root.Controls.Add(BuildJobsPanel(), 0, 3);
            root.Controls.Add(BuildAction(), 0, 4);
        }

        private Control BuildHeader()
        {
            var panel = new Panel { Dock = DockStyle.Fill };
            var title = new Label
            {
                Text = "视频知识整理器",
                AutoSize = true,
                Location = new Point(0, 0),
                ForeColor = ink,
                Font = new Font("Microsoft YaHei UI", 17F, FontStyle.Bold)
            };
            runtimeLabel = new Label
            {
                AutoSize = false,
                Size = new Size(420, 20),
                TextAlign = ContentAlignment.MiddleRight,
                ForeColor = muted,
                Font = new Font("Microsoft YaHei UI", 8.5F),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            quotaLabel = new Label
            {
                AutoSize = false,
                Size = new Size(420, 18),
                TextAlign = ContentAlignment.MiddleRight,
                ForeColor = muted,
                Font = new Font("Microsoft YaHei UI", 8F),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            panel.Controls.Add(title);
            panel.Controls.Add(runtimeLabel);
            panel.Controls.Add(quotaLabel);
            panel.Resize += delegate
            {
                runtimeLabel.Location = new Point(panel.ClientSize.Width - runtimeLabel.Width, 0);
                quotaLabel.Location = new Point(panel.ClientSize.Width - quotaLabel.Width, 25);
            };
            return panel;
        }

        private Control BuildInput()
        {
            var panel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.White,
                Padding = new Padding(16, 12, 16, 12)
            };
            var label = new Label
            {
                Text = "视频链接 / 本地视频",
                AutoSize = true,
                Location = new Point(16, 12),
                ForeColor = ink,
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold)
            };
            localFilesButton = new Button
            {
                Text = "选择本地视频",
                Size = new Size(112, 27),
                BackColor = Color.White,
                ForeColor = accent,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            localFilesButton.FlatAppearance.BorderColor = Color.FromArgb(184, 200, 229);
            localFilesButton.FlatAppearance.BorderSize = 1;
            localFilesButton.Click += SelectLocalFiles;
            localFilesLabel = new Label
            {
                Text = "未选择本地视频",
                AutoSize = false,
                Size = new Size(180, 21),
                TextAlign = ContentAlignment.MiddleRight,
                ForeColor = muted,
                Font = new Font("Microsoft YaHei UI", 8F),
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            linksBox = new TextBox
            {
                Multiline = true,
                AcceptsReturn = true,
                ScrollBars = ScrollBars.Vertical,
                BorderStyle = BorderStyle.FixedSingle,
                BackColor = Color.FromArgb(251, 252, 254),
                ForeColor = ink,
                Font = new Font("Microsoft YaHei UI", 9.5F),
                Location = new Point(16, 39),
                Anchor = AnchorStyles.Top | AnchorStyles.Bottom | AnchorStyles.Left | AnchorStyles.Right
            };
            panel.Controls.Add(label);
            panel.Controls.Add(localFilesLabel);
            panel.Controls.Add(localFilesButton);
            panel.Controls.Add(linksBox);
            panel.Resize += delegate
            {
                localFilesButton.Location = new Point(panel.ClientSize.Width - 128, 7);
                localFilesLabel.Location = new Point(localFilesButton.Left - localFilesLabel.Width - 8, 10);
                linksBox.Size = new Size(panel.ClientSize.Width - 32, panel.ClientSize.Height - 52);
            };
            return panel;
        }

        private void SelectLocalFiles(object sender, EventArgs e)
        {
            using (var dialog = new OpenFileDialog
            {
                Title = "选择要整理的视频",
                Multiselect = true,
                CheckFileExists = true,
                CheckPathExists = true,
                Filter = "视频文件|*.mp4;*.mkv;*.mov;*.webm;*.m4v|所有文件|*.*"
            })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                foreach (string file in dialog.FileNames)
                {
                    string fullPath;
                    try { fullPath = Path.GetFullPath(file); }
                    catch { continue; }
                    if (!File.Exists(fullPath) || !IsSupportedLocalVideo(fullPath)) continue;
                    if (!selectedLocalFiles.Contains(fullPath, StringComparer.OrdinalIgnoreCase))
                        selectedLocalFiles.Add(fullPath);
                }
                UpdateLocalFilesLabel();
            }
        }

        private static bool IsSupportedLocalVideo(string path)
        {
            string extension = Path.GetExtension(path) ?? "";
            return new[] { ".mp4", ".mkv", ".mov", ".webm", ".m4v" }
                .Contains(extension.ToLowerInvariant());
        }

        private void UpdateLocalFilesLabel()
        {
            if (localFilesLabel == null) return;
            localFilesLabel.Text = selectedLocalFiles.Count == 0
                ? "未选择本地视频"
                : "已选 " + selectedLocalFiles.Count + " 个本地视频";
            localFilesLabel.Tag = String.Join(Environment.NewLine, selectedLocalFiles.ToArray());
        }

        private Control BuildProgressHeader()
        {
            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0, 14, 0, 6) };
            summaryLabel = new Label
            {
                Text = "等待开始",
                AutoSize = true,
                ForeColor = ink,
                Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
                Location = new Point(0, 16)
            };
            overallProgress = new ProgressBar
            {
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Height = 7,
                Width = 180,
                Style = ProgressBarStyle.Continuous,
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            panel.Controls.Add(summaryLabel);
            panel.Controls.Add(overallProgress);
            panel.Resize += delegate
            {
                overallProgress.Location = new Point(panel.ClientSize.Width - overallProgress.Width, 20);
            };
            return panel;
        }

        private Control BuildJobsPanel()
        {
            var border = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = divider,
                Padding = new Padding(1)
            };
            jobsPanel = new Panel
            {
                Dock = DockStyle.Fill,
                BackColor = Color.White,
                AutoScroll = true,
                Padding = new Padding(0)
            };
            jobsPanel.Resize += delegate { LayoutJobRows(); };
            border.Controls.Add(jobsPanel);
            return border;
        }

        private Control BuildAction()
        {
            var panel = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0, 14, 0, 0) };
            actionButton = new Button
            {
                Text = "开始整理",
                Size = new Size(116, 36),
                BackColor = accent,
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Cursor = Cursors.Hand,
                Anchor = AnchorStyles.Top | AnchorStyles.Right
            };
            actionButton.FlatAppearance.BorderSize = 0;
            actionButton.Click += ActionClicked;
            panel.Controls.Add(actionButton);
            panel.Resize += delegate
            {
                actionButton.Location = new Point(panel.ClientSize.Width - actionButton.Width, 12);
            };
            return panel;
        }

        private async void ActionClicked(object sender, EventArgs e)
        {
            if (isRunning)
            {
                await StopAllAsync();
                return;
            }

            var links = ParseLinks(linksBox.Text);
            var localFiles = selectedLocalFiles
                .Where(delegate(string path) { return File.Exists(path) && IsSupportedLocalVideo(path); })
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToList();
            if (links.Count == 0 && localFiles.Count == 0)
            {
                MessageBox.Show(this, "请粘贴至少一个视频链接，或选择本地视频。", "还没有视频",
                    MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            if (String.IsNullOrWhiteSpace(codexPath))
            {
                MessageBox.Show(this, "未找到 Codex CLI。请先确认 Codex 已安装并登录。",
                    "Codex CLI 不可用", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            if (!Directory.Exists(SkillRoot))
            {
                MessageBox.Show(this, "未找到 download-cn-video Skill：" + SkillRoot,
                    "Skill 不可用", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            string outputPrefix = Path.GetFullPath(OutputRoot)
                .TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
            string localInOutput = localFiles.FirstOrDefault(delegate(string path)
            {
                return Path.GetFullPath(path).StartsWith(outputPrefix, StringComparison.OrdinalIgnoreCase);
            });
            if (!String.IsNullOrWhiteSpace(localInOutput))
            {
                MessageBox.Show(this,
                    "D:\\video 是会被自动清空的中转目录，不能把其中的文件选作本地原视频。\n请先把原视频移到其他目录：\n" + localInOutput,
                    "本地视频位于中转目录", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }

            Directory.CreateDirectory(OutputRoot);
            string preflightCleanupError = await Task.Run(delegate { return CleanOutputRoot(); });
            if (!String.IsNullOrWhiteSpace(preflightCleanupError))
            {
                MessageBox.Show(this, "无法清空 D:\\video，任务没有启动：\n" + preflightCleanupError,
                    "中转目录清理失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            BuildJobs(links, localFiles);
            isRunning = true;
            stopRequested = false;
            linksBox.ReadOnly = true;
            localFilesButton.Enabled = false;
            actionButton.Text = "停止整理";
            actionButton.BackColor = Color.FromArgb(190, 64, 55);
            cancellation = new CancellationTokenSource();
            summaryLabel.Text = "正在启动 Codex…";

            int concurrency = Math.Min(2, Math.Max(1, jobs.Count));
            var gate = new SemaphoreSlim(concurrency, concurrency);
            var tasks = jobs.Select(delegate(VideoJob job)
            {
                return RunQueuedJob(job, gate, cancellation.Token);
            }).ToArray();

            await Task.WhenAll(tasks);
            gate.Dispose();
            await FinishBatch();
        }

        private List<string> ParseLinks(string value)
        {
            return Regex.Split(value ?? "", @"[,，;\r\n]+")
                .Select(delegate(string item) { return item.Trim(); })
                .Where(delegate(string item) { return item.Length > 0; })
                .Distinct(StringComparer.Ordinal)
                .ToList();
        }

        private static string CanonicalLinkKey(string link)
        {
            Match bilibili = Regex.Match(link ?? "", @"BV[0-9A-Za-z]+", RegexOptions.IgnoreCase);
            if (bilibili.Success)
            {
                Match page = Regex.Match(link ?? "", @"[?&]p=(\d+)(?:[&#]|$)", RegexOptions.IgnoreCase);
                string pageNumber = page.Success ? page.Groups[1].Value : "1";
                return "bilibili:" + bilibili.Value.ToUpperInvariant() + "-p" + pageNumber;
            }

            Match youtube = Regex.Match(
                link ?? "",
                @"(?:youtu\.be/|youtube\.com/(?:watch\?.*?[?&]?v=|shorts/|embed/))([0-9A-Za-z_-]{6,})",
                RegexOptions.IgnoreCase);
            if (youtube.Success) return "youtube:" + youtube.Groups[1].Value;

            Match douyin = Regex.Match(link ?? "", @"douyin\.com/(?:video|note)/(\d+)", RegexOptions.IgnoreCase);
            if (douyin.Success) return "douyin:" + douyin.Groups[1].Value;

            Uri uri;
            if (Uri.TryCreate(link, UriKind.Absolute, out uri))
                return uri.Host.ToLowerInvariant() + uri.AbsolutePath.TrimEnd('/').ToLowerInvariant();
            return (link ?? "").Trim();
        }

        private static string TaskKey(string link)
        {
            string key = CanonicalLinkKey(link);
            int colon = key.IndexOf(':');
            if (colon >= 0) key = key.Substring(colon + 1);
            key = Regex.Replace(key, @"[^0-9A-Za-z_-]+", "-").Trim('-');
            if (key.Length == 0) key = "video";
            if (key.Length > 24) key = key.Substring(0, 24);
            byte[] input = Encoding.UTF8.GetBytes((link ?? "").Trim());
            string suffix;
            using (SHA256 sha = SHA256.Create())
                suffix = BitConverter.ToString(sha.ComputeHash(input), 0, 4).Replace("-", "").ToLowerInvariant();
            return key + "-" + suffix;
        }

        private static void AppendTaskLog(VideoJob job, string channel, string value)
        {
            if (job == null || String.IsNullOrWhiteSpace(job.LogPath)) return;
            string line = (value ?? "").Replace("\r", " ").Replace("\n", " ");
            lock (job.LogLock)
            {
                try
                {
                    File.AppendAllText(
                        job.LogPath,
                        DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + "\t" + channel + "\t" + line + Environment.NewLine,
                        new UTF8Encoding(false));
                }
                catch { }
            }
        }

        private void BuildJobs(List<string> links, List<string> localFiles)
        {
            jobs.Clear();
            jobsPanel.Controls.Clear();
            jobsPanel.AutoScrollPosition = new Point(0, 0);
            string batchStamp = DateTime.Now.ToString("yyyyMMdd-HHmmss");
            var inputs = links.Select(delegate(string link)
            {
                return new { Value = link, IsLocal = false };
            }).Concat(localFiles.Select(delegate(string file)
            {
                return new { Value = file, IsLocal = true };
            })).ToList();
            for (int index = 0; index < inputs.Count; index++)
            {
                string value = inputs[index].Value;
                bool isLocal = inputs[index].IsLocal;
                var job = new VideoJob
                {
                    Number = index + 1,
                    Link = value,
                    IsLocalFile = isLocal,
                    LocalFilePath = isLocal ? value : null,
                    DisplayText = isLocal ? "[本地] " + value : value,
                    Progress = 0,
                    State = JobState.Queued,
                    TaskToken = TaskKey(value)
                };
                job.Stage = "等待并发槽位";
                job.LogPath = Path.Combine(
                    TaskLogRoot,
                    batchStamp + "-" + (index + 1).ToString("00") + "-" + TaskKey(job.Link) + ".log");
                job.Row = new JobRow(job.Number, job.DisplayText);
                jobs.Add(job);
                jobsPanel.Controls.Add(job.Row);
                AppendTaskLog(job, "UI", "等待并发槽位");
            }
            LayoutJobRows();
            UpdateSummary();
        }

        private void LayoutJobRows()
        {
            if (jobsPanel == null) return;
            int rowPitch = 73;
            int contentHeight = jobs.Count * rowPitch;
            jobsPanel.AutoScrollMinSize = new Size(0, contentHeight);
            int width = Math.Max(100, jobsPanel.ClientSize.Width - 2);
            if (contentHeight > jobsPanel.ClientSize.Height)
                width = Math.Max(100, width - SystemInformation.VerticalScrollBarWidth);

            for (int index = 0; index < jobs.Count; index++)
            {
                JobRow row = jobs[index].Row;
                row.SetBounds(0, index * rowPitch, width, 72);
                row.BringToFront();
            }
        }

        private async Task RunQueuedJob(VideoJob job, SemaphoreSlim gate, CancellationToken token)
        {
            try
            {
                await gate.WaitAsync(token);
            }
            catch (OperationCanceledException)
            {
                UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
                return;
            }

            try
            {
                if (token.IsCancellationRequested)
                {
                    UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
                    return;
                }
                if (!await PreparePackage(job, token)) return;
                if (token.IsCancellationRequested)
                {
                    UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
                    return;
                }
                await RunCodex(job, token);
            }
            finally
            {
                gate.Release();
            }
        }

        private async Task RunCodex(VideoJob job, CancellationToken token)
        {
            job.StartedAt = DateTime.Now;
            UpdateJob(job, "Codex 正在接手", 6, JobState.Running);
            AppendTaskLog(job, "UI", "任务开始");
            string prompt = BuildPrompt(job);
            var argumentValues = new List<string>
            {
                "exec",
                "--json",
                "--ephemeral",
                "--sandbox", "workspace-write",
                "-c", "sandbox_workspace_write.network_access=true",
                "-c", "approval_policy=\"never\"",
                "--cd", ProjectRoot,
                "--add-dir", OutputRoot
            };
            if (job.IsLocalFile)
            {
                string sourceDirectory = Path.GetDirectoryName(job.LocalFilePath);
                if (!String.IsNullOrWhiteSpace(sourceDirectory) && Directory.Exists(sourceDirectory))
                {
                    argumentValues.Add("--add-dir");
                    argumentValues.Add(sourceDirectory);
                    AppendTaskLog(job, "UI", "本地视频目录已授权：" + sourceDirectory);
                }
            }
            if (Directory.Exists(OpenCliPackageRoot))
            {
                argumentValues.Add("--add-dir");
                argumentValues.Add(OpenCliPackageRoot);
                AppendTaskLog(job, "UI", "OpenCLI 1.8.6 路径已授权");
            }
            argumentValues.Add(prompt);
            string arguments = JoinArgs(argumentValues);

            var outputErrors = new StringBuilder();
            CancellationTokenSource artifactMonitorCancellation = null;
            Task artifactMonitor = null;
            var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = PythonPath,
                Arguments = Quote(CodexRunnerPath) + " " + arguments,
                WorkingDirectory = ProjectRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            ConfigureUtf8Python(process.StartInfo);
            process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (!String.IsNullOrWhiteSpace(eventArgs.Data))
                {
                    AppendTaskLog(job, "OUT", eventArgs.Data);
                    HandleCodexEvent(job, eventArgs.Data);
                }
            };
            process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs eventArgs)
            {
                if (!String.IsNullOrWhiteSpace(eventArgs.Data))
                {
                    AppendTaskLog(job, "ERR", eventArgs.Data);
                    outputErrors.AppendLine(eventArgs.Data);
                }
            };

            try
            {
                process.Start();
                lock (processLock) activeProcesses[job.Number] = process;
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                artifactMonitorCancellation = CancellationTokenSource.CreateLinkedTokenSource(token);
                artifactMonitor = MonitorPackageArtifacts(job, artifactMonitorCancellation.Token);
                await Task.Run(delegate { process.WaitForExit(); });
                process.WaitForExit();
                artifactMonitorCancellation.Cancel();
                try { await artifactMonitor; }
                catch (OperationCanceledException) { }
                artifactMonitorCancellation.Dispose();
                artifactMonitorCancellation = null;
                artifactMonitor = null;

                if (token.IsCancellationRequested)
                {
                    UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
                }
                else if (process.ExitCode == 0)
                {
                    AppendTaskLog(job, "UI", "Codex 正常结束；开始按实际知识产物执行确定性验证与注入。");
                    await ValidateAndInject(job, token);
                }
                else
                {
                    string error = LastUsefulLine(outputErrors.ToString());
                    job.LastError = error;
                    UpdateJob(job, "失败 · " + error, Math.Max(job.Progress, 8), JobState.Failed);
                }
            }
            catch (Exception ex)
            {
                job.LastError = ex.Message;
                UpdateJob(job, "失败 · " + ex.Message, Math.Max(job.Progress, 8), JobState.Failed);
            }
            finally
            {
                if (artifactMonitorCancellation != null)
                {
                    artifactMonitorCancellation.Cancel();
                    artifactMonitorCancellation.Dispose();
                }
                lock (processLock) activeProcesses.Remove(job.Number);
                process.Dispose();
            }
        }

        private async Task MonitorPackageArtifacts(VideoJob job, CancellationToken token)
        {
            long lastKnowledgeBucket = -1;
            while (!token.IsCancellationRequested)
            {
                try
                {
                    string package = job.PackagePath;
                    if (!String.IsNullOrWhiteSpace(package) && Directory.Exists(package))
                    {
                        string coverage = Path.Combine(package, ".cache", "coverage.json");
                        string knowledge = Path.Combine(package, "knowledge.md");
                        string visualReview = Path.Combine(package, ".cache", "visual-review.json");
                        string semanticAudit = Path.Combine(package, ".cache", "semantic-audit.json");
                        if (File.Exists(coverage))
                        {
                            UpdateJob(job, "核对证据完整性", 88, JobState.Running);
                        }
                        else if (File.Exists(knowledge))
                        {
                            var info = new FileInfo(knowledge);
                            long bucket = info.Length / 32768;
                            if (bucket != lastKnowledgeBucket)
                            {
                                lastKnowledgeBucket = bucket;
                                UpdateJob(job, "整理知识 · " + Math.Max(1, info.Length / 1024) + " KiB", 82, JobState.Running);
                            }
                        }
                        else if (File.Exists(visualReview))
                        {
                            string review = File.ReadAllText(visualReview, Encoding.UTF8);
                            int reviewed = Regex.Matches(review, "\\\"status\\\"\\s*:").Count;
                            string media = Path.Combine(package, "media");
                            int expected = Directory.Exists(media) ? Directory.GetFiles(media, "*.jpg").Length : 0;
                            double ratio = expected > 0 ? Math.Min(1.0, (double)reviewed / expected) : 1.0;
                            int progress = 66 + (int)Math.Round(ratio * 12);
                            string stage = expected > 0
                                ? "审阅关键帧 · " + reviewed + "/" + expected + " 张"
                                : "审阅关键帧 · " + reviewed + " 张";
                            UpdateJob(job, stage, progress, JobState.Running);
                        }
                        else if (File.Exists(semanticAudit))
                        {
                            UpdateJob(job, "核对逐段知识点", 68, JobState.Running);
                        }
                        else
                        {
                            UpdateJob(job, "逐段读取全部证据", 62, JobState.Running);
                        }
                    }
                }
                catch (IOException) { }
                catch (UnauthorizedAccessException) { }
                await Task.Delay(1500, token);
            }
        }

        private async Task<bool> PreparePackage(VideoJob job, CancellationToken token)
        {
            if (token.IsCancellationRequested) return false;
            job.StartedAt = DateTime.Now;
            UpdateJob(job, "开始准备视频证据", 8, JobState.Running);
            AppendTaskLog(job, "UI", "桌面程序开始准备证据包；不委托 Codex 下载。");
            string input = job.IsLocalFile ? job.LocalFilePath : job.Link;
            CommandResult result = await RunPythonTool(job,
                Path.Combine(SkillRoot, "scripts", "prepare_knowledge.py"),
                new[] {
                    input,
                    "--output", OutputRoot,
                    "--package-suffix", "task" + job.Number.ToString("00"),
                    "--language", "auto",
                    "--json"
                });
            if (token.IsCancellationRequested)
            {
                UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
                return false;
            }
            if (result.ExitCode != 0)
            {
                job.LastError = LastUsefulLine(result.Output + Environment.NewLine + result.Error);
                UpdateJob(job, "准备失败 · " + job.LastError, Math.Max(job.Progress, 8), JobState.Failed);
                return false;
            }
            try
            {
                var serializer = new JavaScriptSerializer();
                var payload = serializer.Deserialize<Dictionary<string, object>>(result.Output.Trim());
                string package = ReadText(payload, "package", "");
                if (String.IsNullOrWhiteSpace(package) || !Directory.Exists(package))
                    throw new InvalidOperationException("准备脚本未返回有效证据包路径。");
                string transcript = Path.Combine(package, "transcript.vtt");
                string evidence = Path.Combine(package, ".cache", "evidence.json");
                if (!File.Exists(transcript) || !File.Exists(evidence))
                    throw new InvalidOperationException("证据包缺少字幕或证据清单。");
                job.PackagePath = Path.GetFullPath(package);
                AppendTaskLog(job, "UI", "证据包已完成：" + job.PackagePath);
                return true;
            }
            catch (Exception ex)
            {
                job.LastError = ex.Message;
                UpdateJob(job, "准备失败 · " + ex.Message, Math.Max(job.Progress, 8), JobState.Failed);
                return false;
            }
        }

        private string BuildPrompt(VideoJob job)
        {
            return
                "立即使用 $download-cn-video Skill 正式整理且只处理已准备好的证据包：" + job.PackagePath + "\n" +
                "桌面程序已经完成下载、平台字幕获取、必要时的本地转录、候选关键帧和证据包校验。不要运行 prepare_knowledge.py、download_video.py、yt-dlp、ffmpeg 或转录命令；不要重新下载、不要创建第二个包。\n" +
                "MANDATORY COMPLETENESS PIPELINE: first emit [STAGE:CLEAN], verify transcript.cleaned.jsonl, then emit [STAGE:SEGMENT] and read every .cache/segments/S*/evidence.md in manifest order without sampling. " +
                "Before synthesis, create .cache/semantic-audit.json exactly as references/knowledge-format.md requires: inventory every material claim in every segment with evidence cues, then write matching claim markers into knowledge.md and reverse-audit them. " +
                "Generate knowledge.md with ingest_mode: curated_passthrough, coverage_status: complete, semantic_coverage: audited, every segment ID in the Evidence ledger, and cue ranges beside supported claims. Inspect every periodic and scene-change candidate frame. Apply four content-neutral tests: subject relevance, informational novelty, evidential support, and standalone searchability. Exclude material with no substantive contribution, including purely promotional or decorative material, while preserving subject knowledge that appears beside it. Create .cache/visual-review.json version 2. Every unique frame needs clear alt text and claim_ids; each linked semantic claim must cite the same file in evidence_frames and make the visual knowledge conceptually complete in knowledge.md. Cover the purpose, essential parts, relationships, process, conditions, outcomes, and constraints whenever needed to understand the subject. A reader must be able to understand the image's knowledge without opening it, but incidental labels and minor visual details do not require exhaustive OCR or transcription. Duplicate and no_unique decisions need frame-specific reasons, not repeated templates. Embed every unique frame with ![clear description](media/file.jpg), not an ordinary link. " +
                "Emit [STAGE:COVERAGE], run build_coverage_manifest.py, and repair every missing cue, segment, number, identifier, semantic claim, or visual review before finishing. Do not inject; the desktop tool validates and injects.\n" +
                "这是执行任务，不是让你复述、确认或解释要求。先验证上述包，再立即开始分析；在实际读取证据前不要结束。\n" +
                "所有命令必须在前台完成并保留在本次 Codex 进程树内；禁止 Start-Process、后台、脱离父进程或手工启动恢复任务。" +
                "使用当前 Codex 模型亲自分析完整字幕与关键帧，生成高质量 D:\\video\\<视频名>\\knowledge.md；" +
                "仅使用当前 Codex 模型，不调用任何外部大语言模型。" +
                "严格遵守 references/knowledge-format.md；长视频不得用固定十分钟段落过度压缩，章节应按真实主题切分且通常不超过六分钟。" +
                "Transcript evidence 必须是清理后的完整语义证据，不得只摘录残缺英文短句；Visual evidence 必须描述该帧独有信息，禁止重复模板句。" +
                "完成知识包后不要自行注入，桌面工具会执行确定性质量检查与注入。" +
                "不要修改 llmwiki 项目源码或 Skill 源码，不处理私有、付费、登录限制内容，不要向用户提问。\n" +
                "为了让桌面工具显示进度，请在进入每个阶段时输出一个独立标记：" +
                "[STAGE:CLEAN]、[STAGE:SEGMENT]、[STAGE:VISUAL]、[STAGE:KNOWLEDGE]、[STAGE:COVERAGE]。" +
                "阶段不需要时也可直接进入下一阶段。最终验证 source、transcript、evidence 和 knowledge 后再结束。";
        }

        private async Task ValidateAndInject(VideoJob job, CancellationToken token)
        {
            if (token.IsCancellationRequested)
            {
                UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
                return;
            }

            string knowledge = FindKnowledge(job);
            if (String.IsNullOrWhiteSpace(knowledge))
            {
                job.LastError = "未定位到本任务生成的 knowledge.md";
                AppendTaskLog(job, "UI", job.LastError);
                UpdateJob(job, "失败 · 未找到知识稿", Math.Max(job.Progress, 88), JobState.Failed);
                return;
            }

            UpdateJob(job, "检查知识质量", 90, JobState.Running);
            CommandResult coverage = await RunPythonTool(
                job,
                Path.Combine(SkillRoot, "scripts", "build_coverage_manifest.py"),
                new[] { knowledge, "--json" });
            if (coverage.ExitCode != 0)
            {
                job.LastError = LastUsefulLine(coverage.Output + Environment.NewLine + coverage.Error);
                UpdateJob(job, "完整性检查失败 · 保留中转包", 90, JobState.Failed);
                return;
            }
            CommandResult validation = await RunPythonTool(
                job,
                Path.Combine(SkillRoot, "scripts", "validate_knowledge.py"),
                new[] { knowledge, "--json" });
            if (validation.ExitCode != 0)
            {
                job.LastError = LastUsefulLine(validation.Output + Environment.NewLine + validation.Error);
                UpdateJob(job, "质量检查失败 · 查看日志", 90, JobState.Failed);
                return;
            }

            if (token.IsCancellationRequested)
            {
                UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
                return;
            }

            UpdateJob(job, "注入当前知识库", 96, JobState.Running);
            CommandResult injection = await RunPythonTool(
                job,
                Path.Combine(SkillRoot, "scripts", "inject_llmwiki.py"),
                new[] { knowledge, "--json" });
            if (injection.ExitCode != 0)
            {
                job.LastError = LastUsefulLine(injection.Output + Environment.NewLine + injection.Error);
                UpdateJob(job, "注入失败 · 查看日志", 96, JobState.Failed);
                return;
            }

            if (job.IsLocalFile)
            {
                string deletionError;
                if (!DeleteArchivedLocalVideo(job, out deletionError))
                {
                    job.LastError = deletionError;
                    AppendTaskLog(job, "ERR", deletionError);
                    UpdateJob(job, "已归档 · 原视频删除失败", 99, JobState.Failed);
                    return;
                }
                UpdateJob(job, "完成并已归档 · 原视频已删除", 100, JobState.Completed);
                return;
            }

            UpdateJob(job, "完成并已归档", 100, JobState.Completed);
        }

        private bool DeleteArchivedLocalVideo(VideoJob job, out string error)
        {
            error = null;
            if (job == null || !job.IsLocalFile || String.IsNullOrWhiteSpace(job.LocalFilePath))
            {
                error = "本地视频删除条件无效";
                return false;
            }
            try
            {
                string exactPath = Path.GetFullPath(job.LocalFilePath);
                if (!IsSupportedLocalVideo(exactPath))
                {
                    error = "拒绝删除不受支持的文件类型：" + exactPath;
                    return false;
                }
                if (!File.Exists(exactPath))
                {
                    AppendTaskLog(job, "CLEANUP", "注入完成时原视频已不存在：" + exactPath);
                    return true;
                }
                FileAttributes attributes = File.GetAttributes(exactPath);
                if ((attributes & FileAttributes.Directory) != 0 ||
                    (attributes & FileAttributes.ReparsePoint) != 0)
                {
                    error = "为避免误删，拒绝删除目录或链接文件：" + exactPath;
                    return false;
                }
                File.Delete(exactPath);
                if (File.Exists(exactPath))
                {
                    error = "系统没有删除原视频：" + exactPath;
                    return false;
                }
                AppendTaskLog(job, "CLEANUP", "成功注入后已删除用户明确选择的原视频：" + exactPath);
                return true;
            }
            catch (Exception ex)
            {
                error = "原视频删除失败，文件已保留：" + ex.Message;
                return false;
            }
        }

        private string FindKnowledge(VideoJob job)
        {
            if (!String.IsNullOrWhiteSpace(job.PackagePath))
            {
                string preparedKnowledge = Path.Combine(job.PackagePath, "knowledge.md");
                if (File.Exists(preparedKnowledge))
                {
                    string exactPath = Path.GetFullPath(preparedKnowledge);
                    AppendTaskLog(job, "UI", "knowledge.md=" + exactPath + "（任务路径）");
                    return exactPath;
                }
            }

            string identifier = "";
            if (!job.IsLocalFile)
            {
                string canonical = CanonicalLinkKey(job.Link);
                int colon = canonical.IndexOf(':');
                identifier = colon >= 0 ? canonical.Substring(colon + 1) : canonical;
            }
            DateTime earliest = job.StartedAt.AddMinutes(-1);
            var matches = new List<FileInfo>();
            try
            {
                foreach (string directory in Directory.GetDirectories(OutputRoot))
                {
                    string name = Path.GetFileName(directory);
                    if (name.StartsWith(".", StringComparison.Ordinal)) continue;
                    string candidate = Path.Combine(directory, "knowledge.md");
                    if (!File.Exists(candidate)) continue;
                    var info = new FileInfo(candidate);
                    if (info.LastWriteTime < earliest) continue;
                    string text = File.ReadAllText(candidate, Encoding.UTF8);
                    string evidencePath = Path.Combine(directory, ".cache", "evidence.json");
                    string evidence = File.Exists(evidencePath)
                        ? File.ReadAllText(evidencePath, Encoding.UTF8)
                        : "";
                    if (job.IsLocalFile)
                    {
                        string fullPath = Path.GetFullPath(job.LocalFilePath);
                        string escapedPath = fullPath.Replace("\\", "\\\\");
                        if (text.IndexOf(fullPath, StringComparison.OrdinalIgnoreCase) < 0 &&
                            text.IndexOf(escapedPath, StringComparison.OrdinalIgnoreCase) < 0 &&
                            evidence.IndexOf(fullPath, StringComparison.OrdinalIgnoreCase) < 0 &&
                            evidence.IndexOf(escapedPath, StringComparison.OrdinalIgnoreCase) < 0)
                            continue;
                    }
                    else if (identifier.Length > 0 &&
                             text.IndexOf(identifier, StringComparison.OrdinalIgnoreCase) < 0 &&
                             evidence.IndexOf(identifier, StringComparison.OrdinalIgnoreCase) < 0)
                    {
                        continue;
                    }
                    matches.Add(info);
                }
            }
            catch (Exception ex)
            {
                AppendTaskLog(job, "ERR", "定位 knowledge.md 失败：" + ex.Message);
            }
            FileInfo latest = matches.OrderByDescending(delegate(FileInfo item) { return item.LastWriteTime; })
                .FirstOrDefault();
            if (latest != null) AppendTaskLog(job, "UI", "knowledge.md=" + latest.FullName);
            return latest == null ? null : latest.FullName;
        }

        private async Task<CommandResult> RunPythonTool(VideoJob job, string script, IEnumerable<string> args)
        {
            string arguments = Quote(script) + " " + JoinArgs(args);
            AppendTaskLog(job, "CMD", Path.GetFileName(script) + " " + JoinArgs(args));
            var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = PythonPath,
                Arguments = arguments,
                WorkingDirectory = SkillRoot,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8
            };
            ConfigureUtf8Python(process.StartInfo);
            try
            {
                process.Start();
                lock (processLock) activeProcesses[job.Number] = process;
                var outputBuilder = new StringBuilder();
                var errorBuilder = new StringBuilder();
                Task outputTask = PumpToolStream(job, process.StandardOutput, outputBuilder);
                Task errorTask = PumpToolStream(job, process.StandardError, errorBuilder);
                await Task.Run(delegate { process.WaitForExit(); });
                await Task.WhenAll(outputTask, errorTask);
                string output = outputBuilder.ToString();
                string error = errorBuilder.ToString();
                var result = new CommandResult { ExitCode = process.ExitCode, Output = output, Error = error };
                AppendTaskLog(job, "TOOL", "exit=" + result.ExitCode + " stdout=" + output + " stderr=" + error);
                return result;
            }
            catch (Exception ex)
            {
                AppendTaskLog(job, "ERR", ex.Message);
                return new CommandResult { ExitCode = -1, Output = "", Error = ex.Message };
            }
            finally
            {
                lock (processLock) activeProcesses.Remove(job.Number);
                process.Dispose();
            }
        }

        private async Task PumpToolStream(VideoJob job, StreamReader reader, StringBuilder destination)
        {
            string line;
            while ((line = await reader.ReadLineAsync()) != null)
            {
                if (HandleToolProgress(job, line)) continue;
                destination.AppendLine(line);
            }
        }

        private bool HandleToolProgress(VideoJob job, string line)
        {
            const string prefix = "VIDEO_PROGRESS\t";
            if (String.IsNullOrWhiteSpace(line) || !line.StartsWith(prefix, StringComparison.Ordinal))
                return false;
            string[] parts = line.Split(new[] { '\t' }, 3);
            int progress;
            if (parts.Length < 3 || !Int32.TryParse(parts[1], out progress))
            {
                AppendTaskLog(job, "ERR", "无法解析实时进度：" + line);
                return true;
            }
            UpdateJob(job, parts[2], progress, JobState.Running);
            return true;
        }

        private static void ConfigureUtf8Python(ProcessStartInfo startInfo)
        {
            startInfo.EnvironmentVariables["PYTHONUTF8"] = "1";
            startInfo.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
            startInfo.EnvironmentVariables["PYTHONUNBUFFERED"] = "1";
        }

        private void HandleCodexEvent(VideoJob job, string line)
        {
            string lower = line.ToLowerInvariant();
            bool commandStarted =
                (lower.Contains("\"type\":\"item.started\"") || lower.Contains("\"type\": \"item.started\"")) &&
                lower.Contains("command_execution");
            if (line.Contains("[STAGE:COVERAGE]") ||
                (commandStarted && lower.Contains("build_coverage_manifest.py")))
            {
                UpdateJob(job, "核对证据完整性", 88, JobState.Running);
            }
            else if (line.Contains("[STAGE:KNOWLEDGE]") ||
                (commandStarted && lower.Contains("knowledge.md") &&
                (lower.Contains("set-content") || lower.Contains("out-file") ||
                lower.Contains("add-content") || lower.Contains("apply_patch"))))
            {
                UpdateJob(job, "整理知识", 82, JobState.Running);
            }
            else if (line.Contains("[STAGE:SEGMENT]") ||
                (lower.Contains("\"type\":\"todo_list\"") && lower.Contains("manifest")))
            {
                UpdateJob(job, "逐段读取全部证据", 62, JobState.Running);
            }
            else if (line.Contains("[STAGE:CLEAN]"))
            {
                UpdateJob(job, "清理字幕（不采样）", 56, JobState.Running);
            }
            else if (line.Contains("[STAGE:VISUAL]") ||
                (commandStarted && (lower.Contains("view_image") || lower.Contains("candidate-"))))
            {
                UpdateJob(job, "分析关键画面", 66, JobState.Running);
            }
            else if (line.Contains("[STAGE:TRANSCRIBE]") ||
                (commandStarted && (lower.Contains("transcribe_package") ||
                lower.Contains("faster_whisper_transcribe"))))
            {
                UpdateJob(job, "语音转录", 48, JobState.Running);
            }
            else if (line.Contains("[STAGE:PREPARE]") ||
                (commandStarted && (lower.Contains("prepare_knowledge.py") ||
                lower.Contains("download_video.py") || lower.Contains("yt-dlp"))))
            {
                UpdateJob(job, "下载、字幕与取证", 28, JobState.Running);
            }
            else if (lower.Contains("\"type\":\"turn.started\"") || lower.Contains("\"type\": \"turn.started\""))
            {
                UpdateJob(job, "解析视频", 12, JobState.Running);
            }
            else if (lower.Contains("\"type\":\"turn.failed\"") || lower.Contains("\"type\": \"turn.failed\"") ||
                lower.Contains("\"type\":\"error\"") || lower.Contains("\"type\": \"error\""))
            {
                job.LastError = ExtractMessage(line);
            }
        }

        private void UpdateJob(VideoJob job, string stage, int progress, JobState state)
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action<VideoJob, string, int, JobState>(UpdateJob), job, stage, progress, state);
                return;
            }
            if (job.State == JobState.Completed || job.State == JobState.Failed || job.State == JobState.Cancelled)
                return;
            int nextProgress = Math.Max(job.Progress, progress);
            bool changed = !String.Equals(job.Stage, stage, StringComparison.Ordinal) ||
                job.Progress != nextProgress || job.State != state;
            job.Progress = nextProgress;
            job.State = state;
            job.Stage = stage;
            job.Row.SetStage(stage, job.Progress, state);
            if (changed) AppendTaskLog(job, "STAGE", stage + " · " + job.Progress + "%");
            UpdateSummary();
        }

        private void UpdateSummary()
        {
            if (InvokeRequired)
            {
                BeginInvoke(new Action(UpdateSummary));
                return;
            }
            if (jobs.Count == 0)
            {
                summaryLabel.Text = "等待开始";
                overallProgress.Value = 0;
                return;
            }
            int completed = jobs.Count(delegate(VideoJob job) { return job.State == JobState.Completed; });
            int failed = jobs.Count(delegate(VideoJob job) { return job.State == JobState.Failed; });
            int running = jobs.Count(delegate(VideoJob job) { return job.State == JobState.Running; });
            int queued = jobs.Count(delegate(VideoJob job) { return job.State == JobState.Queued; });
            int average = (int)Math.Round(jobs.Average(delegate(VideoJob job) { return job.Progress; }));
            overallProgress.Value = Math.Max(0, Math.Min(100, average));
            summaryLabel.Text = completed + "/" + jobs.Count + " 完成";
            if (running > 0) summaryLabel.Text += " · " + running + " 处理中";
            if (queued > 0) summaryLabel.Text += " · " + queued + " 排队";
            if (failed > 0) summaryLabel.Text += " · " + failed + " 失败";
        }

        private async Task FinishBatch()
        {
            string cleanupError = await Task.Run(delegate
            {
                SweepRelatedProcesses();
                return CleanOutputRoot();
            });
            isRunning = false;
            stopRequested = false;
            linksBox.ReadOnly = false;
            localFilesButton.Enabled = true;
            selectedLocalFiles.RemoveAll(delegate(string path)
            {
                return jobs.Any(delegate(VideoJob job)
                {
                    return job.IsLocalFile && job.State == JobState.Completed &&
                        String.Equals(job.LocalFilePath, path, StringComparison.OrdinalIgnoreCase) &&
                        !File.Exists(path);
                });
            });
            UpdateLocalFilesLabel();
            actionButton.Enabled = true;
            actionButton.Text = "开始整理";
            actionButton.BackColor = accent;
            int completed = jobs.Count(delegate(VideoJob job) { return job.State == JobState.Completed; });
            int failed = jobs.Count(delegate(VideoJob job) { return job.State == JobState.Failed; });
            int cancelled = jobs.Count(delegate(VideoJob job) { return job.State == JobState.Cancelled; });
            summaryLabel.Text = completed + "/" + jobs.Count + " 完成";
            if (failed > 0) summaryLabel.Text += " · " + failed + " 失败";
            if (cancelled > 0) summaryLabel.Text += " · " + cancelled + " 已取消";
            if (!String.IsNullOrWhiteSpace(cleanupError))
            {
                summaryLabel.Text += " · 中转清理失败";
                MessageBox.Show(this, "任务已结束，但 D:\\video 未能完全清空：\n" + cleanupError,
                    "中转目录清理失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            if (cancellation != null) cancellation.Dispose();
            cancellation = null;
            await RefreshCodexStatus();
        }

        private async Task StopAllAsync()
        {
            if (!isRunning || stopRequested) return;
            stopRequested = true;
            actionButton.Enabled = false;
            actionButton.Text = "正在停止…";
            summaryLabel.Text = "正在停止…";
            if (cancellation != null) cancellation.Cancel();
            foreach (VideoJob job in jobs)
            {
                if (job.State == JobState.Queued || job.State == JobState.Running)
                    UpdateJob(job, "正在停止并清理临时文件", job.Progress, JobState.Running);
            }
            List<Process> processes;
            lock (processLock) processes = activeProcesses.Values.ToList();
            await Task.Run(delegate
            {
                foreach (var process in processes)
                {
                    try
                    {
                        KillProcessTree(process.Id);
                    }
                    catch { try { process.Kill(); } catch { } }
                }
                SweepRelatedProcesses();
                CleanOutputRoot();
            });
            foreach (VideoJob job in jobs)
            {
                if (job.State == JobState.Queued || job.State == JobState.Running)
                    UpdateJob(job, "已取消", job.Progress, JobState.Cancelled);
            }
        }

        private static void KillProcessTree(int processId)
        {
            var killer = Process.Start(new ProcessStartInfo
            {
                FileName = "taskkill.exe",
                Arguments = "/PID " + processId + " /T /F",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true
            });
            if (killer == null) return;
            killer.WaitForExit(5000);
            killer.Dispose();
        }

        private void SweepRelatedProcesses()
        {
            string[] tokens = jobs.Select(delegate(VideoJob job) { return job.TaskToken; })
                .Where(delegate(string token) { return !String.IsNullOrWhiteSpace(token); })
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .ToArray();
            if (tokens.Length == 0) return;
            string tokenArray = String.Join(",", tokens.Select(delegate(string token)
            {
                return "'" + token.Replace("'", "''") + "'";
            }).ToArray());
            string script =
                "$tokens=@(" + tokenArray + ");$self=$PID;$gui=" + Process.GetCurrentProcess().Id + ";" +
                "1..4|ForEach-Object{$targets=Get-CimInstance Win32_Process -ErrorAction SilentlyContinue|" +
                "Where-Object{if($_.ProcessId-eq$self-or$_.ProcessId-eq$gui){return $false};" +
                "$line=[string]$_.CommandLine;foreach($token in $tokens){" +
                "if($line-like('*'+$token+'*')){return $true}};return $false};" +
                "foreach($target in $targets){taskkill.exe /PID $target.ProcessId /T /F 2>$null|Out-Null};" +
                "Start-Sleep -Milliseconds 250}";
            try
            {
                var sweep = Process.Start(new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = "-NoProfile -NonInteractive -Command " + Quote(script),
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true
                });
                if (sweep != null)
                {
                    sweep.WaitForExit(8000);
                    sweep.Dispose();
                }
            }
            catch { }
        }

        private string CleanOutputRoot()
        {
            try
            {
                string expected = @"D:\video";
                string root = Path.GetFullPath(OutputRoot).TrimEnd(Path.DirectorySeparatorChar);
                if (!root.Equals(expected, StringComparison.OrdinalIgnoreCase))
                    return "拒绝清理非预期目录：" + root;
                if (root.Equals(Path.GetPathRoot(root).TrimEnd(Path.DirectorySeparatorChar),
                    StringComparison.OrdinalIgnoreCase))
                    return "拒绝清理磁盘根目录：" + root;

                Directory.CreateDirectory(root);
                var rootInfo = new DirectoryInfo(root);
                if ((rootInfo.Attributes & FileAttributes.ReparsePoint) != 0)
                    return "拒绝清理重解析点：" + root;

                Exception lastError = null;
                for (int attempt = 0; attempt < 12; attempt++)
                {
                    lastError = null;
                    foreach (string entry in Directory.GetFileSystemEntries(root))
                    {
                        try
                        {
                            FileAttributes attributes = File.GetAttributes(entry);
                            if ((attributes & FileAttributes.ReadOnly) != 0)
                                File.SetAttributes(entry, attributes & ~FileAttributes.ReadOnly);
                            if ((attributes & FileAttributes.Directory) != 0)
                            {
                                bool reparse = (attributes & FileAttributes.ReparsePoint) != 0;
                                Directory.Delete(entry, !reparse);
                            }
                            else
                            {
                                File.Delete(entry);
                            }
                        }
                        catch (Exception ex)
                        {
                            lastError = ex;
                        }
                    }
                    if (Directory.GetFileSystemEntries(root).Length == 0)
                    {
                        WriteCleanupLog("D:\\video 已清空。");
                        return null;
                    }
                    Thread.Sleep(500);
                }
                string remaining = String.Join(", ", Directory.GetFileSystemEntries(root)
                    .Select(Path.GetFileName).Take(8).ToArray());
                return "仍有文件被占用：" + remaining +
                    (lastError == null ? "" : "；" + lastError.Message);
            }
            catch (Exception ex)
            {
                WriteCleanupLog("清理失败：" + ex.Message);
                return ex.Message;
            }
        }

        private void WriteCleanupLog(string message)
        {
            try
            {
                Directory.CreateDirectory(TaskLogRoot);
                File.AppendAllText(Path.Combine(TaskLogRoot, "cleanup.log"),
                    DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " " + message + Environment.NewLine,
                    new UTF8Encoding(false));
            }
            catch { }
        }

        private string FindCodex()
        {
            string configured = Environment.GetEnvironmentVariable("CODEX_CLI_PATH");
            if (!String.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;
            try
            {
                var process = Process.Start(new ProcessStartInfo
                {
                    FileName = "where.exe",
                    Arguments = "codex.exe",
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true
                });
                string output = process.StandardOutput.ReadToEnd();
                process.WaitForExit(5000);
                foreach (string line in output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
                    if (line.Trim().EndsWith("codex.exe", StringComparison.OrdinalIgnoreCase))
                        return line.Trim();
            }
            catch { }
            return "codex.exe";
        }

        private void RefreshRuntimeLabel()
        {
            bool available = !String.IsNullOrWhiteSpace(codexPath);
            runtimeLabel.Text = available ? "正在读取 Codex 状态…" : "未找到 Codex CLI";
            runtimeLabel.ForeColor = available ? Color.FromArgb(29, 125, 72) : Color.FromArgb(176, 61, 50);
            quotaLabel.Text = "";
        }

        private async Task RefreshCodexStatus()
        {
            if (String.IsNullOrWhiteSpace(codexPath) || !File.Exists(PythonPath)) return;
            try
            {
                var process = new Process();
                process.StartInfo = new ProcessStartInfo
                {
                    FileName = PythonPath,
                    Arguments = Quote(Path.Combine(SkillRoot, "scripts", "codex_status.py")),
                    WorkingDirectory = SkillRoot,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    StandardOutputEncoding = Encoding.UTF8
                };
                ConfigureUtf8Python(process.StartInfo);
                process.Start();
                string outputTask = await process.StandardOutput.ReadToEndAsync();
                await Task.Run(delegate { process.WaitForExit(); });
                int exitCode = process.ExitCode;
                process.Dispose();
                if (exitCode != 0 || String.IsNullOrWhiteSpace(outputTask))
                    throw new InvalidOperationException("Codex 状态不可用");

                var serializer = new JavaScriptSerializer();
                var status = serializer.Deserialize<Dictionary<string, object>>(outputTask.Trim());
                string model = ReadText(status, "model", "default");
                string account = ReadText(status, "account", "unknown");
                string plan = ReadText(status, "plan", "");
                string quota = ReadText(status, "quota", "额度不可用");
                runtimeLabel.Text = model + " · " + account + (plan.Length > 0 ? " · " + plan : "");
                runtimeLabel.ForeColor = ink;
                quotaLabel.Text = "剩余 " + quota;
                quotaLabel.ForeColor = muted;
            }
            catch
            {
                runtimeLabel.Text = "Codex CLI · 状态不可用";
                runtimeLabel.ForeColor = Color.FromArgb(176, 61, 50);
                quotaLabel.Text = "";
            }
        }

        private static string ReadText(Dictionary<string, object> value, string key, string fallback)
        {
            object result;
            return value.TryGetValue(key, out result) && result != null
                ? Convert.ToString(result)
                : fallback;
        }

        private static string LastUsefulLine(string value)
        {
            string line = (value ?? "").Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries)
                .Reverse().FirstOrDefault();
            if (String.IsNullOrWhiteSpace(line)) return "Codex CLI 退出";
            return line.Length > 90 ? line.Substring(0, 87) + "…" : line;
        }

        private static string ExtractMessage(string json)
        {
            var match = Regex.Match(json, "\"message\"\\s*:\\s*\"((?:\\\\.|[^\"])*)\"");
            return match.Success ? match.Groups[1].Value : "Codex 返回错误";
        }

        private static string Quote(string value)
        {
            return "\"" + (value ?? "").Replace("\"", "\\\"") + "\"";
        }

        private static string JoinArgs(IEnumerable<string> values)
        {
            return String.Join(" ", values.Select(Quote).ToArray());
        }

        private async void OnFormClosing(object sender, FormClosingEventArgs e)
        {
            if (forceClose) return;
            if (!isRunning)
            {
                CleanOutputRoot();
                return;
            }
            var answer = MessageBox.Show(this, "当前仍有视频在处理。关闭会停止全部任务，确定继续吗？",
                "停止并关闭", MessageBoxButtons.YesNo, MessageBoxIcon.Warning);
            if (answer == DialogResult.No)
            {
                e.Cancel = true;
                return;
            }
            e.Cancel = true;
            await StopAllAsync();
            forceClose = true;
            Close();
        }
    }

    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool createdNew;
            using (var mutex = new Mutex(true, @"Local\VideoKnowledgeTool.SingleInstance", out createdNew))
            {
                if (!createdNew)
                {
                    MessageBox.Show("视频知识整理器已经在运行。", "无法重复启动",
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return;
                }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainForm());
            }
        }
    }
}
