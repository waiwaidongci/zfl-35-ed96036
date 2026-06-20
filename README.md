# 稀有种子冷库库存和活性追踪API

运行：

```bash
npm start
```

默认端口`3035`。支持多冷库站点、批次、温度、取样、萌发实验、库存流水、负库存拦截、批次备注、人工复核和取样预约。

## 多冷库站点同步模块

将单一冷库库存扩展为多站点模型。每个批次归属某个站点，库存流水、温度、萌发实验和报告都可按站点隔离查询，同时保留全局汇总报告。旧数据自动迁移到默认站点。

### 核心概念

- **站点（Site）**：独立的冷库单位，每个站点有独立的分区、冷盒和批次
- **默认站点**：系统自动创建 `SITE-001`（主冷库），所有旧数据和未指定站点的新数据自动归属此站点
- **站点隔离**：批次、库区、温度记录、萌发实验、库存流水按站点隔离查询
- **全局汇总**：使用 `siteId=all` 可获取所有站点的汇总报告

### 接口默认行为

所有支持 `siteId` 参数的接口遵循以下规则：

| siteId 参数 | 行为 |
|-------------|------|
| 不传 | 使用默认站点（SITE-001），返回结果包含 `siteFilter` 说明使用了默认站点 |
| 具体站点 ID（如 `SITE-002`） | 仅查询该站点的数据 |
| `all` | 全局汇总，返回所有站点数据（仅报告类接口支持） |

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/sites` | 列出所有站点 |
| GET | `/sites/:id` | 获取单个站点详情 |
| POST | `/sites` | 创建新站点 |
| GET | `/batches?siteId=` | 按站点筛选批次列表 |
| POST | `/batches` | 创建批次（支持 siteId 字段） |
| GET | `/reports/inventory?siteId=` | 库存报告（支持站点隔离和全局汇总） |
| GET | `/reports/viability-risk?siteId=` | 活性风险报告（支持站点隔离） |
| GET | `/anomalies/pending?siteId=` | 温度异常列表（支持站点隔离） |
| GET | `/audit-logs?siteId=` | 审计日志（支持站点筛选） |
| GET | `/locations/sections?siteId=` | 库位分区列表（支持站点筛选） |
| POST | `/locations/sections` | 新增分区（支持 siteId 字段） |
| GET | `/labels/batches?siteId=` | 标签打印数据（支持站点筛选） |

### 数据结构

#### 站点字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 站点 ID（如 SITE-001） |
| `name` | string | 站点名称 |
| `code` | string | 站点代码 |
| `address` | string | 站点地址/库区位置 |
| `isDefault` | boolean | 是否为默认站点 |

#### 批次字段新增

| 字段 | 类型 | 说明 |
|------|------|------|
| `siteId` | string | 所属站点 ID，旧数据自动填充为默认站点 |

#### 分区字段新增

| 字段 | 类型 | 说明 |
|------|------|------|
| `siteId` | string | 所属站点 ID，旧分区自动填充为默认站点 |

### 数据迁移

- 首次启动时自动检测旧数据（无 siteId 字段）
- 所有旧批次和旧分区自动归属默认站点（SITE-001）
- 迁移过程不可逆，但数据内容不变

### 接口详情

#### GET `/sites` — 列出所有站点

```bash
curl http://localhost:3035/sites
```

**响应示例：**

```json
[
  { "id": "SITE-001", "name": "主冷库", "code": "MAIN", "address": "一号库区", "isDefault": true },
  { "id": "SITE-002", "name": "二号备库", "code": "BACKUP", "address": "二号库区", "isDefault": false }
]
```

#### POST `/sites` — 创建新站点

```bash
curl -X POST http://localhost:3035/sites \
  -H "Content-Type: application/json" \
  -d '{
    "name": "三号冷库",
    "code": "BRANCH-3",
    "address": "三号库区",
    "isDefault": false
  }'
