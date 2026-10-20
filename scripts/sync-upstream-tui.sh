#!/usr/bin/env bash
# Merge the official repository's latest code into this checkout, rebuild, and reinstall the terminal into dsh.
#
#   scripts/sync-upstream-tui.sh            # sync now and let `dsh tui` start the check again every week
#   scripts/sync-upstream-tui.sh --disable  # stop the weekly check
#
# With the `dsh` command that scripts/setup-tui.sh writes, dsh runs this checkout's build output, so
# a sync updates both dsh and the terminal. Building rewrites files that a running dsh may still
# load, so a run started by `dsh tui` passes --wait-for-idle: it waits until no process runs this
# checkout's CLI, and that command waits while a sync holds the lock.
#
# The script merges <remote>/<branch> into the current branch; it never rebases or pushes. It stops
# without changing anything when tracked files have uncommitted changes, and it aborts a merge that
# conflicts. After a merge it installs dependencies, builds, runs the terminal's unit tests, and
# installs the terminal built from the merged commit into the selected dsh through
# scripts/release/tui-plugin/install.mjs; failing tests keep the merge commit and leave the installed
# terminal unchanged. Each run records its outcome in $DSH_HOME/addons/dsh-tui/auto-update.json,
# which `dsh tui` reads to start the next run in the background once --interval-days have passed and
# to report a failed run. Output is appended to auto-update.log in the same directory.
#
# Options:
#   --remote <name>        remote of the official repository (default: origin)
#   --branch <name>        official branch to merge (default: master)
#   --dsh <command>        dsh to install the terminal into (default: dsh on PATH)
#   --interval-days <n>    days between automatic runs started by dsh tui (default: 7)
#   --if-due               exit without syncing unless the last run is older than the interval
#   --wait-for-idle        before changing anything, wait until no process runs this checkout's CLI
#   --idle-poll-seconds <n>  seconds between those checks (default: 60)
#   --disable              delete the record so dsh tui no longer starts runs
# macOS and Linux only.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
remote="origin"
branch="master"
dsh_command="dsh"
interval_days=7
if_due=0
wait_for_idle=0
idle_poll_seconds=60
disable=0

while [ $# -gt 0 ]; do
  case "$1" in
    --remote) remote="${2:?--remote needs a value}"; shift 2 ;;
    --branch) branch="${2:?--branch needs a value}"; shift 2 ;;
    --dsh) dsh_command="${2:?--dsh needs a value}"; shift 2 ;;
    --interval-days) interval_days="${2:?--interval-days needs a value}"; shift 2 ;;
    --if-due) if_due=1; shift ;;
    --wait-for-idle) wait_for_idle=1; shift ;;
    --idle-poll-seconds) idle_poll_seconds="${2:?--idle-poll-seconds needs a value}"; shift 2 ;;
    --disable) disable=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "sync-upstream-tui: unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$interval_days" in
  ''|*[!0-9]*|0) echo "sync-upstream-tui: --interval-days must be a positive whole number" >&2; exit 2 ;;
esac
case "$idle_poll_seconds" in
  ''|*[!0-9]*|0) echo "sync-upstream-tui: --idle-poll-seconds must be a positive whole number" >&2; exit 2 ;;
esac

addons="${DSH_HOME:-${HOME}/.dsh}/addons/dsh-tui"
state="${addons}/auto-update.json"
log="${addons}/auto-update.log"
lock="${addons}/auto-update.lock"
mkdir -p "$addons"

if [ "$disable" -eq 1 ]; then
  rm -f "$state"
  echo "sync-upstream-tui: weekly checks disabled; run this script again to re-enable them"
  exit 0
fi

