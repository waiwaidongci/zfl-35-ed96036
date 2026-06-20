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

## 批次标签打印数据模块

为每个稀有种子批次生成可打印标签所需的 JSON 数据，包含批次号、物种、采集地、母株、当前数量、活性等级、冷盒位置和最近一次萌发率。

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/labels/batches/:id` | 获取单个批次的标签数据 |
| GET | `/labels/batches?species=&collectionPlace=&section=&viability=` | 获取所有符合筛选条件批次的标签数据 |
| POST | `/labels/batches/batch` | 批量获取指定批次 ID 的标签数据 |

### 标签字段说明

| 字段 | 类型 | 说明 |
|------|------|------|
| `batchId` | string | 批次号 |
| `species` | string | 物种名称 |
| `collectionPlace` | string | 采集地 |
| `motherPlant` | string | 母株编号 |
| `quantity` | number | 当前数量（原始值） |
| `quantityFormatted` | string | 当前数量（格式化，千分位） |
| `viability` | string | 活性等级原始值（high/medium/low/unknown） |
| `viabilityLabel` | string | 活性等级中文标签 |
| `coldBoxLocation` | string | 冷盒位置描述文本 |
| `section` | string | 所属分区 |
| `container` | string | 冷盒编号 |
| `slotLocations` | array | 详细库位列表（含分区、冷盒、格位号） |
| `latestGermination` | object/null | 最近一次萌发记录（含日期、取样数、发芽数、萌发率） |
| `printedAt` | string | 标签生成时间（ISO 格式） |

### 接口详情

#### GET `/labels/batches/:id` — 单批次标签

获取单个批次的完整标签数据。

**请求示例：**

```bash
curl http://localhost:3035/labels/batches/RS-001
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "species": "独叶草",
  "collectionPlace": "西岭北坡",
  "motherPlant": "MP-17",
  "quantity": 1800,
  "quantityFormatted": "1,800",
  "viability": "high",
  "viabilityLabel": "高活性",
  "coldBoxLocation": "A2低温区 / 冷盒08 / 格位1",
  "section": "A2",
  "container": "C-冷盒-08",
  "slotLocations": [
    {
      "sectionId": "A2",
      "sectionName": "A2低温区",
      "boxId": "C-冷盒-08",
      "boxName": "冷盒08",
      "slotIndex": 1
    }
  ],
  "latestGermination": {
    "at": "2026-06-12",
    "sampled": 100,
    "sprouted": 72,
    "rate": 0.72,
    "rateFormatted": "72.0%"
  },
  "printedAt": "2026-06-20T...Z"
}
```

#### GET `/labels/batches` — 全量标签（支持筛选）

获取所有批次的标签数据，支持按物种、采集地、分区、活性等级筛选。

**请求示例：**

```bash
# 获取全部标签
curl http://localhost:3035/labels/batches

# 按物种筛选
curl http://localhost:3035/labels/batches?species=独叶草

# 按分区筛选
curl http://localhost:3035/labels/batches?section=A2

# 组合筛选
curl "http://localhost:3035/labels/batches?section=A2&viability=high"
```

**响应示例：**

```json
[
  {
    "batchId": "RS-001",
    "species": "独叶草",
    ...
  },
  ...
]
```

#### POST `/labels/batches/batch` — 批量标签

根据指定的批次 ID 列表，批量获取标签数据。

**请求示例：**

```bash
curl -X POST http://localhost:3035/labels/batches/batch \
  -H "Content-Type: application/json" \
  -d '{ "ids": ["RS-001", "RS-002", "RS-003"] }'
```

**请求体：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `ids` | string[] | 批次 ID 数组 |

**响应示例：**

```json
[
  { "batchId": "RS-001", "species": "独叶草", ... },
  { "batchId": "RS-002", "species": "珙桐", ... }
]
```

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `batch_not_found` | 404 | 批次不存在 |
