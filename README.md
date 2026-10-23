# fast

零运行时依赖的 Cloudflare Worker 白名单反向代理。

入口通过 D1 校验客户端 IP；启用的白名单 IP 才能使用代理、浏览器主页和根路径的初始化脚本，一次配置 Ubuntu 和 npm 源。`/admin`、`/admin/` 以及 `/admin/*` 下的页面资源和管理接口免于 IP 校验，供 Cloudflare Access 独立保护。

```text
https://fast.thanejoss.com/archive.ubuntu.com/ubuntu/dists/noble/InRelease
→ https://archive.ubuntu.com/ubuntu/dists/noble/InRelease
```

- Ubuntu / npm 代理与初始化脚本入口不额外限制 HTTP method；这些代理请求的方法和请求体原样转发，上游使用 HTTPS。
- 流式传输响应，保留状态码、缓存头和 Range / 条件请求，支持大文件及断点续传。
- Ubuntu / npm 代理转发 Cookie、Authorization 等请求头，Host 改为目标源域名及端口；保留上游 Set-Cookie。
- Ubuntu / npm 代理在这三个原有域名之间改写 HTTP / HTTPS 重定向，保留端口、用户名和密码；HTTP 目标在下一次代理请求中升级为 HTTPS。其他域名或协议的重定向返回 502。
- GitHub、nvm 和 Node 下载使用独立的匿名规则，只开放下文列出的路径和方法，不转发认证头或 Cookie，不返回上游认证挑战或 Set-Cookie；不接受 URL 用户名、密码或显式端口。重定向必须保持 HTTPS、同一上游域名以及允许的路径和方法。
- 不在 IP 白名单或目标域名白名单内的请求返回 HTTP 403，上游连接失败返回 HTTP 502，D1 校验失败时返回 HTTP 503；这些错误响应体为空，错误由 HTTP 状态码表示。
- 通过 IP 白名单的请求、管理请求及异常写入 D1 访问日志；被 IP 白名单拒绝的请求直接返回 403，不写访问日志。日志通过 `waitUntil` 异步写入，不读取或缓冲下载响应体；写入失败输出 Worker 错误日志。
- Ubuntu / npm 代理使用原生 `HTMLRewriter` 流式改写 HTML 的 `href`、`src`：`/` 开头的根路径，以及指向这三个原有域名的 HTTP / HTTPS、`//域名/路径` 地址，改为对应代理地址。普通相对路径、查询参数、锚点和其他域名的地址保持原样。Git 和下载文件不做内容改写。

`wrangler.toml` 已声明目标域名、Worker 入口与 D1 绑定 `DB`（数据库名 `fast-access`）。首次上线须先创建数据库并执行迁移。

## 浏览器主页

浏览器打开 `/` 时显示由本 README 渲染的 HTML 文档，包含目录、标题、列表、链接及代码块，并适配手机屏幕。`curl` 默认仍取得初始化脚本，原有一键配置命令不变。

主页根据 `Accept` 协商响应类型：明确接受且优先选择 `text/html` 时返回页面；未指定或仅有 `*/*` 时返回脚本。也可通过 `/?format=html` 查看文档、`/?format=script` 查看原始脚本。两种响应均支持 HEAD、不缓存，并受相同的 IP 白名单保护。

Markdown 在构建时转为 HTML，运行时不加载 Markdown 库或外部 CDN。修改 README 后，`wrangler dev`、部署预检和发布会自动重新生成页面；也可单独运行 `npm run build`。原始 HTML 按文本显示，链接仅允许 HTTP / HTTPS / mailto。

## 管理页

访问 `https://fast.thanejoss.com/admin`：

- **IP 管理**：默认按 IP 汇总全部访问，显示请求次数、放行 / 拒绝 / 管理 / 异常计数、最近路径和自动标签。直接在访问卡片上放行、取消放行、修改分组与备注，无需手动输入 IP。没有访问记录的已有配置也会保留。
- **IP 分组**：维护“家里、公司、朋友”等来源分组。删除分组会将成员移至“未分组”，保留 IP 及其启用状态。
- **路径标签**：根据请求路径自动标记 Ubuntu、npm、初始化脚本、管理后台或其他路径，显示在 IP 汇总卡片与逐条日志中，无需维护分类或匹配规则。历史记录同样适用。
- **访问日志**：默认每个 IP 一张汇总卡片，展开查看逐条请求，每次加载 50 条。可用平铺选项组合筛选当前访问权限、当前 IP 分组、路径标签、访问结果和最近 24 小时 / 7 天 / 30 天，支持搜索 IP、备注与路径片段。

