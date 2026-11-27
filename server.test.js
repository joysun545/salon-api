import assert from 'node:assert/strict'
import { once } from 'node:events'
import { test } from 'node:test'
import { createSalonServer } from './server.js'

test('预约、门店确认、查看状态以及并发时段冲突', async t => {
  const server = createSalonServer({
    staffToken: 'test-only',
    now: () => new Date('2026-11-27T02:00:00Z')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  t.after(() => server.close())
  const request = (path, options) => fetch('http://127.0.0.1:' + server.address().port + '/api' + path, options)
  const [service] = await (await request('/services')).json()
  const [slot] = await (await request('/slots')).json()
  assert.equal(slot.label, '2026-11-27 11:00')

  const payload = {
    method: 'POST',
    body: JSON.stringify({ serviceId: service.id, slotId: slot.id })
  }
  assert.equal((await request('/bookings', { method: 'POST', body: '{}' })).status, 400)
  const attempts = await Promise.all([request('/bookings', payload), request('/bookings', payload)])
  assert.deepEqual(attempts.map(result => result.status).sort(), [201, 409])
  const booking = await attempts.find(result => result.status === 201).json()
  assert.equal(booking.status, 'pending')
  assert.ok(!(await (await request('/slots')).json()).some(item => item.id === slot.id))

  const path = '/bookings/' + booking.id
  const staff = { authorization: 'Bearer test-only' }
  assert.equal((await request(path + '/confirm', { method: 'POST' })).status, 401)
  assert.equal((await request('/staff/bookings')).status, 401)
  assert.deepEqual(await (await request('/staff/bookings', { headers: staff })).json(), [booking])
  const confirm = () => request(path + '/confirm', { method: 'POST', headers: staff })
  assert.equal((await (await confirm()).json()).status, 'confirmed')
  assert.equal((await confirm()).status, 200)
  assert.equal((await (await request(path)).json()).status, 'confirmed')
})
