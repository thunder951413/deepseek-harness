# Sourced by the terminal setup and sync scripts; defines use_pinned_pnpm.
#
# Use exactly the pnpm version this checkout pins. A pnpm that is missing, of another version, or
# installed without its platform binary (for example through corepack or npm --omit=optional, which
# fails with "no @pnpm/exe.<platform> native binary was found") is replaced by a private copy that
# npm installs with its optional platform package; `dsh plugin add` finds it through PATH as well.
#
#   use_pinned_pnpm <checkout> <scratch-dir> <message-prefix>
#
# Exports PATH (when a private copy is installed) and npm_config_manage_package_manager_versions.
use_pinned_pnpm() {
  local root="$1" work="$2" prefix="$3" version
  version="$(node -p "require('${root}/package.json').packageManager.replace(/^pnpm@/, '')")"
  if [ "$(cd "$work" && pnpm --version 2>/dev/null || true)" != "$version" ]; then
    echo "${prefix}: installing pnpm ${version} into a temporary directory"
    npm install --prefix "${work}/pnpm" --no-audit --no-fund --include=optional --loglevel=error "pnpm@${version}"
    export PATH="${work}/pnpm/node_modules/.bin:${PATH}"
    if [ "$(cd "$work" && pnpm --version 2>/dev/null || true)" != "$version" ]; then
      echo "${prefix}: pnpm ${version} does not run on this system; install it from https://pnpm.io/installation" >&2
      return 1
    fi
  fi
  export npm_config_manage_package_manager_versions=false
}