两个页面均先对全部匹配记录按 IP 汇总，再按最近访问排序，每页 20 个 IP；翻页和展开明细沿用同一个日志边界，点击“刷新数据”查看新请求。设置分组与备注不会改变访问权限。历史日志保留访问时的分组名称；筛选分组按 IP 当前归属，便于管理。拒绝计数和筛选仅展示已有历史记录，新的 IP 白名单拒绝不再记录。新 IP 可先通过 Cloudflare Access 打开 `/admin`，再点击“刷新数据”，从管理访问记录中放行该 IP。页面沿用 webapps 的蓝白配色、卡片和标签样式。

IP 使用 Cloudflare 的 `CF-Connecting-IP`，不接受 `X-Forwarded-For` 或 `X-Real-IP` 作为白名单依据。支持单个完整 IP，IPv6 自动规范化；不支持 CIDR 网段。若域名启用了 Pseudo IPv4 的 Overwrite Headers 模式，建议改为 Off / Add Header，以便按真实 IPv6 管理白名单。

“放行”表示通过 IP 检查，HTTP 状态码另列，因此上游错误或目标域名拒绝仍可显示为“放行”。耗时统计到响应头返回，不包含下载完成时间。日志记录时间、IP、方法、路径、分类、状态、国家、User-Agent 和耗时，不保存请求体、Cookie、Authorization、查询参数或 URL 用户名密码。日志保留在 D1 中，不自动清理；Access 在 Worker 之前拦截的请求不会进入这些日志。

管理页不内置登录，也不检查 IP 白名单。配置 Access 时请同时覆盖 `/admin` 和 `/admin/*`，包含 `/admin/api/*` 及页面资源；配置完成前，这些管理接口可被公开调用。保留 `workers_dev = false`、`preview_urls = false`，使管理流量统一经过配置 Access 的自定义域名。管理写操作需携带本站 `Origin`，POST / PUT 使用 JSON。

## 本地开发与部署

开发与 CI 使用 `.node-version` 指定的 Node.js 24；使用锁文件安装依赖：

