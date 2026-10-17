# L0 System Map（自动生成） / L0 系统地图（自动生成）

```mermaid
graph TB

  %% Services / 服务
  subgraph S["Services / 服务"]
    N_web["web<br/>Web Client / Web 客户端"]
    N_orders_api["orders-api<br/>Orders API / 订单 API"]
    N_delivery_worker["delivery-worker<br/>Delivery Worker / 投递 Worker"]
  end

  %% Schemas & Tables / 模式与数据表
  subgraph N_SCHEMA_public["public / 公共"]
    N_public_events["public.events<br/>Events / 事件"]
    N_public_order_read_model["public.order_read_model<br/>Order Read Model / 订单读模型"]
    N_public_orders["public.orders<br/>Orders / 订单"]
    N_public_outbox["public.outbox<br/>Outbox / 投递箱"]
  end

  %% Ownership edges (service writes -> schema) / 所有权边（服务写入 -> schema）
  N_delivery_worker --> N_SCHEMA_public
  N_orders_api --> N_SCHEMA_public
```

> 中文：这张图只表达“服务写入哪些 schema”，细节请查看 CRUD Matrix 和每条 Flow 的时序图。
> English: This diagram only shows "which service writes which schema". See the CRUD matrix and per-flow sequence diagrams for details.
