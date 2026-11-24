# BrowserSkill 0.3.2 自维护说明

本仓库是 [Tencent/BrowserSkill](https://github.com/Tencent/BrowserSkill) 的自维护分支，把 CLI、守护进程、浏览器扩展与宿主侧集
成整体固定在 **0.3.2**，并补上「被控窗口显示控制方」的能力。上游代码保持 MIT 许可，上游关系不变：`origin` 仍指向
Tencent/BrowserSkill，本仓库只新增维护分支，不修改上游 `main`。

## 1. 基线

| 组件 | 版本 | 来源 |
| --- | --- | --- |
| 源码基线 | `75ba2949d9abce07931534f8382a055ddb447b9c` | 上游 `release/0.3.2` 合并提交 |
| 上游标签 | `cli-v0.3.2` / `ext-v0.3.2` / `dsh-plugin-v0.3.2` | 同一提交 |
| CLI / 守护进程 | 0.3.2（协议 1.3） | `crates/bsk-cli` |
| 扩展 | 0.3.2（MV3） | `apps/extension` |
| 宿主插件 | `packages/dsh-plugin-browserskill` 0.3.2；本机实际启用的是 WorkBuddy / Codex 的 `browser-skill` 技能，由 `bsk install-skill` 同步 | 同上 |

维护分支：`line/0.3.2`。这是**产品主线**，不是临时锁定：0.5.x 删除了仍在使用的能力，本线保留 0.3.2 的功能集，并在其上叠加
自己的需求。上游只挑修复回移（见 `BACKPORT.md`），不做自动合并，也不跟随功能改版。

版本号：扩展 `0.3.2.<n>`（Chrome 要求四段数字），CLI `0.3.2+vendor.<n>`（SemVer build metadata）。不使用 `0.3.3` / `0.4`，
避免与上游 tag 撞号。

## 2. 相对 0.3.2 的改动

1. **控制方名字**：`session.start` 新增可选字段 `agent_name`，由 CLI 参数 `--agent-name <NAME>`（或环境变量
   `BSK_AGENT_NAME`）提供，经守护进程透传到扩展会话上下文；`tool.session_start` 的 `agent_name` 经
   `sanitizeAgentName()` 去控制字符并截断到 32 字符。
2. **橙色控制提示**：`ControlOverlay` 在原有呼吸式橙色内发光之外，增加 3px 实心橙框与固定在页面顶部的控制条，显示
   「Codex 正在控制」这类文案与会话简称；无名字时显示「未知 Agent」。提示随控制权状态在每个窗口独立渲染，用户接管、
   交还、断连、会话结束时立即清除。
3. **更新通道**：`DEFAULT_MANIFEST_URL` 指向本仓库的 releases，`bsk update` 不会再把 0.3.2 拉到上游 0.5.x。
4. **被控标签变橙**：`tabGroups` 权限 + `chrome.tabs.group` 把被控标签放进橙色标签组，组名即控制方名字；同时内容脚本把
   favicon 换成橙底首字母徽标（页面自带图标会被记住并原样还原）。用户自己分过组的标签不动，会话结束只解散自己创建的组。

## 3. Windows 构建

本机（无 MSVC、无 Windows SDK）使用 GNU 宿主工具链 + 便携 mingw-w64，一次性的引导步骤：

```bash
# 1) MSYS2 便携包（清华镜像），解压后安装 mingw-w64 编译器
curl -L -o msys2.sfx.exe https://mirrors.tuna.tsinghua.edu.cn/msys2/distrib/msys2-x86_64-latest.sfx.exe
./msys2.sfx.exe -y -o"C:\Users\<user>\AppData\Local\Temp\msys64"
msys64/usr/bin/bash.exe -lc "pacman-key --init && pacman-key --populate msys2 && pacman -Sy --noconfirm mingw-w64-x86_64-gcc"

# 2) GNU 宿主工具链（USTC 镜像）
RUSTUP_DIST_SERVER=https://mirrors.ustc.edu.cn/rust-static \
  rustup toolchain install stable-x86_64-pc-windows-gnu --profile minimal
```

构建（`scripts/maintenance/build-windows.sh` 是同一套命令）：

```bash
export PATH="<msys64>/mingw64/bin:$PATH"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER=gcc
export RUSTFLAGS="-C target-feature=+crt-static"     # 静态链接，产物不依赖 mingw DLL
cargo build --release -p bsk --locked --target x86_64-pc-windows-gnu -j 6

pnpm install --frozen-lockfile
pnpm --filter @browser-skill/extension build          # 产物：apps/extension/dist/chrome-mv3
```

注意：**不要在本机受终端加密软件监控的目录里编译**。其文件过滤驱动会在写大体积 rlib 时卡住 `rustc`（表现为进程 CPU
停止增长、无 IO）。把源码复制到 `%TEMP%` 下构建，再拷回产物即可。有 MSVC 的机器直接用上游默认命令
`cargo build --release -p bsk --locked` 亦可。

校验和见 `dist/SHA256SUMS`（0.3.2-pin.1 本机构建）。

## 4. 安装（Windows / Turbo）

1. **CLI**：把 `bsk.exe` 覆盖到 `%USERPROFILE%\.local\bin\bsk.exe`（先 `taskkill /F /IM bsk.exe`，否则文件被占用）。
2. **关闭自动升级**：`setx BSK_AUTO_UPDATE off`。守护进程的自动升级与 CLI 提示都读这个变量。
3. **扩展**：把 `dist/chrome-mv3` 复制到固定目录 `%USERPROFILE%\.bsk\extensions\browserskill-0.3.2`，并用
   `--load-extension=C:\Users\<user>\.bsk\extensions\browserskill-0.3.2` 启动 Turbo：
   - 桌面 / 开始菜单 / 任务栏三个 `Turbo.lnk` 的「目标」末尾追加该参数；
   - `HKCU\Software\Classes\TurboHTM.*\shell\open\command`、`turbo\shell\open\command` 同步追加，保证从链接冷启动也生效。
4. **禁用商店版**：扩展 ID `hhcmgoofomhgciiibhipgmgkgnoenaoi` 的 0.5.0 必须停用，否则会与 0.3.2 抢连接。本机用策略实现：
   `HKCU\Software\Policies\Chromium\ExtensionInstallBlocklist\1 = hhcmgoofomhgciiibhipgmgkgnoenaoi`
   （Turbo 读的是 `Chromium` 策略根，不是 `Google\Chrome`）。
5. **重启**：关闭 Turbo → 用改过的快捷方式启动 → `bsk doctor` 应显示 `protocol 1.3` 且浏览器协议一致。

## 5. 回滚

```powershell
taskkill /F /IM bsk.exe
copy <backup>\bsk-0.4.1.exe %USERPROFILE%\.local\bin\bsk.exe
setx BSK_AUTO_UPDATE on            # 或直接删掉该变量
reg delete "HKCU\Software\Policies\Chromium\ExtensionInstallBlocklist" /f
# 快捷方式：删除 --load-extension 参数，或直接用 <backup>\*.lnk.bak-<date> 覆盖
```

商店版扩展会自动恢复；启动一次 Turbo 后 `bsk doctor` 会重新报「协议不一致」——这是回滚成功的标志，再执行
`bsk update` 即回到上游 0.5.0。

## 6. 验证记录（2026-11-23，本机）

| 项目 | 结果 |
| --- | --- |
| 版本锁 | `bsk --version` = 0.3.2；`bsk status` 协议 1.3；`bsk browsers` EXT 0.3.2；商店 0.5.0 `disable_reasons=65536` |
| 基础操作 | 打开 `127.0.0.1:8899`、`fill #note`、`upload #file` 均成功；`screenshot` 正常出图 |
| 控制提示 | 两个窗口分别显示「Codex 正在控制 / bqoz」与「WorkBuddy 正在控制 / kpaj」，橙框与顶栏均在 |
| 标签着色 | 被控标签进入橙色标签组（组名=控制方），favicon 变橙色首字母徽标；结束/接管后恢复原始图标并解散标签组 |
| 接管 | 点击「中断」后顶栏、橙框、底部胶囊与控制方名字同时消失 |
| 已知限制 | `bsk screenshot` 走 CDP 截图，不包含内容脚本的固定层（`position: fixed`），提示需用系统级截图取证 |