```

#### GET `/reports/inventory?siteId=all` — 全局汇总报告

```bash
curl "http://localhost:3035/reports/inventory?siteId=all"
```

全局报告新增 `siteDetails` 字段，包含每个站点的独立统计。

#### GET `/reports/inventory` — 默认站点报告

不传 `siteId` 时自动使用默认站点，响应中包含：

```json
{
  "siteFilter": {
    "siteId": "SITE-001",
    "applied": "default",
    "note": "未传 siteId，使用默认站点 SITE-001"
  },
  ...
}
```

### 约束

- 批次合并时，所有来源批次必须来自同一站点
- 批次拆分时，子批次自动继承来源批次的站点
- 批量导入时，未指定 `siteId` 的行自动归属默认站点
- 审计日志按站点筛选时，仅返回涉及该站点批次的操作记录


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
| `siteId` | string | 所属站点ID |
| `siteName` | string | 站点名称 |
| `species` | string | 物种名称 |
| `collectionPlace` | string | 采集地 |
| `motherPlant` | string | 母株编号 |
| `quantity` | number | 当前总数量（原始值） |
| `quantityFormatted` | string | 当前总数量（格式化，千分位） |
| `availableQuantity` | number | 可用库存（总数量 - 冻结库存） |
| `availableQuantityFormatted` | string | 可用库存（格式化，千分位） |
| `frozenQuantity` | number | 冻结库存（已批准预约的数量） |
| `viability` | string | 活性等级原始值（high/medium/low/unknown） |
| `viabilityLabel` | string | 活性等级中文标签 |
| `riskLevel` | string | 活性风险等级原始值（normal/warning/critical/unknown） |
| `riskLevelLabel` | string | 活性风险等级中文标签 |
| `pendingAnomalyCount` | number | 未处理温度异常数量 |
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

## 批次拆分与合并模块

支持将一个批次拆分为多个子批次，也支持将同物种、同采集地、同母株的多个批次合并为一个新批次。拆分和合并都会写入库存流水，并保留来源批次与目标批次的谱系关系。库存报告自动排除已合并关闭的批次，避免重复统计。

### 核心概念

- **批次状态（status）**：
  - `active`：正常活跃，可进行正常出入库操作
  - `split_closed`：拆分后已无剩余数量的来源批次
  - `merged_closed`：已被合并的来源批次，不再参与库存统计
- **谱系关系（lineage）**：
  - `splitFrom`：拆分来源批次ID（仅子批次有值）
  - `splitTo`：拆分出的子批次ID数组（仅来源批次有值）
  - `mergedFrom`：合并来源批次ID数组（仅合并目标批次有值）
  - `mergedInto`：合并到的目标批次ID（仅被合并的来源批次有值）
- **交易类型**：
  - `split_out`：拆出，来源批次库存减少
  - `split_in`：拆入，子批次库存增加
  - `merge_out`：合并出，来源批次库存清零并关闭
  - `merge_in`：合并入，目标批次库存增加
- 已合并关闭（`merged_closed`）的批次不参与库存报告统计

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/batches/:id/split` | 将一个批次拆分为多个子批次 |
| POST | `/batches/merge` | 合并多个批次为一个新批次 |
| GET | `/batches/:id` | 批次详情（含 `status` 和 `lineage` 谱系信息） |
| GET | `/batches?status=` | 按批次状态筛选列表 |
| GET | `/reports/inventory` | 库存报告（排除已合并关闭的批次） |

### 数据结构

#### 批次字段新增

| 字段 | 类型 | 说明 |
|------|------|------|
| `status` | string | 批次状态：`active`/`split_closed`/`merged_closed` |
| `lineage` | object | 谱系关系对象 |
| `lineage.splitFrom` | string\|null | 拆分来源批次ID |
| `lineage.splitTo` | string[] | 拆分出的子批次ID数组 |
| `lineage.mergedFrom` | string[] | 合并来源批次ID数组 |
| `lineage.mergedInto` | string\|null | 合并到的目标批次ID |

### 接口详情

#### POST `/batches/:id/split` — 拆分批次

将一个活跃批次拆分为多个子批次。每个子批次必须指定存放位置（container 和 section）。来源批次剩余数量为 0 时自动标记为 `split_closed`。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `items` | array | 是 | 子批次定义数组，至少2项 |
| `items[].quantity` | number | 是 | 该子批次拆分数量，必须大于0 |
| `items[].container` | string | 是 | 子批次存放冷盒编号 |
| `items[].section` | string | 是 | 子批次所属分区 |
| `items[].id` | string | 否 | 自定义子批次ID，默认自动生成 |
| `items[].remark` | string | 否 | 子批次备注 |

**约束：**
- 拆分总数量不能超过来源批次的可用库存（实际库存 - 冻结库存）
- 来源批次必须处于 `active` 状态
- 所有子批次会继承来源批次的物种、采集地、母株、活性等级

**请求示例：**

