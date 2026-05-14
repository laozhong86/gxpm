# Perplexity 团队内部 Agent Skills 设计、迭代与维护之道

> **作者：** meng shao (@shao__meng)  
> **来源：** https://x.com/shao__meng/status/2053098123074105705  
> **发布时间：** 2026-05-09 06:01  
> **互动数据：** 4 回复, 24 转发, 143 点赞, 162 收藏, 13.2K 浏览

---

Perplexity Agents 团队的内部规范公开版，核心论点很反直觉：

> **写 Skill 不是写代码，而是为模型构建上下文。**  
> 把工程师写代码的本能直接套到 Skill 上，几乎一定会失败。

原文链接：https://research.perplexity.ai/articles/designing-refining-and-maintaining-agent-skills-at-perplexity

---

## Skill ≠ 代码，以 Python 信条和 Skill 反信条为例

| Python 信条 | Skill 反信条 |
|------------|-------------|
| Simple is better than complex | **Skill 是文件夹，复杂性是特性** |
| Explicit is better than implicit | **激活靠隐式模式匹配 + 渐进披露** |
| Sparse is better than dense | **每 token 都要榨出最大信号** |
| 特例不应破坏规则 | **Gotchas 才是最高价值内容** |
| 容易解释的实现是好实现 | **容易解释的，模型已经会了 → 删掉** |

---

## Skill 的四重定义

### 1. Skill 是目录（不是单文件）

- **标准结构：** `SKILL.md` + `scripts/` + `references/` + `assets/` + `config.json`
- **复杂领域用多级层次**
  - 例：美国税法有 1945 个 IRC 条款，扁平加载比不加载效果更差；分三级嵌套后才可用
  - 但层次本身有代价，需要导航工具（quick reference、自定义检索）来对冲间接性

### 2. Skill 是格式

- **frontmatter 必须有：**
  - `name`（小写、连字符、与目录同名）
  - `description`
- **description 是路由触发器，不是文档**
  - ❌ 常见错误：`「This Skill does X」`
  - ✅ 正确写法：`「Load when …」`
- **`depends:`** 用于级联依赖；运行时元数据可用辅助 JSON/YAML 隔离，避免污染上下文

### 3. Skill 是可调用的

**加载流程：**
```
load_skill() → 拷贝目录入沙箱 → 递归装依赖 → 剥离 frontmatter，仅暴露 body 与附属文件
```

### 4. Skill 是渐进式的（这是最重要的成本模型）

| 层级 | 内容 | 大小 | 生命周期 |
|------|------|------|----------|
| **Index** | 所有 Skill 的 name+description | ~100 tokens/Skill | 每次会话、每个用户、**永远** |
| **Load** | SKILL.md body | ~5,000 tokens | 一次加载，会话内持续占用 |
| **Runtime** | scripts / references / 子 Skill | 无上界 | 仅模型实际读取时 |

> **→ 越靠上的层，每个字越贵。**  
> **Index 是「奢侈品柜台」，Runtime 是「无限仓库」。**

---

## 什么时候不需要 Skill

反复强调 **「Every Skill is a tax」**。三类典型滥用：

1. **模型已会的** — 写一串 git 命令 → 是好文档，是坏 Skill
2. **重复 system prompt 的** — 通用知识应进全局上下文，不该走条件加载
3. **变化太快的** — 远端 MCP 工具版本频繁变 → Skill 会漂移导致幻觉

**判断单句是否该留的尺子：**
> 「没有这句话，Agent 会做错吗？」  
> 答否即删。

引用 Pascal：
> 「这封信写得长，是因为我没时间写短。」

—— 写短 Skill 很难；写得快的 Skill 大概率有问题。

还引了一篇研究：**LLM 自生成的 Skill 平均无收益**，因为模型无法可靠地把"自己消费有用的程序性知识"写出来。

---

## 构建五步法（顺序不可调）

### Step 0 — 先写 Evals

- 源自真实查询、已知失败、邻域混淆
- **负例往往比正例更重要**

### Step 1 — 写 Description（最难的一行）

- 以 `"Load when…"` 开头，≤ 50 词
- 描述用户意图（用真实抱怨语：`「babysit」` `「watch CI」` `「make sure this lands」`）
- **不要总结工作流**
- **唯一目标：** 路由准确，最小化对其他 Skill 的回归影响

### Step 2 — 写 Body

- **跳过显然的**
- **不要罗列命令序列**
- **用意图陈述代替过程脚本**

❌ 反面示例：
```
git log; git checkout main; git checkout -b; git cherry-pick
```

✅ 正确写法：
```
"Cherry-pick 到干净分支，保留意图解决冲突，落不下时说明原因。"
```

**重点放 gotchas / 负例。**

### Step 3 — 用层次结构

条件性、重型、模板类内容拆到 `scripts/`、`references/`、`assets/`、`config.json`

### Step 4 — 迭代

- 用一个评测集做**小词级调优**
- 描述里**一字之差就能引发路由级联**

### Step 5 — Ship

---

## 维护：Gotchas 飞轮

Skill 是 **「仅追加为主」** 的：

| 问题 | 对策 |
|------|------|
| Agent 错了 | → 加 gotcha |
| 误加载 | → 收紧描述 + 加负例 |
| 该加载没加载 | → 加关键词 + 加正例 |
| system prompt 变了 | → 检查冲突与重复 |

从 80/20 走向 99.9% 的过程，**几乎全靠 gotcha 列表生长**，而不是改描述或加更长的指令。

> 一旦 PR 改描述却没附 evals，"已经走偏了"。

---

## 评测套件分四类

1. **加载评测：** 精度、召回、禁止加载（避免污染邻域）
2. **渐进加载评测：** Skill 加载后是否正确读取附属文件（如 FORMATTING.md）
3. **端到端任务评测：** 跑完整 agent loop，用 LLM judge 按 rubric 打分
4. **跨模型评测：** 在 GPT / Opus / Sonnet 上同时跑（行为差异显著）

---

## 关键 Takeaway

1. **先 evals，后 Skill**；负例与「禁止误载」与正例同等重要
2. **Description 是最难的一行**，以 `"Load when…"` 起手
3. **Gotchas 是最高价值内容**，从薄起步、随失败生长
4. **Action at a distance：** 新增 Skill 会悄无声息地降级现有 Skill —— 这是默认风险，不是边角情况
5. **写 Skill 的能力本身在复利增长**；任何按日/周/季重复的工作流，都是潜在 Skill
