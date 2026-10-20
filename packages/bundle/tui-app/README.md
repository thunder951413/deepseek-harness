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

From a clone of the official repository, run `scripts/setup-tui.sh` (macOS and Linux). Each run merges `origin/master` into the current branch without rebasing or pushing, installs dependencies, runs this package's unit tests, builds, writes a `dsh` command that runs the checkout's CLI (`--name` and `--bin-dir` choose another name or location; `--force` replaces a command it did not write), and installs the terminal built from the same commit, so `dsh` and the terminal always match. A merge that conflicts is aborted and stops the run; with uncommitted changes in tracked files, a run started by hand skips the merge and builds the checkout as it is, while a run started by `dsh tui` stops; failing tests leave `dsh` and the terminal unchanged. `--no-merge` builds without merging, and `--remote` and `--branch` name another official source. To add the terminal to an existing `dsh`, use the external distribution: `node install.mjs --dsh <existing-dsh-command>`. The installer adds `@surfing/dsh-tui` and selects it alone in a client-only profile; it preserves a previous terminal profile manifest as a backup. It rejects profiles selecting unrelated bundles; choose another `--profile` name for those. The release generator, `pnpm exec tsx scripts/release/create-tui-plugin.ts --out <new-directory> --version <terminal-version>`, consumes built artifacts, embeds the current DSH wire client and codecs, and leaves Cordis as a runtime peer. The payload contains no agent engine. The source workspace remains `@deepseek-ai/dsh-tui-app`.

The first run also enables a weekly update: when `dsh tui` starts and at least `--interval-days` (default 7) have passed since the last run, it starts the script in the background with the same `--remote`, `--branch`, `--name`, and `--bin-dir`. Because `dsh` runs this checkout's build output, that run waits until no process runs this checkout's CLI, and the new version applies at the next start; a `dsh` started while it builds waits for it to finish, and a run started by hand refuses to start while such a `dsh` is open. The banner reports a scheduled run or the last failure; output is appended to `$DSH_HOME/addons/dsh-tui/auto-update.log`, and `scripts/setup-tui.sh --disable` stops the weekly update.

Official `dsh` upgrades retain profiles and their packages under `DSH_HOME`; start the same terminal profile afterward. Changing to an executable using the same home needs no source edits or runtime rebuild. Re-run the saved installer with `--dsh <command>` when reattachment is needed. `release.json` records the tested Harness version. The installer warns when `dsh --version` differs, and `--require-match` refuses the installation instead. Compatibility depends on the Web protocol and launcher/Cordis interfaces, not a promise that every future version works. Startup authenticates and requires the Session list. The terminal reads other results leniently: it takes only the fields it displays, ignores additions, and shows `未提供` for absent optional data. A Harness that lacks the model directory, usage readings, account balance, or user questions loses only that feature. A changed or missing Session list, creation, follow, or prompt interface reports a failure and requires the terminal release built for that Harness. A weekly workflow, `tui-compat`, installs the current build into a scratch `DSH_HOME` and probes it against a published `@deepseek-ai/dsh`. Installation does not migrate user data. Session format migrations remain owned by the backend; older backends need not read data migrated by newer versions.

Run `dsh tui` in the project directory. A new conversation opens immediately. Like the Web client, it reuses this directory's newest empty conversation when the Host allows it, so restarting leaves at most one empty conversation per directory; the Host creates a new one when that conversation has started, was archived, or is open in another process. `/new`, `/clear`, and Ctrl-N in a conversation that is still empty keep it and say so. Use `/resume` or Ctrl-R to search the Sessions of the invoking directory (`/resume <id>` opens one from another directory); `dsh tui --session <id>` opens a named conversation directly. Configure model credentials through the Web interface; `/web` shows its complete sign-in link, token included, which the status area never shows because it works like a password. The detailed status shows the conversation title and identity and the directory. The Host titles a conversation after its first message, first from that message's leading words and then from a model-generated summary, and the title in the status updates as soon as the Host changes it; `/rename` replaces it. Automatic layout uses compact rows when those details would wrap; `/layout` selects automatic, compact, or detailed status. `--backend-profile <name>` chooses the owned backend profile (default `web`); `--connect <launch-url>` attaches to an existing Host; `--port <port>` chooses an owned listener port; omission lets the operating system allocate one. `--host <address>` chooses where the owned Web service listens: `lan`, the default, binds the IPv4 address of a wired or wireless local network interface so other computers on the network can open the `/web` link, and falls back to this computer only when no such interface exists; `loopback` accepts this computer only; an address literal binds that local interface. Anyone with the link can run commands on this computer, so share it only on networks you trust. New conversations join the Workspace for the invoking directory; an existing Workspace for the same canonical path is reused, otherwise one is created. An interactive input and output terminal are required.

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

