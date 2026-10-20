---
description: "面向交互式组合的 /title 命令：重新生成或设置对话标题、你会看到什么，以及如何挂载。"
kind: "package-reference"
---

# @deepseek-ai/dsh-command-title

[English](README.md) | 中文

## 概述

`dsh-command-title` 为聊天 UI 添加 `/title` 命令。单独输入 `/title` 会通过部署注册的标题生成器重新生成对话标题，未注册生成器时则推导内置的回退标题；`/title <文本>` 把标题设为给定文本。命令会报告接受的标题，从不进入模型历史，生成失败时保留当前标题。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当标题不再描述对话时，在聊天 UI 中输入 `/title`；想自己命名时输入 `/title <文本>`。随附的 `dsh` base 会把该命令挂在标题服务旁边，因此通常已经可用。

### 使用命令

| 输入 | 结果 |
|---|---|
| `/title` | 通过已注册的生成器重新生成标题，未注册生成器时推导回退标题，然后报告 `Title: <标题>`。之前手动设置的标题会被替换。 |
| 尚无消息时的 `/title` | `No message to title yet.`——不做任何改变。 |
| `/title <文本>` | 把标题设为规范化后的文本并报告 `Title: <标题>`；在 `/title` 重新生成之前，自动生成不会再替换它。 |
| 文本没有可见字符的 `/title` | `Usage: /title regenerates the title; /title <new title> sets it.` |

### 你会看到什么

| 情况 | 你看到的消息 |
|---|---|
| 生成器失败、超时或返回了无效标题 | `Title generation failed; the current title is kept: <原因>` |
| 命令被取消 | `Title generation cancelled.` |

重新生成的标题概括哪些消息取决于生成器：随附的首条消息生成器会再次概括第一条合格消息，实验性的全部消息生成器则概括所有合格消息。

### 组合命令

挂载命令注册表、标题服务、可选的生成器以及本插件：

```yaml
- id: commands
  name: '@deepseek-ai/dsh-commands'
- id: session-title
  name: '@deepseek-ai/dsh-session-title'
  config:
    fallbackMaxWords: 5
    fallbackMaxBytes: 40
    maxTitleBytes: 80
- id: command-title
  name: '@deepseek-ai/dsh-command-title'
```

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释命令背后的设计决策；可观察的行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

- **标题归标题服务管理。** 处理函数只调用 `ctx.sessionTitle.refresh()` 或 `ctx.sessionTitle.rename()`，生成器选择、规范化、长度限制和取代关系都留在该服务中。
- **显式重新生成即解除固定。** 用户设置的标题会停止自动修订；不带文本的 `/title` 是把标题交还给生成器的明确方式。
- **静默拆卸。** 生命周期 effect 先注销 `/title`，再等待已开始的处理函数结束。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`/title` 注册、改名与重新生成路径、失败报告、生命周期收尾 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [会话标题服务](../session-title/README.zh.md)——回退标题、改名、刷新和生成器注册。
- [首条消息标题生成器](../session-title-first-prompt-llm/README.zh.md)——根据会话第一条消息命名的随附生成器。
- [全部消息标题生成器](../../experimental/session-title-all-prompts-llm/README.zh.md)——随对话推进修订标题的实验性生成器。
- [命令包](../../interaction/commands/README.zh.md)——聊天命令背后的注册表与分发约定。

-----

<a id="model-experience"></a>
## 模型体验

### 用户 `/title` 控制

#### 模型看到的内容

斜杠输入、标题和结果都不会进入模型请求；标题是只写入日志的 `session/title` 事件，命令生命周期是只写入日志的 `command/run` 与 `command/done` 事件。

#### Token 影响

该命令不为主请求增加 token。通过 LLM 生成器重新生成时，会在对话之外发起一次辅助请求。

#### KV Cache 影响

无：模型可见的历史没有变化。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **生成器决定概括来源**——使用随附的首条消息生成器时，`/title` 会再次概括第一条消息而不是最新话题；希望标题随对话变化的部署应挂载全部消息生成器。
- **仅限命令适配器**——没有 `ctx.commands` 的界面改用会话控制器的改名操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景——点击展开</summary>

本开发备注是给维护者的工作背景，明确不具权威性；已发布的行为以上文各节和包代码为准。

- **按最新话题重新生成，尚未决定**——`/title` 遵循部署注册的生成器；若要在首条消息生成器下按最近的消息重新生成，需要的是生成器选项而不是命令参数。

</details>
