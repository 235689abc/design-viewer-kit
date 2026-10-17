# FLOW-ORDER-CREATE-001 — Create Order / 创建订单

- **Owner**: `Orders API / 订单 API`
- **Reads**: n/a （读取表）
- **Writes**: public.orders:C, public.events:C, public.outbox:C （写入操作）
- **Events appended**: OrderCreated （追加事件）
- **Idempotency**: client_request_id （幂等键）

```mermaid
sequenceDiagram
  autonumber
  participant A as "Actor<br/>触发方"
  participant S as "orders-api<br/>Orders API / 订单 API"
  participant DB as "Database<br/>数据库"
  participant E as "public.events<br/>Events / 事件"
  participant O as "public.outbox<br/>Outbox / 投递表"
  participant W as "outbox-worker<br/>Publisher / 投递器"
  participant B as "EventBus<br/>事件总线"
  participant C as "Consumer<br/>消费者"

  A->>S: trigger flow / 触发流程
  S->>DB: BEGIN / 开启事务
  S->>DB: READ n/a / 读取
  S->>DB: WRITE public.orders:C, public.events:C, public.outbox:C / 写入
  S->>E: APPEND public.events OrderCreated / 追加事件
  S->>O: INSERT public.outbox(PENDING) / 写入待投递
  S->>DB: COMMIT / 提交事务

  W->>O: SELECT PENDING (SKIP LOCKED) / 选择待投递
  W->>B: publish(message) / 发布消息
  W->>O: UPDATE status=SENT/FAILED / 更新状态

  B-->>C: deliver message / 投递消息
  C->>DB: INSERT processed_events (ON CONFLICT DO NOTHING) / 幂等去重
  C->>DB: UPSERT read models / side effects / 更新读模型与副作用
```
