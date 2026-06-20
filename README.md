# 稀有种子冷库库存和活性追踪API

运行：

```bash
npm start
```

默认端口`3035`。支持批次、温度、取样、萌发实验、库存流水、负库存拦截、批次备注、人工复核和取样预约。

## 批次备注与人工复核模块

支持管理员给批次追加复核记录，记录复核时间、复核人、结论和备注。批次详情接口一并返回复核历史，列表接口支持按是否存在待复核结论筛选。

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| PATCH | `/batches/:id/remark` | 更新批次备注 |
| GET | `/batches/:id/reviews` | 获取批次复核历史记录 |
| POST | `/batches/:id/reviews` | 新增复核记录 |
| GET | `/batches?hasPendingReview=true/false` | 按是否存在待复核结论筛选批次列表 |

### 数据结构

#### 批次字段新增

| 字段 | 类型 | 说明 |
|------|------|------|
| `remark` | string | 批次备注 |
| `reviews` | array | 复核记录列表 |

#### 复核记录字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 复核记录ID |
| `at` | string | 复核时间（ISO格式） |
| `reviewer` | string | 复核人 |
| `conclusion` | string | 复核结论：`pending`（待复核）、`approved`（通过）、`rejected`（驳回） |
| `note` | string | 复核备注 |

### 接口详情

#### PATCH `/batches/:id/remark` — 更新批次备注

**请求体：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `remark` | string | 批次备注内容 |

**请求示例：**

```bash
curl -X PATCH http://localhost:3035/batches/RS-001/remark \
  -H "Content-Type: application/json" \
  -d '{ "remark": "高品质种子，需重点关注" }'
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "remark": "高品质种子，需重点关注"
}
```

#### GET `/batches/:id/reviews` — 获取复核历史

获取指定批次的所有复核记录，按时间从早到晚排序。

**请求示例：**

```bash
curl http://localhost:3035/batches/RS-001/reviews
```

**响应示例：**

```json
[
  {
    "id": "RV-1",
    "at": "2026-05-25T10:30:00.000Z",
    "reviewer": "李管理员",
    "conclusion": "pending",
    "note": "初步检查种子外观完整，等待萌发实验结果后最终确认"
  }
]
```

#### POST `/batches/:id/reviews` — 新增复核记录

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `reviewer` | string | 否 | 复核人，默认"未知管理员" |
| `conclusion` | string | 否 | 复核结论：`pending`/`approved`/`rejected`，默认`pending` |
| `note` | string | 否 | 复核备注 |
| `at` | string | 否 | 复核时间，默认当前时间 |

**请求示例：**

```bash
curl -X POST http://localhost:3035/batches/RS-001/reviews \
  -H "Content-Type: application/json" \
  -d '{
    "reviewer": "王主任",
    "conclusion": "approved",
    "note": "萌发率72%，符合入库标准，通过复核"
  }'
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "review": {
    "id": "RV-1718888888888",
    "at": "2026-06-20T10:00:00.000Z",
    "reviewer": "王主任",
    "conclusion": "approved",
    "note": "萌发率72%，符合入库标准，通过复核"
  }
}
```

#### GET `/batches?hasPendingReview=true` — 按待复核筛选

- `hasPendingReview=true`：筛选出存在待复核结论的批次
- `hasPendingReview=false`：筛选出没有待复核结论的批次
- 不传该参数：不筛选，返回所有批次

**请求示例：**

```bash
# 仅显示有待复核结论的批次
curl "http://localhost:3035/batches?hasPendingReview=true"
```

#### GET `/batches/:id` — 批次详情（含复核历史）

批次详情接口已包含 `remark` 和 `reviews` 字段，一并返回复核历史。

**响应示例（节选）：**

```json
{
  "id": "RS-001",
  "species": "独叶草",
  "remark": "初始入库批次，待质量复核",
  "reviews": [
    {
      "id": "RV-1",
      "at": "2026-05-25T10:30:00.000Z",
      "reviewer": "李管理员",
      "conclusion": "pending",
      "note": "初步检查种子外观完整，等待萌发实验结果后最终确认"
    }
  ],
  ...
}
```

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `batch_not_found` | 404 | 批次不存在 |

## 取样预约模块

