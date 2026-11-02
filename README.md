# 文件下载器

轻作独立插件 `official.downloader`，版本 0.1.0，需要支持插件 API 1.8 的轻作。

把公开 HTTPS 直链粘贴到「文件下载器」，先检测服务器是否支持断点续传。支持时最多使用 4 路连接分段下载；不支持时自动改为单连接普通下载。下载任务由轻作主进程托管，关闭插件页面不会中断，退出应用后可在下次启动继续未完成任务。

## 使用

1. 打开「文件下载器」，在「默认保存位置」选择下载文件夹。
2. 选择下载连接数（1–4）。
3. 粘贴下载链接并检测能力，确认文件名和保存目录后开始下载。
4. 在任务列表查看全部任务，可暂停、继续、取消或打开已完成文件所在文件夹。

首版只支持公开 HTTPS 直链。需要 Cookie、浏览器登录态、Authorization 或其它鉴权请求头的链接无法下载。单个文件上限为 20 GB。清除任务记录或卸载插件不会删除已经完成的文件；未完成的分片会随任务清理。

## 开发与验证

```sh
npm ci --ignore-scripts
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:market
```

SDK 1.8.0 的固定 tarball 保存在 `vendor/`，发布前使用 `QINGZUO_VERIFY_SDK_RELEASE=1 npm run verify:sdk` 对照公开 `sdk-v1.8.0` Release。发布流水线还要求固定底座版本、成功的 Release 构建和 `QINGZUO_HOST_RUN_ID`。

插件使用静态 HTML 和 ES module，不包含后端 worker，也不在运行时下载依赖。市场签名、目录收录和底座下载实现分别在 `ZhiPenTu/qingzuo-market` 与 `ZhiPenTu/qingzuo-desktop` 仓库维护。
