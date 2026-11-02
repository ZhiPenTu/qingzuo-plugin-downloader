# AGENTS.md

本仓库是轻作独立 `official.downloader` 插件，提供文件下载、任务查看和保存位置设置。真正的链接探测、Range 分片、续传、磁盘写入和目录授权都由轻作底座 API 1.8 的 `client.downloads` 完成；插件不直接读取文件、不保存下载地址，也不内置网络代理。

## 项目边界

- `ui/` 是静态 HTML / ES module 界面；`tests/` 包含格式、清单、固定 host 和公开市场验收；`scripts/` 负责固定 SDK、打包、Release 输入校验。
- manifest 只申请 `permissions.downloads: 'manage'`。`manage` 只对市场或内置来源生效；本地侧载不会获得全局设置或全部任务管理权限。
- SDK 1.8.0 tarball 随项目固定保存，发布时核对公开 `sdk-v1.8.0` Release 的 SHA-256；不要改用浮动版本或运行时下载。
- 插件没有后端 worker、没有服务提供、没有新增市场网络源。不要加入 Cookie、登录态、Authorization 或任意鉴权请求头支持。

## 安全与用户数据

- 插件界面只展示宿主返回的域名、文件名、目录名称、进度、速度和错误；不要把完整下载 URL、查询参数或本地路径写入存储、日志、截图或测试证据。
- 下载任务独立于插件页面。关闭页面不能取消任务；停用调用插件时由底座暂停任务；卸载时由底座清理未完成分片和任务记录，但保留已完成文件。
- 文件重名不能覆盖已有文件；目录身份改变、临时文件符号链接、远程 ETag / Last-Modified / 大小变化时必须暂停或重新开始，不能混合两个远程版本。
- 测试只能访问本地固定 Range 服务或公开签名市场，不发起真实大文件、付费或需要登录的下载。

## 验证与发布

```sh
npm ci --ignore-scripts
npm test
npm run pack
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:host
QINGZUO_HOST_EXECUTABLE=/path/to/Qingzuo npm run test:market
```

发布标签必须与 `package.json` 版本一致。`.github/workflows/release.yml` 在 macOS arm64 与 Windows x64 上核对固定底座 Release、SDK Release 和 `QINGZUO_HOST_RUN_ID`，运行本地 Range 服务验收后上传 `.ecplugin` 与目录片段。市场仓库负责原始字节、Ed25519 签名和目录 PR；本仓库不保存市场私钥，也不直接修改线上目录。

`test:market` 只验证公开签名市场安装、插件启动、下载能力和底座摘要保持不变，不等同于真实第三方服务器的断点续传、限速或长期稳定性验收。
