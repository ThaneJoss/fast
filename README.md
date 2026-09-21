# fast

零运行时依赖的 Cloudflare Worker 白名单反向代理。

```text
https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/dists/noble/InRelease
→ https://archive.ubuntu.com/ubuntu/dists/noble/InRelease
```

- 所有入口均不额外限制 HTTP method；代理请求的方法和请求体原样转发，上游使用 HTTPS。
- 流式传输响应，保留状态码、缓存头和 Range / 条件请求，支持大文件及断点续传。
- 转发 Cookie、Authorization 等请求头，Host 改为目标源域名及端口；保留上游 Set-Cookie。
- 白名单内的 HTTP / HTTPS 重定向改写回代理地址，保留端口、用户名和密码；HTTP 目标在下一次代理请求中升级为 HTTPS。其他域名或协议的重定向返回 502。
- 非白名单返回 403，上游连接失败返回 502；代理自身的错误响应体只返回对应状态码，不返回原因，不记录日志。
- 使用原生 `HTMLRewriter` 流式改写 HTML 的 `href`、`src`：`/` 开头的根路径，以及指向白名单域名的 HTTP / HTTPS、`//域名/路径` 地址，改为对应代理地址。普通相对路径、查询参数、锚点和其他域名的地址保持原样。

`wrangler.toml` 已声明目标域名和 Worker 入口；未执行部署或 DNS 操作。

## 一键配置 Ubuntu 源

以 root 执行：

```bash
curl -fsSL https://fast.thanejoss.com/ | sudo bash
```

## 按 host 组织逻辑

- `hosts/archive.ubuntu.com`
- `hosts/security.ubuntu.com`
- `hosts/registry.npmjs.org`

文件名就是完整 host，不加扩展名。每个文件导出处理函数，处理该域名的具体逻辑。路由按主机名匹配，支持 `/用户名:密码@域名:端口/路径` 形式。

## npm / Node

部署后，将 npm 源设为代理地址：

```bash
npm config set registry https://fast.thanejoss.com/registry.npmjs.org/
```

也可以仅对一次安装使用代理：

```bash
npm install lodash --registry=https://fast.thanejoss.com/registry.npmjs.org/
```

- 支持普通包、`@scope/name` 包、版本查询和 tarball 下载。
- 流式改写完整及精简 JSON 元数据中以 `http://registry.npmjs.org/` 或 `https://registry.npmjs.org/` 开头的 URL，使 `dist.tarball` 下载继续经过代理；其他域名保持原样。
- 包文件保持流式透传，支持 Range 和条件请求；改写的 JSON 移除上游 Content-Length、Content-Encoding 和 ETag。
- npm 请求的方法、请求体和认证头透传给上游，包括发布、删除包、登录和审计请求；操作权限由 npm 上游校验。JSON URL 改写按响应状态和类型处理，不区分请求方法。

恢复官方源：

```bash
npm config set registry https://registry.npmjs.org/
```
