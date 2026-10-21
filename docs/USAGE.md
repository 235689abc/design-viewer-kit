# Design Viewer Kit 使用说明

本文说明如何把一个项目的设计证据整理成可审阅的静态台账，并在需要
时接入只读运行态信息。

## 1. 最小目录

```text
your-project/
├── design-viewer.config.json
├── docs/diagrams/flows.json
├── docs/diagrams/generated/       # 生成的 Mermaid/Markdown
├── apps/web/public/data/index.json # viewer 读取的索引
└── tools/                         # 可直接引用本库的 Python 工具
```

可以把本库作为 Git 子模块、复制工具文件，或直接在本库目录中维护
manifest。工具默认只读输入并写入明确的生成目录。

## 2. 配置文件

`design-viewer.config.example.json` 是可复制模板：

```json
{
  "project": "my-project",
  "spec": "./docs/diagrams/flows.json",
  "generatedDir": "./docs/diagrams/generated",
  "indexOut": "./apps/web/public/data/index.json",
  "historyDir": "./apps/web/public/data/history",
  "historyManifest": "./apps/web/public/data/history/manifest.json",
  "historyKeepLimit": 20,
  "skipHistory": true
}
```

路径相对于配置文件所在目录解析。`skipHistory: true` 适合公开仓库；
历史快照可能暴露变更前的内部结构。

## 3. Manifest 结构

最小 manifest 包含 `services`、`tables`、`flows` 三部分；生成器会计算
`crudEdges` 和 Mermaid 图。

```json
{
  "meta": {
    "schema_version": "1",
    "policy": {
      "event_table": "public.events",
      "outbox_table": "public.outbox"
    }
  },
  "services": [
    {"id": "orders-api", "name_en": "Orders API", "name_zh": "订单 API"}
  ],
  "datastores": [
    {"id": "orders-db", "name": "Orders DB", "engine": "PostgreSQL", "schema": "public"}
  ],
  "tables": [
    {
      "name": "public.orders",
      "kind": "postgres-table",
      "state": "existing",
      "owner_service": "orders-api",
      "introduced_in": "v1",
      "datastore_id": "orders-db",
      "columns": [
        {"name": "order_id", "type": "UUID", "nullable": false, "primary_key": true},
        {"name": "customer_id", "type": "UUID", "nullable": false}
      ],
      "primary_key": ["order_id"],
      "foreign_keys": [],
      "indexes": [
        {"name": "orders_customer_idx", "columns": ["customer_id"], "unique": false}
      ]
    }
  ],
  "flows": [
    {
      "id": "FLOW-ORDER-CREATE-001",
      "name_en": "Create order",
      "name_zh": "创建订单",
      "owner_service": "orders-api",
      "doc_path": "docs/flows/order-create",
      "introduced_in": "v1",
      "reads": [],
      "writes": [{"table": "public.orders", "op": "C"}],
      "events_appended": ["OrderCreated"],
      "idempotency_key": "request.idempotency_key"
    }
  ]
}
```

### 可选字段

- `services[].system_id`, `source_ref`：归属系统和证据位置。
- `datastores[]`：数据库实例的 `id`、名称、引擎、schema、状态和源码证据。
- `tables[].kind`, `datastore_id`, `columns`, `primary_key`, `foreign_keys`,
  `indexes`, `notes`, `alias_of`：数据库字段与关系、表类型、别名和设计说明。
- `flows[].actors`, `event_table`, `outbox_table`, `finality`, `kind`,
  `source_ref`, `deprecated`, `replaced_by`：触发方、事件链路、状态和
  证据。
- `meta.policy.runtime_paths`：只读运行态接口路径。

未知字段会被生成器保留在输出索引中，可用于逐步扩展到 endpoint、页面、
worker、RBAC、环境开关和状态机等全量盘点维度。

## 4. 生成和校验

```bash
python3 tools/validate_manifest.py --spec docs/diagrams/flows.json
python3 tools/gen_diagrams.py --config design-viewer.config.json
npm run build
```

校验器会检查重复 ID、未知服务/数据库/表引用、非法 CRUD 操作，以及
字段、主键、外键和索引对列的引用；生成器会输出 CRUD、数据库 ERD、
流程 Markdown、`index.json` 和可选历史快照。生成时间由 manifest 的
mtime 稳定计算，便于 CI 检查重复生成。

## 5. 从现有项目接入

推荐先以只读方式导出证据，再人工确认 manifest：

1. 从路由注册、页面路由、worker 启动文件、迁移、权限定义和配置文件
   生成候选条目。
2. 为每个条目补充 `source_ref`，并把不确定项标为 `planned`、`TBD` 或
   `notes`，不要把猜测写成已实现事实。
3. 运行校验器和 viewer，逐条检查 owner、读写表、事件/outbox 和状态。
4. 在审阅完成后再把 manifest 纳入目标项目的版本控制。

本库不会自动 SSH 到远程主机，也不会扫描生产数据库；如需远程证据，
请由项目方提供脱敏的只读导出文件。

## 6. 脚手架工作流

`tools/scaffold_flow.py` 可生成一组待审阅文档和 patch：

```bash
python3 tools/scaffold_flow.py --root . \
  --flow-id FLOW-EXAMPLE-001 \
  --name-en "Create example" --name-zh "创建示例" \
  --owner-service orders-api \
  --writes public.orders:C --events-appended ExampleCreated \
  --dry-run
```

默认不覆盖已存在文件、不修改应用路由、不写生产路径。确认内容后才
再用 `tools/apply_flows_patch.py --apply` 明确写入 manifest；后端输出仍然
只是 `outputs/scaffold/<flow>/backend/` 下的安全模式评审文件。

## 7. 运行态适配器

如果项目提供以下 GET 接口，可以把实时证据放到流程详情页：

```text
GET /ops/events
GET /ops/outbox
GET /ops/flows/:id/recent
```

实际路径可通过 `meta.policy.runtime_paths`、
`VITE_DV_RUNTIME_FLOW_RECENT_PATH`、`VITE_DV_RUNTIME_EVENTS_PATH` 和
`VITE_DV_RUNTIME_OUTBOX_PATH` 覆盖。接口不可用时 UI 显示 unknown，不会
阻塞静态设计审阅。

## 8. 路线图

当前能力覆盖 flow/table 设计索引和 manifest 驱动的数据库 ERD。后续可在
不破坏现有字段的前提下增加：

- endpoint：方法、路径、鉴权、输入输出和源码证据；
- frontend：页面/路由/组件与后端调用关系；
- worker：定时任务、队列消费者、重试和状态机；
- authorization：角色、权限、资源范围和默认拒绝；
- environment：开关、部署环境、默认值和影响范围；
- evidence：统一的 `source_ref`、置信度、发现时间和人工确认状态。

每个扩展都应先更新 schema、校验器和示例，再更新 viewer，避免把项目
特定规则硬编码到通用库。
