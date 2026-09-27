# Collector album API and integration

## English

This document describes the shipped implementation. It does not authorize connecting real accounts, installing an application or deploying a theme. Read [README.md](README.md) for current status and local synthetic preview instructions.

### Request flow

The browser calls same-origin `/apps/pakra-collection/v1/collection`. Shopify App Proxy must forward it to the backend's `/proxy/v1/collection`, preserving the signed query parameters. The service obtains identity only from the verified `logged_in_customer_id`; clients cannot supply an account ID in the body. The signed `shop` and `path_prefix` must match the configured shop and `/apps/pakra-collection`.

Proxy signatures accept timestamps up to 300 seconds old and at most 30 seconds in the future. Anonymous requests, invalid signatures, another shop, a wrong prefix and duplicate critical parameters are rejected. CSRF tokens last 15 minutes and are bound to shop and account. All API responses use `Cache-Control: private, no-store`; CORS is not enabled.

`GET /proxy/v1/collection` returns a complete snapshot:

```json
{
  "schemaVersion": 1,
  "revision": 0,
  "csrfToken": "<returned-at-runtime>",
  "entries": {}
}
```

`POST` requires `Content-Type: application/json` and the revision and CSRF token from the latest snapshot:

```json
{
  "revision": 0,
  "csrfToken": "<value-from-GET>",
  "changes": [
    {
      "cardId": "<exact-id-from-catalog>",
      "status": "owned",
      "quantity": 1,
      "wishlist": false
    }
  ]
}
```

The server commits the whole batch in a SQLite transaction and returns the new complete snapshot with `revision + 1`. Display a successful save only after a successful response. A disconnect or timeout leaves the outcome uncertain; GET again to reconcile before retrying. A revision conflict requires a fresh snapshot and explicit reconciliation of unsaved changes.

| Field or limit | Contract |
| --- | --- |
| `status` | `unrecorded`, `missing`, `owned`, or `previously_owned` |
| `quantity` | Integer 1–999 for `owned`; exactly 0 otherwise |
| `wishlist` | Boolean, independent of ownership |
| Empty record | `unrecorded` with `wishlist: false` removes the entry |
| Batch | 1–100 changes, no duplicate IDs, exact allowed fields only |
| Request body | At most 64 KiB |
| Card ID | Must exactly match the catalog; Unicode symbols are significant |
| Rate limits | Per account per process: 120 reads and 60 writes each minute |

The IDs for `QY08-CR-001` and `QY08-◇CR-001` identify different cards. Never strip or normalize the diamond symbol.

Errors have shape `{ "error": { "code": "...", "message": "..." } }`:

| HTTP | Code | Client response |
| --- | --- | --- |
| 400 | `invalid_input` | Check card and state inputs |
| 401 | `authentication_required` | Sign in, then reload collection |
| 403 | `invalid_csrf` | GET a fresh snapshot before a user retry |
| 404 | `not_found` | Check endpoint path |
| 405 | `method_not_allowed` | Use GET or POST |
| 409 | `revision_conflict` | Reload and reconcile unsaved changes |
| 413 | `body_too_large` | Reduce the batch |
| 415 | `json_required` | Send JSON content type |
| 429 | `rate_limited` | Wait; response includes `Retry-After: 60` |
| 500 | `storage_unavailable` | Save is unconfirmed; inspect service and reload |
| 503 | `not_configured` | Explain that account sync is unavailable |

`GET /health` returns `200 {"status":"ready"}` or `503 {"status":"not_configured"}` without configuration details. Readiness means startup prerequisites loaded; it is not a live storage write check.

### Runtime configuration

Use only the approved official Shopify application runtime and credential mechanism. Never paste real secrets into source, shell commands, ordinary `.env` files, logs or Git. This service only consumes an injected secret; it has no credential retrieval, display or persistence feature. If a supported official injection path is not available, leave it unconfigured.

