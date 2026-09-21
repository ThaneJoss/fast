# fast

零运行时依赖的 Cloudflare Worker 白名单反向代理。

```text
https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/dists/noble/InRelease
→ https://archive.ubuntu.com/ubuntu/dists/noble/InRelease
```

- 只允许 `archive.ubuntu.com`、`security.ubuntu.com`，在 `index.js` 中直接导入并注册对应模块。
- 每个 host 文件独立决定允许的 method，当前均为 GET / HEAD；上游使用 HTTPS。
- 流式传输响应，保留状态码、缓存头和 Range / 条件请求，支持大文件及断点续传。
- 不转发 Cookie、Authorization 等私密请求头，不下发上游 Cookie。
- 上游重定向只允许白名单内的标准 HTTP / HTTPS 地址，并改写回代理地址；HTTP 目标在下一次代理请求中升级为 HTTPS。其他目标返回 502。
- 非白名单返回 403，不支持的方法返回 405，上游连接失败返回 502；代理自身的错误响应体为空，不返回原因，不记录日志。
- 不改写 HTML 中的链接；本项目用于软件源资源下载。

`wrangler.toml` 已声明目标域名和 Worker 入口；未执行部署或 DNS 操作。

## 一键配置 Ubuntu 源

以 root 执行：

```bash
curl -fsSL https://fast.thanejoss.com/ | bash
```

普通用户使用 `curl -fsSL https://fast.thanejoss.com/ | sudo bash`。

主页返回 `setup.sh`。脚本按域名检查 `/etc/apt/sources.list.d/ubuntu.sources` 的 `URIs:` 行，已有对应代理地址就跳过，仅追加缺少的源。
各域名使用普通命令块 `{ ...; }`，仅在需要追加时读取 `/etc/os-release` 获取版本代号；不使用子 shell。

保留文件原有内容，重复执行不会重复追加；不覆盖、不备份、不刷新索引，不含函数或提示输出。

## 按 host 组织逻辑

- `hosts/archive.ubuntu.com`
- `hosts/security.ubuntu.com`

文件名就是完整 host，不加扩展名。每个文件导出处理函数，独立控制 method 和具体逻辑：

```js
export default function ({ request, target, proxy }) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  return proxy(request, target);
}
```

`request` 是原始请求，`target` 是已解析的 HTTPS 上游 URL，`proxy` 是公共代理函数。
新增 host 时，添加对应文件，然后在 `index.js` 中导入并注册到 `HOSTS`。主入口直接调用模块，不统一限制 method。

无构建脚本、无依赖、无生成文件。Wrangler 使用 `no_bundle` 和 ESModule 规则直接加载源码及 host 模块。入口 `index.js` 位于项目根目录，使用 `./hosts/域名` 导入，保持本地路径与上传后的模块路径一致，避免 `../` 越过模块根目录。公共代理函数处理请求头、流式响应和重定向白名单校验。未保留测试文件。

## main 分支规则

`.github/main-ruleset.json` 是待启用的规则配置，**提交此文件不会自动启用 GitHub 规则**。
要求所有 main 更新经过 PR，无绕过角色，禁止强推和删除；不强制他人审批，便于个人仓库使用。

仓库管理员可在 Settings → Rules → Rulesets 导入此 JSON，或使用具备仓库 Administration 写权限的 GitHub CLI：

```sh
gh api --method POST repos/ThaneJoss/fast/rulesets --input .github/main-ruleset.json
```

本次 GitHub 连接不提供规则管理写入能力，因此规则尚未启用。空仓库仅先初始化 README 基础提交，功能代码通过 PR 提交。
