---
kind: upgrade-guide
description: "The terminal starts a new conversation directly and replaces its full-screen history picker with local commands."
---

# Terminal conversations use native scrollback

English | [中文](guide.zh.md)

## Change

`dsh tui` starts a new conversation in the invoking directory's Workspace instead of opening the conversation picker. It renders into the terminal's normal screen, supports native scrollback, and replaces full-screen dialogs with inline questions. Enter sends a message; Shift+Enter inserts a newline. While the model works, a fixed panel shows the latest tool call and its details; afterwards each run of consecutive calls is one summary line, such as `12 tool calls · 1 failed`. Reasoning and normal turn endings are not shown; full arguments and output are available through `/tools`. The conversation identity, directory, and Web address move from a top header to the right side of the bottom status rows, without the browser sign-in link because it works like a password; `/web` shows it. Ctrl-C stops generation, clears the editor when idle, and exits when pressed twice.

## Migration

1. Run `dsh tui` to begin a new conversation, or keep using `dsh tui --session <id>` to resume an exact Session. The directory's existing Workspace is reused.
2. Use `/resume` or Ctrl-R to search conversation history. Use your terminal's scrollback to read earlier output.
3. Use `/tools` or Ctrl-O for tool details and `/help` for commands. Type `/` for command completion and `@` for project-file path completion.
4. Use `/web` when a script or habit read the sign-in link or conversation identity from the top header; they are now in the bottom status rows.
5. Confirm the composer displays `Enter send · Shift+Enter new line`. No Session data migration is required.
