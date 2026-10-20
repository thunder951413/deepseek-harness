---
description: "通过 dsh tui 启动终端编程助手及其共享的 Web 服务。"
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

[English](README.md) | 中文

## 概述

运行 `dsh tui`，即可在终端中对话、查看工具执行、回答问题并审批操作。命令自动启动本地回环地址上的 Web 服务；通过其 URL 可在浏览器中打开相同的对话。两个界面共享模型设置、工具和持久化的 Session 历史。仅含客户端的 `tui` profile 挂载此 bundle；后台在另一个进程中使用现有 Web profile。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)

<a id="use-this-package"></a>
## 使用本包

在本仓库的检出目录中运行 `scripts/setup-tui.sh`（macOS 和 Linux）。它会安装依赖、构建、写入一个运行该检出目录 CLI 的 `dsh` 命令（`--name` 和 `--bin-dir` 可指定其他名称或位置），并安装由同一提交构建的插件，因此终端与其 Harness 始终匹配；更新检出目录后再运行一次即可。要把终端加到已有的 `dsh` 上，使用独立分发包：`node install.mjs --dsh <已有的-dsh-命令>`。安装器添加 `@surfing/dsh-tui`，并在仅含客户端的 profile 中只选择该 bundle；已有终端 profile 的清单会备份。若 profile 选择了其他无关 bundle，安装器会拒绝修改，请使用其他 `--profile` 名称。分发生成命令 `pnpm exec tsx scripts/release/create-tui-plugin.ts --out <新目录> --version <终端版本>` 使用构建产物，内嵌当前 DSH 远程客户端和编解码器，只将 Cordis 保留为运行时 peer。安装包不包含智能体引擎。源码工作区名称仍为 `@deepseek-ai/dsh-tui-app`。

官方 `dsh` 升级后，profile 和其中的插件仍保存在 `DSH_HOME` 下，直接启动同一个终端 profile 即可。使用相同数据目录的新命令无需修改源码或重建运行时；需要重新接入时，用保存的安装器指定 `--dsh <命令>`。`release.json` 记录已验证的 Harness 版本。`dsh --version` 与之不同时安装器会警告，加 `--require-match` 则拒绝安装。兼容性取决于 Web 协议、启动器和 Cordis 接口，并不保证所有未来版本都适用。启动时会认证并要求会话列表可用。终端对其他返回值采用宽容读取：只取显示用的字段，忽略新增字段，可选数据缺失时显示 `未提供`。Harness 缺少模型目录、用量读数、账户余额或用户提问时，只失去对应功能。会话列表、创建、跟随或发送接口变化或缺失时会报告失败，需要与该 Harness 对应的终端发布包。每周运行的 `tui-compat` 工作流会把当前构建安装到临时 `DSH_HOME`，并对已发布的 `@deepseek-ai/dsh` 做探测。安装不迁移用户数据。Session 格式迁移仍由后台负责，旧后台不保证能读取新版迁移后的数据。

在项目目录中运行 `dsh tui`。启动后直接打开新对话；使用 `/resume` 或 Ctrl-R 搜索启动目录下的 Session（`/resume <id>` 可打开其他目录的 Session）；`dsh tui --session <id>` 可直接打开指定对话。通过 Web 界面配置模型凭据；`/web` 显示其登录链接，状态区不显示该链接，因为它相当于密码。详细状态栏显示对话标识、目录和 Web 地址。自动布局会在这些信息需要换行时使用紧凑行；`/layout` 可选择自动、紧凑或详细状态栏。`--backend-profile <name>` 选择自启后台的 profile（默认 `web`）；`--connect <launch-url>` 连接已有服务；`--port <port>` 指定自启后台的监听端口；省略时由操作系统分配。新对话归入启动目录对应的工作区；如果相同规范路径已有工作区，则复用，否则创建。输入和输出都必须是交互式终端。

| 按键 | 操作 |
|---|---|
| Ctrl-S | 发送编辑框内容或确认文本回答 |
| Enter | 发送消息、确认文本回答或选择菜单项 |
| Shift+Enter | 在编辑框中换行 |
| Ctrl-N | 在启动目录中创建对话 |
| Ctrl-R | 选择持久化的对话 |
| 终端滚动历史 | 查看较早的对话输出 |
| Ctrl-O | 查看工具参数和输出 |
| Ctrl-C | 停止生成；空闲时先清空编辑框，连按两次退出 |
| Ctrl-Q | 退出并关闭本程序的 Web 服务 |
| Escape | 关闭菜单；关闭审批菜单会拒绝操作 |

每段对话都从一个横幅开始：轻微浮动的 DeepSeek 鲸鱼，下方居中显示终端版本、下一次请求的模型、目录，以及此目录最近一段有标题的对话。终端至少 26 行且足够宽时，右侧显示四个常用命令和前三个技能，并给出其余数量，鲸鱼和文字在列表左侧的空间里居中；较窄的终端省略列表，较矮的终端省略鲸鱼。对话有内容后鲸鱼停止浮动。`/skills` 列出 Harness 为当前对话提供的技能，每项旁边显示说明；选中后编辑框中会填入 `/name `，消息以它开头时宿主会运行该技能。`/help` 列出全部命令和技能。

