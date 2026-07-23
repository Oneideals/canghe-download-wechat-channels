# 自有解析器配置

默认使用“腾讯元宝浏览器登录态 → 腾讯视频号官方接口”的本地交接流程，不需要部署解析器。只有运行环境没有 Browser 能力，或团队已经维护可信服务时，才配置自有解析器。

## 接口约定

解析器接收视频号分享链接：

```http
POST /api/fetch_video_profile
Content-Type: application/json

{"url":"https://weixin.qq.com/sph/示例ID"}
```

成功响应至少包含：

```json
{
  "data": {
    "feedInfo": {
      "description": "视频标题",
      "coverUrl": "https://...",
      "createtime": 1700000000,
      "h264VideoInfo": {"videoUrl": "https://..."},
      "h265VideoInfo": {"videoUrl": "https://..."}
    },
    "authorInfo": {"nickname": "作者"}
  }
}
```

`h265VideoInfo` 可以缺省。错误响应使用非 2xx 状态码并返回 `{"error":"..."}`。

## 配置

```bash
python3 "<skill绝对路径>/scripts/channels.py" config set-resolver 'https://channels-resolver.example.com/api/fetch_video_profile'
```

Windows PowerShell：

```powershell
py -3 "<skill绝对路径>\scripts\channels.py" config set-resolver "https://channels-resolver.example.com/api/fetch_video_profile"
```

优先级为：单次 `--resolver`、环境变量 `DOWNLOAD_WECHAT_CHANNELS_RESOLVER`、用户配置、默认官方浏览器模式。

远程解析器必须使用 HTTPS；只有 `localhost`、`127.0.0.1` 和 `::1` 允许 HTTP。URL 不允许包含凭据、查询参数或片段。

自有服务需要鉴权时，只通过环境变量提供：

```text
DOWNLOAD_WECHAT_CHANNELS_RESOLVER_TOKEN=<secret>
```

客户端发送 `Authorization: Bearer <secret>`，并拒绝跨来源重定向。不要把 Token 写入 URL、配置、Git 仓库或对话。

检查与恢复：

```bash
python3 "<skill绝对路径>/scripts/channels.py" config show
python3 "<skill绝对路径>/scripts/channels.py" config reset
```

`config reset` 恢复官方浏览器模式。

## 服务端要求

- 将腾讯侧登录凭据放在服务端 Secret 管理中，不要写入源码。
- 添加访问令牌、速率限制和日志脱敏。
- 不记录完整分享链接、媒体 URL、Cookie 或 Token。
- 监控 401、403、429 和 5xx，并建立凭据过期更新流程。
- 对外提供服务前确认平台规则、版权边界和所用代码许可证。
- 不使用 `sph.litao.workers.dev` 作为生产依赖；该公共实例已出现持久 401。
