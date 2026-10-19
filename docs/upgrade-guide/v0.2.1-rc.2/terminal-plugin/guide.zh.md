---
kind: upgrade-guide
description: "将终端安装为外部客户端 profile，继续使用官方 Harness 引擎。"
---

# 安装独立终端客户端

[English](guide.md) | 中文

## 变更

终端改为仅含客户端的外部 profile。默认在另一个进程中通过已有 `dsh` 启动 Web profile；`--connect <launch-url>` 连接已有后台，退出时保留后台运行。官方 CLI 不再内置终端 bundle 或 `tui` 模板。独立分发包内嵌远程客户端和编解码器，使用已安装的 Harness 引擎。

## 迁移

1. 解压独立终端分发包，执行 `node install.mjs --dsh <已有命令>`。安装器将 `@surfing/dsh-tui` 注册到仅含客户端的 `tui` profile，并备份已有终端 profile 的清单。无关的自定义 profile 需要另选 `--profile` 名称。
2. 在项目目录运行 `dsh tui`。后台插件和模型配置使用 `web` profile，也可通过 `--backend-profile <name>` 选择其他后台。终端显示设置属于终端 profile。
3. 正常升级官方 `dsh` 后，启动同一个终端 profile 即可。profile 和插件仍保存在 `DSH_HOME` 中；必要时使用保存的安装器重新接入其他命令。`release.json` 记录已验证的 Harness 版本。`dsh --version` 与之不同时安装器会警告（`--require-match` 则拒绝），Web 接口不兼容时需要与该 Harness 版本对应的终端发布包。
4. 插件安装不执行 Session 迁移。后台升级仍遵循其自身的持久化迁移规则，旧后台不保证能读取新版迁移后的数据。