对话使用终端的普通屏幕和原生滚动历史。编辑框支持移动光标、修改中间文字、多行粘贴和上下方向键浏览输入历史。输入 `/` 补全命令，输入 `@` 查找项目文件；选择文件后会将带引号的路径插入消息，模型使用文件工具读取。自动文件发现遵循 `.gitignore`，排除隐藏目录和 `node_modules`；显式输入 `@.config/` 等隐藏路径时，会直接列出该目录。索引中和无匹配结果的提示与错误分开显示。查找 `.gitignore` 文件时也会跳过 `.Trash` 等隐藏目录。无权读取的子目录会被跳过，并提示补全结果不完整；项目根目录或 `.gitignore` 文件无法读取时仍会报告补全失败。`/new`（或 `/clear`）开始另一段对话，`/resume` 搜索历史，`/tools` 打开工具详情，`/skills` 选择技能，`/web` 显示浏览器登录链接，`/help` 列出快捷键，`/exit` 关闭应用。

模型工作期间，编辑框上方有一个固定面板，显示已用时间、本轮的工具调用数和失败数、最新一次调用的单行标题（例如 `Bash(ls)`、`Read(path)`、`Edit(path)` 或 `Write(path)`，带状态标记），以及为它预留的三行说明（命令、路径与改动，或开头的几个参数）。面板在本轮结束前保持高度不变，所以调用之间屏幕不会跳动。其他工具显示名称和首个参数。本轮结束后，每段连续的调用折叠为一行，例如 `● 12 tool calls · 1 failed`；`/tools` 浏览保留的调用，可筛选失败项，并分开显示参数与输出。关闭详情会返回原来的列表选项；失败摘要包含保留的工具标题。不显示模型的推理内容。正常结束的轮次不加一行，中止或出错才会显示。模型的任务列表渲染为就地更新的清单。

输入 `/model` 选择已配置的供应商和模型，输入 `/reasoning` 选择该模型公布的推理强度，输入 `/stats`（或 `/cost`）查看整个会话的用量并刷新账户余额。这些命令只在终端本地执行。模型切换作用于下一次模型请求，并与网页选择器一样保存默认选择。供应商、API Key 和账户登录继续通过显示的 Web URL 配置。

编辑框下方的紧凑状态区显示下一次请求的模型、推理强度、整个会话的缓存命中率、平均输出速度，以及已登录 DeepSeek 账户的钱包余额。命中率的分母为未缓存输入、缓存读取和缓存写入 Token 之和。速度为供应商报告的输出 Token 数除以生成时间，不含首 Token 前等待和工具执行时间。缺失数据在英文界面显示 `Unavailable`，中文界面显示 `未提供`，查询失败会显示重试方式。余额在账户变化、每轮结束和 `/stats` 时刷新；充值与赠送钱包分别保留币种，金额四舍五入到分显示。不查询第三方 API Key 的余额。

默认启动时，终端在独立进程中通过当前 `dsh` 命令运行 `--profile web --no-open`。退出时通过正常关闭流程停止该后台。`--connect <launch-url>` 连接已有后台，终端退出后保留后台运行。重新运行 `dsh tui` 后，使用 `/resume` 继续这些 Session。如果其他进程持有某个 Session 的写锁，需要先释放，当前进程才能继续该 Session。

终端应答其所选 Session 的审批和提问请求。其他 Session 的请求继续交给 Web 应答器。审批参数首先在可滚动阅读器中打开。审批默认拒绝；只有 **Allow once** 会授权操作。关闭应用会取消待处理输入。操作失败显示在编辑区旁，发送失败时保留编辑框内容。

执行期间发送的消息默认排入下一轮。`/queue` 显示后台当前待执行的用户文本消息，可编辑、移除或选择**立即补充指令**，使其用于下一次模型请求。`/steer <text>` 显式向下一次模型请求提交新指令；它不能修改正在进行的模型请求。接收成功会显示反馈，状态栏显示待执行文本消息数。消息已被取走后，后台会拒绝编辑。含附件的消息仍在 Web 管理。

`/resume` 提供当前项目和全部项目列表，每个标题旁对齐显示相对更新时间和标识，筛选时可匹配标题或标识；`/search <text>` 在后台开启索引后搜索已持久化的消息内容（在后台 profile 补丁中设置 `session-query-sqlite.config.openAt: first-search` 或 `startup`）。默认 Web profile 禁用该索引；开启前终端会显示后台错误。`/rename [title]` 修改当前标题，`/fork` 经确认后从最近已完成轮次创建分叉对话。切换对话会在本次终端运行期间保留未发送草稿。`/history` 按 `historyMessages` 增加打开时的消息窗口，字符预算仍生效。历史省略或输出截断时会显示提示。`/export` 在后台将当前 Session 的完整持久化 ZIP 流式写入新本地文件，不包含后代 Session；不会覆盖已有文件，下载失败会删除不完整文件。

