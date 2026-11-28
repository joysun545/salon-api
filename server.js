import { createServer } from 'node:http'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { pathToFileURL } from 'node:url'

const services = [
  { id: 'facial', name: '基础面部护理', duration: 60, price: 168 },
  { id: 'hydration', name: '补水护理', duration: 60, price: 228 }
]

function slotsFor(now) {
  const shopTime = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  return Array.from({ length: 14 }, (_, offset) => {
    const day = new Date(shopTime)
    day.setUTCDate(day.getUTCDate() + offset)
    const date = day.toISOString().slice(0, 10)
    return ['10:00', '11:00', '14:00', '15:00', '16:00'].map(time => {
      const id = date + 'T' + time + ':00+08:00'
      return { id, label: date + ' ' + time }
    })
  }).flat().filter(slot => Date.parse(slot.id) > now.getTime())
}

async function readJson(request) {
  let body = ''
  for await (const chunk of request) {
    body += chunk
    if (Buffer.byteLength(body) > 4096) {
      request.resume()
      return null
    }
  }
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

function isStaff(header, token) {
  if (!token || !header) return false
  const actual = Buffer.from(header)
  const expected = Buffer.from('Bearer ' + token)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export function createSalonServer({ staffToken, now = () => new Date() } = {}) {
  const bookings = new Map()
  const occupied = new Set()

  return createServer(async (request, response) => {
    const requestPath = (request.url || '').split('?')[0]
    const path = requestPath.startsWith('/salon/api/')
      ? requestPath.slice('/salon'.length)
      : requestPath
    const send = (status, data) => {
      response.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store'
      })
      response.end(JSON.stringify(data))
    }
    const fail = (status, message) => send(status, { message })
    const method = request.method

    try {
      if (method === 'GET' && path === '/api/services') return send(200, services)
      if (method === 'GET' && path === '/api/slots') {
        return send(200, slotsFor(now()).filter(slot => !occupied.has(slot.id)))
      }

      if (method === 'POST' && path === '/api/bookings') {
        const input = await readJson(request)
        const service = services.find(item => item.id === input?.serviceId)
        const slot = slotsFor(now()).find(item => item.id === input?.slotId)
        if (!service || !slot) return fail(400, '请选择有效的服务和时段')
        if (occupied.has(slot.id)) return fail(409, '该时段已被预约，请重新选择')

        const booking = {
          id: randomUUID(),
          serviceName: service.name,
          slotLabel: slot.label,
          status: 'pending'
        }
        occupied.add(slot.id)
        bookings.set(booking.id, booking)
        return send(201, booking)
      }

      if (method === 'GET' && path === '/api/staff/bookings') {
        if (!isStaff(request.headers.authorization, staffToken)) {
          return fail(401, '需要店员凭据')
        }
        return send(200, [...bookings.values()])
      }

      const match = path.match(/^\/api\/bookings\/([a-f0-9-]{36})(\/confirm)?$/)
      if (match) {
        const confirm = method === 'POST' && Boolean(match[2])
        const read = method === 'GET' && !match[2]
        if (confirm && !isStaff(request.headers.authorization, staffToken)) {
          return fail(401, '需要店员凭据')
        }
        if (confirm || read) {
          const booking = bookings.get(match[1])
          if (!booking) return fail(404, '没有找到该预约')
          if (confirm) booking.status = 'confirmed'
          return send(200, booking)
        }
      }
      return fail(404, '接口不存在')
    } catch {
      if (!response.destroyed && !response.headersSent) fail(500, '服务暂时不可用')
    }
  })
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port = Number(process.env.PORT ?? 3000)
  createSalonServer({ staffToken: process.env.SALON_STAFF_TOKEN })
    .listen(port, '127.0.0.1', () => console.log('Salon API: http://127.0.0.1:' + port))
}
