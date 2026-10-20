/** The address the owned Web service listens on: a local network interface by default, or this computer only. */
import type { NetworkInterfaceInfo } from 'node:os'

/** Listener choice: `lan`, `loopback`, or one address literal of a local interface. */
export type ListenSetting = string

/** Interfaces that are tunnels, container or VM bridges, or link-local helpers, never a LAN people reach. */
const VIRTUAL = /^(?:lo|utun|tun|tap|ppp|ipsec|gif|stf|awdl|llw|anpi|ap\d|bridge|docker|br-|veth|virbr|vboxnet|vmnet|zt|tailscale|wg)/u
/** Wired and wireless adapters, preferred over any other physical interface. */
const PREFERRED = /^(?:en|eth|wl)/u

/**
 * Resolve the listener address passed to the backend's `--host`.
 * @param setting - `lan`, `loopback`, or an address literal, which the backend validates.
 * @param interfaces - the computer's interfaces, as `os.networkInterfaces()` reports them.
 * @returns the address to bind, or undefined for the backend's loopback default, which `lan` also falls back to
 * when no LAN interface has an IPv4 address.
 */
export function listenHost(setting: ListenSetting, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | undefined {
  if (setting === 'loopback') return undefined
  if (setting !== 'lan') return setting
  const candidates = Object.entries(interfaces)
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([name, addresses]) => (addresses ?? [])
      .filter(address => address.family === 'IPv4' && !address.internal && !address.address.startsWith('169.254.'))
      .map(address => ({ name, address: address.address })))
  return (candidates.find(candidate => PREFERRED.test(candidate.name)) ?? candidates[0])?.address
}