# Rewrite the record; the fields come from the environment so no value is ever parsed as code.
record() {
  STATE="$state" CHECKOUT="$root" REMOTE="$remote" BRANCH="$branch" DSH="${dsh_path:-}" \
    INTERVAL="$interval_days" LOG="$log" STATUS="$1" MESSAGE="$2" CHECKED="${checked:-}" node -e '
      const { writeFileSync, renameSync } = require("node:fs")
      const env = process.env
      const value = { version: 1, checkout: env.CHECKOUT, remote: env.REMOTE, branch: env.BRANCH, dsh: env.DSH,
        intervalDays: Number(env.INTERVAL), lastCheck: Number(env.CHECKED), status: env.STATUS,
        message: env.MESSAGE, log: env.LOG, updatedAt: Date.now() }
      writeFileSync(`${env.STATE}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
      renameSync(`${env.STATE}.tmp`, env.STATE)'
}

fail() {
  echo "sync-upstream-tui: $1" >&2
  record failed "$1"
  exit 1
}

if [ "$if_due" -eq 1 ] && [ -f "$state" ]; then
  due="$(STATE="$state" INTERVAL="$interval_days" node -p '
    const last = Number(JSON.parse(require("node:fs").readFileSync(process.env.STATE, "utf8")).lastCheck)
    !(Date.now() - last < Number(process.env.INTERVAL) * 86400000)')"
  [ "$due" = "true" ] || exit 0
fi

exec > >(tee -a "$log") 2>&1
echo "== $(date '+%Y-%m-%d %H:%M:%S') sync ${remote}/${branch} into ${root}"
dsh_path="$(command -v "$dsh_command" || true)"
checked="$(node -p 'Date.now()')"
[ -n "$dsh_path" ] || fail "${dsh_command} was not found on PATH; pass --dsh <command>"

cli="${root}/apps/cli/lib/bin.js"
busy() { pgrep -f "$cli" >/dev/null 2>&1; }

# One run at a time; a lock left by a process that no longer exists is taken over.
take_lock() {
  if ! mkdir "$lock" 2>/dev/null; then
    owner="$(cat "${lock}/pid" 2>/dev/null || true)"
    if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
      echo "sync-upstream-tui: another run (pid ${owner}) is in progress"
      exit 0
    fi
    rm -rf "$lock"
    mkdir "$lock"
  fi
  echo "$$" > "${lock}/pid"
}

if [ "$wait_for_idle" -eq 1 ]; then
  record waiting "Waiting for dsh to exit before merging ${remote}/${branch}"
  while :; do
    while busy; do sleep "$idle_poll_seconds"; done
    take_lock
    # A dsh started between the check and the lock would load files the build rewrites.
    busy || break
    rm -rf "$lock"
  done
else
  busy && fail "a dsh from this checkout is running; exit it first, or let dsh tui start the weekly run"
  take_lock
fi
work="$(mktemp -d)"
trap 'rm -rf "$work" "$lock"' EXIT
record running "Merging ${remote}/${branch}"

cd "$root"
[ -z "$(git status --porcelain --untracked-files=no)" ] \
  || fail "the checkout has uncommitted changes; commit or stash them, then run scripts/sync-upstream-tui.sh"
git fetch "$remote" "$branch" || fail "could not fetch ${remote}/${branch}"
upstream="$(git rev-parse FETCH_HEAD)"
behind="$(git rev-list --count "HEAD..${upstream}")"
if [ "$behind" -gt 0 ]; then
  if ! git merge --no-edit "$upstream"; then
    git merge --abort || true
    fail "merging ${remote}/${branch} conflicts with $(git branch --show-current); merge it by hand"
  fi
fi
commit="$(git rev-parse --short HEAD)"
version="0.0.0-local.${commit}"
if [ "$behind" -eq 0 ] && grep -q "\"dsh-tui-${version}-" "${addons}/current.json" 2>/dev/null; then
  record current "Already up to date at ${commit}"
  echo "sync-upstream-tui: already up to date at ${commit}"
  exit 0
fi

command -v npm >/dev/null || fail "npm is required"
# shellcheck source=pinned-pnpm.sh
. "${root}/scripts/pinned-pnpm.sh"
use_pinned_pnpm "$root" "$work" sync-upstream-tui || fail "the pinned pnpm is unavailable"
pnpm install --frozen-lockfile || fail "dependency installation failed after merging ${commit}"
pnpm run build:artifacts || fail "the build failed after merging ${commit}"
pnpm exec vitest run packages/bundle/tui-app \
  || fail "terminal unit tests failed after merging ${commit}; the merge is kept and the installed terminal is unchanged"
pnpm exec tsx scripts/release/create-tui-plugin.ts --out "${work}/release" --version "$version" \
  || fail "packing the terminal failed at ${commit}"
node "${work}/release/install.mjs" --dsh "$dsh_path" || fail "installing the terminal into ${dsh_path} failed"
record updated "Merged ${behind} official commit(s); installed ${version}, which applies the next time dsh tui starts"
echo "sync-upstream-tui: installed ${version}"