用于在真正扣减库存前登记实验室的取样申请。预约创建时状态为 `pending`；批准后冻结对应数量（不直接扣库存）；转为实际取样时写入 transactions 并释放冻结量；拒绝或取消已批准的预约也会释放冻结量。

### 核心概念

- **冻结库存（frozenQuantity）**：已批准但尚未实际取样的预约数量之和。`可用库存 = 实际库存 - 冻结库存`
- **状态流转**：`pending` → `approved` → `fulfilled`；或 `pending` → `rejected`；或 `pending`/`approved` → `cancelled`
- 批准时仅冻结数量，不扣减实际库存
- 转为实际取样（fulfill）时写入一条 `sample` 类型的 transaction，同时释放冻结量
- 取消已批准的预约会释放冻结量

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/batches/:id/reservations` | 创建取样预约 |
| GET | `/batches/:id/reservations?status=` | 查询预约列表（可按状态筛选） |
| PATCH | `/batches/:id/reservations/:reservationId/approve` | 批准预约（冻结数量） |
| PATCH | `/batches/:id/reservations/:reservationId/reject` | 拒绝预约 |
| PATCH | `/batches/:id/reservations/:reservationId/cancel` | 取消预约 |
| POST | `/batches/:id/reservations/:reservationId/fulfill` | 转为实际取样（扣库存、释放冻结） |

### 数据结构

#### 批次字段新增

| 字段 | 类型 | 说明 |
|------|------|------|
| `frozenQuantity` | number | 冻结库存数量（已批准但未实际取样的预约数量之和） |
| `reservations` | array | 取样预约记录列表 |

#### 预约记录字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 预约ID（格式 `RES-时间戳`） |
| `applicant` | string | 申请人 |
| `purpose` | string | 用途 |
| `quantity` | number | 预计取样数量 |
| `plannedDate` | string | 计划日期 |
| `status` | string | 状态：`pending`（待审批）、`approved`（已批准）、`rejected`（已拒绝）、`cancelled`（已取消）、`fulfilled`（已转为实际取样） |
| `createdAt` | string | 创建时间（ISO格式） |
| `updatedAt` | string | 最近更新时间（ISO格式） |
| `fulfilledAt` | string | 转为实际取样的时间（仅fulfilled状态） |

### 接口详情

#### POST `/batches/:id/reservations` — 创建取样预约

创建一条取样预约，状态初始为 `pending`，不冻结库存。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `applicant` | string | 是 | 申请人 |
| `purpose` | string | 是 | 用途 |
| `quantity` | number | 是 | 预计取样数量（必须大于0） |
| `plannedDate` | string | 否 | 计划日期 |

**请求示例：**

```bash
curl -X POST http://localhost:3035/batches/RS-001/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "applicant": "张研究员",
    "purpose": "基因多样性分析",
    "quantity": 200,
    "plannedDate": "2026-07-01"
  }'
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "reservation": {
    "id": "RES-1718888888888",
    "applicant": "张研究员",
    "purpose": "基因多样性分析",
    "quantity": 200,
    "plannedDate": "2026-07-01",
    "status": "pending",
    "createdAt": "2026-06-20T10:00:00.000Z",
    "updatedAt": "2026-06-20T10:00:00.000Z"
  }
}
```

#### GET `/batches/:id/reservations?status=` — 查询预约列表

获取指定批次的预约列表，可按状态筛选。

**请求示例：**

```bash
# 查询全部预约
curl http://localhost:3035/batches/RS-001/reservations

