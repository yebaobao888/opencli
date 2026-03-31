---
name: ai-generate-cli
description: "AI-driven CLI adapter generation for any website. Replaces rule-based `opencli generate --goal` with semantic browser exploration + LLM generation. Use when user says 'generate cli', 'create adapter', 'add command for website', or provides a URL + goal wanting a new opencli command."
---

# AI Generate CLI

> 给一个 URL + Goal（自然语言），AI 自主探索网站并生成 opencli YAML adapter。
> 替代规则驱动的 `opencli generate --goal`，零硬编码规则，纯语义理解。

## When to Use

- 用户说"为 xxx 网站生成 CLI"
- 用户说"给这个 URL 创建一个命令"
- 用户提供 URL + 自然语言描述想要的功能
- 任何需要从零为新网站/新页面生成 opencli adapter 的场景

## Prerequisites

- Chrome 浏览器已运行，CDP 端口 18800 可用
- 用户已在 Chrome 中登录目标网站（如果需要认证）
- agent-browser 可用

## 输入

| 项目 | 必需 | 示例 |
|------|------|------|
| **URL** | ✅ | `https://www.zhihu.com/hot` |
| **Goal** | ✅ | "获取热榜列表，包含标题、热度、链接" |
| **Site** | ❌ | `zhihu`（不提供则从 URL 自动推断） |

## 输出

- 生成 **YAML 格式** adapter 到 `~/.opencli/clis/<site>/<name>.yaml`
- 全局安装的 `opencli` 自动发现，无需编译
- ⚠️ **不要生成 TS 文件到用户目录** — 全局 `opencli` 因 shim 链路问题无法加载 TS adapter

---

## YAML Pipeline 执行引擎参考

生成 YAML 之前，你**必须**理解 opencli 的 pipeline 执行机制。YAML 文件不是静态配置，它是一个**可执行的数据管道**。

### Schema（顶层字段）

```yaml
site: <string>           # 站点标识（如 zhihu、github）
name: <string>           # 命令名（kebab-case）
description: <string>    # 命令描述
domain: <string>         # 站点域名
strategy: <string>       # public | cookie | intercept
browser: <boolean>       # 是否需要浏览器会话
timeout: <number>        # 超时秒数（可选）
navigateBefore: <bool|string>  # 自动导航（可选，值为 true 或 URL 字符串）

args: <Record>           # 参数定义
columns: <string[]>      # 表格输出列
pipeline: <Step[]>       # 执行管道
```

### 参数定义（args）

```yaml
args:
  query:                     # 参数名
    type: str                # str | int | bool
    required: true           # 是否必需
    positional: true         # true = 位置参数，不用 --query
    description: Search term
    default: ""              # 默认值
    choices: [a, b, c]       # 可选值枚举
```

### 全部 16 个 Pipeline 步骤

引擎按顺序执行 pipeline 数组中的每个步骤，**上一步的返回值作为下一步的 `data` 输入**。

#### 🌐 浏览器步骤（需要 `browser: true`）

| 步骤 | 用途 | 示例 |
|------|------|------|
| `navigate` | 打开 URL | `- navigate: https://example.com` |
| `evaluate` | 在页面中执行 JS，返回值作为 data | `- evaluate: \| ...JS代码...` |
| `click` | 点击元素 | `- click: "#submit-btn"` |
| `type` | 输入文本 | `- type: { ref: "#search", text: "${{ args.query }}", submit: true }` |
| `wait` | 等待（秒数或文本出现） | `- wait: 3` 或 `- wait: { text: "Loaded", timeout: 10 }` |
| `press` | 按键 | `- press: Enter` |
| `snapshot` | 获取页面快照（调试用） | `- snapshot: { interactive: true }` |
| `intercept` | 拦截网络请求 | 见下方示例 |
| `tap` | 触发 Pinia/Vuex Store Action 并捕获 API | 见下方示例 |

#### 📡 HTTP 步骤（不需要浏览器）

| 步骤 | 用途 | 示例 |
|------|------|------|
| `fetch` | 发送 HTTP 请求 | `- fetch: { url: "...", params: { q: "${{ args.query }}" } }` |

#### 🔄 数据变换步骤

| 步骤 | 用途 | 示例 |
|------|------|------|
| `select` | 从 data 中提取子路径 | `- select: data.list` |
| `map` | 遍历数组，映射字段 | `- map: { title: "${{ item.name }}" }` |
| `filter` | 过滤数组 | `- filter: item.score > 10` |
| `sort` | 排序 | `- sort: { by: score, order: desc }` |
| `limit` | 截取前 N 条 | `- limit: "${{ args.limit }}"` |

