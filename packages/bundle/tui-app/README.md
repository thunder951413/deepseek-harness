---
description: "Run a terminal coding assistant and its shared Web service with dsh tui."
kind: "package-bundle"
---

# @deepseek-ai/dsh-tui-app

English | [中文](README.zh.md)

## Summary

Run `dsh tui` to chat, inspect tool activity, answer questions, and approve operations in a terminal. The command starts a loopback Web service automatically; its URL opens the same conversations in a browser. Both interfaces share model settings, tools, and persisted Session history. The client-only `tui` profile mounts this bundle; its backend uses the existing Web profile in another process.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

## Use this package

From a checkout of this repository, run `scripts/setup-tui.sh` (macOS and Linux). It installs dependencies, builds, writes a `dsh` command that runs the checkout's CLI (`--name` and `--bin-dir` choose another name or location), and installs the plugin built from the same commit, so the terminal and its Harness always match; run it again after updating the checkout. To add the terminal to an existing `dsh`, use the external distribution: `node install.mjs --dsh <existing-dsh-command>`. The installer adds `@surfing/dsh-tui` and selects it alone in a client-only profile; it preserves a previous terminal profile manifest as a backup. It rejects profiles selecting unrelated bundles; choose another `--profile` name for those. The release generator, `pnpm exec tsx scripts/release/create-tui-plugin.ts --out <new-directory> --version <terminal-version>`, consumes built artifacts, embeds the current DSH wire client and codecs, and leaves Cordis as a runtime peer. The payload contains no agent engine. The source workspace remains `@deepseek-ai/dsh-tui-app`.

Official `dsh` upgrades retain profiles and their packages under `DSH_HOME`; start the same terminal profile afterward. Changing to an executable using the same home needs no source edits or runtime rebuild. Re-run the saved installer with `--dsh <command>` when reattachment is needed. `release.json` records the tested Harness version. The installer warns when `dsh --version` differs, and `--require-match` refuses the installation instead. Compatibility depends on the Web protocol and launcher/Cordis interfaces, not a promise that every future version works. Startup authenticates and requires the Session list. The terminal reads other results leniently: it takes only the fields it displays, ignores additions, and shows `未提供` for absent optional data. A Harness that lacks the model directory, usage readings, account balance, or user questions loses only that feature. A changed or missing Session list, creation, follow, or prompt interface reports a failure and requires the terminal release built for that Harness. A weekly workflow, `tui-compat`, installs the current build into a scratch `DSH_HOME` and probes it against a published `@deepseek-ai/dsh`. Installation does not migrate user data. Session format migrations remain owned by the backend; older backends need not read data migrated by newer versions.

Run `dsh tui` in the project directory. A new conversation opens immediately; use `/resume` or Ctrl-R to search the Sessions of the invoking directory (`/resume <id>` opens one from another directory); `dsh tui --session <id>` opens a named conversation directly. Configure model credentials through the Web interface; `/web` shows its sign-in link, which the status area omits because it works like a password. The right side of the three bottom rows always shows the conversation identity, its directory, and the Web address; a narrow terminal moves an item that does not fit onto its own row above. `--backend-profile <name>` chooses the owned backend profile (default `web`); `--connect <launch-url>` attaches to an existing Host; `--port <port>` chooses an owned listener port; omission lets the operating system allocate one. New conversations join the Workspace for the invoking directory; an existing Workspace for the same canonical path is reused, otherwise one is created. An interactive input and output terminal are required.

| Key | Action |
|---|---|
| Ctrl-S | Send the editor contents or confirm a text answer |
| Enter | Send the message, confirm a text answer, or select a menu item |
| Shift+Enter | Add an editor line |
| Ctrl-N | Create a conversation in the invoking directory |
| Ctrl-R | Choose a persisted conversation |
| Terminal scrollback | Read earlier conversation output |
| Ctrl-O | Inspect tool arguments and output |
| Ctrl-C | Stop generation; when idle, clear the editor, then press twice to exit |
| Ctrl-Q | Exit and shut down the owned Web service |
| Escape | Dismiss a menu; an approval dismissal rejects the operation |

The conversation uses the terminal’s normal screen and native scrollback. The editor supports cursor movement, inline edits, multiline paste, and Up/Down input history. Type `/` for command completion or `@` to find project files; accepted file suggestions insert quoted paths into the message, and the model uses its file tools to read them. Discovery respects `.gitignore` and excludes hidden files and `node_modules`. `/new` (or `/clear`) starts another conversation, `/resume` searches history, `/tools` opens tool details, `/web` shows the browser sign-in link, `/help` lists shortcuts, and `/exit` closes the application.

While the model works, a fixed panel above the editor shows the elapsed time, the number of tool calls and failures in the turn, the latest call as a one-line title such as `Bash(ls)`, `Read(path)`, `Edit(path)`, or `Write(path)` with a state marker, and three reserved rows describing it (the command, the path and change, or leading arguments). The panel keeps its height until the turn ends, so the screen does not jump between calls. Other tools show their name and first argument. When the turn ends, each run of consecutive calls collapses into one line such as `● 12 tool calls · 1 failed`; `/tools` lists every call with its arguments and output. The model's reasoning is not shown. A turn that finishes normally adds no line; an abort or error does. The model's task list renders as a checklist updated in place.