| Setting | Meaning / default |
| --- | --- |
| `SHOPIFY_API_SECRET` | Runtime-injected App Proxy signing secret, at least 32 characters/bytes |
| `PAKRA_SHOP` | One allowed full `*.myshopify.com` shop domain |
| `PAKRA_ALBUM_CATALOG_PATH` | Optional; defaults to this project's `theme/assets/p10-collector-catalog.json` |
| `PAKRA_ALBUM_DB` | Optional; defaults to this project's `data/collection.sqlite` |
| `HOST` / `PORT` | Optional; defaults to `127.0.0.1` / `8787` |
| `PREVIEW_PORT` | Synthetic preview only; defaults to `8791` |

The catalog must contain `schemaVersion: 1` and a nonempty `cards` array with unique IDs. An ID starts with a Unicode letter or number, has at most 160 characters, and permits subsequent letters, numbers, combining marks, symbols, `.`, `_`, `:`, `-`. Whitespace/control characters are rejected. Extra public card metadata is allowed. Missing or invalid catalogs leave the service unconfigured. The catalog is loaded at startup.

### Production work remaining

1. Obtain the approved App object/configuration and any necessary scopes through the official workflow. This package does not request scopes, install an app or call the Admin API.
2. Configure HTTPS hosting and the official runtime secret injection. Set shop App Proxy prefix `/apps/pakra-collection` and backend target `https://<approved-host>/proxy`.
3. Run one service instance using a local persistent volume. SQLite files must not be shared by multiple hosts over a network filesystem. Establish encrypted backups, restricted access, retention/deletion, and privacy event handling before real accounts are connected.
4. Disable query-string/body logging at hosting, reverse proxy and monitoring layers: proxy parameters contain account identifiers and signatures. Do not log CSRF tokens. The service itself does not log requests.
5. Obtain the exact approved existing Theme ID/role and files. Merge only the locale additions. Create/assign the approved Page template and navigation entry separately.
6. Validate real login/logout, guest behavior, A/B isolation, account switching, session expiry, cross-device edits, restart persistence, network failures and target-theme rendering. Synthetic test results do not satisfy these checks.

Reference for the existing signature algorithm: [Shopify App Proxy authentication](https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies). The documentation was not fetched during this offline handoff.

## 中文

本文描述交接代码已经实现的行为，不代表授权接入真实账号、安装应用或部署主题。当前状态及本地合成预览见 [README.md](README.md)。

### 请求流程

浏览器调用同站 `/apps/pakra-collection/v1/collection`。Shopify App Proxy 应保留签名查询参数并转发到后端 `/proxy/v1/collection`。服务只从已验证的 `logged_in_customer_id` 取得身份，不能通过正文提交账号 ID。签名里的 `shop` 和 `path_prefix` 必须与指定店铺及 `/apps/pakra-collection` 一致。

代理签名接受最多 300 秒前的时间戳及最多 30 秒的向前时钟偏差。匿名、错误签名、其他店铺、错误路径前缀和重复关键参数均拒绝。CSRF token 有效期 15 分钟，绑定店铺和账号。所有接口使用 `Cache-Control: private, no-store`，不开放 CORS。

`GET /proxy/v1/collection` 返回完整快照：

```json
{
  "schemaVersion": 1,
  "revision": 0,
  "csrfToken": "<服务运行时返回>",
  "entries": {}
}
```

`POST` 必须使用 `Content-Type: application/json`，并提交最新快照里的 revision 和 CSRF token：

```json
{
  "revision": 0,
  "csrfToken": "<GET返回的值>",
  "changes": [
    {
      "cardId": "<目录中的精确ID>",
      "status": "owned",
      "quantity": 1,
      "wishlist": false
    }
  ]
}
```

服务通过 SQLite 事务整批提交，并返回 `revision + 1` 的完整新快照。只有成功响应才能显示保存成功。断线或超时意味着结果未确认，重试前应 GET 核对。发生版本冲突时需要读取最新快照，再确认尚未提交的修改。

| 字段或限制 | 约定 |
| --- | --- |
| `status` | `unrecorded` 未登记、`missing` 缺少、`owned` 拥有、`previously_owned` 曾经拥有 |
| `quantity` | 拥有时为 1–999 整数，其他状态必须为 0 |
| `wishlist` | 布尔值，与拥有状态独立 |
| 空记录 | `unrecorded` 且 `wishlist: false` 会删除记录 |
| 批次 | 1–100 项，ID 不可重复，仅允许约定字段 |
| 正文 | 最多 64 KiB |
| 卡片 ID | 必须精确匹配目录，Unicode 符号具有身份含义 |
| 限流 | 每账号每进程每分钟 120 次读、60 次写 |