# 仅查询已批准的预约
curl "http://localhost:3035/batches/RS-001/reservations?status=approved"
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "reservations": [
    {
      "id": "RES-1718888888888",
      "applicant": "张研究员",
      "purpose": "基因多样性分析",
      "quantity": 200,
      "plannedDate": "2026-07-01",
      "status": "pending",
      "createdAt": "2026-06-20T10:00:00.000Z",
      "updatedAt": "2026-06-20T10:00:00.000Z"
    }
  ]
}
```

#### PATCH `/batches/:id/reservations/:reservationId/approve` — 批准预约

将 `pending` 状态的预约批准为 `approved`，同时冻结对应数量。若可用库存不足则返回错误。

**请求示例：**

```bash
curl -X PATCH http://localhost:3035/batches/RS-001/reservations/RES-1718888888888/approve
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "reservation": {
    "id": "RES-1718888888888",
    "applicant": "张研究员",
    "purpose": "基因多样性分析",
    "quantity": 200,
    "plannedDate": "2026-07-01",
    "status": "approved",
    "createdAt": "2026-06-20T10:00:00.000Z",
    "updatedAt": "2026-06-20T10:05:00.000Z"
  },
  "frozenQuantity": 200,
  "availableQuantity": 1600
}
```

#### PATCH `/batches/:id/reservations/:reservationId/reject` — 拒绝预约

将 `pending` 状态的预约拒绝为 `rejected`，不涉及冻结量变动。

**请求示例：**

```bash
curl -X PATCH http://localhost:3035/batches/RS-001/reservations/RES-1718888888888/reject
```

#### PATCH `/batches/:id/reservations/:reservationId/cancel` — 取消预约

取消 `pending` 或 `approved` 状态的预约。若预约已批准，会同时释放冻结量。

**请求示例：**

```bash
curl -X PATCH http://localhost:3035/batches/RS-001/reservations/RES-1718888888888/cancel
```

#### POST `/batches/:id/reservations/:reservationId/fulfill` — 转为实际取样

将 `approved` 状态的预约转为实际取样。释放冻结量，扣减实际库存，写入一条 `sample` 类型的 transaction。

**请求示例：**

```bash
curl -X POST http://localhost:3035/batches/RS-001/reservations/RES-1718888888888/fulfill
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "reservation": {
    "id": "RES-1718888888888",
    "applicant": "张研究员",
    "purpose": "基因多样性分析",
    "quantity": 200,
    "plannedDate": "2026-07-01",
    "status": "fulfilled",
    "createdAt": "2026-06-20T10:00:00.000Z",
    "updatedAt": "2026-06-20T12:00:00.000Z",
    "fulfilledAt": "2026-06-20T12:00:00.000Z"
  },
  "transaction": {
    "id": "TX-1718890000000",
    "at": "2026-06-20T12:00:00.000Z",
    "type": "sample",
    "quantity": 200,
    "balance": 1600,
    "note": "取样预约 RES-1718888888888 转实际取样，申请人：张研究员，用途：基因多样性分析"
  },
  "quantity": 1600,
  "frozenQuantity": 0,
  "availableQuantity": 1600
}
```

### 库存报告（更新）

`GET /reports/inventory` 接口现在同时展示可用库存和冻结库存。

**响应示例：**

```json
{
  "total": 1800,
  "totalFrozen": 200,
  "totalAvailable": 1600,
  "bySpecies": { "独叶草": 1800 },
  "bySection": { "A2": 1800 },
  "frozenBySpecies": { "独叶草": 200 },
  "frozenBySection": { "A2": 200 },
  "lowStock": [
    {
      "id": "RS-001",
      "species": "独叶草",
      "quantity": 1800,
      "frozenQuantity": 200,
      "availableQuantity": 1600
    }
  ]
}
```

新增字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalFrozen` | number | 冻结库存总量 |
| `totalAvailable` | number | 可用库存总量 |
| `frozenBySpecies` | object | 按物种分组的冻结库存 |
| `frozenBySection` | object | 按分区分组的冻结库存 |
| `lowStock` | array | 可用库存低于200的批次（含 `frozenQuantity` 和 `availableQuantity`） |

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `batch_not_found` | 404 | 批次不存在 |
| `reservation_not_found` | 404 | 预约不存在 |
| `invalid_quantity` | 400 | 预约数量无效（必须大于0） |
| `invalid_status_transition` | 409 | 状态流转不合法 |
| `insufficient_available_quantity` | 409 | 可用库存不足，无法批准 |
| `negative_inventory_blocked` | 409 | 库存不足，转实际取样会导致负库存 |

## 温度异常事件模块

自动识别冷藏温度超过阈值的时间点并生成异常事件，支持查看未处理异常、按批次查看异常历史、标记处理结果和处理人。

### 阈值规则

| 阈值类型 | 温度值 | 说明 |
|---------|--------|------|
| 默认阈值 | `-18°C` | 温度高于此值即视为异常 |
| 警告级 | `-15°C` | 温度 ≥ -15°C 标记为 `warning`（警告） |
| 严重级 | `-10°C` | 温度 ≥ -10°C 标记为 `critical`（严重） |
| 一般异常 | `< -15°C` 且 `> -18°C` | 标记为 `abnormal`（异常） |