Submit `/model` to choose a configured provider/model, `/reasoning` to choose one of that model's advertised effort levels, or `/stats` (or `/cost`) to inspect whole-session usage and refresh the account balance. These commands stay local to the terminal. Model changes apply to the next model request and save the same default as the Web selector. Configure providers, API keys, and account sign-in through the displayed Web URL.

The compact status below the editor shows the next model, reasoning effort, whole-session cache-hit share, average decode speed, and signed-in DeepSeek account wallets. Cache share divides cache-read tokens by uncached input plus cache reads and writes. Speed divides provider output tokens by decode time, excluding time before the first token and tool execution. Missing readings display `未提供`; failed queries display a retry action. Balance refreshes on account changes, turn completion, and `/stats`; recharge and bonus wallets keep their currencies and show amounts rounded to the cent. Third-party API-key balances are not queried.

Default startup launches the invoking `dsh` executable with `--profile web --no-open` in a separate process. Quitting closes that owned backend through normal launcher shutdown. `--connect <launch-url>` connects to an existing backend and leaves it running on exit. After restarting `dsh tui`, use `/resume` to continue those Sessions. Another process holding a Session's writer lock must release it before this process can continue that Session.

The terminal answers approval and question requests for its selected Session. Requests for other Sessions continue to the Web answerers. Approval defaults to rejection; only **Allow once** authorizes an operation. Closing the application cancels pending input. Failed operations appear beside the composer, and a failed submission keeps its editor text.

Profile patches may configure the `tui` row's `historyMessages` (default 200) and `transcriptCharacters` (default 200000). File completion uses `completionDepth` (default 8) and `completionFiles` (default 10000) to bound traversal and the retained index. These bound the displayed history, without deleting the persisted log. `defaultReasoningEffort` (default `high`) is applied to each new conversation whose model offers that level; a conversation with its own recorded choice is never changed, and an empty value keeps the model's default. Block colors follow the terminal: at startup it asks the terminal for its background color and mixes a little of one hue into it, a bluish tint for your messages, a faint neutral for the assistant's answers, a greenish one for tool activity (the working panel, the call summaries, and the task list), and a neutral one for the input, so the blocks differ only slightly from the surroundings on dark and light terminals alike. When the terminal does not answer and `COLORFGBG` does not say, blocks get no tint and a mid-grey line separates them instead. `appearance` (default `auto`) can be `dark` or `light` to skip detection, and `inputBackground`, `userBackground`, `assistantBackground`, and `toolBackground` accept a `#rrggbb` color to override one block. Tints need a terminal with 256 colors or more (the input needs 16); `NO_COLOR` turns all of them off and leaves the grey lines. Detection happens once at startup, so restart the terminal after changing its theme.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The [bundle patch](cordis.patch.yml) mounts only the terminal startup and renderer. [The port](src/port.ts) is the terminal's own vocabulary for a Harness; no Harness package appears in it, in the application, the controls, or the UI. [The Web Remote adapter](src/web-remote.ts) is the only file that speaks the wire protocol: it exchanges a launch token at `/connect`, mounts the generated Session, Workspace, Account, and User Question contributions on the existing authenticated HTTP/WebSocket client, answers forwarded approvals and questions, and reports methods the Harness lacks as unsupported features. [The readers](src/readers.ts) convert each wire result into port types and tolerate additions and malformed optional data. [The journal projection](src/wire-transcript.ts) turns events into terminal-owned display blocks, with [tool summaries](src/tool-view.ts) that fall back to a generic title for unknown tools. UI components do not read Session logs or access Host services. [The server owner](src/server.ts) launches an ordinary Web profile and waits for its authenticated URL; an externally connected Host is never terminated by the terminal.

Terminal rendering and editing use `@earendil-works/pi-tui` on the main screen. Markdown uses its renderer and `cli-highlight`. Questions and searchable lists temporarily replace the composer while retaining drafts. Disposal restores the terminal and console, cancels file completion and Remote streams, waits for active answers, and closes an owned backend.

</details>

## Further Exploration

- [CLI profiles](../../../apps/cli/README.md)
- [Web application](../web-app/README.md)
- [Bundle map](../README.md)

## Model Experience

Indirectly, through the shared Session controller and the tools composed by the Web profile. This bundle contributes no model prompt or tool schema.

#### KV Cache effect

Displaying or selecting a conversation adds no model request. Submitted messages use the shared Session history; the model provider owns prefix-cache availability.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The independent package currently depends on the existing Web Remote protocol, generated client descriptors, Cordis, and the profile launcher. The Remote protocol is pre-stable and carries no version negotiation; compatibility is kept by lenient readers and a terminal release built for each Harness version, not guaranteed for arbitrary future protocol changes. Dedicated tool summaries exist only for `bash`, `str_replace_editor`, and `todo_write`. Use the displayed URL for browser access to the backend. Images and rich Web plugin cards remain available in the browser; terminal tool results are text. The transcript shows a bounded recent history window. Session selection lists identities and directories. Terminal copy is English.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
