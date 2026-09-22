# fast

零运行时依赖的 Cloudflare Worker 白名单反向代理。

入口通过 D1 校验客户端 IP；启用的白名单 IP 才能使用代理与根路径的初始化脚本，一次配置 Ubuntu 和 npm 源。`/admin`、`/admin/` 以及 `/admin/*` 下的页面资源和管理接口免于 IP 校验，供 Cloudflare Access 独立保护。

```text
https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/dists/noble/InRelease
→ https://archive.ubuntu.com/ubuntu/dists/noble/InRelease
```

- 代理与初始化脚本入口不额外限制 HTTP method；代理请求的方法和请求体原样转发，上游使用 HTTPS。
- 流式传输响应，保留状态码、缓存头和 Range / 条件请求，支持大文件及断点续传。
- 转发 Cookie、Authorization 等请求头，Host 改为目标源域名及端口；保留上游 Set-Cookie。
- 白名单内的 HTTP / HTTPS 重定向改写回代理地址，保留端口、用户名和密码；HTTP 目标在下一次代理请求中升级为 HTTPS。其他域名或协议的重定向返回 502。
- 不在 IP 白名单或目标域名白名单内的请求返回 HTTP 403，上游连接失败返回 HTTP 502，D1 校验失败时返回 HTTP 503；这些错误响应体为空，错误由 HTTP 状态码表示。
- 所有经过 Worker 的请求写入 D1 访问日志，包括拒绝请求和管理请求。日志通过 `waitUntil` 异步写入，不读取或缓冲下载响应体；写入失败输出 Worker 错误日志。
- 使用原生 `HTMLRewriter` 流式改写 HTML 的 `href`、`src`：`/` 开头的根路径，以及指向白名单域名的 HTTP / HTTPS、`//域名/路径` 地址，改为对应代理地址。普通相对路径、查询参数、锚点和其他域名的地址保持原样。

`wrangler.toml` 已声明目标域名、Worker 入口与 D1 绑定 `DB`（数据库名 `fast-access`）。首次上线须先创建数据库并执行迁移。

## 管理页

访问 `https://fast.thanejoss.com/admin`：

- **IP 管理**：默认按 IP 汇总全部访问，显示请求次数、放行 / 拒绝 / 管理 / 异常计数、最近路径和自动标签。直接在访问卡片上放行、取消放行、修改分组与备注，无需手动输入 IP。没有访问记录的已有配置也会保留。
- **IP 分组**：维护“家里、公司、朋友”等来源分组。删除分组会将成员移至“未分组”，保留 IP 及其启用状态。
- **路径标签**：根据请求路径自动标记 Ubuntu、npm、初始化脚本、管理后台或其他路径，显示在 IP 汇总卡片与逐条日志中，无需维护分类或匹配规则。历史记录同样适用。
- **访问日志**：默认每个 IP 一张汇总卡片，展开查看逐条请求，每次加载 50 条。可用平铺选项组合筛选当前访问权限、当前 IP 分组、路径标签、访问结果和最近 24 小时 / 7 天 / 30 天，支持搜索 IP、备注与路径片段。

两个页面均先对全部匹配记录按 IP 汇总，再按最近访问排序，每页 20 个 IP；翻页和展开明细沿用同一个日志边界，点击“刷新数据”查看新请求。设置分组与备注不会改变访问权限。历史日志保留访问时的分组名称；筛选分组按 IP 当前归属，便于管理。页面沿用 webapps 的蓝白配色、卡片和标签样式。

IP 使用 Cloudflare 的 `CF-Connecting-IP`，不接受 `X-Forwarded-For` 或 `X-Real-IP` 作为白名单依据。支持单个完整 IP，IPv6 自动规范化；不支持 CIDR 网段。若域名启用了 Pseudo IPv4 的 Overwrite Headers 模式，建议改为 Off / Add Header，以便按真实 IPv6 管理白名单。

“放行”表示通过 IP 检查，HTTP 状态码另列，因此上游错误或目标域名拒绝仍可显示为“放行”。耗时统计到响应头返回，不包含下载完成时间。日志记录时间、IP、方法、路径、分类、状态、国家、User-Agent 和耗时，不保存请求体、Cookie、Authorization、查询参数或 URL 用户名密码。日志保留在 D1 中，不自动清理；Access 在 Worker 之前拦截的请求不会进入这些日志。

管理页不内置登录，也不检查 IP 白名单。配置 Access 时请同时覆盖 `/admin` 和 `/admin/*`，包含 `/admin/api/*` 及页面资源；配置完成前，这些管理接口可被公开调用。保留 `workers_dev = false`、`preview_urls = false`，使管理流量统一经过配置 Access 的自定义域名。管理写操作需携带本站 `Origin`，POST / PUT 使用 JSON。

## 本地开发与部署