工具、帮助、统计和审批参数使用有高度限制的阅读器：方向键滚动，Page Up/Down 翻页，Home/End 跳到首尾，`/` 开始字面搜索，`n`/`N` 切换匹配项，Escape 或 Enter 返回。工作面板区分等待模型、接收回答、执行工具以及前台审批或提问。断线状态持续可见；连接恢复后重新加载当前对话和实时统计。`/reconnect` 重新启动恢复流程。发送结果不确定时会报告错误，不自动重发；重试前请检查历史。若后台重启后需要新登录 URL，请使用该 URL 和 `--connect` 重新启动终端。

如需内容搜索，后台 profile 补丁需要同时提供索引路径和打开时机：

```yaml
- id: session-query-sqlite
  config:
    path: ':memory:'
    openAt: first-search
```

`/language` 为当前终端选择英文或简体中文。Profile 配置 `language`（默认 `en`，或 `zh`）和 `statusLayout`（默认 `auto`，或 `compact`、`detailed`）设置启动偏好；交互修改持续到退出。

配置补丁可设置 `tui` 行的 `historyMessages`（默认 200）和 `transcriptCharacters`（默认 200000）。文件补全使用 `completionDepth`（默认 8）和 `completionFiles`（默认 10000）限制遍历深度和保留的索引。这些设置限制显示的历史范围，不会删除持久化日志。`defaultReasoningEffort`（默认 `high`）会应用到每个新对话，前提是其模型提供该档位；已有自己记录选择的对话不会被改动，设为空值则保持模型默认。块的颜色跟随终端：启动时向终端询问其背景色，再混入少量一种色相，你的消息偏蓝，助手的回答是淡中性色，工具活动（工作面板、调用摘要和任务清单）偏绿，输入框是中性色，因此无论深色还是浅色终端，各块都只与周围略有差别。终端不回应而且 `COLORFGBG` 也没有说明时，各块没有底色，改用中灰色线条分隔。`appearance`（默认 `auto`）可设为 `dark` 或 `light` 以跳过检测；`inputBackground`、`userBackground`、`assistantBackground` 和 `toolBackground` 可用 `#rrggbb` 颜色覆盖某一块。底色需要 256 色或更多颜色的终端（输入框需要 16 色）；设置 `NO_COLOR` 会关闭全部底色并保留灰色线条。检测只在启动时进行，更改终端主题后请重新启动。

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[bundle 补丁](cordis.patch.yml) 只挂载终端启动器和渲染器。[端口](src/port.ts) 是终端自己对 Harness 的词汇表；其中、应用、控制和界面代码里都不出现 Harness 包。[Web 远程适配器](src/web-remote.ts) 是唯一使用线上协议的文件：它通过 `/connect` 交换启动令牌，在已有的认证 HTTP/WebSocket 客户端中挂载 Session、Workspace、Account 和 User Question 接口，应答转发的审批和提问，并把 Harness 没有的方法报告为不支持的功能。[读取器](src/readers.ts) 把每个线上返回值转换为端口类型，容忍新增字段和格式错误的可选数据。[日志投影](src/wire-transcript.ts) 将事件转为终端自己的显示块，其[工具摘要](src/tool-view.ts)对未知工具回退为通用标题。界面组件不读取 Session 日志或访问 Host 服务。[后台进程所有者](src/server.ts) 启动普通 Web profile 并等待认证 URL；终端不会关闭外部连接的 Host。

终端渲染和编辑使用 `@earendil-works/pi-tui` 的普通屏幕模式。Markdown 使用其渲染器和 `cli-highlight`。提问和可搜索列表临时替换编辑框，同时保留草稿。释放时恢复终端和控制台，取消文件补全和 Remote 流，等待正在处理的回答，并关闭自身启动的后台。

</details>

<a id="further-exploration"></a>
## 进一步探索

- [CLI 配置](../../../apps/cli/README.zh.md)
- [Web 应用](../web-app/README.zh.md)
- [Bundle 导航](../README.zh.md)

<a id="model-experience"></a>
## 模型体验

Indirectly, through 共享的 Session 控制器及 Web 配置组合的工具。此 bundle 不提供模型提示词或工具 schema。

#### KV Cache 影响

显示或选择对话不会增加模型请求。提交的消息使用共享 Session 历史；前缀缓存是否可用由模型提供商决定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 独立包目前依赖现有 Web Remote 协议、生成的客户端描述、Cordis 和 profile 启动器。Remote 协议尚未稳定，也没有版本协商；兼容性靠宽容读取和为每个 Harness 版本构建的终端发布包维持，不保证兼容任意未来协议变更。只有 `bash`、`str_replace_editor` 和 `todo_write` 有专门的工具摘要。通过显示的 URL 可在浏览器中访问后台。图片及丰富的 Web 插件卡片仍可在浏览器中查看；终端工具结果以文本显示。对话记录显示有界的近期历史窗口。会话选择器列出标识和目录。界面支持英文和简体中文；模型输出和后台诊断保留原语言。

### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

无。

</details>
