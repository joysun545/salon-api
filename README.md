# 美容院预约 API

本地联调版，使用 Node.js 24，无需安装依赖。服务和时段是演示数据，预约在进程内保存，重启后清空。时段以北京时间计算，单门店每个时段只接一单。

```bash
npm test
read -rs SALON_STAFF_TOKEN
export SALON_STAFF_TOKEN
npm start
```

输入自选的本地测试令牌后按回车。API 默认监听 `127.0.0.1:3000`。[小程序前端](https://github.com/joysun545/salon-miniapp/tree/feat/booking-mvp) 默认使用下文的站点 HTTPS 地址。

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

## 接入 joytest.site

服务器上的项目目录为 `/root/salon-api`。从 GitHub 拉取 `feat/booking-mvp`，执行 `npm test`。建议使用 Node.js 24。后端只绑定回环地址，可用 `PORT` 指定空闲端口。以下以 `3100` 为例，先用 `ss -ltn 'sport = :3100'` 检查。若有监听项，请选择另一个空闲端口，并在启动命令和反向代理中使用同一端口。

```bash
cd /root/salon-api
read -rs SALON_STAFF_TOKEN
export SALON_STAFF_TOKEN
PORT=3100 npm start
```

上述命令以前台方式运行，适合先验证联通。正式长期运行时请用服务器的进程管理器启动，并从服务器环境注入店员令牌。

如果服务器用 Nginx 终结 HTTPS，将以下片段放进现有服务 `joytest.site` 的 HTTPS `server` 块。部署前检查是否已配置同样的路径，用 `nginx -t` 校验成功后再重新加载。其他反向代理使用同一匹配规则并保留请求路径。

```nginx
location ^~ /salon/api/ {
    proxy_pass http://127.0.0.1:3100;
}
```

部署后请求 `https://joytest.site/salon/api/services` 和 `https://joytest.site/salon/api/slots`，两者应返回 JSON 数组。小程序使用此地址。维护流程为云工作区开发和验证 → 推送 GitHub → Windows 和服务器从同一分支更新。
