# 美容院预约 API

本地联调版，使用 Node.js 24，无需安装依赖。服务和时段是演示数据，预约在进程内保存，重启后清空。时段以北京时间计算，单门店每个时段只接一单。

```bash
npm test
read -rs SALON_STAFF_TOKEN
export SALON_STAFF_TOKEN
npm start
```

输入自选的本地测试令牌后按回车。API 默认监听 `127.0.0.1:3000`。微信开发者工具导入 [小程序前端](https://github.com/joysun545/salon-miniapp) 后可提交预约和刷新状态。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/services | 查询服务 |
| GET | /api/slots | 查询未来 14 天内可预约的时段 |
| POST | /api/bookings | 发送 JSON，包含 `serviceId` 和 `slotId` |
| GET | /api/bookings/{id} | 按预约编号查询状态 |
| GET | /api/staff/bookings | 查询门店预约列表 |
| POST | /api/bookings/{id}/confirm | 确认预约 |

通过另一个终端查看待确认预约并确认。将示例中的 `预约编号` 换成列表返回的 `id`，并在该终端设置同一测试令牌。

```bash
read -rs SALON_STAFF_TOKEN
curl -H "Authorization: Bearer $SALON_STAFF_TOKEN" http://127.0.0.1:3000/api/staff/bookings
curl -X POST -H "Authorization: Bearer $SALON_STAFF_TOKEN" \
  http://127.0.0.1:3000/api/bookings/预约编号/confirm
```

联调时只用演示数据。上线前需要持久化、微信登录和正式的店员权限管理，并配置 HTTPS 请求域名。