#### 📥 下载步骤

| 步骤 | 用途 | 示例 |
|------|------|------|
| `download` | 批量下载文件 | `- download: { url: "${{ item.src }}", dir: ./out, concurrency: 5 }` |

### 模板语法 `${{ }}`

模板表达式在 pipeline 的 params 中使用，**不是在 evaluate 的 JS 代码中使用**。

**可用变量**：

| 变量 | 含义 | 作用域 |
|------|------|--------|
| `args` | 用户传入的命令行参数 | 全局 |
| `data` | 上一步的输出 | 全局 |
| `item` | 当前遍历的元素 | map / filter / fetch(批量) |
| `index` | 当前索引 | map / filter |

**管道过滤器**（`${{ value \| filter }}`）：

| 过滤器 | 用途 | 示例 |
|--------|------|------|
| `default(val)` | 默认值 | `${{ args.limit \| default(20) }}` |
| `json` | JSON 序列化 | `${{ args.mode \| json }}` |
| `join(sep)` | 数组拼接 | `${{ item.tags \| join(', ') }}` |
| `upper` / `lower` | 大小写 | `${{ item.name \| upper }}` |
| `truncate(n)` | 截断 | `${{ item.title \| truncate(50) }}` |
| `trim` | 去空白 | `${{ item.text \| trim }}` |
| `replace(old,new)` | 替换 | `${{ item.url \| replace('http','https') }}` |
| `keys` / `length` | 对象键/长度 | `${{ item.list \| length }}` |
| `first` / `last` | 首/末元素 | `${{ item.list \| first }}` |
| `slugify` | URL 安全 slug | `${{ item.title \| slugify }}` |
| `sanitize` | 安全文件名 | `${{ item.name \| sanitize }}` |
| `urlencode` | URL 编码 | `${{ args.query \| urlencode }}` |
| `ext` / `basename` | 文件扩展名/文件名 | `${{ item.url \| basename }}` |

**JS 表达式**：`${{ }}` 内支持完整 JS（三元、算术、`||`、`??` 等），在 node:vm 沙箱中执行：

```yaml
- fetch:
    url: "https://api.example.com/${{ args.sort === 'date' ? 'search_by_date' : 'search' }}"
```

---

## 工作流程（5 步）

### Step 1: 打开页面 + 理解页面结构

```bash
# 连接 CDP
CDP_PORT=18800
WS_URL=$(curl -s "http://127.0.0.1:$CDP_PORT/json/version" | python3 -c "import json,sys; print(json.load(sys.stdin)['webSocketDebuggerUrl'])")
AB="agent-browser --cdp $WS_URL"

# 导航到目标 URL
$AB open <URL>
$AB wait --load networkidle
$AB snapshot -i
```

**AI 在此步骤要做的**：
- 阅读 snapshot 输出，理解页面类型（列表页？搜索页？详情页？个人中心？）
- 识别与 Goal 相关的 UI 区域和数据内容
- 判断是否需要交互（点击按钮/切换 Tab）才能触发目标数据的 API

### Step 2: 抓包 + 语义筛选 API

```bash
# 获取网络请求
$AB network --filter json
```

如果首次抓包没有发现目标 API，主动交互触发：

```bash
# 根据 Step 1 的 snapshot 发现的交互元素
$AB click @e<N>           # 点击相关按钮/Tab
$AB scroll down 1000      # 滚动触发懒加载
$AB wait 2000
$AB network --filter json  # 再次抓包
```

**AI 在此步骤要做的**：
- 从所有 JSON 请求中，用 **语义理解** 找到与 Goal 最匹配的 API
- 不是靠 URL 关键词匹配（如 `/hot`），而是理解每个 API 返回的**数据内容**
- 记录目标 API 的：URL、Method、关键 Headers

### Step 3: 验证 API + 分析响应结构

在浏览器中用 fetch 复现请求，验证 API 可用性：

```bash
$AB execute "fetch('<api_url>', {credentials: 'include'}).then(r=>r.json()).then(d=>JSON.stringify(d).slice(0,3000))"
```

**AI 在此步骤要做的**：
- 验证 API 能否复现
- 分析 JSON 响应结构，找到数据数组的路径（如 `data.list`、`data.items`）
- 识别每个字段的语义含义（哪个是标题？链接？作者？时间？分数？）
- **判断认证策略** → 决定 pipeline 模式：