```bash
curl -X POST http://localhost:3035/batches/RS-001/split \
  -H "Content-Type: application/json" \
  -d '{
    "items": [
      { "quantity": 600, "container": "C-冷盒-09", "section": "A2", "remark": "分发给A实验室" },
      { "quantity": 400, "container": "C-冷盒-10", "section": "A2", "remark": "分发给B实验室" }
    ]
  }'
```

**响应示例：**

```json
{
  "sourceBatch": {
    "id": "RS-001",
    "quantity": 800,
    "status": "active",
    "transaction": {
      "id": "TX-1718888888888-abcd",
      "at": "2026-06-20T10:00:00.000Z",
      "type": "split_out",
      "quantity": 1000,
      "balance": 800,
      "note": "拆分为 RS-001-S1-8888、RS-001-S2-8888，共拆分 1000 粒"
    }
  },
  "childBatches": [
    {
      "id": "RS-001-S1-8888",
      "quantity": 600,
      "container": "C-冷盒-09",
      "section": "A2",
      "transaction": {
        "id": "TX-1718888888889-wxyz",
        "at": "2026-06-20T10:00:00.000Z",
        "type": "split_in",
        "quantity": 600,
        "balance": 600,
        "note": "从批次 RS-001 拆分子批次，拆分数量 600"
      }
    },
    {
      "id": "RS-001-S2-8888",
      "quantity": 400,
      "container": "C-冷盒-10",
      "section": "A2",
      "transaction": {
        "id": "TX-1718888888890-pqrs",
        "at": "2026-06-20T10:00:00.000Z",
        "type": "split_in",
        "quantity": 400,
        "balance": 400,
        "note": "从批次 RS-001 拆分子批次，拆分数量 400"
      }
    }
  ]
}
```

#### POST `/batches/merge` — 合并批次

将多个同物种、同采集地、同母株的活跃批次合并为一个新批次。来源批次会被标记为 `merged_closed` 且库存清零，不再参与库存统计。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batchIds` | string[] | 是 | 要合并的来源批次ID数组，至少2项 |
| `target` | object | 是 | 目标批次信息 |
| `target.container` | string | 是 | 目标批次存放冷盒编号 |
| `target.section` | string | 是 | 目标批次所属分区 |
| `target.id` | string | 否 | 自定义目标批次ID，默认自动生成 `RS-M-xxxxxx` |
| `target.remark` | string | 否 | 目标批次备注 |

**约束：**
- 所有来源批次必须处于 `active` 状态
- 所有来源批次必须具有相同的 `species`、`collectionPlace`、`motherPlant`
- 合并后目标批次继承来源批次的物种、采集地、母株、活性等级
- 来源批次的冻结库存会一并合并到目标批次

**请求示例：**

```bash
curl -X POST http://localhost:3035/batches/merge \
  -H "Content-Type: application/json" \
  -d '{
    "batchIds": ["RS-001-S1-8888", "RS-001-S2-8888"],
    "target": {
      "container": "C-冷盒-11",
      "section": "A2",
      "remark": "合并后统一管理"
    }
  }'
