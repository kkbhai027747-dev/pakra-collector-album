# Collector album

Standalone project: `pakra-collector-album`. Unreleased collector-album experiment; real Shopify integration remains unverified.

Source: [pakra-cards-system](https://github.com/sreylekcheat-coder/pakra-cards-system), commit `00879b2821c7dce87cb1d44d1d81c0b40e08cea2`, directory `experiments/collector-album`, extracted on 2026-09-27. Run the commands below from this repository's root. `SOURCE-MANIFEST.json` retains earlier historical provenance; its old paths are not current file dependencies. This repository split does not deploy the project or replace an existing running task.

中文：本目录按独立项目维护，以下命令从本仓库根目录运行。来源为上述提交及子目录；历史来源清单保留用于追溯。分仓不代表已经部署、连接真实账号或替换原本运行的任务。


## English

**Status: in development.** This handoff contains a private collection UI and a single-store Node.js service. It has not been deployed; real Shopify login, App Proxy routing, and rendering inside the target theme remain unverified. The included preview uses synthetic accounts only.

The pilot covers 25 Chinese My Little Pony Fun Moments Edition 8 card kinds: 13 CR and 12 Hidden CR. This is a partial checklist. Users can record ownership, quantities, missing cards, previously owned cards, and a separate wishlist. This wishlist belongs to the album service; it does not synchronize with the Swish wishlist project. Ownership is self-reported.

### Start here

Use Node.js 24.19 or newer. All runtime and test dependencies are Node.js built-ins; no package installation is required. From the repository root:

```sh
npm test
npm run check:catalog
npm run preview
```

Open `http://127.0.0.1:8791/?lang=en` or `http://127.0.0.1:8791/?lang=zh-CN`. Use the preview bar to switch between synthetic account A, synthetic account B, and guest. Append `&theme=dark` for dark mode. Stop with Ctrl+C. The preview binds to loopback, generates a temporary signing key, and uses an in-memory database; restarting resets its data. It implements only the Liquid expressions used by this section and is not a full Shopify theme renderer. Card images still load from Shopify CDN when a browser opens the preview.

`npm start` starts the actual service at `127.0.0.1:8787`. Without approved runtime configuration it returns 503 and creates no database. Do not use the synthetic preview server for hosting or real accounts.

### Code map

| File | Responsibility |
| --- | --- |
| `server.mjs` | HTTP routes, startup configuration, catalog allowlist, input validation and rate limiting |
| `auth.mjs` | App Proxy signature verification and account-bound CSRF tokens |
| `store.mjs` | SQLite transactions, account isolation and revision conflicts |
| `test/server.test.mjs` | 15 existing synthetic service tests |
| `test/handoff.test.mjs` | Portable catalog check and bilingual preview/account isolation smoke test |
| `preview.mjs` | Local synthetic proxy adapter and limited Liquid renderer |
| `build-catalog.mjs` / `catalog-sources.json` | Deterministic pilot catalog generation and pinned source checksums |
| `theme/sections/p10-collector-album.liquid` | Page markup and translated client configuration |
| `theme/templates/page.collector-album.json` | Page template using this section |
| `theme/assets/p10-collector-album.js` | Browser state, collection editing, filters, dialogs and API calls |
| `theme/assets/p10-collector-album.css` | Scoped responsive styling and dark mode |
| `theme/assets/p10-collector-catalog.json` | Public 25-card pilot allowlist; no prices, inventory or account data |
| `theme/locales/*.json` | **Partial locale additions only:** 69 keys under `p10_album.ui` per language |
| [API.md](API.md) | API contract, runtime configuration and deployment prerequisites |
| `SOURCE-MANIFEST.json` | Source provenance, original hashes and handoff changes |

The UI reads the catalog and an account snapshot, then sends a revision and changed card entries. The service authenticates the signed proxy request, validates the complete batch, and commits it atomically. A stale revision returns 409. No Shopify Admin API or customer profile/order/payment lookup is implemented.

### Catalog dependency and maintenance

The committed 25-card catalog lets the service and preview run using this project directory alone. The complete test suite, catalog build, and catalog check use the fixed inputs in `fixtures/catalog-source/`; they do not depend on the current V9 theme or a sibling project. `catalog-sources.json` pins both source SHA-256 hashes; a changed source fails the build until reviewed. See [HANDOFF.md](HANDOFF.md) for this relocation and its historical provenance.

The shared card source is byte-identical to the original album input. The shared boxes file is a newer snapshot: its full hash differs, but the selected Fun Moments Edition 8 box record is identical. The regenerated album retains all 25 card records, the set record, and catalog version `1-e36b3c0b30f4`; only provenance metadata changes. Images and product/variant links are saved public references, not a current stock or availability check.

To update the pilot, review exact card/variant identities and coverage in the builder before changing the input checksums. Run `npm run build:catalog`, inspect the generated diff, then run tests and `npm run check:catalog`. The generator does not call Shopify. It removes machine-specific source paths and omits a wall-clock generation timestamp so unchanged sources produce identical bytes. The service reads the catalog once at startup; changing it requires a restart and does not automatically delete stored entries.

### Handoff improvements and checks

- Replaced personal workspace/output paths with module-relative paths. Commands also work when invoked from a different working directory.
- Centralized and pinned shared catalog inputs; retained identity, rarity, product, variant and image-origin validation.
- Kept the existing API, authentication, SQLite schema and storefront behavior. Stable business logic is not reformatted or rewritten just for the handoff.
- Packaged the existing preview with fixed synthetic identities, bounded request bodies and no external credentials.
- Included only this module's locale additions and documented the integration points.

Handoff validation: **17 tests passed** (15 original + 2 portability/preview tests); deterministic catalog check passed; English and Chinese locale key sets both contain the same 69 keys. The section, page template, browser JavaScript and CSS are unchanged copies. The regenerated catalog's cards, set, and version match the original. No browser visual test or official Shopify theme validation was rerun for this package; earlier local preview results are not treated as production acceptance.

### Integration boundaries and remaining work

This folder is a theme module, not a complete standalone Shopify theme. Before any deployment, select the approved existing Theme ID and role and list the exact files. The five theme files are the section, page template, JavaScript, CSS, and catalog shown above. Merge only `p10_album.ui` into the target theme's latest English and Chinese locale files; **never replace a complete locale file with these subsets**. The back link expects the single-card page at `/pages/kayou-mlp-card-catalog`.

Production still needs approved App Proxy application setup, HTTPS hosting, official credential injection, persistent storage/backup, required privacy and deletion handling, Page/template assignment, approved navigation entry, and real-account/device acceptance tests. None is performed by this handoff. Do not upload a full theme, create a replacement theme, expand scopes, or deploy from this project without the separate applicable approvals.

Current limits: one service instance with local SQLite; process-local rate limits; 25-card coverage; search uses card codes and the original English image descriptions, not Chinese character names; no public sharing, certified rankings, stock notifications or automatic order matching. Safari/Firefox and the real Shopify account lifecycle remain to be validated. See [API.md](API.md) for configuration and error handling.

No real customer database, secrets, cookies, login state, logs, screenshots, complete locale bundles or global theme configuration is included.

## 中文

**状态：开发中。** 本交接包包含私人收藏图鉴页面及单店 Node.js 服务，尚未部署；真实 Shopify 登录、App Proxy 路由和目标主题内的渲染尚未验收。所带预览只使用合成账号。

试点仅收录小马中文趣影 8 的 25 种卡：13 种 CR 与 12 种隐藏 CR，属于部分目录。用户可以登记拥有状态、数量、缺卡、曾经拥有及独立愿望单。这里的愿望单保存在图鉴服务内，不与 Swish 愿望单项目同步。拥有状态为用户自行申报。

### 从这里开始

使用 Node.js 24.19 或更新版本。运行和测试均使用 Node.js 内置模块，无需安装依赖。从仓库根目录执行：

```sh
npm test
npm run check:catalog
npm run preview
```

打开 `http://127.0.0.1:8791/?lang=zh-CN` 或 `http://127.0.0.1:8791/?lang=en`。在预览栏切换合成账号 A、合成账号 B 和游客；追加 `&theme=dark` 查看深色模式。Ctrl+C 停止。预览只监听本机地址，运行时生成临时签名密钥，使用内存数据库；重启后重置数据。它只支持本 section 使用的有限 Liquid 表达式，不是完整 Shopify 主题渲染器。浏览器打开预览后，卡图仍会从 Shopify CDN 加载。

`npm start` 在 `127.0.0.1:8787` 启动正式服务程序。未配置经批准的运行环境时，它返回 503 且不创建数据库。不能把合成预览服务用于托管或真实账号。

### 代码地图

| 文件 | 作用 |
| --- | --- |
| `server.mjs` | HTTP 路由、启动配置、目录白名单、输入校验和限流 |
| `auth.mjs` | App Proxy 签名校验及绑定账号的 CSRF token |
| `store.mjs` | SQLite 事务、账号隔离及版本冲突 |
| `test/server.test.mjs` | 原有 15 项合成服务测试 |
| `test/handoff.test.mjs` | 目录跨工作目录校验和双语预览／账号隔离检查 |
| `preview.mjs` | 本地合成代理适配器及有限 Liquid 渲染器 |
| `build-catalog.mjs` / `catalog-sources.json` | 可重复的试点目录生成及源文件校验和 |
| `theme/sections/p10-collector-album.liquid` | 页面结构及传给前端的翻译配置 |
| `theme/templates/page.collector-album.json` | 使用该 section 的页面模板 |
| `theme/assets/p10-collector-album.js` | 浏览器状态、收藏编辑、筛选、弹窗及接口调用 |
| `theme/assets/p10-collector-album.css` | 局部响应式样式及深色模式 |
| `theme/assets/p10-collector-catalog.json` | 25 张卡的公开试点白名单，不含价格、库存或账号数据 |
| `theme/locales/*.json` | **仅语言包增量：** 每种语言在 `p10_album.ui` 下有 69 个键 |
| [API.md](API.md) | 接口约定、运行配置及部署前置条件 |
| `SOURCE-MANIFEST.json` | 来源、原 SHA-256 及交接改动 |

前端读取目录与账号快照，再提交版本号及需要修改的卡片记录。服务验证代理签名、校验完整批次，然后通过事务一次性提交。旧版本请求返回 409。这里没有 Shopify Admin API 调用，也没有客户资料、订单或支付查询。

### 目录依赖与维护

服务和预览只需本项目目录及已提交的 25 卡目录即可运行。完整测试、目录构建和目录校验使用 `fixtures/catalog-source/` 内的固定输入，不再依赖当前 V9 主题或相邻项目。`catalog-sources.json` 固定两个输入的 SHA-256；输入变化后需先审核，否则构建会失败。迁移和历史来源见 [HANDOFF.md](HANDOFF.md)。

共享单卡源文件与图鉴原始输入逐字节一致。共享盒装文件是较新的快照，整个文件的 SHA 不同，但选中的趣影 8 盒装记录完全一致。重新生成后，25 条卡片、系列信息及目录版本 `1-e36b3c0b30f4` 均保持不变，只更新来源说明。图片、商品及 variant 链接是已保存的公开引用，不表示已重新核对当前库存或可购买状态。

更新试点前，应先检查生成器中的精确卡片／variant 身份与收录范围，再修改输入校验和。执行 `npm run build:catalog`，检查生成差异，再运行测试和 `npm run check:catalog`。生成器不会调用 Shopify。已移除机器专属路径及会随运行时间改变的总生成时间戳，相同输入会产生相同字节。服务仅在启动时读取目录，更新目录后需重启，且不会自动删除已保存的记录。

### 本次可维护性整理及检查

- 将个人工作区和历史 output 路径改为相对模块位置的路径，从其他工作目录调用也可运行。
- 集中并固定共享目录输入，保留卡片身份、稀有度、商品、variant 和图片来源校验。
- 保留现有 API、认证、SQLite 表结构和页面行为，不为交接而重写稳定业务逻辑。
- 整理已有预览，固定合成账号、限制请求体大小，不依赖外部凭据。
- 只提取本模块语言包增量，并写清接入位置。

交接验证：**17 项测试通过**，包括原有 15 项及新增 2 项可移植性／预览测试；目录可重复生成校验通过；英文与中文均为相同的 69 个键。Section、页面模板、浏览器 JavaScript 和 CSS 与原文件一致。新生成目录的卡片、系列信息和版本与原目录相同。本交接未重新执行浏览器视觉测试或 Shopify 官方主题校验，历史本地预览结果不能视为正式环境验收。

### 接入边界及待完成事项

本目录是主题模块，不是完整 Shopify 主题。部署前需指定并批准现有 Theme ID、role 及精确文件清单。主题部分只有上表中的 section、页面模板、JavaScript、CSS 和目录共五个文件。语言包只把 `p10_album.ui` 合并到目标主题最新英文／中文文件，**不得用这里的增量文件覆盖整份语言包**。返回单卡页面的链接依赖 `/pages/kayou-mlp-card-catalog`。

正式接入还需完成经批准的 App Proxy 应用配置、HTTPS 托管、官方凭据注入、持久存储和备份、隐私事件及删除流程、Page／模板分配、经批准的导航入口，以及真实账号／多设备验收。本交接没有执行这些操作。整主题上传、创建替代主题、扩大权限或部署均不能由这份交接授权替代。

当前局限：单服务实例及本地 SQLite；进程内限流；仅 25 卡；搜索依据卡号和原始英文图片描述，暂不支持中文角色名；没有公开分享、认证排行、到货通知或自动订单关联。Safari／Firefox 和真实 Shopify 账号生命周期仍待验收。配置及错误处理见 [API.md](API.md)。

未收录真实客户数据库、密钥、Cookie、登录状态、日志、截图、整份语言包或全局主题设置。
