# FLOW-ORDER-PUBLISH-001 — Publish Order Event / 投递订单事件

- **Owner**: `Delivery Worker / 投递 Worker`
- **Reads**: public.outbox （读取表）
- **Writes**: public.outbox:U （写入操作）
- **Events appended**: n/a （追加事件）
- **Idempotency**: outbox_event_id （幂等键）

```mermaid
sequenceDiagram
  autonumber
  participant A as "Actor<br/>触发方"
  participant S as "delivery-worker<br/>Delivery Worker / 投递 Worker"
  participant DB as "Database<br/>数据库"
  participant O as "public.outbox<br/>Outbox / 投递表"
  participant W as "outbox-worker<br/>Publisher / 投递器"
  participant B as "EventBus<br/>事件总线"
  participant C as "Consumer<br/>消费者"

  A->>S: trigger flow / 触发流程
  S->>DB: BEGIN / 开启事务
  S->>DB: READ public.outbox / 读取
  S->>DB: WRITE public.outbox:U / 写入
  S->>O: INSERT public.outbox(PENDING) / 写入待投递
  S->>DB: COMMIT / 提交事务

  W->>O: SELECT PENDING (SKIP LOCKED) / 选择待投递
  W->>B: publish(message) / 发布消息
  W->>O: UPDATE status=SENT/FAILED / 更新状态

  B-->>C: deliver message / 投递消息
  C->>DB: INSERT processed_events (ON CONFLICT DO NOTHING) / 幂等去重
  C->>DB: UPSERT read models / side effects / 更新读模型与副作用
```