```

**响应示例：**

```json
{
  "targetBatch": {
    "id": "RS-M-888888",
    "quantity": 1000,
    "frozenQuantity": 0,
    "container": "C-冷盒-11",
    "section": "A2",
    "transaction": {
      "id": "TX-1718888889000-merge",
      "at": "2026-06-20T11:00:00.000Z",
      "type": "merge_in",
      "quantity": 1000,
      "balance": 1000,
      "note": "由批次 RS-001-S1-8888、RS-001-S2-8888 合并，合并数量 1000 粒"
    },
    "mergedFrom": ["RS-001-S1-8888", "RS-001-S2-8888"]
  },
  "sourceBatches": [
    {
      "batchId": "RS-001-S1-8888",
      "transaction": {
        "id": "TX-1718888889001-out1",
        "at": "2026-06-20T11:00:00.000Z",
        "type": "merge_out",
        "quantity": 600,
        "balance": 0,
        "note": "合并到批次 RS-M-888888，合并数量 600 粒"
      }
    },
    {
      "batchId": "RS-001-S2-8888",
      "transaction": {
        "id": "TX-1718888889002-out2",
        "at": "2026-06-20T11:00:00.000Z",
        "type": "merge_out",
        "quantity": 400,
        "balance": 0,
        "note": "合并到批次 RS-M-888888，合并数量 400 粒"
      }
    }
  ]
}
```

#### GET `/batches/:id` — 批次详情（含谱系信息）

批次详情接口现在包含 `status` 和 `lineage` 字段，可查看该批次的来源和去向。

**响应示例（拆分后的来源批次）：**

```json
{
  "id": "RS-001",
  "species": "独叶草",
  "quantity": 800,
  "status": "active",
  "lineage": {
    "splitFrom": null,
    "splitTo": ["RS-001-S1-8888", "RS-001-S2-8888"],
    "mergedFrom": [],
    "mergedInto": null
  },
  "transactions": [
    { "type": "collect", ... },
    { "type": "split_out", "quantity": 1000, "balance": 800, ... }
  ],
  ...
}
```

**响应示例（子批次）：**

```json
{
  "id": "RS-001-S1-8888",
  "species": "独叶草",
  "quantity": 600,
  "status": "active",
  "lineage": {
    "splitFrom": "RS-001",
    "splitTo": [],
    "mergedFrom": [],
    "mergedInto": null
  },
  ...
}
```

**响应示例（已合并关闭的来源批次）：**

```json
{
  "id": "RS-001-S1-8888",
  "quantity": 0,
  "status": "merged_closed",
  "lineage": {
    "splitFrom": "RS-001",
    "splitTo": [],
    "mergedFrom": [],
    "mergedInto": "RS-M-888888"
  },
  ...
}
```

#### GET `/reports/inventory` — 库存报告（更新）

库存报告现在排除 `merged_closed` 状态的批次，避免重复统计。新增 `mergedClosedBatches` 和 `totalBatchesAll` 字段用于参考。

**响应示例（新增字段）：**

```json
{
  "total": 1800,
  "totalBatches": 2,
  "totalBatchesAll": 4,
  "mergedClosedBatches": 2,
  "lowStock": [
    {
      "id": "RS-M-888888",
      "species": "独叶草",
      "quantity": 1000,
      "frozenQuantity": 0,
      "availableQuantity": 1000,
      "status": "active"
    }
  ],
  ...
}
```

新增字段说明：

| 字段 | 类型 | 说明 |
|------|------|------|
| `totalBatches` | number | 参与统计的活跃批次数量（排除 merged_closed） |
| `totalBatchesAll` | number | 所有批次总数（含已关闭） |
| `mergedClosedBatches` | number | 已合并关闭的批次数量 |
| `lowStock[].status` | string | 批次状态 |

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `batch_not_found` | 404 | 批次不存在，合并时返回缺失ID列表 |
| `batch_not_active` | 409 | 批次状态不是 active，无法拆分/合并 |
| `invalid_split_items` | 409 | 拆分项无效（至少需要2个子批次） |
| `invalid_quantity` | 400/409 | 数量无效（小于等于0） |
| `insufficient_available_quantity` | 409 | 可用库存不足 |
| `missing_container_or_section` | 409 | 缺少 container 或 section |
| `batch_id_conflict` | 409 | 自定义批次ID已存在 |
| `insufficient_batches` | 409 | 合并至少需要2个批次 |
| `merge_mismatch` | 409 | 合并批次必须同物种、同采集地、同母株 |

## 活性趋势分析模块

根据每个批次的 `germinations` 历史记录，自动计算最近萌发率、趋势方向和风险等级。提供全局活性风险报告，列出连续下降、低于阈值和长期未复测的批次。批次列表支持按活性风险筛选，批次详情返回趋势摘要。

### 核心概念

#### 风险等级（riskLevel）

| 等级 | 说明 | 判断条件 |
|------|------|----------|
| `normal` | 正常 | 无风险因素 |
| `warning` | 警告 | 存在1个风险因素，或多个轻度风险因素 |
| `critical` | 严重 | 萌发率下降趋势 + 低于阈值 |
| `unknown` | 未知 | 无萌发实验数据 |

#### 趋势方向（trendDirection）

| 方向 | 说明 |
|------|------|
| `rising` | 上升 | 最近萌发率显著提升 |
| `stable` | 稳定 | 无显著变化 |
| `declining` | 下降 | 最近萌发率持续下降或总体下降 |
| `unknown` | 未知 | 数据不足（少于2次记录） |

#### 风险因素

| 因素 | 说明 | 默认阈值 |
|------|------|----------|
| `rate_below_threshold` | 萌发率低于阈值 | 60%（0.6） |
| `declining_trend` | 连续下降趋势 | 连续2次显著下降（变化≥5%） |
| `long_term_no_retest` | 长期未复测 | 超过90天 |

#### 可配置参数

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `lowRateThreshold` | 低萌发率阈值 | 0.6 |
| `consecutiveDeclineThreshold` | 连续下降次数阈值 | 2 |
| `longTermDays` | 长期未复测天数 | 90 |
| `significantChangeThreshold` | 显著变化阈值 | 0.05（5%） |
| `minRecordsForTrend` | 趋势分析最少记录数 | 2 |

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/reports/viability-risk?lowRateThreshold=&consecutiveDeclineThreshold=&longTermDays=&significantChangeThreshold=` | 全局活性风险报告 |
| GET | `/batches/:id/viability` | 单个批次活性分析详情 |
| GET | `/batches?riskLevel=normal/warning/critical/unknown` | 按风险等级筛选批次列表 |
| GET | `/batches/:id` | 批次详情（含 `trendSummary` 趋势摘要） |

