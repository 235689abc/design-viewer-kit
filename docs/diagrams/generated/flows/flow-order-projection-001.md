# FLOW-ORDER-PROJECTION-001 — Project Order Read Model / 投影订单读模型

- **Owner**: `Delivery Worker / 投递 Worker`
- **Reads**: public.events （读取表）
- **Writes**: public.order_read_model:U （写入操作）
- **Events appended**: n/a （追加事件）
- **Idempotency**: event_id （幂等键）

```mermaid
sequenceDiagram
  autonumber
  participant A as "Actor<br/>触发方"
  participant S as "delivery-worker<br/>Delivery Worker / 投递 Worker"
  participant DB as "Database<br/>数据库"

  A->>S: trigger flow / 触发流程
  S->>DB: BEGIN / 开启事务
  S->>DB: READ public.events / 读取
  S->>DB: WRITE public.order_read_model:U / 写入
  S->>DB: COMMIT / 提交事务
```