**判断逻辑**：当 `temperature.value > threshold` 时判定为异常。阈值可在扫描时通过参数自定义。

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/anomalies/pending` | 查看所有未处理异常 |
| GET | `/batches/:id/anomalies?status=` | 按批次查看异常历史（可按状态筛选） |
| PATCH | `/batches/:id/anomalies/:anomalyId/handle` | 标记异常处理结果和处理人 |
| POST | `/anomalies/scan?batchId=&threshold=` | 手动触发异常扫描（可指定批次和自定义阈值） |

### 数据结构

#### 批次字段新增

| 字段 | 类型 | 说明 |
|------|------|------|
| `anomalies` | array | 温度异常事件列表 |

#### 异常事件字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 异常事件ID（格式 `ANOM-时间戳-随机串`） |
| `batchId` | string | 关联批次ID |
| `temperatureAt` | string | 异常温度记录时间（ISO格式） |
| `temperatureValue` | number | 异常温度值 |
| `threshold` | number | 判断时使用的阈值 |
| `severity` | string | 严重程度：`abnormal`/`warning`/`critical` |
| `status` | string | 状态：`pending`（待处理）、`handled`（已处理） |
| `detectedAt` | string | 检测时间（ISO格式） |
| `handledAt` | string | 处理时间（ISO格式，仅已处理） |
| `handler` | string | 处理人（仅已处理） |
| `handlingResult` | string | 处理结果：`resolved`（已解决）、`ignored`（已忽略）、`escalated`（已升级） |
| `note` | string | 处理备注 |

### 接口详情

#### GET `/anomalies/pending` — 查看未处理异常

获取所有状态为 `pending` 的异常事件，按检测时间从早到晚排序。

**请求示例：**

```bash
curl http://localhost:3035/anomalies/pending
```

**响应示例：**

```json
[
  {
    "id": "ANOM-1718888888888-abc123",
    "batchId": "RS-001",
    "batchSpecies": "独叶草",
    "batchSection": "A2",
    "temperatureAt": "2026-06-02T08:00:00.000Z",
    "temperatureValue": -17.2,
    "threshold": -18,
    "severity": "abnormal",
    "status": "pending",
    "detectedAt": "2026-06-20T10:00:00.000Z",
    "handledAt": null,
    "handler": null,
    "handlingResult": null,
    "note": null
  },
  {
    "id": "ANOM-1718888888889-def456",
    "batchId": "RS-001",
    "batchSpecies": "独叶草",
    "batchSection": "A2",
    "temperatureAt": "2026-06-03T08:00:00.000Z",
    "temperatureValue": -12.5,
    "threshold": -18,
    "severity": "warning",
    "status": "pending",
    "detectedAt": "2026-06-20T10:00:00.000Z",
    "handledAt": null,
    "handler": null,
    "handlingResult": null,
    "note": null
  }
]
```

#### GET `/batches/:id/anomalies?status=` — 按批次查看异常历史

获取指定批次的所有异常事件，可按状态筛选。

**请求示例：**

```bash
# 查看批次所有异常
curl http://localhost:3035/batches/RS-001/anomalies

# 仅查看未处理异常
curl "http://localhost:3035/batches/RS-001/anomalies?status=pending"

# 仅查看已处理异常
curl "http://localhost:3035/batches/RS-001/anomalies?status=handled"
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "batchSpecies": "独叶草",
  "anomalies": [
    {
      "id": "ANOM-1718888888888-abc123",
      "batchId": "RS-001",
      "temperatureAt": "2026-06-02T08:00:00.000Z",
      "temperatureValue": -17.2,
      "threshold": -18,
      "severity": "abnormal",
      "status": "pending",
      "detectedAt": "2026-06-20T10:00:00.000Z",
      "handledAt": null,
      "handler": null,
      "handlingResult": null,
      "note": null
    }
  ]
}
```

#### PATCH `/batches/:id/anomalies/:anomalyId/handle` — 标记处理结果

将 `pending` 状态的异常标记为已处理，记录处理人、处理结果和备注。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `handler` | string | 否 | 处理人，默认"未知管理员" |
| `handlingResult` | string | 否 | 处理结果：`resolved`/`ignored`/`escalated`，默认`resolved` |
| `note` | string | 否 | 处理备注 |

**请求示例：**

```bash
curl -X PATCH http://localhost:3035/batches/RS-001/anomalies/ANOM-1718888888888-abc123/handle \
  -H "Content-Type: application/json" \
  -d '{
    "handler": "王工程师",
    "handlingResult": "resolved",
    "note": "冷库压缩机故障已修复，温度已恢复正常"
  }'
