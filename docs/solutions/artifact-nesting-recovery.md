---
title: "artifact write 嵌套 payload 的修复"
category: "recovery"
date: "2026-05-04"
severity: "low"
component: "gxpm-cli"
tags: ["artifact", "cli", "json"]
---

# artifact write 嵌套 payload 的修复

## 场景

使用 `gxpm artifact write` 直接传入包含 `payload` 字段的 JSON 时，CLI 可能将整个 JSON 包装为新的 `payload`，导致双重嵌套。

## 症状

读取 artifact 时看到结构：
```json
{
  "payload": {
    "payload": {
      "criteria": [...]
    }
  }
}
```

## 解决步骤

1. **确认嵌套层级**
   ```bash
   ./bin/gxpm artifact read <issue-id> <artifact-type>
   ```

2. **重写 artifact（只传 payload 内容）**
   ```bash
   ./bin/gxpm artifact write <issue-id> <artifact-type> --json '{
     "criteria": [...],
     "status": "ready"
   }'
   ```
   注意：不传外层的 `schemaVersion`、`issueId`、`type` 等字段，CLI 会自动填充。

3. **验证修复**
   ```bash
   ./bin/gxpm artifact read <issue-id> <artifact-type> | jq '.payload'
   ```

## 预防措施

- 使用 `artifact write` 时只提供业务数据（criteria、steps 等）
- 不要手动构造完整的 artifact envelope
- 不确定时先用 `artifact read` 查看当前结构

## 相关

- `core/artifacts.ts` — artifact 序列化逻辑
