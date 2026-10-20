#!/usr/bin/env bash
# Install, update, and keep current a `dsh` command and terminal client built from this checkout.
#
#   git clone <official repository> && cd deepseek-harness && scripts/setup-tui.sh
#   scripts/setup-tui.sh                     # later: merge the official code, rebuild, and reinstall
#   scripts/setup-tui.sh --disable           # stop the weekly update that `dsh tui` starts
#
# Each run merges <remote>/<branch> into the current branch (it never rebases or pushes), installs
# dependencies, runs the terminal's unit tests, builds, writes a `dsh` command that runs this
# checkout's CLI, and installs the terminal built from the same commit into the `tui` profile under
# DSH_HOME (default ~/.dsh). A merge that conflicts is aborted and stops the run. When tracked files
# have uncommitted changes, a run started by hand skips the merge and builds the checkout as it is,
# while a run started by `dsh tui` stops, so unfinished work never replaces the daily dsh unattended.
#
# Each run records its outcome in $DSH_HOME/addons/dsh-tui/auto-update.json; `dsh tui` reads it to
# start the next run in the background once --interval-days have passed and to report a failure.
# Because dsh runs this checkout's build output, such a run waits until no process runs this
# checkout's CLI, and the `dsh` command waits while a run holds the lock. Output is appended to
# auto-update.log beside the record.
#
# Options:
#   --name <command>         command to create (default: dsh); use another name to keep an installed dsh
#   --bin-dir <dir>          where to create the command (default: ~/.local/bin)
#   --force                  replace an existing command that this script did not create
#   --skip-build             reuse existing build output (dependencies are still installed)
#   --no-merge               build the current branch without merging the official code
#   --remote <name>          remote of the official repository (default: origin)
#   --branch <name>          official branch to merge (default: master)
#   --interval-days <n>      days between runs started by dsh tui (default: 7)
#   --if-due                 exit unless the last run is older than the interval (used by dsh tui)
#   --wait-for-idle          first wait until no process runs this checkout's CLI (used by dsh tui)
#   --idle-poll-seconds <n>  seconds between those checks (default: 60)
#   --disable                delete the record so dsh tui no longer starts runs
# macOS and Linux only.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="dsh"
bin_dir="${HOME}/.local/bin"
force=0
skip_build=0
merge=1
remote="origin"
branch="master"
interval_days=7
if_due=0
wait_for_idle=0
idle_poll_seconds=60
disable=0

while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="${2:?--name needs a value}"; shift 2 ;;
    --bin-dir) bin_dir="${2:?--bin-dir needs a value}"; shift 2 ;;
    --force) force=1; shift ;;
    --skip-build) skip_build=1; shift ;;
    --no-merge) merge=0; shift ;;
    --remote) remote="${2:?--remote needs a value}"; shift 2 ;;
    --branch) branch="${2:?--branch needs a value}"; shift 2 ;;
    --interval-days) interval_days="${2:?--interval-days needs a value}"; shift 2 ;;
    --if-due) if_due=1; shift ;;
    --wait-for-idle) wait_for_idle=1; shift ;;
    --idle-poll-seconds) idle_poll_seconds="${2:?--idle-poll-seconds needs a value}"; shift 2 ;;
    --disable) disable=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "setup-tui: unknown option: $1" >&2; exit 2 ;;
  esac
done
case "$name" in
  *[!A-Za-z0-9._-]*|'') echo "setup-tui: --name must be a plain command name" >&2; exit 2 ;;
esac
for value in "$interval_days" "$idle_poll_seconds"; do
  case "$value" in
    ''|*[!0-9]*|0) echo "setup-tui: --interval-days and --idle-poll-seconds must be positive whole numbers" >&2; exit 2 ;;
  esac
done
# A run started by dsh tui is unattended: it never builds uncommitted work.
unattended=$(( if_due || wait_for_idle ))

command -v node >/dev/null || { echo "setup-tui: Node.js 22.19+ or 24+ is required" >&2; exit 1; }
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (!(major >= 24 || (major === 22 && minor >= 19))) {
    console.error(`setup-tui: Node.js 22.19+ or 24+ is required (found ${process.versions.node})`)
    process.exit(1)
  }'

addons="${DSH_HOME:-${HOME}/.dsh}/addons/dsh-tui"
state="${addons}/auto-update.json"
log="${addons}/auto-update.log"
lock="${addons}/auto-update.lock"
mkdir -p "$addons"

if [ "$disable" -eq 1 ]; then
  rm -f "$state"
  echo "setup-tui: weekly updates disabled; run this script again to re-enable them"
  exit 0
fi

