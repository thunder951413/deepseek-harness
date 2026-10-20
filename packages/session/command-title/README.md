---
description: "The /title command for interactive compositions: regenerate or set a conversation's title, what you see, and how to mount it."
kind: "package-reference"
---

# @deepseek-ai/dsh-command-title

English | [中文](README.zh.md)

## Summary

`dsh-command-title` adds a `/title` command to chat UIs. `/title` alone regenerates the conversation title through the title provider the deployment registers, or derives the built-in fallback title when none is registered; `/title <text>` sets the title to the given text. The command reports the accepted title, never enters model history, and leaves the current title in place when generation fails.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Type `/title` in a chat UI when the title no longer describes the conversation, or `/title <text>` to name it yourself. The shipped `dsh` base mounts the command beside the title service, so it is usually already available.

### Using the command

| Input | Result |
|---|---|
| `/title` | Regenerate the title through the registered provider, or derive the fallback title when none is registered, then report `Title: <title>`. A title you set earlier is replaced. |
| `/title` before any message | `No message to title yet.` — nothing changes. |
| `/title <text>` | Set the title to the normalized text and report `Title: <title>`; automatic generation no longer replaces it until `/title` regenerates it. |
| `/title` with text that has no visible characters | `Usage: /title regenerates the title; /title <new title> sets it.` |

### What you see

| Situation | Message you see |
|---|---|
| The provider failed, timed out, or returned an invalid title | `Title generation failed; the current title is kept: <reason>` |
| The command was cancelled | `Title generation cancelled.` |

Which messages a regenerated title summarizes depends on the provider: the shipped first-message provider summarizes the first eligible message again, while the experimental all-prompts provider summarizes every eligible message.

### Composing the command

Mount the command registry, the title service, an optional provider, and this plugin:

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
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

This section explains the design decisions behind the command; the observable behavior is fully covered in [Use this package](#use-this-package).

### Design philosophy

- **The title service owns titles.** The handler only calls `ctx.sessionTitle.refresh()` or `ctx.sessionTitle.rename()`, so provider choice, normalization, length limits, and supersession stay in that service.
- **Explicit regeneration is the unpin.** A user-set title stops automatic revisions; `/title` without text is the deliberate way to hand the title back to the provider.
- **Quiescent teardown.** The lifecycle effect unregisters `/title` before draining handlers that already started.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: `/title` registration, rename and regenerate paths, failure reporting, lifecycle drain |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Session title service](../session-title/README.md) — fallback titles, rename, refresh, and provider registration.
- [First-message title provider](../session-title-first-prompt-llm/README.md) — the shipped provider that titles a session from its first message.
- [All-prompts title provider](../../experimental/session-title-all-prompts-llm/README.md) — the experimental provider that revises titles as the conversation grows.
- [Commands package](../../interaction/commands/README.md) — the registry and dispatch contract behind chat commands.

-----

<a id="model-experience"></a>
## Model Experience

### Human `/title` control

#### What the model sees

The slash input, the title, and the result never enter a model request; a title is a log-only `session/title` event, and the command lifecycle is the log-only `command/run` and `command/done` pair.

#### Token effect

The command adds no main-request tokens. Regenerating through an LLM provider makes one auxiliary request outside the conversation.

#### KV Cache effect

None: no model-visible history changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Provider decides the source** — with the shipped first-message provider, `/title` summarizes the first message again rather than the latest topic; deployments that want titles to follow the conversation mount the all-prompts provider.
- **Command adapters only** — surfaces without `ctx.commands` rename through the session controller's rename operation instead.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers and is explicitly non-authoritative; shipped behavior lives in the sections above and the package code.

- **Latest-topic regeneration, undecided** — `/title` follows whichever provider the deployment registers; regenerating from recent messages under the first-message provider would need a provider option rather than a command argument.

</details>
