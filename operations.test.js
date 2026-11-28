import assert from 'node:assert/strict'
import { once } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSalonServer } from './server.js'

test('定向活动、购买、排班、店员接单和双方确认扣次', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'salon-'))
  const demoFile = join(dir, 'demo.json')
  let clock = '2026-11-28T02:00:00+08:00'
  const options = { demoFile, now: () => new Date(clock), adminToken: 'test-admin', staffToken: 'test-staff' }
  const startServer = async () => {
    const server = createSalonServer(options)
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    return server
  }
  let server = await startServer()
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    rmSync(dir, { recursive: true, force: true })
  })
  async function call(path, { token, input, method = input ? 'POST' : 'GET', status = 200 } = {}) {
    const response = await fetch('http://127.0.0.1:' + server.address().port + '/salon/api/operations' + path, {
      method, headers: token ? { authorization: 'Bearer ' + token } : {},
      body: input ? JSON.stringify(input) : undefined
    })
    assert.equal(response.status, status, path)
    return response.json()
  }
  const admin = 'test-admin'
  const staff = 'test-staff'
  await call('/admin', { token: staff, status: 401 })
  const project = await call('/admin/projects', {
    token: admin, input: { name: '联调护理', duration: 60, priceCents: 12000, visits: 1 }
  })
  const campaign = await call('/admin/campaigns', {
    token: admin, input: {
      projectId: project.id, audience: 'visitor', priceCents: 9900,
      name: '新客优惠', endsAt: '2026-11-30T23:59:59+08:00'
    }
  })
  assert.equal((await call('/catalog')).campaigns[0].id, campaign.id)
  const { token } = await call('/session', { method: 'POST' })
  const order = await call('/orders', { token, input: { projectId: project.id, campaignId: campaign.id } })
  assert.equal(order.priceCents, 9900)
  const orderPath = '/orders/' + order.id
  assert.deepEqual(await call(orderPath + '/slots', { token }), [])
  await call(orderPath + '/demo-pay', { token, method: 'POST' })
  await call(orderPath + '/demo-pay', { token, method: 'POST' })
  assert.deepEqual((await call('/catalog', { token })).campaigns, [])
  await call('/admin/schedules', { token: admin, input: {
    start: '2026-11-28T10:00:00+08:00', end: '2026-11-28T12:00:00+08:00'
  } })
  const slots = await call(orderPath + '/slots', { token })
  assert.equal(slots.length, 3)
  const booking = await call(orderPath + '/book', { token, input: { start: slots[0].start } })
  await call(orderPath + '/book', { token, input: { start: slots[1].start }, status: 409 })
  assert.equal((await call('/staff', { token: staff })).bookings[0].id, booking.id)
  assert.equal((await call('/admin', { token: admin })).bookings[0].status, 'pending')
  const task = '/bookings/' + booking.id
  await call(task + '/accept', { token: staff, method: 'POST' })
  await call(task + '/finish', { token: staff, method: 'POST', status: 409 })
  clock = '2026-11-28T11:05:00+08:00'
  await call(task + '/finish', { token: staff, method: 'POST' })
  assert.equal((await call('/account', { token })).orders[0].used, 0)
  const stranger = await call('/session', { method: 'POST' })
  await call(task + '/confirm', { token: stranger.token, method: 'POST', status: 404 })
  await call(task + '/confirm', { token, method: 'POST' })
  await call(task + '/confirm', { token, method: 'POST' })

  await new Promise(resolve => server.close(resolve))
  server = await startServer()
  const account = await call('/account', { token })
  assert.equal(account.orders[0].used, 1)
  assert.equal(account.bookings[0].status, 'completed')
})