### 数据结构

#### 趋势摘要字段（trendSummary）

批次列表和详情接口都会返回此字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `latestRate` | number | 最近萌发率（0-1） |
| `latestRateFormatted` | string | 格式化的萌发率（如 "72.0%"） |
| `trendDirection` | string | 趋势方向：`rising`/`stable`/`declining`/`unknown` |
| `riskLevel` | string | 风险等级：`normal`/`warning`/`critical`/`unknown` |
| `daysSinceLastTest` | number | 距最近一次测试的天数 |

### 接口详情

#### GET `/reports/viability-risk` — 全局活性风险报告

获取所有批次的活性风险分析报告，包含三类重点关注批次清单。

**查询参数（可选）：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `lowRateThreshold` | number | 自定义低萌发率阈值（0-1） |
| `consecutiveDeclineThreshold` | number | 自定义连续下降次数阈值 |
| `longTermDays` | number | 自定义长期未复测天数 |
| `significantChangeThreshold` | number | 自定义显著变化阈值 |

**请求示例：**

```bash
# 使用默认阈值
curl http://localhost:3035/reports/viability-risk

# 自定义阈值
curl "http://localhost:3035/reports/viability-risk?lowRateThreshold=0.7&longTermDays=60"
```

**响应示例：**

```json
{
  "generatedAt": "2026-06-20T10:00:00.000Z",
  "options": {
    "lowRateThreshold": 0.6,
    "consecutiveDeclineThreshold": 2,
    "longTermDays": 90,
    "significantChangeThreshold": 0.05
  },
  "summary": {
    "totalBatches": 6,
    "criticalCount": 1,
    "warningCount": 3,
    "normalCount": 1,
    "unknownCount": 1
  },
  "continuouslyDeclining": [
    {
      "batchId": "RS-002",
      "species": "珙桐",
      "latestRate": 0.55,
      "trendChange": -0.23,
      "germinationCount": 3,
      "germinationHistory": [
        { "at": "2026-02-10", "sampled": 100, "sprouted": 78, "rate": 0.78 },
        { "at": "2026-04-10", "sampled": 100, "sprouted": 71, "rate": 0.71 },
        { "at": "2026-05-20", "sampled": 100, "sprouted": 55, "rate": 0.55 }
      ]
    }
  ],
  "belowThreshold": [
    {
      "batchId": "RS-002",
      "species": "珙桐",
      "latestRate": 0.55,
      "latestRateFormatted": "55.0%",
      "threshold": 0.6,
      "latestTestDate": "2026-05-20"
    },
    {
      "batchId": "RS-004",
      "species": "望天树",
      "latestRate": 0.52,
      "latestRateFormatted": "52.0%",
      "threshold": 0.6,
      "latestTestDate": "2026-01-20"
    }
  ],
  "longTermNoRetest": [
    {
      "batchId": "RS-005",
      "species": "水杉",
      "latestRate": 0.88,
      "daysSinceLastTest": 125,
      "latestTestDate": "2026-02-15"
    }
  ],
  "allAnalyses": [
    {
      "batchId": "RS-001",
      "species": "独叶草",
      "latestRate": 0.72,
      "trendDirection": "declining",
      "riskLevel": "warning",
      "riskReasons": ["declining_trend"],
      "daysSinceLastTest": 8
    },
    {
      "batchId": "RS-002",
      "species": "珙桐",
      "latestRate": 0.55,
      "trendDirection": "declining",
      "riskLevel": "critical",
      "riskReasons": ["rate_below_threshold", "declining_trend"],
      "daysSinceLastTest": 31
    }
  ]
}
```