| 测试结果 | 策略 | YAML 配置 | Pipeline 模式 |
|----------|------|-----------|---------------|
| `fetch(url)` 直接成功 | Tier 1: public | `strategy: public`, `browser: false` | 用 `fetch` 步骤 |
| `fetch(url, {credentials:'include'})` 成功 | Tier 2: cookie | `strategy: cookie`, `browser: true` | 用 `navigate` + `evaluate`（内嵌 fetch） |
| 需要 Bearer/CSRF header | Tier 3: header | `strategy: cookie`, `browser: true` | 用 `navigate` + `evaluate`（内嵌 fetch + header） |
| fetch 全失败但页面自己能请求 | Tier 4: intercept | `strategy: intercept`, `browser: true` | 用 `navigate` + `intercept` 或 `tap` |
| 完全没有 API，只能 DOM 解析 | Tier 5: DOM | `strategy: cookie`, `browser: true` | 用 `navigate` + `wait` + `evaluate`（DOM 解析） |

### Step 4: 生成 adapter 文件

根据 Step 3 判定的策略和分析结果，生成 adapter。

**⚠️ 关键规则：统一生成 YAML 格式**

本 skill 生成的 adapter **一律使用 YAML 格式**，输出到 `~/.opencli/clis/<site>/` 目录。

---

#### 模式 A: Public API（Tier 1）— 最简洁

无需浏览器，直接 HTTP 请求。优先使用 `fetch` + `select` 步骤组合。

```yaml
site: hackernews
name: search
description: Search Hacker News stories
domain: news.ycombinator.com
strategy: public
browser: false

args:
  query:
    type: str
    required: true
    positional: true
    description: Search query
  limit:
    type: int
    default: 20
    description: Number of results

pipeline:
  - fetch:
      url: "https://hn.algolia.com/api/v1/search"
      params:
        query: ${{ args.query }}
        tags: story
        hitsPerPage: ${{ args.limit }}

  - select: hits

  - map:
      rank: ${{ index + 1 }}
      title: ${{ item.title }}
      score: ${{ item.points }}
      author: ${{ item.author }}
      url: ${{ item.url }}

  - limit: ${{ args.limit }}

columns: [rank, title, score, author, url]
```

**要点**：
- `fetch` 步骤支持 `url`、`method`、`params`（query string）、`headers`
- `fetch` 还支持批量请求：当 data 是数组且 url 模板引用 `item` 时，自动并发请求
- 用 `select` 步骤提取子路径（如 `hits`），比在 evaluate 里写 JS 更简洁
- `filter` 步骤可过滤无效数据：`- filter: item.title && !item.deleted`

#### 模式 B: Cookie 认证（Tier 2-3）— 最常见

需要浏览器传递 cookie。用 `navigate` + `evaluate` 组合。

```yaml
site: pixiv
name: ranking
description: Pixiv illustration rankings
domain: www.pixiv.net
strategy: cookie
browser: true

args:
  mode:
    type: str
    default: daily
    description: Ranking mode
    choices: [daily, weekly, monthly]
  limit:
    type: int
    default: 20
    description: Number of results

pipeline:
  - navigate: https://www.pixiv.net

  - evaluate: |
      (async () => {
        const mode = ${{ args.mode | json }};
        const limit = ${{ args.limit | json }};
        const res = await fetch(
          'https://www.pixiv.net/ranking.php?mode=' + mode + '&format=json',
          { credentials: 'include' }
        );
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        return (data.contents || []).slice(0, limit).map((item, i) => ({
          rank: item.rank,
          title: item.title,
          author: item.user_name,
          url: 'https://www.pixiv.net/artworks/' + item.illust_id
        }));
      })()

columns: [rank, title, author, url]
```

**要点**：
- `navigate` 先打开同域页面，让浏览器建立 cookie 上下文
- `evaluate` 内的 JS 在页面上下文中执行，`credentials: 'include'` 自动携带 cookie
- **在 evaluate 内的 JS 代码中**，用 `${{ args.xxx | json }}` 注入参数（`json` 过滤器确保正确序列化）
- 如果 API 需要 CSRF token：在 JS 中用 `document.cookie.match(...)` 提取

#### 模式 C: Store Action 拦截（Tier 4）— SPA 专用

适用于 Vue/React SPA 框架，直接触发 Store Action 并捕获 API 响应。