Each conversation opens under a banner: the DeepSeek whale, drifting gently, centered above the terminal version, next model, directory, and the latest titled conversation of this directory. When the terminal is at least 26 rows tall and wide enough, four featured commands and the first three skills sit on the right with counts of the rest, and the whale and text center in the space left of them; narrower terminals omit the lists, and shorter ones omit the whale. The whale stops moving once the conversation has content. `/skills` lists the skills the Harness offers the current conversation, each beside its description; choosing one puts `/name ` in the editor, and the Host runs that skill when a message starts with it. `/help` lists every command and skill. The Harness's own slash commands for the current conversation, such as `/compact`, `/goal`, `/plan`, and `/permission`, run in the Harness as they do from the Web client: a short result appears beside the composer and a longer one opens in the reader. Typing `/` completes terminal commands first, then Harness commands, then skills; a terminal command keeps a name it shares with a Harness command. `/permission` without an argument lists the Harness's permission presets with the current one marked and switches the conversation to the chosen one.

The conversation uses the terminal’s normal screen and native scrollback. The editor supports cursor movement, inline edits, multiline paste, and Up/Down input history. Type `/` for command completion or `@` to find project files; accepted file suggestions insert quoted paths into the message, and the model uses its file tools to read them. Automatic discovery respects `.gitignore` and excludes hidden directories and `node_modules`; an explicitly typed hidden path such as `@.config/` lists that directory directly. Indexing and empty-result notices appear separately from errors. Searching for `.gitignore` files also skips hidden directories such as `.Trash`. Permission-denied child directories are skipped with a partial-results notice; an unreadable project root or `.gitignore` file still reports a completion failure. `/new` (or `/clear`) starts another conversation, `/resume` searches history, `/tools` opens tool details, `/skills` chooses a skill, `/mode` chooses the work mode, `/web` shows the browser sign-in link, `/help` lists shortcuts, and `/exit` closes the application.

While the model works, a fixed panel above the editor shows the elapsed time, the number of tool calls and failures in the turn, the latest call as a one-line title such as `Bash(ls)`, `Read(path)`, `Edit(path)`, or `Write(path)` with a state marker, and three reserved rows describing it (the command, the path and change, or leading arguments). The panel keeps its height until the turn ends, so the screen does not jump between calls. Other tools show their name and first argument. When the turn ends, each run of consecutive calls collapses into one line such as `● 12 tool calls · 1 failed`; `/tools` browses retained calls, filters failures, and separates arguments from output. Closing a detail returns to the selected list item; failed summaries include retained tool titles. The model's reasoning is not shown. A turn that finishes normally adds no line; an abort or error does. The model's task list renders as a checklist updated in place.

`/mode` lists the work modes (agent presets) the Harness composes, such as those the Web client offers, with descriptions; the current and default modes are marked and an unavailable mode shows why. A conversation keeps its mode after its first message, so choosing a mode changes an empty conversation in place and otherwise starts a new conversation in that mode; later new conversations in the same terminal start in it too. The status and the banner name the current mode when the Harness offers modes. Submit `/model` to choose a configured provider/model, `/reasoning` to choose one of that model's advertised effort levels, or `/stats` (or `/cost`) to inspect whole-session usage and refresh the account balance. These commands stay local to the terminal. Model changes apply to the next model request and save the same default as the Web selector. Configure providers, API keys, and account sign-in through the displayed Web URL.