**响应字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `generatedAt` | string | 报告生成时间 |
| `options` | object | 本次分析使用的阈值参数 |
| `summary` | object | 风险等级统计汇总 |
| `continuouslyDeclining` | array | 连续下降批次列表 |
| `belowThreshold` | array | 萌发率低于阈值批次列表 |
| `longTermNoRetest` | array | 长期未复测批次列表 |
| `allAnalyses` | array | 所有批次的活性分析摘要 |

#### GET `/batches/:id/viability` — 批次活性分析详情

获取单个批次的完整活性趋势分析。

**查询参数（可选）：**

| 参数 | 类型 | 说明 |
|------|------|------|
| `lowRateThreshold` | number | 自定义低萌发率阈值 |
| `consecutiveDeclineThreshold` | number | 自定义连续下降次数阈值 |
| `longTermDays` | number | 自定义长期未复测天数 |
| `significantChangeThreshold` | number | 自定义显著变化阈值 |

**请求示例：**

```bash
curl http://localhost:3035/batches/RS-002/viability
```

**响应示例：**

```json
{
  "batchId": "RS-002",
  "latestGermination": {
    "at": "2026-05-20",
    "sampled": 100,
    "sprouted": 55,
    "rate": 0.55
  },
  "latestRate": 0.55,
  "daysSinceLastTest": 31,
  "trendDirection": "declining",
  "trendReason": "consecutive_decline",
  "trendChange": -0.23,
  "riskLevel": "critical",
  "riskReasons": ["rate_below_threshold", "declining_trend"],
  "germinationCount": 3,
  "germinationHistory": [
    { "at": "2026-02-10", "sampled": 100, "sprouted": 78, "rate": 0.78 },
    { "at": "2026-04-10", "sampled": 100, "sprouted": 71, "rate": 0.71 },
    { "at": "2026-05-20", "sampled": 100, "sprouted": 55, "rate": 0.55 }
  ]
}
```

#### GET `/batches?riskLevel=critical` — 按风险等级筛选

在批次列表接口中新增 `riskLevel` 查询参数，筛选指定风险等级的批次。

**可用值：**
- `normal` - 正常
- `warning` - 警告
- `critical` - 严重
- `unknown` - 未知

**请求示例：**

```bash
# 仅显示严重风险批次
curl "http://localhost:3035/batches?riskLevel=critical"

# 组合筛选：警告风险 + A2分区
curl "http://localhost:3035/batches?riskLevel=warning&section=A2"
```

**响应示例：**

```json
[
  {
    "id": "RS-002",
    "species": "珙桐",
    "quantity": 950,
    "trendSummary": {
      "latestRate": 0.55,
      "latestRateFormatted": "55.0%",
      "trendDirection": "declining",
      "riskLevel": "critical",
      "daysSinceLastTest": 31
    },
    ...
  }
]
```

#### GET `/batches/:id` — 批次详情（含趋势摘要）

批次详情接口已包含 `trendSummary` 字段，可直接查看活性趋势。

**响应示例（节选）：**

```json
{
  "id": "RS-001",
  "species": "独叶草",
  "quantity": 1800,
  "germinations": [
    { "at": "2026-01-15", "sampled": 100, "sprouted": 85, "rate": 0.85 },
    { "at": "2026-03-15", "sampled": 100, "sprouted": 82, "rate": 0.82 },
    { "at": "2026-05-15", "sampled": 100, "sprouted": 78, "rate": 0.78 },
    { "at": "2026-06-12", "sampled": 100, "sprouted": 72, "rate": 0.72 }
  ],
  "trendSummary": {
    "latestRate": 0.72,
    "latestRateFormatted": "72.0%",
    "trendDirection": "declining",
    "riskLevel": "warning",
    "daysSinceLastTest": 8
  },
  ...
}
```

### 示例数据说明

示例数据中包含6个批次，覆盖各种风险场景：

| 批次 | 物种 | 风险等级 | 说明 |
|------|------|----------|------|
| RS-001 | 独叶草 | warning | 整体下降趋势（85%→82%→78%→72%） |
| RS-002 | 珙桐 | critical | 连续下降 + 低于阈值（78%→71%→55%） |
| RS-003 | 红豆杉 | normal | 稳定高活性（92%→90%→89%） |
| RS-004 | 望天树 | warning | 低于阈值（52%） |
| RS-005 | 水杉 | warning | 长期未复测（125天） |
| RS-006 | 银杏 | unknown | 无萌发实验数据 |

