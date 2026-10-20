# Sourced by scripts/setup-tui.sh; defines write_dsh_wrapper.
#
#   write_dsh_wrapper <path> <command-name> <checkout>
#
# Writes an executable `dsh` command that runs the checkout's built CLI. While
# scripts/setup-tui.sh holds its lock and rewrites that build, the command waits for it,
# except when the sync itself runs the command: the sync exports DSH_TUI_SYNC_PID as the lock owner.
DSH_WRAPPER_MARKER="# managed by scripts/setup-tui.sh"
write_dsh_wrapper() {
  local path="$1" name="$2" root="$3"
  cat > "$path" <<WRAPPER
#!/bin/sh
${DSH_WRAPPER_MARKER}
# scripts/setup-tui.sh rewrites the build output while it holds this lock.
lock="\${DSH_HOME:-\$HOME/.dsh}/addons/dsh-tui/auto-update.lock"
owner="\$(cat "\$lock/pid" 2>/dev/null || true)"
if [ -n "\$owner" ] && [ "\$owner" != "\${DSH_TUI_SYNC_PID:-}" ] && kill -0 "\$owner" 2>/dev/null; then
  echo "${name}: an update from the official repository is building; waiting for it (log: \${lock%.lock}.log)" >&2
  while [ -n "\$owner" ] && kill -0 "\$owner" 2>/dev/null; do sleep 2; owner="\$(cat "\$lock/pid" 2>/dev/null || true)"; done
fi
exec node '${root}/apps/cli/lib/bin.js' "\$@"
WRAPPER
  chmod +x "$path"
}