The compact status below the editor shows the next model, reasoning effort, whole-session cache-hit share, average decode speed, and signed-in DeepSeek account wallets. Cache share divides cache-read tokens by uncached input plus cache reads and writes. Speed divides provider output tokens by decode time, excluding time before the first token and tool execution. Missing readings display `Unavailable` in English or `未提供` in Chinese; failed queries display a retry action. Balance refreshes on account changes, turn completion, and `/stats`; recharge and bonus wallets keep their currencies and show amounts rounded to the cent. Third-party API-key balances are not queried.

Default startup launches the invoking `dsh` executable with `--profile web --no-open` in a separate process. Quitting closes that owned backend through normal launcher shutdown. `--connect <launch-url>` connects to an existing backend and leaves it running on exit. After restarting `dsh tui`, use `/resume` to continue those Sessions. Another process holding a Session's writer lock must release it before this process can continue that Session.

The terminal answers approval and question requests for its selected Session. Requests for other Sessions continue to the Web answerers. Approval arguments first open in a scrollable reader. Approval defaults to rejection; only **Allow once** authorizes an operation. Closing the application cancels pending input. Failed operations appear beside the composer, and a failed submission keeps its editor text.

Messages sent during execution queue for the next turn. `/queue` displays the Host's current pending human text messages and offers editing, removal, or **Steer now**, which applies the message at the next model step. `/steer <text>` submits a new instruction at that step explicitly; it cannot alter a model request already in flight. A successful admission shows feedback, and the status displays pending text-message counts. The Host rejects edits after a message has been claimed. Messages containing attachments remain managed in Web.

`/resume` offers current-project and all-project lists of conversations that have at least one message and are not archived in the Web client, with each title's relative update time and identity aligned beside it; filtering matches either the title or the identity. `/search <text>` searches persisted message content when the backend enables indexing (`session-query-sqlite.config.openAt: first-search` or `startup` in its profile patch). Stock Web profiles disable this index; the terminal reports that backend error until indexing is enabled. `/rename [title]` changes the current title, and `/fork` creates a conversation from the latest completed turn after confirmation. Switching conversations retains unsent drafts for this terminal lifetime. `/history` increases the opening message window by `historyMessages`; the character budget still applies. A notice identifies omitted history or clipped output. `/export` streams the current Session's complete persisted ZIP to a new local file in the background, excluding descendant Sessions; existing files are never overwritten, and failed downloads are removed.

Tools, help, statistics, and approval arguments use a bounded reader: arrows scroll, Page Up/Down page, Home/End jump, `/` starts literal search, `n`/`N` move between matches, and Escape or Enter returns. While working, the panel distinguishes model waiting, response streaming, tool execution, and foreground approvals/questions. Connection loss remains visible; transport recovery reloads the current conversation and live readings. `/reconnect` restarts recovery. An uncertain prompt outcome is reported without automatic resubmission; inspect history before retrying. If a restarted Host requires a new login URL, restart with `--connect` and that URL.

For content search, the backend profile patch must include both the index path and opening phase:

```yaml
- id: session-query-sqlite
  config:
    path: ':memory:'
    openAt: first-search
```

`/language` chooses English or Simplified Chinese for the current terminal. Profile configuration `language` (`en`, the default, or `zh`) and `statusLayout` (`auto`, the default, `compact`, or `detailed`) set startup preferences; interactive changes last until exit.

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

- The independent package currently depends on the existing Web Remote protocol, generated client descriptors, Cordis, and the profile launcher. The Remote protocol is pre-stable and carries no version negotiation; compatibility is kept by lenient readers and a terminal release built for each Harness version, not guaranteed for arbitrary future protocol changes. Dedicated tool summaries exist only for `bash`, `str_replace_editor`, and `todo_write`. Use the displayed URL for browser access to the backend. Images and rich Web plugin cards remain available in the browser; terminal tool results are text. The transcript shows a bounded recent history window. Session selection lists identities and directories. The interface supports English and Simplified Chinese; model output and backend diagnostics retain their source language.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
