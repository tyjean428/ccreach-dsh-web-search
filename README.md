# ccreach-dsh-web-search

English below, followed by [中文说明](#中文说明).

CCReach capability-search provider for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Registers `WebSearchProvider.id = "ccreach"` and selects it in the `web` profile through a `dsh.bundle` patch.

CCReach returns capability candidates and their provider entry points, not generated answers. The user's agent decides whether and how to call a provider. A catalog entry, `executable: true`, or a reachable documentation URL does not assert that a task was successfully executed. Unknown price and permission conditions remain explicit in each snippet.

## Install

Requires Node.js `^22.19.0 || >=24.0.0`, DeepSeek Harness and pnpm. Verified with DSH `0.1.0-rc.6`; DSH is a developer preview with evolving APIs.

After this package has been published to npm:

```sh
dsh plugin --profile web add ccreach-dsh-web-search
dsh --profile web --dump-config
dsh --profile web
```

From a local source checkout, build it first and install the directory:

```sh
cd ccreach-dsh-web-search
npm ci
npm run build
cd ..
dsh plugin --profile web add ./ccreach-dsh-web-search
```

Removing the bundle restores the preceding provider selection:

```sh
dsh plugin --profile web remove ccreach-dsh-web-search
```

The shipped patch replaces the `web` row's complete config with `searchProvider: ccreach` and inserts `web-search-ccreach`. Other providers remain mounted. Later profile/home/CLI patches can override either row; include any custom `fetchProvider` setting when overriding the complete `web` config.

## Anonymous access and optional credentials

**No CCReach API key is required. Anonymous access is the default.** Configuring a key sends `Authorization: Bearer <key>` for future authenticated features. No account is created and no model API is called by this plugin.

The plugin uses the official Harness credentials service once per request. In a normal Harness profile it resolves either the inherited `CCREACH_API_KEY` environment variable or `$DSH_HOME/.credentials.yaml` (normally `~/.dsh/.credentials.yaml`). The Harness credentials service owns precedence; the inherited environment takes precedence over its managed document. Key rotation applies to the next request.

Credentials document, if you choose to configure a key:

```yaml
CCREACH_API_KEY: your-api-key
```

On POSIX, restrict that file to its owner (`chmod 600 ~/.dsh/.credentials.yaml`). On Windows, restrict its ACL to your account. Keep credentials out of the profile patch and Git.

Alternatively, configure the launching environment:

```sh
export CCREACH_API_KEY='your-api-key'
```

```powershell
$env:CCREACH_API_KEY = 'your-api-key'
```

If an embedding composition has no credentials service, the plugin uses the official launch-environment snapshot. The standalone `CCReachClient` additionally supports a per-operation `resolveApiKey` callback or a literal `apiKey` in memory.

## Configuration

A later profile patch can configure the installed row:

```yaml
- id: web-search-ccreach
  config:
    baseURL: https://ccreach.com
    category: data
    kind: tool
    protocol: http
    free_only: false
    executable_only: true
    count: 10
```

| Key | Default | Meaning |
| --- | --- | --- |
| `baseURL` | `https://ccreach.com` | HTTP(S) API base; appends `api/search` or `api/meta`. No URL credentials, query or fragment. |
| `category` | omitted | `all/information/data/development/office/media/automation/research/agents`. |
| `kind` | omitted | `all/document/data_source/tool/agent/skill/workflow`. |
| `protocol` | omitted | `all/web/http/mcp/a2a/local`. |
| `free_only` | omitted | Boolean passed verbatim; unknown cost is not treated as free. |
| `executable_only` | omitted | Boolean passed verbatim; not proof of successful execution. |
| `count` | `10` | Default `limit`, integer 1–50. Harness `request.maxResults` overrides it, capped at 50. |
| `page` | omitted (server: `1`) | Provider config pagination; current Harness requests have no page member. |
| `snapshot_id` | omitted | Optional 64-character hex snapshot; standalone `null` is omitted. |
| `result_set_id` | omitted | Optional 64-character hex stable result-set identifier; standalone `null` is omitted. |
| `apiKeyEnv` | `CCREACH_API_KEY` | Optional credential reference, resolved for every operation. |
| `requireApiKey` | `false` | Explicit future authenticated mode. Only this mode rejects missing credentials. |

`request.query` becomes `q`, including Unicode and reserved characters through URL encoding. A search performs one GET; it does not walk all backend pages. The current DSH `WebSearchRequest` contains only `query` and `maxResults`, so it does not receive per-call pagination or filters. Provider-level filters do not introduce new model-facing tool arguments.

## Field mapping

| CCReach field | `WebSearchSource` field / treatment |
| --- | --- |
| `access.docs_url` | `url`, when nonblank. |
| `sources[0].url` | `url` fallback when `docs_url` is absent/blank. Both missing → skip this result. |
| `name` | `title`. |
| `summary` | First line of `snippet`, copied without generating a new summary. |
| `sources[0].checked_at` | `publishedAt`: valid `YYYY-MM-DD` → `YYYY-MM-DDT00:00:00Z`. Invalid/missing → omitted. This is a **source check date**, not an asserted publication date. |
| `resource_kind`, `protocols`, `cost.status`, `auth_status`, `executable`, `missing_conditions` | Second line of `snippet`, explicitly labeled CCReach capability metadata. Conditions are a JSON string array. |
| `access.endpoint` | Not substituted for the documentation/source URL. No endpoint is invoked. |
| Other evidence and ranking fields | Not synthesized or copied into unsupported Harness fields. |
| Backend pagination / `has_next` | Does not imply `truncated`; that flag only records local removal to honor the source bound. |

`WebSearchResult.content` is omitted. Results are filtered for missing URLs and then bounded to the requested limit, even if the server over-returns. Backend `total` may exceed the number of citeable sources in one response.

The supplied resource specification calls its list “26 fields” but enumerates 25 names. The mock includes every enumerated name exactly. Real Registry-origin responses may omit admission/parser evidence members; unused members are optional in the wire types and are never invented by the adapter. The search response and detail resource types use the same measured vocabulary; ranking members are optional because the detail endpoint omits them.

## Actual anonymous example

Captured with `GET https://ccreach.com/api/search?q=weather&limit=1` on 2026-10-09. The following is an excerpt of the actual response. The complete, unmodified field values are in [examples/ccreach-response.json](examples/ccreach-response.json); an output snapshot is in [examples/mapped-result.json](examples/mapped-result.json).

```json
{
  "query": "weather",
  "results": [{
    "id": "registry-5922b8db6598f866b5da",
    "name": "Weather",
    "summary": "US weather for AI agents: active NWS alerts by state, 5-period forecasts by lat/lon. Paid per call.",
    "resource_kind": "tool",
    "protocols": ["mcp", "web"],
    "executable": true,
    "auth_status": "unknown",
    "cost": { "status": "unknown", "details": "注册信息未核验收费或免费额度。", "evidence": [] },
    "sources": [{
      "url": "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Thx93%2Fweather/versions/1.0.0",
      "checked_at": "2026-10-07"
    }],
    "access": {
      "docs_url": "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Thx93%2Fweather/versions/1.0.0",
      "endpoint": null
    },
    "missing_conditions": ["费用条件待核实", "需要认证或接入权限待确认", "未完成实际执行验证"]
  }]
}
```

Mapped result:

```json
{
  "sources": [{
    "url": "https://registry.modelcontextprotocol.io/v0.1/servers/io.github.Thx93%2Fweather/versions/1.0.0",
    "title": "Weather",
    "snippet": "US weather for AI agents: active NWS alerts by state, 5-period forecasts by lat/lon. Paid per call.\n[CCReach capability metadata] resource_kind=tool; protocols=mcp,web; cost.status=unknown; auth_status=unknown; executable=true; missing_conditions=[\"费用条件待核实\",\"需要认证或接入权限待确认\",\"未完成实际执行验证\"]",
    "publishedAt": "2026-10-07T00:00:00Z"
  }],
  "truncated": false
}
```

## Availability, health and errors

Official `WebSearchProvider.available()` is a synchronous **local** check and explicitly must not call the network. This plugin checks the configured URL, filters, count and fetch transport, and accepts anonymous mode. It cannot prove current network reachability synchronously. Live failures are surfaced when executing a search. Explicit health checking is separate:

```ts
import { CCReachSearchProvider } from 'ccreach-dsh-web-search'

const provider = new CCReachSearchProvider()
const ready = provider.available()
const meta = await provider.health(AbortSignal.timeout(10_000))
const result = await provider.search({ query: 'weather API', maxResults: 10 })
```

`health()` calls the read-only `/api/meta`, validates its shape and returns the metadata. It makes no paid model request or external capability invocation.

| Failure | Standard `WebError.code` |
| --- | --- |
| HTTP status other than exactly 200, network failure, redirect, invalid JSON or invalid mapped response | `WEB_PROVIDER_ERROR` |
| Caller cancellation, including during credentials lookup or body parsing | `WEB_ABORTED` |
| Missing credential when explicitly opting into `requireApiKey: true` | `WEB_PROVIDER_CREDENTIAL_MISSING` |

Transport uses `redirect: error`, does not retry automatically, and does not expose raw server bodies or credential-resolution exceptions in errors.

## Development and npm release

```sh
npm ci
npm test
npm run build
npm run test:live
npm pack --dry-run
npm pack
```

`npm test` runs mocked keyless tests, including the real Cordis/WebRuntime lifecycle. `test:live` is explicit, always anonymous, makes only meta plus one bounded search GET, and updates both example snapshots. It does not call returned providers. The package bundles compiled JS/declarations, the Cordis patch, example snapshots, README and MIT license; tests, development profiles, credentials and `node_modules` are excluded.

Release checklist:

1. Run the commands above; review the `npm pack --dry-run` file list.
2. Verify local profile installation and `searchProvider: ccreach` in `dsh --profile web --dump-config`.
3. Check package name/version availability (`npm view ccreach-dsh-web-search version`) and your npm identity (`npm whoami`). A registry 404 means the name is not currently found, not a reservation.
4. Confirm MIT license, README and peer versions; bump the version if it already exists.
5. After authenticating the intended npm account, publish with `npm publish --access public` (npm may require an OTP or provenance settings).

This implementation has been built, tested and packed locally; creating it does not publish a package to npm or start your real Harness profile.

To verify installation without touching your real profile, set an isolated `DSH_HOME` for that command. PowerShell example:

```powershell
$previousDshHomeForTest = $env:DSH_HOME
try {
  $env:DSH_HOME = Join-Path $PWD '.verification/dsh-home'
  dsh plugin --profile web add .
  dsh --profile web --dump-config
} finally {
  $env:DSH_HOME = $previousDshHomeForTest
}
```

## 中文说明

这是 CCReach 的 DeepSeek Harness 搜索插件。它注册 `ccreach` 搜索提供方，通过 `cordis.patch.yml` 将 web profile 的 `searchProvider` 指向 CCReach。插件返回能力入口及接入条件，不生成答案，也不替用户调用这些能力。

### 安装与凭据

要求 Node.js `^22.19.0 || >=24.0.0`、DSH 和 pnpm。本地已验证 DSH `0.1.0-rc.6`；DSH 仍是开发预览版本。

发布 npm 后安装：

```sh
dsh plugin --profile web add ccreach-dsh-web-search
```

本地开发：先在项目目录执行 `npm ci`、`npm run build`，再从父目录执行：

```sh
dsh plugin --profile web add ./ccreach-dsh-web-search
```

默认匿名访问，不需要 CCReach Key。可选地将 `CCREACH_API_KEY` 写入 `$DSH_HOME/.credentials.yaml`（通常为 `~/.dsh/.credentials.yaml`），或设置同名环境变量。通过 DSH 官方凭据服务每次解析，环境变量优先，密钥更换后下次请求生效。不要把密钥写入插件配置或 Git。仅显式设置 `requireApiKey: true` 时才会因缺少凭据而拒绝请求。

### 配置项与字段

| 配置项 | 默认值 | 含义 |
| --- | --- | --- |
| `baseURL` | `https://ccreach.com` | API 基址。 |
| `category` | 不传 | all/information/data/development/office/media/automation/research/agents。 |
| `kind` | 不传 | all/document/data_source/tool/agent/skill/workflow。 |
| `protocol` | 不传 | all/web/http/mcp/a2a/local。 |
| `free_only` | 不传 | 透传布尔值；未知费用不当作免费。 |
| `executable_only` | 不传 | 透传布尔值；可执行声明不代表执行成功。 |
| `count` | `10` | 默认 limit；请求的 maxResults 优先，上限 50。 |
| `page` | 不传，服务端为 1 | 配置层分页；当前 DSH 请求类型没有分页字段。 |
| `snapshot_id` / `result_set_id` | 不传 | 64 位十六进制标识；独立客户端传 null 时省略。 |
| `apiKeyEnv` | `CCREACH_API_KEY` | 可选凭据引用。 |
| `requireApiKey` | `false` | 为将来显式认证模式预留，默认不启用。 |

| CCReach 字段 | Harness 映射 |
| --- | --- |
| `access.docs_url`，否则 `sources[0].url` | url；两者无有效内容时跳过。 |
| `name` | title。 |
| `summary` | snippet 的第一行，保留原文。 |
| `sources[0].checked_at` | publishedAt，合法日期转为 ISO UTC 零点；这是核验日期。 |
| 类型、协议、费用状态、权限、可执行声明、missing_conditions | snippet 附加的明确标记元信息。 |

不返回 `content`，不将 `access.endpoint` 当成来源网页，不代调能力。英文部分附有真实匿名查询原文与映射示例；完整示例文件在 `examples/`。规格中“共 26 个”实际列出 25 个字段名，测试完整覆盖全部列出的字段，没有添加不存在的字段。Registry 结果缺少部分证据字段时，不会为了凑字段而编造内容。

### 可用性、错误与发布检查

官方规定 `available()` 是同步本地检查，不能联网；因此匿名配置有效、fetch 可用时返回 true。网络是否可达由实际查询或独立 `health()` 检查 `/api/meta`，不能在同步函数中假称已联网核验。

非 200 HTTP、网络失败、重定向、无效 JSON/响应 → `WEB_PROVIDER_ERROR`；中断 → `WEB_ABORTED`；显式认证模式缺少密钥 → `WEB_PROVIDER_CREDENTIAL_MISSING`。不自动重试，不输出原始错误体或凭据。

发布前执行：

```sh
npm ci
npm test
npm run build
npm run test:live
npm pack --dry-run
npm pack
```

确认包文件中没有秘密文件、测试 profile、node_modules；检查本地安装后配置正确，再确认 `npm whoami`、包名与版本。真正发布使用 `npm publish --access public`。当前交付只完成本地开发、测试、构建和打包，没有自动发布 npm，也没有启动你的真实 DSH profile。

## Contract references

- [Official DSH WebSearchProvider contracts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web/src/types.ts)
- [Official DSH web runtime and registration lifecycle](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/web/web/src/index.ts)
- [Bocha upstream plugin registration and credential resolution](https://github.com/bocha-ai/dsh-web-search-bocha/blob/main/src/index.ts)
- [Bocha upstream bundle patch](https://github.com/bocha-ai/dsh-web-search-bocha/blob/main/cordis.patch.yml)
- [CCReach public search](https://ccreach.com/api/search?q=weather&limit=1) and [meta](https://ccreach.com/api/meta)

MIT licensed.
