# fast

零运行时依赖的 Cloudflare Worker 白名单反向代理。

```text
https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/dists/noble/InRelease
→ https://archive.ubuntu.com/ubuntu/dists/noble/InRelease
```

- 只允许 `archive.ubuntu.com`、`security.ubuntu.com`，在 `src/index.js` 的 `HOSTS` 中维护。
- 支持 GET / HEAD；路径和查询参数转发，上游始终使用 HTTPS。
- 流式传输响应，保留状态码、缓存头和 Range / 条件请求，支持大文件及断点续传。
- 不转发 Cookie、Authorization 等私密请求头，不下发上游 Cookie。
- 上游重定向只允许白名单内的标准 HTTP / HTTPS 地址，并改写回代理地址；HTTP 目标在下一次代理请求中升级为 HTTPS。其他目标返回 502。
- 非白名单返回 403，其他方法返回 405，上游连接失败返回 502。
- 不改写 HTML 中的链接；本项目用于软件源资源下载。

`wrangler.toml` 已声明目标域名和 Worker 入口；未执行部署或 DNS 操作。

## 验证

Node.js 22+，无需安装依赖：

```sh
npm test
```

测试使用模拟 fetch，未连接 Cloudflare 或真实软件源。

## main 分支规则

`.github/main-ruleset.json` 是待启用的规则配置，**提交此文件不会自动启用 GitHub 规则**。
要求所有 main 更新经过 PR，无绕过角色，禁止强推和删除；不强制他人审批，便于个人仓库使用。

仓库管理员可在 Settings → Rules → Rulesets 导入此 JSON，或使用具备仓库 Administration 写权限的 GitHub CLI：

```sh
gh api --method POST repos/ThaneJoss/fast/rulesets --input .github/main-ruleset.json
```

本次 GitHub 连接不提供规则管理写入能力，因此规则尚未启用。空仓库仅先初始化 README 基础提交，功能代码通过 PR 提交。
