import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'

export function createOperations({ file, services, now, staffToken, adminToken, isStaff }) {
  let state = {
    projects: services.map(service => ({
      ...service, priceCents: service.price * 100, visits: 1, description: ''
    })),
    campaigns: [], sessions: {}, orders: [], schedules: [], bookings: []
  }
  if (file) {
    try {
      state = JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  return function operate({ method, path, header, input }) {
    const next = structuredClone(state)
    const { projects, campaigns, sessions, orders, schedules, bookings } = next
    const answer = (status, data) => ({ status, data })
    const reject = (status, message) => answer(status, { message })
    const save = data => {
      if (file) {
        writeFileSync(file + '.tmp', JSON.stringify(next), { mode: 0o600 })
        renameSync(file + '.tmp', file)
      }
      state = next
      return answer(200, data)
    }
    const token = header?.startsWith('Bearer ') ? header.slice(7) : ''
    const session = Object.hasOwn(sessions, token) ? sessions[token] : null
    const ownedOrders = session ? orders.filter(order => order.owner === token) : []
    const isAdmin = isStaff(header, adminToken)
    const staff = isStaff(header, staffToken)
    const buyer = ownedOrders.some(order => order.status === 'paid')
    const audience = buyer ? 'customer' : 'visitor'
    const activeCampaigns = campaigns.filter(campaign =>
      campaign.audience === audience && Date.parse(campaign.endsAt) > now().getTime())
    const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : ''
    const positive = (value, max) => Number.isInteger(value) && value > 0 && value <= max
    const overlaps = (start, end, other) => start < other.end && end > other.start

    if (method === 'GET' && path === '/catalog') return answer(200, { projects, campaigns: activeCampaigns, buyer })
    if (method === 'POST' && path === '/session') {
      if (session) return answer(200, { token })
      const id = randomUUID()
      sessions[id] = true
      return save({ token: id })
    }
    if (path === '/admin' && method === 'GET') {
      if (!isAdmin) return reject(401, '请输入管理员令牌')
      return answer(200, { projects, campaigns, schedules, bookings: bookings.map(({ owner, ...booking }) => booking) })
    }
    if (path === '/staff' && method === 'GET') {
      if (!staff) return reject(401, '请输入店员令牌')
      return answer(200, { schedules, bookings: bookings.map(({ owner, ...booking }) => booking) })
    }
    if (method === 'POST' && path.startsWith('/admin/')) {
      if (!isAdmin) return reject(401, '请输入管理员令牌')
      if (path === '/admin/projects') {
        const existing = projects.find(project => project.id === input?.id)
        if (input?.id && !existing) return reject(404, '项目不存在')
        const name = text(input?.name, 80)
        const { duration, priceCents, visits } = input || {}
        if (!name || !positive(duration, 480) || !positive(priceCents, 10000000) || !positive(visits, 100)) {
          return reject(400, '请填写有效的项目名称、时长、金额和次数')
        }
        const project = { id: existing?.id || randomUUID(), name, duration, priceCents, visits, description: text(input.description, 400) }
        if (existing) Object.assign(existing, project)
        else projects.push(project)
        return save(project)
      }
      if (path === '/admin/campaigns') {
        const project = projects.find(item => item.id === input?.projectId)
        const name = text(input?.name, 80)
        const { priceCents, audience, endsAt } = input || {}
        if (!project || !name || !['visitor', 'customer'].includes(audience) ||
            !positive(priceCents, project.priceCents) || !(Date.parse(endsAt) > now().getTime())) {
          return reject(400, '请填写项目、活动价、受众和未来截止时间')
        }
        const campaign = { id: randomUUID(), projectId: project.id, name, priceCents, audience, endsAt }
        campaigns.push(campaign)
        return save(campaign)
      }
      if (path === '/admin/schedules') {
        const start = Date.parse(input?.start)
        const end = Date.parse(input?.end)
        if (!(start > now().getTime() && end > start && end - start <= 12 * 3600000)) {
          return reject(400, '请设置未来的排班，结束时间应在开始时间后 12 小时以内')
        }
        if (schedules.some(item => overlaps(start, end, item))) return reject(409, '排班重叠')
        const schedule = { id: randomUUID(), start, end, label: input.start.slice(0, 16).replace('T', ' ') + ' 至 ' + input.end.slice(11, 16) }
        schedules.push(schedule)
        return save(schedule)
      }
    }

    const transition = path.match(/^\/bookings\/([a-f0-9-]+)\/(accept|finish|confirm|decline)$/)
    if (method === 'POST' && transition) {
      const [, id, action] = transition
      const booking = bookings.find(item => item.id === id)
      if (action === 'confirm') {
        if (!session || !booking || booking.owner !== token) return reject(404, '找不到该预约')
      } else if (!staff) return reject(401, '请输入店员令牌')
      if (!booking) return reject(404, '找不到该预约')
      const transitions = {
        accept: ['pending', 'accepted'], decline: ['pending', 'declined'],
        finish: ['accepted', 'awaiting_customer'], confirm: ['awaiting_customer', 'completed']
      }
      const [before, after] = transitions[action]
      if (booking.status === after) return answer(200, { status: after })
      if (booking.status !== before) return reject(409, '预约已更新，请刷新后重试')
      if (action === 'finish' && booking.start > now().getTime()) return reject(409, '还未到预约时间')
      if (action === 'confirm') {
        const order = orders.find(item => item.id === booking.orderId)
        order.used += 1
      }
      booking.status = after
      return save({ status: after })
    }

    const reserved = order => bookings.filter(booking =>
      booking.orderId === order.id && ['pending', 'accepted', 'awaiting_customer'].includes(booking.status)).length
    const availability = order => {
      if (order.status !== 'paid' || order.visits - order.used <= reserved(order)) return []
      const length = order.duration * 60000
      const slots = []
      for (const schedule of schedules) {
        for (let start = schedule.start; start + length <= schedule.end; start += 30 * 60000) {
          const end = start + length
          if (start > now().getTime() && !bookings.some(booking =>
            booking.status !== 'declined' && overlaps(start, end, booking))) {
            const label = new Date(start + 8 * 3600000).toISOString().slice(0, 16).replace('T', ' ')
            slots.push({ start, end, label })
          }
        }
      }
      return slots.sort((a, b) => a.start - b.start)
    }

    if (!session) return reject(401, '请先建立联调会话')
    if (method === 'GET' && path === '/account') {
      return answer(200, {
        orders: ownedOrders.map(({ owner, ...order }) => ({ ...order, available: order.visits - order.used - reserved(order) })),
        bookings: bookings.filter(item => item.owner === token).map(({ owner, ...booking }) => booking)
      })
    }
    if (method === 'POST' && path === '/orders') {
      const project = projects.find(item => item.id === input?.projectId)
      const campaign = activeCampaigns.find(item => item.id === input?.campaignId && item.projectId === project?.id)
      if (!project || (input?.campaignId && !campaign)) return reject(400, '项目或优惠已失效')
      const order = {
        id: randomUUID(), owner: token, projectId: project.id, name: project.name,
        duration: project.duration, visits: project.visits, used: 0,
        priceCents: campaign?.priceCents ?? project.priceCents,
        campaignId: campaign?.id ?? null, status: 'unpaid'
      }
      orders.push(order)
      return save({ id: order.id, priceCents: order.priceCents })
    }
    const orderPath = path.match(/^\/orders\/([a-f0-9-]+)\/(demo-pay|slots|book)$/)
    if (orderPath) {
      const [, id, action] = orderPath
      const order = ownedOrders.find(item => item.id === id)
      if (!order) return reject(404, '找不到该订单')
      if (method === 'POST' && action === 'demo-pay') {
        if (order.status === 'paid') return answer(200, { status: 'paid' })
        order.status = 'paid'
        return save({ status: 'paid' })
      }
      if (method === 'GET' && action === 'slots') return answer(200, availability(order))
      if (method === 'POST' && action === 'book') {
        const slot = availability(order).find(item => item.start === input?.start)
        if (!slot) return reject(409, '该时段或服务次数已不可用，请刷新')
        const booking = {
          ...slot, id: randomUUID(), orderId: order.id, owner: token, name: order.name, status: 'pending'
        }
        bookings.push(booking)
        return save({ id: booking.id, status: booking.status })
      }
    }
    return reject(404, '接口不存在')
  }
}