### 计算模块

活性趋势分析的核心计算逻辑独立在 [viability-trend.js](file:///Users/ali/Desktop/zfl%20new%20solo%20coder/zfl-35/lib/viability-trend.js) 模块中，提供以下可复用函数：

| 函数 | 说明 |
|------|------|
| `analyzeBatchViability(batch, options)` | 完整分析单个批次的活性趋势 |
| `getBatchTrendSummary(batch, options)` | 获取批次的趋势摘要（用于列表和详情） |
| `filterBatchesByRisk(batches, riskLevel, options)` | 按风险等级筛选批次 |
| `isRiskLevel(batch, level, options)` | 判断批次是否属于指定风险等级 |
| `generateViabilityRiskReport(options)` | 生成全局风险报告 |
| `getBatchViabilityAnalysis(batchId, options)` | 从数据库加载批次并分析 |

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `batch_not_found` | 404 | 批次不存在 |

## 批次导入预览模块

支持一次性提交一组待入库批次 JSON，先返回字段校验结果、重复批次号、数量异常和可导入行摘要，确认后再真正写入 batches 并生成 collect 流水。导入确认时通过数据库指纹机制防止预览后数据变化导致重复写入。

### 核心概念

- **两阶段导入**：先 `preview`（预览校验），再 `confirm`（确认写入），避免直接写入脏数据
- **预览令牌（previewToken）**：预览成功后返回唯一令牌，确认时需携带此令牌
- **数据库指纹（fingerprint）**：预览时记录当前数据库状态的 MD5 摘要，确认时校验指纹是否一致。若预览后有人修改了批次数据（新增/删除/修改数量），指纹会变化，确认将被拒绝
- **令牌有效期**：预览令牌 30 分钟内有效，过期需重新预览
- **导入限制**：单次导入不超过 1000 条

### 校验规则

#### 必填字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 批次号（非空字符串） |
| `species` | string | 物种名称 |
| `quantity` | number | 数量（正整数，最大 10,000,000） |

#### 可选字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `collectionPlace` | string | 采集地 |
| `motherPlant` | string | 母株编号 |
| `container` | string | 冷盒编号 |
| `section` | string | 分区 |
| `viability` | string | 活性等级：`high`/`medium`/`low`/`unknown`，不合法值会被设为 `unknown` |
| `remark` | string | 备注 |

#### 校验项

| 校验项 | 级别 | 说明 |
|--------|------|------|
| `missing_required_field` | 错误 | 缺少必填字段 |
| `invalid_field_type` | 错误 | 字段类型不正确 |
| `duplicate_id_existing` | 错误 | 批次号与系统中已有批次重复 |
| `duplicate_id_in_import` | 错误 | 批次号在导入列表内重复 |
| `quantity_not_positive` | 错误 | 数量不为正数 |
| `quantity_too_large` | 错误 | 数量超过 10,000,000 |
| `invalid_viability` | 警告 | 活性等级值不合法，将被设为 `unknown` |
| `non_integer_quantity` | 警告 | 数量非整数，将被截断 |

### 接口一览

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/imports/preview` | 预览导入：校验并返回预览结果 |
| POST | `/imports/confirm` | 确认导入：写入批次并生成 collect 流水 |

### 接口详情

#### POST `/imports/preview` — 预览导入

提交一批待入库批次数据，系统进行校验并返回详细结果。返回结果中仅校验通过的行可被确认导入。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `batches` | array | 是 | 待导入批次对象数组 |

**请求示例：**

```bash
curl -X POST http://localhost:3035/imports/preview \
  -H "Content-Type: application/json" \
  -d '{
    "batches": [
      {
        "id": "RS-010",
        "species": "红豆杉",
        "quantity": 2000,
        "collectionPlace": "秦岭南坡",
        "motherPlant": "MP-22",
        "container": "C-冷盒-15",
        "section": "B1",
        "viability": "high"
      },
      {
        "id": "RS-011",
        "species": "珙桐",
        "quantity": 1500,
        "collectionPlace": "神农架",
        "container": "C-冷盒-16",
        "section": "B1"
      },
      {
        "id": "RS-010",
        "species": "水杉",
        "quantity": 500
      },
      {
        "id": "RS-012",
        "species": "望天树",
        "quantity": -100
      },
      {
        "id": "RS-001",
        "species": "独叶草",
        "quantity": 300
      }
    ]
  }'