`QY08-CR-001` 与 `QY08-◇CR-001` 对应不同卡片，不得去掉或归一化其中的菱形符号。

错误格式为 `{ "error": { "code": "...", "message": "..." } }`：

| HTTP | code | 客户端处理 |
| --- | --- | --- |
| 400 | `invalid_input` | 检查卡片及状态输入 |
| 401 | `authentication_required` | 重新登录后读取收藏 |
| 403 | `invalid_csrf` | GET 新快照后由用户重试 |
| 404 | `not_found` | 检查接口路径 |
| 405 | `method_not_allowed` | 使用 GET 或 POST |
| 409 | `revision_conflict` | 重读并确认尚未提交的修改 |
| 413 | `body_too_large` | 减少批次大小 |
| 415 | `json_required` | 使用 JSON Content-Type |
| 429 | `rate_limited` | 等待，响应含 `Retry-After: 60` |
| 500 | `storage_unavailable` | 保存未确认，检查服务后重读 |
| 503 | `not_configured` | 提示账号同步尚未启用 |

`GET /health` 返回 `200 {"status":"ready"}` 或 `503 {"status":"not_configured"}`，不暴露配置详情。ready 表示启动所需条件已载入，不代表实时存储写入检查。

### 运行配置

仅使用经批准的 Shopify 官方应用运行环境和凭据机制。真实密钥不得写入源码、命令行、普通 `.env`、日志或 Git。本服务只消费运行时注入的签名密钥，不提供获取、显示或保存凭据的功能；如没有受支持的官方注入方式，应保持未配置。

| 配置 | 含义／默认值 |
| --- | --- |
| `SHOPIFY_API_SECRET` | 运行时注入的 App Proxy 签名密钥，至少 32 字符／字节 |
| `PAKRA_SHOP` | 唯一允许的完整 `*.myshopify.com` 店铺域名 |
| `PAKRA_ALBUM_CATALOG_PATH` | 可选，默认本项目 `theme/assets/p10-collector-catalog.json` |
| `PAKRA_ALBUM_DB` | 可选，默认本项目 `data/collection.sqlite` |
| `HOST` / `PORT` | 可选，默认 `127.0.0.1` / `8787` |
| `PREVIEW_PORT` | 仅合成预览使用，默认 `8791` |

目录要求 `schemaVersion: 1`、非空 `cards` 数组及唯一 ID。ID 以 Unicode 字母或数字开头，最多 160 字符，后续允许字母、数字、组合符号、Unicode 符号及 `. _ : -`，拒绝空白和控制字符；允许额外公开卡片信息。目录缺失或无效时服务保持未配置。目录在启动时读取。

### 正式接入待办

1. 通过官方流程取得经批准的应用对象／配置及必要权限。本包不会申请权限、安装应用或调用 Admin API。
2. 配置 HTTPS 托管及官方运行时密钥注入。店铺代理前缀设为 `/apps/pakra-collection`，后端目标为 `https://<已批准主机>/proxy`。
3. 使用本地持久卷运行单实例；不能让多台主机通过网络文件系统共享 SQLite。真实账号接入前完成加密备份、访问限制、保留／删除机制及隐私事件处理。
4. 在托管、反向代理和监控层关闭 query string／正文日志，因为代理参数含账号标识与签名。不得记录 CSRF token；本服务自身没有逐请求日志。
5. 确认并批准精确现有 Theme ID、role 及文件清单；仅合并语言包增量。另行批准 Page／模板分配及导航入口。
6. 验收真实登录／退出、游客、A／B 隔离、账号切换、会话过期、多设备同时修改、重启持久化、网络失败和目标主题渲染。合成测试不能替代这些验收。

现有签名算法参考：[Shopify App Proxy authentication](https://shopify.dev/docs/apps/build/online-store/app-proxies/authenticate-app-proxies)。本轮离线交接未重新联网读取该文档。
