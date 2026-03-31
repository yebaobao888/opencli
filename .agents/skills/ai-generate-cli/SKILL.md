---
name: ai-generate-cli
description: "AI-driven CLI adapter generation for any website. Replaces rule-based `opencli generate --goal` with semantic browser exploration + LLM generation. Use when user says 'generate cli', 'create adapter', 'add command for website', or provides a URL + goal wanting a new opencli command."
---

# AI Generate CLI

> 给一个 URL + Goal（自然语言），AI 自主探索网站并生成 opencli adapter。
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
| **Type** | ❌ | `yaml` 或 `ts`（不指定则 AI 根据复杂度自动判断） |

## 输出

与 `opencli generate` 完全一致：
- **用户全局目录**（推荐）：生成到 `~/.opencli/clis/<site>/` 下，全局安装的 opencli 自动发现
- **源码目录**（开发模式）：如在 opencli 源码仓库内开发，可放到 `src/clis/<site>/`
- 文件遵循 opencli 的命令注册规范，保存即自动发现

> **判断规则**：如果当前工作目录是 opencli 源码仓库（存在 `src/clis/`），则放 `src/clis/<site>/`；否则放 `~/.opencli/clis/<site>/`。

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
- 判断认证策略：

```
fetch(url) 直接成功？              → Tier 1: public  (YAML, browser: false)
fetch(url, {credentials:'include'})？ → Tier 2: cookie  (YAML, browser: true)
需要加 Bearer/CSRF header？         → Tier 3: header  (TS)
fetch 全失败但页面自己能请求？        → Tier 4: intercept (TS, installInterceptor)
完全没有 API，只能 DOM 解析？        → Tier 5: ui (TS)
```

### Step 4: 生成 adapter 文件

根据 Step 3 判定的策略和分析结果，生成 adapter。

**选择 YAML vs TS 的决策**：
- Tier 1 (public) / Tier 2 (cookie) → **YAML**（除非响应需要复杂处理）
- Tier 3 (header) / Tier 4 (intercept) / Tier 5 (ui) → **TS**
- 嵌入 JS 超过 10 行 → **TS**

#### YAML 模板（Tier 1/2）

```yaml
site: <site>
name: <name>
description: "<goal 的简要描述>"
domain: <domain>
strategy: cookie        # 或 public
browser: true           # public 时为 false

args:
  limit:
    type: int
    default: 20
    description: Number of items to return

pipeline:
  - navigate: <target_url>

  - evaluate: |
      (async () => {
        const res = await fetch('<api_url>', { credentials: 'include' });
        const d = await res.json();
        return (d.<data_path> || []).map(item => ({
          <field1>: item.<source_field1>,
          <field2>: item.<source_field2>,
        }));
      })()

  - map:
      rank: ${{ index + 1 }}
      <field1>: ${{ item.<field1> }}
      <field2>: ${{ item.<field2> }}

  - limit: ${{ args.limit }}

columns: [rank, <field1>, <field2>]
```

#### TS 模板（Tier 3/4/5）

```typescript
import { cli, Strategy } from '../../registry.js';

cli({
  site: '<site>',
  name: '<name>',
  description: '<goal 的简要描述>',
  domain: '<domain>',
  strategy: Strategy.<STRATEGY>,
  browser: true,
  args: [
    { name: 'limit', type: 'int', default: 20, help: 'Number of items to return' },
  ],
  columns: ['rank', '<field1>', '<field2>'],
  func: async (page, kwargs) => {
    // ... AI 根据实际情况生成
  },
});
```

**生成规则**：
1. 主参数用 positional arg（如 `query`、`id`）
2. 命令名用 kebab-case
3. 参考同 site 已有的 adapter 风格（先 `ls src/clis/<site>/`）
4. 如果 site 有 `utils.ts`，复用其 helper 函数

### Step 5: 构建验证

```bash
# 1. 编译检查
npx tsc --noEmit

# 2. 确认命令已注册
npx tsx src/main.ts list | grep <site>

# 3. 实际运行
npx tsx src/main.ts <site> <name> --limit 3
```

验证通过后向用户报告结果。

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
- **先看已有 adapter**：生成前先 `ls src/clis/<site>/` 检查是否已有类似命令
- **遵循收口规则**：参见 SKILL.md 顶部的 3 条规则（positional arg、CliError、更新文档）
- **参考 CLI-EXPLORER.md**：如遇复杂认证场景，查阅完整策略决策树
