# 稀有种子冷库库存和活性追踪API

运行：

```bash
npm start
```

默认端口`3035`。支持批次、温度、取样、萌发实验、库存流水和负库存拦截。

## 库位管理模块

冷库按 **分区（Section）→ 冷盒（Box）→ 格位（Slot）** 三级结构管理。现有批次的 `section` 和 `container` 字段保持不变，库位模块通过 `batchId` 关联格位与批次。

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/locations/sections` | 列出所有分区及占用率统计 |
| POST | `/locations/sections` | 新增分区 |
| GET | `/locations/sections/:id` | 分区详情（含各冷盒占用/空余） |
| GET | `/locations/sections/:id/free-slots` | 分区下所有空余格位列表 |
| POST | `/locations/sections/:id/boxes` | 在指定分区下新增冷盒 |
| GET | `/locations/boxes/:id` | 冷盒详情（含批次列表） |
| PATCH | `/locations/boxes/:id/slots/:index` | 格位分配/释放（设置 `batchId`） |
| GET | `/locations/batches/:id/slots` | 查询某个批次当前占用的所有库位 |

### 接口详情

#### POST `/locations/sections` — 新增分区

```json
{ "id": "C1", "name": "C1恒温区" }
```

#### POST `/locations/sections/:id/boxes` — 新增冷盒

```json
{ "id": "C-冷盒-20", "name": "冷盒20", "slotCapacity": 24 }
```

#### PATCH `/locations/boxes/:id/slots/:index` — 分配/释放格位

分配（`batchId` 为字符串）：
```json
{ "batchId": "RS-001" }
```

释放（`batchId` 为 null）：
```json
{ "batchId": null }
```

#### GET `/locations/sections` — 响应示例

```json
[
  {
    "id": "A2",
    "name": "A2低温区",
    "totalSlots": 32,
    "occupiedSlots": 1,
    "freeSlots": 31,
    "occupancyRate": 0.0313
  }
]
```

#### GET `/locations/sections/:id` — 响应示例

包含分区统计和各冷盒详情。

#### GET `/locations/boxes/:id` — 响应示例

```json
{
  "id": "C-冷盒-08",
  "name": "冷盒08",
  "sectionId": "A2",
  "sectionName": "A2低温区",
  "slotCapacity": 16,
  "occupiedCount": 1,
  "freeCount": 15,
  "slots": [ { "index": 1, "batchId": "RS-001" }, ... ],
  "batches": [ { "slotIndex": 1, "batchId": "RS-001" } ]
}
```

#### GET `/locations/batches/:id/slots` — 响应示例

```json
[
  { "sectionId": "A2", "sectionName": "A2低温区", "boxId": "C-冷盒-08", "boxName": "冷盒08", "slotIndex": 1 }
]
```

#### GET `/locations/sections/:id/free-slots` — 响应示例

```json
{
  "sectionId": "A2",
  "sectionName": "A2低温区",
  "freeSlots": [ { "boxId": "C-冷盒-07", "boxName": "冷盒07", "slotIndex": 1 }, ... ],
  "freeCount": 31
}
```

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `section_not_found` | 404 | 分区不存在 |
| `box_not_found` | 404 | 冷盒不存在 |
| `section_already_exists` | 409 | 分区ID已存在 |
| `box_already_exists` | 409 | 冷盒ID已存在 |
| `slot_already_occupied` | 409 | 格位已被占用 |
| `slot_index_out_of_range` | 400 | 格位序号超出冷盒容量范围 |
