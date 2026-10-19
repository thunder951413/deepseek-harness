/** Terminal invocation and the Web listener settings it owns. */
import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable plugin identity. */
export const name = 'tui-startup'
/** Launcher arguments required by this provider. */
export const inject = ['cmdlineArgs']

/** Terminal invocation options. */
export interface TuiStartup {
  /** Existing conversation to open; omission starts a new conversation. */
  readonly session?: string
  /** Existing Web launch URL. */
  readonly connect?: string
  /** Profile for an owned backend. */
  readonly backendProfile: string
  /** Owned backend listener port. */
  readonly port: number
}

/**
 * Parse terminal arguments before binding its loopback Web server.
 * @param ctx - launcher context.
 */
export function apply(ctx: Context): void {
  const program = new Command()
    .name('dsh tui')
    .description('Chat in the terminal with an automatically started Web service.')
    .option('--session <id>', 'resume an existing conversation')
    .option('--connect <url>', 'connect to an existing Harness launch URL')
    .option('--backend-profile <name>', 'profile for an owned Web backend', 'web')
    .option('--port <port>', 'Web listener port (default: an OS-assigned port)', '0')
  program.action(() => {
    const options = program.opts<{ session?: string; connect?: string; backendProfile: string; port: string }>()
    if (!/^\d+$/.test(options.port) || Number(options.port) > 65535) {
      program.error('error: --port must be an integer from 0 through 65535')
    }
    if (options.session !== undefined && options.session.trim() === '') {
      program.error('error: --session must not be empty')
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      program.error('error: dsh tui requires an interactive terminal; use dsh headless for piped tasks')
    }
    if (options.backendProfile === 'tui') program.error('error: backend profile must not be the terminal profile')
    ctx.provide('tuiStartup', { ...options, port: Number(options.port) } satisfies TuiStartup)
  })
  parseCmdline(ctx, program)
}
