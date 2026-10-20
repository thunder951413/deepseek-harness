/** The owned backend's listener address: a LAN interface by default, loopback on request or without one. */
import type { NetworkInterfaceInfo } from 'node:os'
import { expect, it } from 'vitest'
import { listenHost } from '../src/listen.ts'

const v4 = (address: string, internal = false): NetworkInterfaceInfo =>
  ({ address, family: 'IPv4', internal, netmask: '255.255.255.0', mac: '00:00:00:00:00:00', cidr: null })
const v6 = (address: string): NetworkInterfaceInfo =>
  ({ address, family: 'IPv6', internal: false, netmask: 'ffff::', mac: '00:00:00:00:00:00', scopeid: 0, cidr: null })

it('prefers a wired or wireless IPv4 address and skips loopback, tunnels, bridges, and link-local addresses', () => {
  expect(listenHost('lan', {
    lo0: [v4('127.0.0.1', true)], utun3: [v4('10.8.0.2')], bridge100: [v4('192.168.64.1')], docker0: [v4('172.17.0.1')],
    llw0: [v6('fe80::1')], awdl0: [v4('169.254.3.4')], en1: [v4('169.254.9.9')], en0: [v6('fe80::2'), v4('192.168.1.20')],
  })).toBe('192.168.1.20')
  expect(listenHost('lan', { ens5: [v4('10.0.0.4')], eth0: undefined })).toBe('10.0.0.4')
  expect(listenHost('lan', { bond0: [v4('10.1.1.1')] })).toBe('10.1.1.1')
})

it('falls back to the loopback default without a LAN address, and passes explicit choices through', () => {
  expect(listenHost('lan', { lo0: [v4('127.0.0.1', true)], utun0: [v4('10.8.0.2')] })).toBeUndefined()
  expect(listenHost('loopback', { en0: [v4('192.168.1.20')] })).toBeUndefined()
  expect(listenHost('10.0.0.7', {})).toBe('10.0.0.7')
})