```yaml
site: xiaohongshu
name: feed
description: "小红书首页推荐 Feed"
domain: www.xiaohongshu.com
strategy: intercept
browser: true

args:
  limit:
    type: int
    default: 20
    description: Number of items

pipeline:
  - navigate: https://www.xiaohongshu.com/explore
  - tap:
      store: feed               # Pinia store 名称
      action: fetchFeeds        # 要调用的 action
      capture: homefeed         # 要捕获的 API URL 模式（支持正则）
      select: data.items        # 从响应中提取的子路径
      timeout: 8
  - map:
      title: ${{ item.note_card.display_title }}
      author: ${{ item.note_card.user.nickname }}
      likes: ${{ item.note_card.interact_info.liked_count }}
      url: https://www.xiaohongshu.com/explore/${{ item.id }}
  - limit: ${{ args.limit | default(20) }}

columns: [title, author, likes, url]
```

**`tap` 步骤参数**：
- `store`: Pinia/Vuex store 名称
- `action`: 要调用的 action 方法名
- `args`: 传给 action 的参数数组（可选）
- `capture`: API URL 匹配模式（字符串或正则）
- `select`: 从捕获的响应中提取子路径
- `timeout`: 等待捕获的超时秒数
- `framework`: 强制指定框架（`pinia` 或 `vuex`，默认自动检测）

**`intercept` 步骤**（更通用的拦截）：
```yaml
- intercept:
    trigger: "navigate:https://example.com/page"  # 或 click:@e123 / evaluate:... / scroll
    capture: "/api/data"
    select: data.list
    timeout: 8
```

#### 模式 D: DOM 解析（Tier 5）— 兜底

完全没有 API，从页面 DOM 中提取数据。

```yaml
site: example
name: list
description: Extract data from page DOM
domain: example.com
strategy: cookie
browser: true

args:
  limit:
    type: int
    default: 20

pipeline:
  - navigate: https://example.com/list
  - wait: 3
  - evaluate: |
      (() => {
        const cards = document.querySelectorAll('.card-item');
        return [...cards].map((card, i) => ({
          rank: i + 1,
          title: card.querySelector('.title')?.textContent?.trim(),
          link: card.querySelector('a')?.href,
        }));
      })()
  - limit: ${{ args.limit }}

columns: [rank, title, link]
```

---

### 生成规则

1. **策略选择优先级**：Tier 1 (`fetch`) > Tier 2-3 (`evaluate` + fetch) > Tier 4 (`tap`/`intercept`) > Tier 5 (DOM)
   — 能用 `fetch` 步骤就不用 `evaluate` 内嵌 fetch；能用 API 就不解析 DOM
2. **主参数用 positional**：如 `query`、`id`、`username` 设 `positional: true`，用户可以 `opencli site cmd value` 直接使用
3. **命令名用 kebab-case**：如 `hot-list`、`user-profile`
4. **文件输出到**：`~/.opencli/clis/<site>/<name>.yaml`
5. **不硬编码敏感信息**：不要在 YAML 中写入 token、密码或用户 ID

### Step 5: 验证

```bash
# 1. 确认命令已注册
opencli list | grep <site>

# 2. 实际运行
opencli <site> <name> --limit 3
```

验证通过后向用户报告结果。如果失败，根据错误信息调整 YAML 并重试。

---

## 与 `opencli generate --goal` 的对比

| 维度 | `generate --goal`（规则驱动） | 本 Skill（AI 驱动） |
|------|-------------------------------|---------------------|
| Goal 理解 | 9 种硬编码别名 | 任意自然语言 |
| API 筛选 | 规则打分 (score ≥ 5) | 语义理解 |
| 字段识别 | 关键词匹配 (`title`/`url`) | AI 理解字段含义 |
| 认证判断 | Header 规则检测 | AI 综合判断 |
| 模板生成 | 固定模板拼接 | AI 按需生成 |
| 泛化性 | 仅支持已知模式 | 任意网站 |
| 交互探索 | 固定滚动 3 次 | AI 智能交互 |

## 注意事项

- **隐私安全**：不要在生成的代码中硬编码任何 token、密码或用户 ID
- **先看已有 adapter**：生成前先 `ls ~/.opencli/clis/<site>/` 和 `ls src/clis/<site>/` 检查是否已有类似命令
- **参考 CLI-EXPLORER.md**：如遇复杂认证场景，查阅完整策略决策树
