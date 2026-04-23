本文件用于约束 XQoder Conversation Engine 单 Slice 施工。

规则：

1. 每次只做一个 Slice。
2. 不允许跨 Slice 实现未来模块的真实逻辑。
3. 不允许无关重构。
4. 不允许把新主链逻辑继续堆进 `src/core/*`。
5. 必须保持现有 CLI / HTTP / headless 对外行为兼容。
6. 每个 Slice 必须先补或确认 focused tests。
7. 每次输出必须包含：
   - 本次 Slice
   - 改动文件
   - 行为变化
   - 验证命令
   - 测试结果
   - 未做事项
   - 下一 Slice 建议
