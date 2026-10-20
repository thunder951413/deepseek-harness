#!/usr/bin/env bash
# Build this checkout and install the terminal client so that `dsh tui` works from any directory.
#
#   git clone <your fork> && cd deepseek-harness && scripts/setup-tui.sh
#
# The script installs dependencies, builds the artifacts, packs the terminal plugin from this
# checkout, writes a `dsh` command that runs this checkout's CLI, and installs the plugin into the
# `tui` profile under DSH_HOME (default ~/.dsh). The terminal and the `dsh` it talks to come from
# the same commit, so after rebasing onto a newer official release, run this script again.
#
# Options:
#   --name <command>    command to create (default: dsh); use another name to keep an installed dsh
#   --bin-dir <dir>     where to create the command (default: ~/.local/bin)
#   --skip-build        reuse existing build output (dependencies are still installed)
#   --force             replace an existing command that this script did not create
# macOS and Linux only.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
name="dsh"
bin_dir="${HOME}/.local/bin"
skip_build=0
force=0
# shellcheck source=dsh-wrapper.sh
. "${root}/scripts/dsh-wrapper.sh"
marker="$DSH_WRAPPER_MARKER"

while [ $# -gt 0 ]; do
  case "$1" in
    --name) name="${2:?--name needs a value}"; shift 2 ;;
    --bin-dir) bin_dir="${2:?--bin-dir needs a value}"; shift 2 ;;
    --skip-build) skip_build=1; shift ;;
    --force) force=1; shift ;;
    -h|--help) sed -n '2,/^set -euo/p' "$0" | sed '$d' | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "setup-tui: unknown option: $1" >&2; exit 2 ;;
  esac
done

case "$name" in
  *[!A-Za-z0-9._-]*|'') echo "setup-tui: --name must be a plain command name" >&2; exit 2 ;;
esac

command -v node >/dev/null || { echo "setup-tui: Node.js 22.19+ or 24+ is required" >&2; exit 1; }
node -e '
  const [major, minor] = process.versions.node.split(".").map(Number)
  if (!(major >= 24 || (major === 22 && minor >= 19))) {
    console.error(`setup-tui: Node.js 22.19+ or 24+ is required (found ${process.versions.node})`)
    process.exit(1)
  }'
command -v npm >/dev/null || { echo "setup-tui: npm is required" >&2; exit 1; }
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# shellcheck source=pinned-pnpm.sh
. "${root}/scripts/pinned-pnpm.sh"
use_pinned_pnpm "$root" "$work" setup-tui

command_path="${bin_dir}/${name}"
if [ -e "$command_path" ] && ! grep -q "$marker" "$command_path" 2>/dev/null && [ "$force" -eq 0 ]; then
  echo "setup-tui: ${command_path} already exists and was not created by this script." >&2
  echo "          Use --name <other-name> to keep it, or --force to replace it." >&2
  exit 1
fi

cd "$root"
pnpm install --frozen-lockfile
if [ "$skip_build" -eq 0 ]; then pnpm run build:artifacts; fi
[ -f apps/cli/lib/bin.js ] || { echo "setup-tui: apps/cli/lib/bin.js is missing; run without --skip-build" >&2; exit 1; }

mkdir -p "$bin_dir"
staging="${work}/staging"
mkdir -p "$staging"
write_dsh_wrapper "${staging}/${name}" "$name" "$root"
mv -f "${staging}/${name}" "$command_path"

version="0.0.0-local.$(git rev-parse --short HEAD 2>/dev/null || echo checkout)"
release="${staging}/release"
pnpm exec tsx scripts/release/create-tui-plugin.ts --out "$release" --version "$version"
node "${release}/install.mjs" --dsh "$command_path" --require-match

case ":${PATH}:" in
  *":${bin_dir}:"*) ;;
  *) echo
     echo "Add ${bin_dir} to PATH to run it from anywhere:"
     echo "  export PATH=\"${bin_dir}:\$PATH\"" ;;
esac
echo
echo "Done. In a project directory, run: ${name} tui"
