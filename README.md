# fast

零运行时依赖的 Cloudflare Worker 白名单反向代理。

```text
https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/dists/noble/InRelease
→ https://archive.ubuntu.com/ubuntu/dists/noble/InRelease
```

- 每个 host 文件独立决定允许的 method，当前均为 GET / HEAD；上游使用 HTTPS。
- 流式传输响应，保留状态码、缓存头和 Range / 条件请求，支持大文件及断点续传。
- 转发 Cookie、Authorization 等请求头，Host 改为目标源域名；保留上游 Set-Cookie。
- 上游重定向只允许白名单内的标准 HTTP / HTTPS 地址，并改写回代理地址；HTTP 目标在下一次代理请求中升级为 HTTPS。其他目标返回 502。
- 非白名单返回 403，不支持的方法返回 405，上游连接失败返回 502；代理自身的错误响应体只返回对应状态码，不返回原因，不记录日志。
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

文件名就是完整 host，不加扩展名。每个文件导出处理函数，独立控制 method 和具体逻辑。
