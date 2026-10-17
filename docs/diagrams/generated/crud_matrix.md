# CRUD Matrix（Flow × Table） / CRUD 矩阵（流程 × 数据表）

> 说明：每个格子是该 Flow 对该表的操作集合：C/R/U/D。
> Note: each cell shows operations by the flow: C/R/U/D.

| Flow ID | Name (EN / 中文) | Owner (EN / 中文) | Orders / 订单 | Events / 事件 | Outbox / 投递箱 | Order Read Model / 订单读模型 |
|---|---|---|---|---|---|---|
| FLOW-ORDER-CREATE-001 | Create Order / 创建订单 | Orders API / 订单 API | C | C | C | - |
| FLOW-ORDER-PUBLISH-001 | Publish Order Event / 投递订单事件 | Delivery Worker / 投递 Worker | - | - | RU | - |
| FLOW-ORDER-PROJECTION-001 | Project Order Read Model / 投影订单读模型 | Delivery Worker / 投递 Worker | - | R | - | U |