```bash
npm install
npm run dev
```

打开 `http://localhost:8787/admin`，在当前 IP 的访问卡片上点击“放行 IP”后访问 `/`。`npm run dev` 会先应用本地 D1 迁移；本地数据库与线上数据库独立。

首次上线，在已登录 Cloudflare 的环境执行：

```bash
npx wrangler login
npx wrangler d1 create fast-access --binding DB
```

将创建命令返回的 `database_id` 填入 `wrangler.toml` 现有的 `[[d1_databases]]`，然后执行：

```bash
npm run db:migrate:remote
npm run deploy
```

若 `fast-access` 已存在，使用 `npx wrangler d1 list` 查到其 ID 后更新现有绑定，无需重复创建。先应用远端迁移，再发布 Worker；初始 IP 白名单为空，上线后从 `/admin` 的访问记录中放行 IP。

从旧版升级时也需要先运行 `npm run db:migrate:remote`：`0002_log_path_tags.sql` 为新旧日志增加自动路径标签与索引，兼容旧 Worker 继续写入。旧路径分类数据保留在数据库中，但不再用于管理或日志分类。

```bash
npm run types       # 配置变更后生成本地绑定类型
npm run check       # JavaScript / Shell 语法检查与 Wrangler 部署预检，不会发布
```

实现分为：`index.js` 入口检查与日志、`access.js` IP 与日志查询、`admin.js` 管理接口、`admin/` 静态页面、`migrations/` D1 表结构、`proxy.js` 流式代理与脚本入口、`setup.sh` Ubuntu 与 npm 配置脚本。

## 一键配置 Ubuntu 与 npm 源

以 root 执行：

```bash
curl -fsSL https://fast.thanejoss.com/ | sudo bash
```

主页脚本一次完成两种源的配置，可重复执行。Ubuntu 沿用版本标记避免重复添加源；npm 合并为一条 `registry` 配置，内容已一致时不重写文件。

执行时逐项输出 `[已修改]` 或 `[未修改]`，分别显示 Ubuntu 主源、Ubuntu 安全源和 npm registry 的处理结果；npm 提示还包含配置文件路径和 registry 地址。

## 按 host 组织逻辑

- `hosts/archive.ubuntu.com`
- `hosts/security.ubuntu.com`
- `hosts/registry.npmjs.org`

文件名就是完整 host，不加扩展名。每个文件导出处理函数，处理该域名的具体逻辑。路由按主机名匹配，支持 `/用户名:密码@域名:端口/路径` 形式。

## npm / Node

在 `/admin` 放行当前 IP 后，运行上面的主页脚本即可。npm registry 根据请求域名生成，例如 `https://fast.thanejoss.com/registry.npmjs.org/`。

脚本直接更新用户默认的 `~/.npmrc`，无需预先安装 Node.js / npm，后续通过 nvm 安装也可使用。通过 `sudo bash` 执行时配置 `SUDO_USER` 对应的原用户；直接以 root 执行时配置 root。已有文件的权限、属主、符号链接及其他配置项保留，新文件归目标用户所有且权限为 `0600`。

项目 `.npmrc`、自定义 `NPM_CONFIG_USERCONFIG`、registry 环境变量、命令行参数和单独配置的 `@scope:registry` 仍可能覆盖默认用户配置。脚本不会迁移官方源的认证令牌；私有包需要按代理 registry 地址单独配置 npm 认证。

查看当前生效配置并验证代理连通性：

```bash
npm config get registry
npm ping --registry=https://fast.thanejoss.com/registry.npmjs.org/
npm view @types/node dist.tarball --registry=https://fast.thanejoss.com/registry.npmjs.org/
```

最后一条命令返回的 tarball URL 应以代理地址开头。

也可以仅对一次安装使用代理：

```bash
npm install lodash --registry=https://fast.thanejoss.com/registry.npmjs.org/
```

- 支持普通包、`@scope/name` 包、版本查询和 tarball 下载。
- 流式改写完整及精简 JSON 元数据中以 `http://registry.npmjs.org/` 或 `https://registry.npmjs.org/` 开头的 URL，使 `dist.tarball` 下载继续经过代理；支持 JSON 的斜杠和 Unicode 转义，保留描述中的内嵌 URL 与其他域名。
- 包文件保持流式透传，支持 Range 和条件请求；改写的 JSON 移除上游 Content-Length、Content-Encoding、ETag、Last-Modified 和内容摘要头，保留包的 integrity / shasum。
- npm 请求的方法、请求体和认证头透传给上游，包括发布、删除包、登录和审计请求；操作权限由 npm 上游校验。JSON URL 改写按响应状态和类型处理，不区分请求方法。

将当前用户配置恢复为官方源（不是此前的自定义源）：

```bash
npm config set registry https://registry.npmjs.org/ --global=false --location=user --workspaces=false
```