# Rewrite the record; the fields come from the environment so no value is ever parsed as code.
record() {
  STATE="$state" CHECKOUT="$root" REMOTE="$remote" BRANCH="$branch" NAME="$name" BIN_DIR="$bin_dir" \
    INTERVAL="$interval_days" LOG="$log" STATUS="$1" MESSAGE="$2" CHECKED="${checked:-0}" node -e '
      const { writeFileSync, renameSync } = require("node:fs")
      const env = process.env
      const value = { version: 2, checkout: env.CHECKOUT, remote: env.REMOTE, branch: env.BRANCH, name: env.NAME,
        binDir: env.BIN_DIR, intervalDays: Number(env.INTERVAL), lastCheck: Number(env.CHECKED), status: env.STATUS,
        message: env.MESSAGE, log: env.LOG, updatedAt: Date.now() }
      writeFileSync(`${env.STATE}.tmp`, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
      renameSync(`${env.STATE}.tmp`, env.STATE)'
}

fail() {
  echo "setup-tui: $1" >&2
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
echo "== $(date '+%Y-%m-%d %H:%M:%S') setup-tui in ${root}"
checked="$(node -p 'Date.now()')"

# shellcheck source=dsh-wrapper.sh
. "${root}/scripts/dsh-wrapper.sh"
command_path="${bin_dir}/${name}"
if [ -e "$command_path" ] && ! grep -qF "$DSH_WRAPPER_MARKER" "$command_path" 2>/dev/null && [ "$force" -eq 0 ]; then
  fail "${command_path} already exists and was not created by this script; use --name <other-name> to keep it, or --force to replace it"
fi

cli="${root}/apps/cli/lib/bin.js"
busy() { pgrep -f "$cli" >/dev/null 2>&1; }

# One run at a time; a lock left by a process that no longer exists is taken over.
take_lock() {
  if ! mkdir "$lock" 2>/dev/null; then
    owner="$(cat "${lock}/pid" 2>/dev/null || true)"
    if [ -n "$owner" ] && kill -0 "$owner" 2>/dev/null; then
      echo "setup-tui: another run (pid ${owner}) is in progress"
      exit 0
    fi
    rm -rf "$lock"
    mkdir "$lock"
  fi
  echo "$$" > "${lock}/pid"
}

if [ "$wait_for_idle" -eq 1 ]; then
  record waiting "Waiting for dsh to exit before updating"
  while :; do
    while busy; do sleep "$idle_poll_seconds"; done
    take_lock
    # A dsh started between the check and the lock would load files the build rewrites.
    busy || break
    rm -rf "$lock"
  done
else
  busy && fail "a dsh from this checkout is running; exit it first, because the build rewrites the files it loads"
  take_lock
fi
work="$(mktemp -d)"
trap 'rm -rf "$work" "$lock"' EXIT
# The dsh command waits while the lock is held, except for this run's own children.
export DSH_TUI_SYNC_PID="$$"
record running "Updating from ${remote}/${branch}"

cd "$root"
behind=0
dirty=0
[ -z "$(git status --porcelain --untracked-files=no)" ] || dirty=1
if [ "$merge" -eq 1 ]; then
  if [ "$dirty" -eq 1 ]; then
    [ "$unattended" -eq 0 ] \
      || fail "the checkout has uncommitted changes; commit or stash them, then run scripts/setup-tui.sh"
    echo "setup-tui: skipping the merge of ${remote}/${branch}: tracked files have uncommitted changes; building the checkout as it is"
  else
    git fetch "$remote" "$branch" || fail "could not fetch ${remote}/${branch}"
    upstream="$(git rev-parse FETCH_HEAD)"
    behind="$(git rev-list --count "HEAD..${upstream}")"
    if [ "$behind" -gt 0 ] && ! git merge --no-edit "$upstream"; then
      git merge --abort || true
      fail "merging ${remote}/${branch} conflicts with $(git branch --show-current); merge it by hand, then run scripts/setup-tui.sh"
    fi
  fi
fi
commit="$(git rev-parse --short HEAD 2>/dev/null || echo checkout)"
version="0.0.0-local.${commit}"
if [ "$dirty" -eq 0 ] && [ "$behind" -eq 0 ] && [ -e "$command_path" ] \
  && grep -q "\"dsh-tui-${version}-" "${addons}/current.json" 2>/dev/null; then
  record current "Already up to date at ${commit}"
  echo "setup-tui: already up to date at ${commit}"
  exit 0
fi

command -v npm >/dev/null || fail "npm is required"
# shellcheck source=pinned-pnpm.sh
. "${root}/scripts/pinned-pnpm.sh"
use_pinned_pnpm "$root" "$work" setup-tui || fail "the pinned pnpm is unavailable"
pnpm install --frozen-lockfile || fail "dependency installation failed at ${commit}"
# The tests run from source, so they gate the build that dsh runs from.
pnpm exec vitest run packages/bundle/tui-app \
  || fail "terminal unit tests failed at ${commit}; dsh and the installed terminal are unchanged"
if [ "$skip_build" -eq 0 ]; then
  pnpm run build:artifacts || fail "the build failed at ${commit}; dsh may not start until a build succeeds"
fi
[ -f "$cli" ] || fail "apps/cli/lib/bin.js is missing; run without --skip-build"

mkdir -p "$bin_dir"
write_dsh_wrapper "${work}/${name}" "$name" "$root"
mv -f "${work}/${name}" "$command_path"
pnpm exec tsx scripts/release/create-tui-plugin.ts --out "${work}/release" --version "$version" \
  || fail "packing the terminal failed at ${commit}"
node "${work}/release/install.mjs" --dsh "$command_path" --require-match \
  || fail "installing the terminal into ${command_path} failed"
record updated "Merged ${behind} official commit(s); installed ${version}, which applies the next time dsh tui starts"

case ":${PATH}:" in
  *":${bin_dir}:"*) ;;
  *) echo
     echo "Add ${bin_dir} to PATH to run it from anywhere:"
     echo "  export PATH=\"${bin_dir}:\$PATH\"" ;;
esac
echo
echo "Done. In a project directory, run: ${name} tui"