```

**响应示例：**

```json
{
  "previewToken": "IMP-1718888888888-abc123",
  "fingerprint": "a1b2c3d4e5f6...",
  "totalRows": 5,
  "importableCount": 1,
  "invalidCount": 4,
  "importableRows": [
    {
      "index": 1,
      "id": "RS-011",
      "species": "珙桐",
      "quantity": 1500,
      "warnings": []
    }
  ],
  "duplicateIds": [
    { "id": "RS-010", "count": 2 }
  ],
  "duplicateExistingIds": ["RS-001"],
  "quantityAnomalies": [
    {
      "index": 3,
      "id": "RS-012",
      "quantity": -100,
      "issues": [
        { "code": "quantity_not_positive", "field": "quantity", "message": "quantity 必须大于0" }
      ]
    }
  ],
  "validationResults": [
    {
      "index": 0,
      "id": "RS-010",
      "valid": false,
      "errors": [
        { "code": "duplicate_id_in_import", "field": "id", "message": "批次号 RS-010 在导入列表中重复出现 2 次" }
      ],
      "warnings": []
    },
    {
      "index": 1,
      "id": "RS-011",
      "valid": true,
      "errors": [],
      "warnings": []
    },
    {
      "index": 2,
      "id": "RS-010",
      "valid": false,
      "errors": [
        { "code": "duplicate_id_in_import", "field": "id", "message": "批次号 RS-010 在导入列表中重复出现 2 次" }
      ],
      "warnings": []
    },
    {
      "index": 3,
      "id": "RS-012",
      "valid": false,
      "errors": [
        { "code": "quantity_not_positive", "field": "quantity", "message": "quantity 必须大于0" }
      ],
      "warnings": []
    },
    {
      "index": 4,
      "id": "RS-001",
      "valid": false,
      "errors": [
        { "code": "duplicate_id_existing", "field": "id", "message": "批次号 RS-001 已存在于系统中" }
      ],
      "warnings": []
    }
  ]
}
```

#### POST `/imports/confirm` — 确认导入

使用预览令牌确认导入。系统会校验令牌有效性、数据库指纹一致性以及批次号是否仍无冲突，全部通过后才写入批次数据并生成 collect 流水。确认后令牌自动失效。

**请求体：**

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `previewToken` | string | 是 | 预览时返回的令牌 |

**请求示例：**

```bash
curl -X POST http://localhost:3035/imports/confirm \
  -H "Content-Type: application/json" \
  -d '{
    "previewToken": "IMP-1718888888888-abc123"
  }'
```

**响应示例：**

```json
{
  "imported": 1,
  "totalRows": 5,
  "importableCount": 1,
  "invalidCount": 4,
  "batches": [
    {
      "id": "RS-011",
      "species": "珙桐",
      "quantity": 1500,
      "container": "C-冷盒-16",
      "section": "B1",
      "viability": "unknown"
    }
  ],
  "transactions": [
    {
      "id": "TX-1718890000000-ab12",
      "type": "collect",
      "quantity": 1500,
      "balance": 1500
    }
  ]
}
```

### 防重复写入机制

确认导入时会进行以下校验，防止预览后数据变化导致重复写入：

1. **指纹校验**：预览时记录当前数据库指纹，确认时重新计算指纹。若不一致（说明有人在此期间新增/删除/修改了批次），拒绝导入并返回 `data_changed_since_preview` 错误
2. **批次号二次校验**：即使指纹一致，仍会逐条检查导入行中的批次号是否在确认时已被占用
3. **令牌一次性**：确认成功后令牌立即失效，不可重复使用
4. **令牌过期**：令牌 30 分钟有效期，超时需重新预览

### 错误码

| 错误码 | HTTP状态 | 说明 |
|--------|----------|------|
| `invalid_input` | 400 | 请求体无效（非空数组） |
| `too_many_rows` | 400 | 单次导入超过1000条 |
| `invalid_token` | 400 | 令牌格式无效 |
| `token_not_found` | 404 | 预览令牌不存在 |
| `token_expired` | 410 | 预览令牌已过期 |
| `data_changed_since_preview` | 409 | 预览后数据已变化 |
| `no_importable_rows` | 409 | 无可导入行 |
