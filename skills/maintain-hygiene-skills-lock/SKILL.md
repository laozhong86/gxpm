---
name: maintain-hygiene-skills-lock
description: 维护 skills-lock.json 完整性锁。在新增、修改或删除 skill 时更新锁文件。
---
<!-- AUTO-GENERATED from SKILL.md.tmpl - do not edit directly -->

# maintain-hygiene-skills-lock

## 入口条件

- `skills/` 目录发生变更（新增、修改、删除 skill）
- `skills-lock.json` 与当前 skill 内容不一致
- `bun run check` 报 `skills-lock: hash mismatch` 或 `not listed`

## 流程

### 1. 重新计算哈希

运行以下脚本重新生成 `skills-lock.json`：

```bash
python3 -c "
import json, hashlib
from pathlib import Path
lock = {'version': 1, 'skills': {}}
for d in sorted(Path('skills').iterdir()):
    p = d / 'SKILL.md'
    if p.exists():
        lock['skills'][d.name] = hashlib.sha256(p.read_bytes()).hexdigest()
print(json.dumps(lock, indent=2, ensure_ascii=False))
"
```

### 2. 写入 skills-lock.json

将输出写入 `skills-lock.json`。

### 3. 验证

运行 `bun run check` 确认 `skills-lock` 校验通过。

## 出口条件

- [ ] `bun run check` 通过
- [ ] `skills-lock.json` 中所有 skill 的哈希与实际文件一致
- [ ] 没有未列入 `skills-lock.json` 的 skill
- [ ] 没有已删除但仍在 `skills-lock.json` 中的 skill

## 红旗

- **不要**手动编辑 `skills-lock.json` 中的哈希值；始终通过脚本重新生成
- 删除 skill 时必须同步删除 `skills-lock.json` 中的对应条目
- 新增 skill 必须立即加入 `skills-lock.json` 并提交
- `SKILL.md` 是生成产物时，以 `.tmpl` 为真值计算哈希（如技能使用模板生成）