```bash
npm ci
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

若 `fast-access` 已存在，使用 `npx wrangler d1 list` 查到其 ID 后更新现有绑定，无需重复创建。先应用远端迁移，再发布 Worker；初始 IP 白名单为空，上线后通过 Cloudflare Access 打开 `/admin` 并刷新数据，从管理访问记录中放行 IP。

从旧版升级时也需要先运行 `npm run db:migrate:remote`：`0002_log_path_tags.sql` 为新旧日志增加自动路径标签与索引，兼容旧 Worker 继续写入。旧路径分类数据保留在数据库中，但不再用于管理或日志分类。

```bash
npm run types       # 配置变更后生成本地绑定类型
npm run lint        # JavaScript（含 hosts）规范与 Shell 语法检查
npm test            # Markdown 渲染与临时目录内的配置脚本回归测试
npm run build       # 将 README.md 渲染为主页 HTML
npm run check       # JavaScript / Shell 语法检查与 Wrangler 部署预检，不会发布
npx playwright install chromium
npm run test:e2e    # 本地 Worker / D1 与桌面、移动端浏览器验收
```

`.github/workflows/ci.yml` 在每个 PR（包括 draft）以及 `main` 推送时调用固定版本的通用 reusable CI，自动发现已有 lint、test 和 build，并执行依赖安全审计。Worker 打包预检与 Playwright / axe 不属于通用 CI 自动发现范围，需要按上述命令独立执行，不将未执行检查视为通过。浏览器检查包括 IP 放行、分组删除、主页内容协商与 HEAD、错误恢复、键盘焦点、横向溢出和无障碍；本地报告与截图保存在 `playwright-report/` 和 `test-results/`，通用 CI 不自动上传这些文件。项目为 JavaScript，`npm run types` 仅生成绑定声明，不是类型检查；CI 使用 ESLint 和单元测试，不声称提供 TypeScript 或浏览器检查。

浏览器测试只启动 `127.0.0.1:8789` 的 `wrangler dev --local`，迁移和测试数据写入独立的 `.wrangler/test-state`，不会使用日常开发的本地数据库或线上 D1，也不会请求真实代理上游。配置脚本测试把 APT、用户目录与 SSH 写入重定向至临时目录，不执行主机初始化；SSH 专项测试在 root 环境明确跳过，CI 使用普通用户执行。自动质量检查不包含部署、远端迁移或 Cloudflare 凭据。

实现分为：`index.js` 入口检查与日志、`access.js` IP 与日志查询、`admin.js` 管理接口、`admin/` 静态页面、`migrations/` D1 表结构、`proxy.js` 流式代理、`home.js` 主页内容协商、`home/template.html` 文档样式、`scripts/render-home.js` Markdown 构建、`setup.sh` Ubuntu 与 npm 配置脚本。

## 一键配置 Ubuntu 与 npm 源

以 root 执行：

```bash
curl -fsSL https://fast.thanejoss.com/ | sudo bash
```

主页脚本一次完成两种源的配置，可重复执行。Ubuntu 按[官方格式约定](https://ubuntu.com/server/docs/how-to/software/package-management/)整份替换官方源文件：24.04 及以后使用 deb822 格式的 `/etc/apt/sources.list.d/ubuntu.sources`，更早版本使用传统格式的 `/etc/apt/sources.list`，同时移除另一个官方源文件，避免两份配置同时生效。这两个文件内原有的所有内容（包括自定义条目）都会被替换或移除；`sources.list.d` 下其他独立文件保持原样，第三方源应放在这些独立文件中。

修改前将两个官方源文件中已有的文件完整备份到 `/etc/apt/fast-backups/ubuntu.XXXXXX/`（每次实际修改使用独立目录，终端显示具体路径），保留原文件名、权限及符号链接；APT 不读取此备份目录。需要恢复时，将备份中的 `sources.list` 放回 `/etc/apt/sources.list`、`ubuntu.sources` 放回 `/etc/apt/sources.list.d/ubuntu.sources`，并移除这两个位置中备份里原本不存在的文件。只有目标文件的完整内容与当前发行版和预期配置一致、另一个官方源文件也已不存在时才跳过，重复执行不会重写源文件或新增备份。npm 合并为一条 `registry` 配置，内容已一致时不重写文件。

执行时逐项输出 `[已修改]` 或 `[未修改]`，分别显示 Ubuntu 主源、Ubuntu 安全源和 npm registry 的处理结果；npm 提示还包含配置文件路径和 registry 地址。

`[未修改]` 是正常状态，表示配置已一致，无需重复修改，并非报错。全部步骤成功后显示 `[完成]`，然后返回命令行；脚本只配置源，不执行 `apt update`、安装软件或检查代理连通性。

## 按 host 组织逻辑

- `hosts/archive.ubuntu.com`
- `hosts/security.ubuntu.com`
- `hosts/registry.npmjs.org`
- `hosts/github.com`
- `hosts/raw.githubusercontent.com`
- `hosts/nodejs.org`

文件名就是完整 host，不加扩展名。每个文件导出处理函数，处理该域名的具体逻辑。原有 Ubuntu / npm 路由按主机名匹配，支持 `/用户名:密码@域名:端口/路径` 形式；新增的三个匿名路由只接受完整的原样小写域名。

## GitHub 公共仓库

在 `/admin` 放行当前 IP 后，将公共仓库的 `https://github.com/username/project` 换成 `https://fast.thanejoss.com/github.com/username/project`；末尾有无 `.git` 都支持。例如：

```bash
git clone https://fast.thanejoss.com/github.com/nvm-sh/nvm.git
git -C nvm fetch origin
```

只开放 Git smart HTTP 的 `GET /用户名/仓库/info/refs?service=git-upload-pack` 和 `POST /用户名/仓库/git-upload-pack`。POST 要求 `application/x-git-upload-pack-request`，请求体与响应体流式传输，保留 `Git-Protocol` 以支持协议协商；Git 响应不缓存。发现阶段的仓库规范化或改名重定向会改写回代理；POST 仅接受保持方法的 307 / 308 重定向。

不支持 push、私有仓库认证、仓库网页、Git LFS 或 GitHub Release 附件，也不会自动替换子模块里的 URL。上游 401 / 407 转为 403，避免提示输入 GitHub 凭据。

## 通过代理安装 nvm 与 Node LTS

以下命令用于 **Linux / Ubuntu 的 Bash**，以日常用户执行，**不要加 sudo**；需要已有 `bash`、`curl` 和 `git`。WSL 的 Linux Bash 可以使用，原生 Windows 的 PowerShell / CMD 不支持。先在 `/admin` 放行当前 IP，并在同一个 Bash 会话中依次执行下面三步。

第一步安装 nvm。保留已有 `NVM_DIR`；未设置时使用官方的 XDG / `~/.nvm` 默认目录。已有 `nvm.sh` 时跳过安装，不更新现有 nvm；目标路径已存在但缺少 `nvm.sh` 时停止，先检查该目录再继续。

