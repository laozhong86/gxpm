# artifact read 读取访问

<cite>
**本文档引用的文件**
- [artifacts.ts](file://core/artifacts.ts)
- [gxpm.ts](file://scripts/gxpm.ts)
- [gxpm-cli.test.ts](file://test/gxpm-cli.test.ts)
- [artifacts.test.ts](file://test/artifacts.test.ts)
- [phase-artifact-commands.ts](file://scripts/phase-artifact-commands.ts)
- [package.json](file://package.json)
- [bin/gxpm](file://bin/gxpm)
</cite>

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构概览](#架构概览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考虑](#性能考虑)
8. [故障排除指南](#故障排除指南)
9. [结论](#结论)

## 简介

artifact read 命令是 gxpm 项目管理工具中的一个核心功能，用于读取和显示指定类型的产物（artifact）内容。该命令允许用户以 JSON 格式查看项目中特定问题（issue）的产物数据，支持多种产物类型，并提供完整的错误处理机制。

## 项目结构

gxpm 项目采用模块化架构设计，artifact read 功能主要涉及以下关键文件：

```mermaid
graph TB
subgraph "CLI 层"
BIN[bin/gxpm<br/>入口脚本]
GXPM[scripts/gxpm.ts<br/>主命令处理器]
end
subgraph "核心逻辑层"
ARTIFACTS[core/artifacts.ts<br/>产物读取核心]
STATE[core/state.ts<br/>状态管理]
end
subgraph "测试层"
CLI_TEST[test/gxpm-cli.test.ts<br/>CLI 测试]
ART_TEST[test/artifacts.test.ts<br/>核心功能测试]
end
BIN --> GXPM
GXPM --> ARTIFACTS
ARTIFACTS --> STATE
CLI_TEST --> GXPM
ART_TEST --> ARTIFACTS
```

**图表来源**
- [bin/gxpm:1-18](file://bin/gxpm#L1-L18)
- [scripts/gxpm.ts:11-11](file://scripts/gxpm.ts#L11-L11)
- [core/artifacts.ts:1-8](file://core/artifacts.ts#L1-L8)

**章节来源**
- [package.json:1-25](file://package.json#L1-L25)
- [bin/gxpm:1-18](file://bin/gxpm#L1-L18)

## 核心组件

### 命令语法和参数

artifact read 命令的完整语法如下：
```
gxpm artifact read <issue-id> <type>
```

**必需参数：**
- `issue-id`: 问题标识符，格式为 `GXPM-XXXX`
- `type`: 产物类型，必须是预定义的受支持类型之一

**命令执行流程：**
1. 验证必需参数
2. 调用核心读取函数
3. 将结果以 JSON 格式输出到标准输出

### 支持的产物类型

系统支持以下 12 种产物类型：

| 类型名称 | 描述 |
|---------|------|
| `issue-intake` | 问题接收 |
| `triage-report` | 问题分类报告 |
| `acceptance-contract` | 接受契约 |
| `implementation-plan` | 实施计划 |
| `dispatch-handoff` | 派发交接 |
| `local-verify` | 本地验证 |
| `acceptance-check` | 接受检查 |
| `self-review` | 自我审查 |
| `ship-readiness` | 发运准备 |
| `pr-check` | PR 检查 |
| `verify-findings` | 验证发现 |
| `qa-findings` | 质量保证发现 |
| `land-findings` | 上线发现 |

**章节来源**
- [core/artifacts.ts:10-24](file://core/artifacts.ts#L10-L24)
- [scripts/gxpm.ts:218-224](file://scripts/gxpm.ts#L218-L224)

## 架构概览

artifact read 命令的完整执行流程如下：

```mermaid
sequenceDiagram
participant User as 用户
participant CLI as CLI 入口
participant Handler as 命令处理器
participant ArtCore as 产物核心
participant FS as 文件系统
User->>CLI : gxpm artifact read <issue-id> <type>
CLI->>Handler : 解析命令参数
Handler->>Handler : 验证必需参数
Handler->>ArtCore : readArtifact({issueId, type})
ArtCore->>FS : 检查产物文件存在性
FS-->>ArtCore : 文件存在状态
ArtCore->>FS : 读取 JSON 文件
FS-->>ArtCore : 返回文件内容
ArtCore-->>Handler : 返回产物对象
Handler->>Handler : JSON 序列化缩进 2 空格
Handler-->>User : 输出 JSON 格式结果
Note over Handler,FS : 错误处理
Handler->>Handler : 参数缺失时抛出错误
ArtCore->>Handler : 文件不存在时抛出错误
ArtCore->>Handler : 类型无效时抛出错误
```

**图表来源**
- [scripts/gxpm.ts:218-224](file://scripts/gxpm.ts#L218-L224)
- [core/artifacts.ts:93-104](file://core/artifacts.ts#L93-L104)

## 详细组件分析

### 命令处理器实现

命令处理器负责解析用户输入并调用相应的核心功能：

```mermaid
flowchart TD
Start([开始执行]) --> ParseArgs["解析命令参数"]
ParseArgs --> ValidateArgs{"验证必需参数"}
ValidateArgs --> |参数缺失| ThrowError["抛出使用错误"]
ValidateArgs --> |参数有效| CallCore["调用 readArtifact 函数"]
CallCore --> ProcessResult["处理返回结果"]
ProcessResult --> FormatJSON["格式化为 JSON2 空格缩进"]
FormatJSON --> Output["输出到标准输出"]
Output --> End([结束])
ThrowError --> End
```

**图表来源**
- [scripts/gxpm.ts:218-224](file://scripts/gxpm.ts#L218-L224)

### 核心读取逻辑

核心读取函数实现了完整的文件操作和验证流程：

```mermaid
flowchart TD
Start([readArtifact 调用]) --> ValidateType["验证产物类型"]
ValidateType --> GetPaths["获取问题路径"]
GetPaths --> BuildPath["构建文件路径"]
BuildPath --> CheckExists{"文件是否存在"}
CheckExists --> |不存在| ThrowNotFound["抛出 'Artifact not found' 错误"]
CheckExists --> |存在| ReadFile["读取文件内容"]
ReadFile --> ParseJSON["解析 JSON 内容"]
ParseJSON --> ReturnResult["返回产物对象"]
ThrowNotFound --> End([结束])
ReturnResult --> End
```

**图表来源**
- [core/artifacts.ts:93-104](file://core/artifacts.ts#L93-L104)
- [core/artifacts.ts:163-168](file://core/artifacts.ts#L163-L168)

### 数据结构定义

产物读取操作涉及以下核心数据结构：

```mermaid
classDiagram
class ReadArtifactInput {
+root : string
+issueId : string
+type : string
}
class StoredArtifact {
+schemaVersion : number
+issueId : string
+type : string
+writtenAt : string
+payload : unknown
}
class ArtifactRecord {
+schemaVersion : number
+type : string
+path : string
+writtenAt : string
}
ReadArtifactInput --> StoredArtifact : "读取结果"
StoredArtifact --> ArtifactRecord : "索引记录"
```

**图表来源**
- [core/artifacts.ts:43-55](file://core/artifacts.ts#L43-L55)
- [core/artifacts.ts:35-41](file://core/artifacts.ts#L35-L41)
- [core/artifacts.ts:28-33](file://core/artifacts.ts#L28-L33)

**章节来源**
- [core/artifacts.ts:28-41](file://core/artifacts.ts#L28-L41)
- [scripts/gxpm.ts:218-224](file://scripts/gxpm.ts#L218-L224)

## 依赖关系分析

artifact read 命令的依赖关系图：

```mermaid
graph LR
subgraph "外部依赖"
BUN[Bun 运行时]
NODE[Node.js 文件系统]
end
subgraph "内部模块"
BIN[bin/gxpm]
GXPM[scripts/gxpm.ts]
ARTIFACTS[core/artifacts.ts]
STATE[core/state.ts]
end
subgraph "测试模块"
CLI_TEST[test/gxpm-cli.test.ts]
ART_TEST[test/artifacts.test.ts]
end
BIN --> BUN
GXPM --> ARTIFACTS
ARTIFACTS --> STATE
ARTIFACTS --> NODE
CLI_TEST --> GXPM
ART_TEST --> ARTIFACTS
```

**图表来源**
- [bin/gxpm:17-17](file://bin/gxpm#L17-L17)
- [scripts/gxpm.ts:11-11](file://scripts/gxpm.ts#L11-L11)
- [core/artifacts.ts:1-8](file://core/artifacts.ts#L1-L8)

**章节来源**
- [scripts/gxpm.ts:11-11](file://scripts/gxpm.ts#L11-L11)
- [core/artifacts.ts:1-8](file://core/artifacts.ts#L1-L8)

## 性能考虑

artifact read 命令具有以下性能特征：

- **时间复杂度**: O(1) - 文件系统操作和 JSON 解析
- **空间复杂度**: O(n) - n 为产物文件大小
- **I/O 特性**: 单次文件读取操作
- **内存使用**: 与产物大小成正比

优化建议：
1. 对于大型产物文件，考虑分块读取策略
2. 实现缓存机制避免重复读取相同文件
3. 添加超时控制防止长时间阻塞

## 故障排除指南

### 常见错误及解决方案

| 错误类型 | 错误消息 | 可能原因 | 解决方案 |
|---------|---------|---------|---------|
| 参数错误 | "Usage: gxpm artifact read <issue-id> <type>" | 缺少必需参数 | 提供完整的 issue-id 和 type 参数 |
| 类型错误 | "Invalid artifact type: <type>" | 产物类型不在支持列表中 | 使用受支持的产物类型之一 |
| 文件不存在 | "Artifact not found: <type>" | 产物文件不存在 | 确认产物已被创建或检查问题 ID |
| 权限错误 | "Permission denied" | 文件权限不足 | 检查文件权限和目录访问权限 |
| JSON 解析错误 | "Unexpected token" | 文件内容不是有效 JSON | 验证文件完整性 |

### 错误处理机制

系统提供了多层次的错误处理：

```mermaid
flowchart TD
Start([命令执行]) --> ParamCheck["参数验证"]
ParamCheck --> TypeCheck["类型验证"]
TypeCheck --> FileCheck["文件存在性检查"]
FileCheck --> JSONParse["JSON 解析"]
JSONParse --> Success["成功返回"]
ParamCheck --> |参数缺失| ParamError["抛出参数错误"]
TypeCheck --> |类型无效| TypeError["抛出类型错误"]
FileCheck --> |文件不存在| NotFoundError["抛出未找到错误"]
JSONParse --> |解析失败| ParseError["抛出解析错误"]
ParamError --> End([结束])
TypeError --> End
NotFoundError --> End
ParseError --> End
Success --> End
```

**图表来源**
- [scripts/gxpm.ts:218-224](file://scripts/gxpm.ts#L218-L224)
- [core/artifacts.ts:93-104](file://core/artifacts.ts#L93-L104)
- [core/artifacts.ts:163-168](file://core/artifacts.ts#L163-L168)

**章节来源**
- [scripts/gxpm.ts:218-224](file://scripts/gxpm.ts#L218-L224)
- [core/artifacts.ts:93-104](file://core/artifacts.ts#L93-L104)

## 结论

artifact read 命令为 gxpm 项目管理工具提供了简洁而强大的产物读取功能。通过标准化的 JSON 输出格式和完善的错误处理机制，用户可以轻松地访问和调试项目中的各种产物数据。

该命令的主要优势包括：
- **简单易用**: 直观的命令语法和清晰的输出格式
- **可靠性**: 完整的参数验证和错误处理
- **一致性**: 标准化的 JSON 输出格式
- **可扩展性**: 支持多种产物类型和未来扩展

对于开发者而言，该命令不仅是一个实用的工具，也是理解 gxpm 项目管理流程的重要入口点。