```

**响应示例：**

```json
{
  "batchId": "RS-001",
  "anomaly": {
    "id": "ANOM-1718888888888-abc123",
    "batchId": "RS-001",
    "temperatureAt": "2026-06-02T08:00:00.000Z",
    "temperatureValue": -17.2,
    "threshold": -18,
    "severity": "abnormal",
    "status": "handled",
    "detectedAt": "2026-06-20T10:00:00.000Z",
    "handledAt": "2026-06-20T14:30:00.000Z",
    "handler": "王工程师",
    "handlingResult": "resolved",
    "note": "冷库压缩机故障已修复，温度已恢复正常"
  }
}
```

#### POST `/anomalies/scan?batchId=&threshold=` — 手动触发异常扫描

扫描所有批次或指定批次的温度记录，检测并生成新的异常事件。可自定义阈值。

**请求示例：**

```bash
# 扫描所有批次，使用默认阈值 -18°C
curl -X POST http://localhost:3035/anomalies/scan

# 仅扫描指定批次
curl -X POST "http://localhost:3035/anomalies/scan?batchId=RS-001"

# 使用自定义阈值 -20°C
curl -X POST "http://localhost:3035/anomalies/scan?threshold=-20"

# 同时指定批次和阈值
curl -X POST "http://localhost:3035/anomalies/scan?batchId=RS-001&threshold=-20"
```

**响应示例：**

```json
{
  "detected": 3,
  "anomalies": [
    {
      "id": "ANOM-1718888888888-abc123",
      "batchId": "RS-001",
      "temperatureAt": "2026-06-02T08:00:00.000Z",
      "temperatureValue": -17.2,
      "threshold": -18,
      "severity": "abnormal",
      "status": "pending",
      "detectedAt": "2026-06-20T10:00:00.000Z",
      "handledAt": null,
      "handler": null,
      "handlingResult": null,
      "note": null
    }
  ]
}
```

#### POST `/batches/:id/temperatures` — 自动异常检测

新增温度记录后会自动触发该批次的异常扫描，新检测到的异常会一并返回。

**请求示例：**

```bash
curl -X POST http://localhost:3035/batches/RS-001/temperatures \
  -H "Content-Type: application/json" \
  -d '{ "value": -16.5 }'
```

**响应示例（新增）：**

```json
{
  "batch": { ... },
  "anomaliesDetected": 1,
  "newAnomalies": [
    {
      "id": "ANOM-1718888888888-abc123",
      "batchId": "RS-001",
      "temperatureAt": "2026-06-20T10:00:00.000Z",
      "temperatureValue": -16.5,
      "threshold": -18,
      "severity": "abnormal",
      "status": "pending",
      "detectedAt": "2026-06-20T10:00:00.000Z",
      "handledAt": null,
      "handler": null,
      "handlingResult": null,
      "note": null
    }
  ]
}
```

### 库存报告（更新）

`GET /reports/inventory` 接口新增受异常影响的批次统计。

**响应示例（新增字段）：**

```json
{
  "total": 1800,
  "totalFrozen": 0,
  "totalAvailable": 1800,
  "totalBatches": 1,
  "batchesWithAnomalies": 1,
  "batchesWithPendingAnomalies": 1,
  ...
}
```

新增字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalBatches` | number | 批次总数 |
| `batchesWithAnomalies` | number | 曾发生过温度异常的批次数量 |
| `batchesWithPendingAnomalies` | number | 存在未处理异常的批次数量 |

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `batch_not_found` | 404 | 批次不存在 |
| `anomaly_not_found` | 404 | 异常事件不存在 |
| `anomaly_already_handled` | 409 | 异常已处理，不可重复标记 |

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
