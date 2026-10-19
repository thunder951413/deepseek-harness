/** Built-client wire rejection and Peer cleanup against an external HTTP/WebSocket fixture. */
import { createServer } from 'node:http'
import { once } from 'node:events'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import { expect, it, onTestFinished } from 'vitest'
import { WebRemotePort } from '@deepseek-ai/dsh-tui-app/src/web-remote.ts'

async function incompatibleHost(mode: 'unauthorized' | 'missing-method' | 'invalid-result') {
  const endpoints: string[] = []
  const cookies: Array<string | undefined> = []
  const sockets = new Set<Duplex>()
  const mux = new WebSocketServer({ noServer: true })
  const server = createServer((request, response) => {
    if (request.url?.startsWith('/connect?')) {
      response.writeHead(mode === 'unauthorized' ? 401 : 302, { 'set-cookie': 'probe=credential; HttpOnly', location: '/api/remote.mux' })
      response.end()
      return
    }
    cookies.push(request.headers.cookie)
    void (async () => {
      let body = ''
      for await (const chunk of request) body += String(chunk)
      const value = JSON.parse(body) as { rpcId: string; method: string }
      endpoints.push(value.method)
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ type: 'server-response', rpcId: value.rpcId,
        result: mode === 'invalid-result' ? { ok: true, value: { items: 'not-a-session-list' } }
          : { ok: false, error: { code: 'gateway/not-found', message: 'method unavailable', details: {} } } }))
    })().catch((error: unknown) => { response.destroy(error instanceof Error ? error : undefined) })
  })
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => { sockets.delete(socket) }) })
  server.on('upgrade', (request, socket, head) => {
    cookies.push(request.headers.cookie)
    mux.handleUpgrade(request, socket, head, (peer) => {
      peer.on('error', () => { peer.terminate() })
      peer.on('message', (data) => {
        const text = Array.isArray(data) ? Buffer.concat(data).toString('utf8')
          : Buffer.from(data instanceof ArrayBuffer ? new Uint8Array(data) : data).toString('utf8')
        const frame = JSON.parse(text) as { type: string; endpoint: string; streamId: string }
        if (frame.type === 'open' && frame.endpoint === '$events') peer.send(JSON.stringify({
          type: 'item', streamId: frame.streamId, value: { type: 'ready', clientId: 'compatibility-probe', host: { home: '/host' } },
        }))
      })
    })
  })
  onTestFinished(async () => {
    for (const peer of mux.clients) peer.terminate()
    for (const socket of sockets) socket.destroy()
    await new Promise<void>((resolve) => { mux.close(() => { resolve() }) })
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => { server.close((error) => { if (error === undefined) resolve(); else reject(error) }) })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Host did not bind a port')
  return { url: `http://127.0.0.1:${address.port}/?token=fixture-token`, endpoints, cookies, mux }
}

it('rejects missing authentication before opening a Peer or issuing business calls', async () => {
  const host = await incompatibleHost('unauthorized')
  await expect(WebRemotePort.connect(host.url, AbortSignal.timeout(5000))).rejects.toThrow('authentication failed (401)')
  expect(host.endpoints).toEqual([])
  expect(host.mux.clients.size).toBe(0)
})

it.each(['missing-method', 'invalid-result'] as const)('reports %s incompatibility before sending prompts and closes its Peer', async (mode) => {
  const host = await incompatibleHost(mode)
  await expect(WebRemotePort.connect(host.url, AbortSignal.timeout(5000))).rejects.toThrow('required terminal interfaces')
  expect(host.endpoints).toEqual(['session/list'])
  expect(host.cookies.every(cookie => cookie === 'probe=credential')).toBe(true)
  await expect.poll(() => host.mux.clients.size).toBe(0)
})
