# 故障排查

## 链接无法识别

- 链接必须形如 `https://weixin.qq.com/sph/...`。
- 可以粘贴微信复制出的整段文字；脚本自动提取链接。
- 链接中间不能有空格、换行或 Markdown 转义字符。

## 腾讯元宝要求登录

官方短链匿名接口只返回标题、作者和封面，不返回视频流。完整解析需要用户本人的腾讯元宝登录态。

- 浏览器显示“登录”时，请用户自行扫码或登录。
- 不要代填密码或验证码，不要读取 Cookie、Local Storage 或浏览器配置文件。
- Skill 会分段等待约 2 分钟；在等待期间完成扫码可自动继续。
- 超时后保持腾讯元宝标签页打开，用户回复已登录即可继续。
- 401 代表未登录或会话过期；不要连续重试。

## 浏览器桥接失败

- `YUANBAO_PAGE_NOT_READY`：标签页不是腾讯元宝首页，或页面尚未完成加载；刷新一次。
- `YUANBAO_CDP_INVALID`：浏览器能力返回格式变化；重新连接 Browser 后重试一次。
- `YUANBAO_RESPONSE_INVALID`：腾讯元宝返回了非 JSON 内容；检查是否出现登录页或风控提示。
- `YUANBAO_PROFILE_INVALID`：官方接口字段发生变化，需更新 Skill。
- Browser 不可用：只能配置可信自有解析器，不能退回未知在线下载网站。

## 临时解析文件

- `prepare` 创建仅当前用户可读写的 JSON 临时文件。
- 桥接模块会验证文件路径、流程标记和分享链接。
- Python 在视频下载成功后删除它；网络或权限失败时暂时保留，以便用同一命令重试。
- 成功、取消流程或凭据过期后应删除临时文件；其中的一次性凭据不会进入最终输出。
- `PROFILE_LINK_MISMATCH` 时不要修改 JSON，重新为当前链接执行 `prepare`。

## 视频号官方接口失败

- `OFFICIAL_FEED_HTTP_ERROR`、`OFFICIAL_FEED_ERROR`：一次性 token/eid 可能过期，重新执行 Browser 解析。
- `VIDEO_UNAVAILABLE`：可能是图片合集、直播、直播回放、已删除或受限内容。不要绕过访问控制。
- `DOWNLOAD_HTTP_ERROR`：媒体地址通常已过期，重新执行完整流程。
- `INCOMPLETE_DOWNLOAD`：网络中断或服务器提前关闭连接；残缺文件不会保留。

先用原命令重试一次。只有重试仍提示官方凭据过期，才重新执行 `prepare` 和浏览器解析。

## 输出目录不可写

默认目录是系统下载目录中的 `视频号`。使用 `--output-dir` 改到可写目录。Windows 路径包含空格时完整加双引号。

Codex 沙箱可能在首次写入系统下载目录时显示权限确认。审批超时不会消耗临时解析文件；获得明确授权后直接重试下载命令。

## Python 命令不存在

- macOS：优先使用 Codex 工作区 Python，其次尝试 `python3`。
- Windows：依次尝试 `py -3` 和 `python`。
- 需要 Python 3.9 或更高版本，不需要第三方 Python 包。

## 文件名和播放兼容性

脚本会移除 Windows 非法字符并保护 `CON`、`PRN`、`AUX`、`NUL`、`COM1`、`LPT1` 等保留名。同名文件自动生成 `(2)`、`(3)` 后缀。

默认 `--quality auto` 会优先原画并在原画不可确认时选择兼容格式。明确要求不降级时使用 `--quality original`；下载后无法播放时使用 `--quality compatible`。HTML、JSON、空文件、非 MP4 和 Content-Length 不完整结果都会被拒绝。
