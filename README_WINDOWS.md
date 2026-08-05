# LLM Wiki：Windows 克隆、运行与构建指南

这份说明用于在一台新的 Windows 电脑上，从 GitHub 克隆本仓库并完整运行 LLM Wiki。完成后可以启动桌面应用、导入 PDF 等资料、配置大模型，并使用内置的本地 API 与 MCP 工具服务。例如：克隆完成后运行 `npm run tauri dev`，会打开真正的 Windows 桌面窗口，而不是只能在浏览器中查看网页。

> 如果只想使用程序、不准备修改源码，优先从项目的 [Releases](https://github.com/richenHe/llm-wiki/releases) 下载 Windows 安装包。下面的步骤适合需要从源码运行或自行制作安装包的人；例如你准备在另一台电脑继续开发，就应使用本指南。

## 1. 新电脑需要准备什么

推荐使用 64 位 Windows 10 或 Windows 11，并保持网络可用。第一次安装会下载 JavaScript 与 Rust 依赖，通常需要数 GB 可用空间；例如 Rust 编译缓存可能单独占用几 GB，不能只预留最终程序的大小。

依次安装下面的软件：

1. **Git**：用来克隆和更新源码。安装后打开新的 PowerShell，运行 `git --version`，应看到版本号，例如 `git version 2.50.0.windows.1`。
2. **Node.js 20 或更高版本**：用来构建界面和内置工具服务。本仓库的自动检查使用 Node.js 20；安装 Node.js 的长期支持版后，运行 `node --version` 和 `npm --version`，例如分别看到 `v20.x.x` 与 `10.x.x`。
3. **Rust stable 工具链**：用来编译桌面后端。通过 [rustup](https://rustup.rs/) 安装默认的 stable 版本，重新打开 PowerShell 后运行 `rustc --version` 和 `cargo --version`；例如两条命令都应输出版本号，不能提示“找不到命令”。
4. **Microsoft C++ Build Tools**：Tauri 在 Windows 上编译桌面程序必须使用它。打开 [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) 安装器，勾选“使用 C++ 的桌面开发（Desktop development with C++）”；例如漏选这一项时，Rust 常见报错是找不到 `link.exe`。
5. **Microsoft Edge WebView2 Runtime**：它负责显示桌面界面。Windows 10/11 通常已经安装；若程序能启动窗口但界面无法显示，请安装 [WebView2 Evergreen Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。例如系统精简版删除了 WebView2 时，窗口可能是空白的。
6. **Protocol Buffers 编译器（protoc）**：部分 Rust 依赖在编译时需要它。本仓库的 Windows 自动构建也会安装 protoc；例如使用 Chocolatey 时可执行 `choco install protoc -y`，安装后用 `protoc --version` 确认命令可用。如果不使用 Chocolatey，可以从 [Protocol Buffers Releases](https://github.com/protocolbuffers/protobuf/releases) 下载 Windows x64 版本，并把其中的 `bin` 目录加入当前用户的 `PATH`。

Tauri 官方的 Windows 环境要求可在 [Prerequisites](https://v2.tauri.app/start/prerequisites/) 核对。例如官方明确要求 Microsoft C++ Build Tools 与 WebView2，二者不是普通 npm 依赖，无法只靠克隆仓库自动获得。

## 2. 克隆正确的仓库

在准备存放项目的目录中打开 PowerShell，执行：

```powershell
git clone https://github.com/richenHe/llm-wiki.git
Set-Location llm-wiki
git status
```

`git status` 应显示当前分支与干净的工作区。例如看到 `nothing to commit, working tree clean` 表示克隆内容完整且没有本地改动；如果克隆中途断网，请删除未完成的目录后重新克隆，不要从残缺目录继续安装。

## 3. 安装两组 JavaScript 依赖

项目包含两组依赖：根目录是桌面界面，`mcp-server` 是让 Codex、Claude Code 等工具访问本机知识库的服务。请在仓库根目录依次执行：

```powershell
npm ci
npm --prefix mcp-server ci
npm run mcp:build
```

`npm ci` 会严格按照仓库中的依赖锁文件安装，结果比 `npm install` 更容易在不同电脑保持一致。例如根目录执行成功后会出现 `node_modules`，工具服务安装成功后还会出现 `mcp-server/node_modules`，而 `npm run mcp:build` 会生成 `mcp-server/dist`。

如果下载依赖时出现网络超时，保持 `package-lock.json` 不变后重新执行相同命令。例如不要为了绕过一次下载失败而删除锁文件，否则另一台电脑可能安装到未经本项目验证的新版本。

## 4. 先做完整性检查

运行下面的命令，确认界面代码与内置工具服务都能编译：

```powershell
npm run typecheck
npm run mcp:test
Test-Path .\src-tauri\pdfium\pdfium.dll
```

前两条命令应以退出码 0 结束，最后一条应显示 `True`。例如 `pdfium.dll` 已随仓库提交，显示 `False` 说明克隆内容不完整，之后即使窗口能打开，PDF 解析也可能无法使用。

首次编译 Rust 前再确认系统工具：

```powershell
rustc --version
cargo --version
protoc --version
```

三条命令都必须输出版本号。例如 `protoc` 提示“无法识别”时，应先修复 `PATH` 并重新打开 PowerShell，再继续运行桌面程序。

## 5. 启动开发版桌面程序

在仓库根目录执行：

```powershell
npm run tauri dev
```

第一次运行会下载并编译 Rust 依赖，可能需要较长时间；以后会复用本机缓存。例如看到 Vite 输出本地地址是正常的，最终结果仍应是自动打开名为“LLM Wiki”的桌面窗口，不需要手动在浏览器访问该地址。

启动后按下面顺序做最小验收：

1. 创建一个测试项目；例如名称填“新电脑测试”。
2. 打开“设置”，配置一个可用的大模型提供商、密钥和模型；例如使用 OpenAI 兼容服务时，需要同时填写它要求的接口地址。
3. 导入一个小型 Markdown 或 PDF 文件；例如先导入只有一页的 PDF，可以更快确认 PDF 解析组件正常。
4. 等待活动面板处理完成，再打开生成的 Wiki 页面；例如资料能出现在“资料源”中，但没有生成 Wiki 时，应先检查大模型配置和活动面板里的具体错误。

大模型密钥、个人知识库和下载缓存不会存进 Git 仓库，这是为了避免泄露私人数据。例如在旧电脑创建的知识库不会因为 `git clone` 自动出现在新电脑；需要在旧电脑中导出项目压缩包，再在新电脑中导入。

## 6. 制作可安装的 Windows 程序

开发版确认可用后，在仓库根目录执行：

```powershell
npm run tauri build
```

该命令会重新构建界面、内置工具服务和 Rust 桌面程序，并把所需资源放进安装包。例如 Windows 安装文件通常出现在 `src-tauri\target\release\bundle\msi` 或 `src-tauri\target\release\bundle\nsis`；具体格式由当前 Tauri 配置和本机工具决定。

不要只把 `src-tauri\target\debug\llm-wiki.exe` 复制到另一台电脑。它是开发构建，可能依赖仓库目录中的资源；例如缺少一同打包的 `pdfium.dll` 或 `mcp-server` 时，PDF 与外部工具连接会失效。需要给其他电脑使用时，应复制上一步生成的安装包。

## 7. 更新已经克隆的项目

确认自己没有未提交改动后，在仓库根目录执行：

```powershell
git pull --ff-only
npm ci
npm --prefix mcp-server ci
npm run mcp:build
```

`--ff-only` 会在本地历史与远程冲突时停止，而不是自动生成难以理解的合并结果。例如 `git status` 显示你修改过源码时，应先提交或备份改动，再执行更新。

如果 `package-lock.json` 和 `mcp-server/package-lock.json` 都没有变化，通常不需要删除现有依赖目录。例如更新只有 README 变化时，重新运行安装命令不会带来功能收益。

## 8. 常见问题

### 找不到 `link.exe`

系统缺少 Microsoft C++ 编译环境，或安装后当前终端尚未刷新。打开 Visual Studio Installer，确认已安装“使用 C++ 的桌面开发”，然后重新启动 PowerShell；例如只安装 Visual Studio Code 并不能提供 `link.exe`。

### 找不到 `protoc`

Protocol Buffers 编译器没有安装，或它的 `bin` 目录不在 `PATH` 中。运行 `protoc --version` 必须能看到版本号；例如刚修改完 `PATH` 后，旧 PowerShell 窗口仍可能看不到，需要关闭后重新打开。

### `npm ci` 提示依赖锁文件不匹配

不要直接修改或删除锁文件。先执行 `git status` 检查是否有本地改动，并确认 Node.js 至少为 20；例如锁文件被编辑过时，可以先备份自己的修改，再恢复仓库版本后重试。

### 桌面窗口空白或无法显示

先安装或修复 WebView2 Runtime，然后重新运行 `npm run tauri dev`。例如精简版 Windows 可能没有完整的 WebView2，即使 Rust 编译完全成功，界面仍无法渲染。

### 程序能打开，但无法处理资料

先查看活动面板中的具体错误，再检查大模型配置与网络。程序源码运行成功不等于外部模型服务已经配置；例如 API 密钥过期时，项目能创建，但自动生成 Wiki 会被模型服务拒绝。

## 9. 完成标准

满足下面四项才算“克隆后完整运行”：`npm run typecheck` 通过、`npm run mcp:test` 通过、`npm run tauri dev` 打开桌面窗口、导入一个小文件后能生成 Wiki 内容。例如只看到网页构建成功，但桌面窗口没有打开，仍不能算完成。

如需把旧电脑的数据带过来，还要额外完成一次“导出项目 → 新电脑导入项目”。例如源码、程序和个人知识库是三类不同内容，Git 只负责同步第一类。
