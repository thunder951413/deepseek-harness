---
kind: upgrade-guide
description: "Install the terminal as an external client profile while keeping the official Harness engine."
---

# Install the independent terminal client

English | [中文](guide.zh.md)

## Change

The terminal is an external client-only profile. Default startup launches the existing `dsh` Web profile in another process; `--connect <launch-url>` attaches to an existing backend and leaves it running on exit. The official CLI no longer carries a terminal bundle or a shipped `tui` template. The external distribution embeds its wire client and codecs and uses the installed Harness engine.

## Migration

1. Extract the independent terminal release and run `node install.mjs --dsh <existing-command>`. The installer registers `@surfing/dsh-tui` in a client-only `tui` profile, backing up an older terminal profile manifest. An unrelated profile needs a fresh `--profile` name.
2. Run `dsh tui` from the project directory. Backend plugins and model configuration use the `web` profile; select another with `--backend-profile <name>`. Terminal display settings belong to the terminal profile.
3. Upgrade official `dsh` normally, then run the same terminal profile. Profiles and packages remain in `DSH_HOME`. Use the saved installer to reattach to another executable when necessary. `release.json` records the verified Harness version; an incompatible Web interface requires an updated terminal adapter.
4. No Session migration is performed by plugin installation. Backend upgrades retain their own persistence migration rules; an older backend need not read a newer backend's migrated data.
