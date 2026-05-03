## Code Intelligence (code-review-graph)

本仓库已集成 `code-review-graph` MCP 工具（本地 SQLite 代码知识图谱，支持 Leiden 社区检测与向量语义搜索）。初始化后运行 `code-review-graph build` 生成图谱。

**优先使用 MCP 的场景**（这些情况下优先于 `ls`/`grep`/`cat`）：
- 用自然语言搜索符号（函数、类），不确定精确命名时。
- 分析调用关系（谁调用了谁、谁被谁调用）。
- 评估代码变更的影响半径。
- 探索模块执行流或架构社区划分。
- 识别架构热点（高连接度节点、桥接点）。

**必须回退到 grep / ReadFile 的场景**：
- 搜索字符串字面量、日志文本、注释内容。
- 读取配置文件（yaml、json、toml）或 markdown 文档内容。
- 需要精确行号或源码细读时。
- 查询内部/私有函数的测试覆盖（图数据库仅索引导出符号的直接测试关系）。

**工作流原则**：先用 MCP 定位符号和社区边界，再用 grep / ReadFile 精读源码；避免在不可索引的内容上反复尝试 MCP。