```bash
if [ -z "${NVM_DIR:-}" ]; then
  if [ -n "${XDG_CONFIG_HOME:-}" ]; then
    NVM_DIR="$XDG_CONFIG_HOME/nvm"
  else
    NVM_DIR="$HOME/.nvm"
  fi
fi
export NVM_DIR

(
  set -e
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    printf '使用已有 nvm：%s\n' "$NVM_DIR"
  else
    if [ -e "$NVM_DIR" ] || [ -L "$NVM_DIR" ]; then
      printf '路径已存在但缺少 nvm.sh，请先检查：%s\n' "$NVM_DIR" >&2
      exit 1
    fi
    fast_nvm_installer=$(mktemp)
    trap 'rm -f -- "$fast_nvm_installer"' EXIT
    curl -fsSL --proto '=https' --proto-redir '=https' \
      https://fast.thanejoss.com/raw.githubusercontent.com/nvm-sh/nvm/v0.40.8/install.sh \
      -o "$fast_nvm_installer"
    mkdir -p -- "$NVM_DIR"
    PROFILE=/dev/null METHOD=git \
      NVM_SOURCE=https://fast.thanejoss.com/github.com/nvm-sh/nvm.git \
      NVM_INSTALL_VERSION= NODE_VERSION= \
      bash "$fast_nvm_installer"
  fi
)
```

使用固定版本的[官方 v0.40.8 安装器](https://github.com/nvm-sh/nvm/blob/v0.40.8/install.sh)，通过 `METHOD=git` 和代理 `NVM_SOURCE` 下载完整 nvm 仓库，包含 `nvm.sh`、`nvm-exec` 与 `bash_completion`。`NVM_INSTALL_VERSION` 留空时采用该固定安装器内的版本，避免额外的直连版本探测；清空 `NODE_VERSION` 禁止安装器顺带安装 Node。`PROFILE=/dev/null` 让启动配置由下一步统一追加。

第二步持久化配置。仅在 `~/.bashrc` 中追加一次独立区块，已有文件先备份为 `~/.bashrc.fast-nvm.时间戳.bak`，不替换原内容。保留已有 `NVM_DIR` 和 `NVM_NODEJS_ORG_MIRROR`；未设置镜像时使用本代理。已有 nvm 加载逻辑继续生效。

```bash
(
  set -e
  if [ ! -s "$NVM_DIR/nvm.sh" ]; then
    printf '请先完成 nvm 安装。\n' >&2
    exit 1
  fi
  if ! grep -Fqx '# >>> fast nvm proxy >>>' "$HOME/.bashrc" 2>/dev/null; then
    if [ -e "$HOME/.bashrc" ]; then
      cp -p -- "$HOME/.bashrc" "$HOME/.bashrc.fast-nvm.$(date +%Y%m%d%H%M%S).bak"
    fi
    {
      printf '\n# >>> fast nvm proxy >>>\n'
      printf '[ -n "${NVM_DIR:-}" ] || NVM_DIR=%q\n' "$NVM_DIR"
      cat <<'EOF'
export NVM_DIR
export NVM_NODEJS_ORG_MIRROR="${NVM_NODEJS_ORG_MIRROR:-https://fast.thanejoss.com/nodejs.org/dist}"
if ! command -v nvm >/dev/null 2>&1 && [ -s "$NVM_DIR/nvm.sh" ]; then
  . "$NVM_DIR/nvm.sh"
fi
# <<< fast nvm proxy <<<
EOF
    } >> "$HOME/.bashrc"
  fi
)
```

配置对后续读取 `~/.bashrc` 的交互 Bash 生效，包括 Ubuntu 默认配置。若自行定制了 Bash 登录文件，使其不再读取 `~/.bashrc`，还需让该登录文件加载此区块。

第三步在当前 Bash 加载 nvm，并通过代理安装 Node LTS：

```bash
export NVM_NODEJS_ORG_MIRROR="${NVM_NODEJS_ORG_MIRROR:-https://fast.thanejoss.com/nodejs.org/dist}"
. "$NVM_DIR/nvm.sh" --no-use
NVM_NODEJS_ORG_MIRROR=https://fast.thanejoss.com/nodejs.org/dist \
  nvm install --lts --skip-default-packages
```

最后一条命令单次明确选择本代理，即使原来设置了其他镜像，也不改写该设置。它在当前 Bash 中启用安装的 LTS，保留其他已安装的 Node 版本与已有的 `default` 别名；没有默认别名时由 nvm 创建。`--skip-default-packages` 跳过自动安装全局包，保留原有 `default-packages` 文件。

Node 镜像开放 `https://fast.thanejoss.com/nodejs.org/dist` 下的 GET / HEAD 下载，覆盖版本索引、校验和、二进制及源码包，保留 Range 和条件请求。raw 入口仅开放 `nvm-sh/nvm/v主版本.次版本.补丁版本/` 下的 `install.sh`、`nvm.sh`、`nvm-exec`、`bash_completion`，不代理其他 raw 文件或分支。两者均不接受查询参数，认证头和 Cookie 不会转发。

## npm 源

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
