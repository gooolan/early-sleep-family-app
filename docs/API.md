# HTTP API

默认监听 `:8080`。除健康检查、默认配置、身份识别、手机号登录、新建和加入家庭外，其余接口都需要：

```http
Authorization: Bearer <member-token>
Content-Type: application/json
```

成功响应通常使用 `{ "data": ... }`，错误响应使用：

```json
{
  "error": {
    "code": "invalid_input",
    "message": "..."
  }
}
```

## 公共接口

### `GET /ping`

返回 `{"message":"pong"}`。

### `GET /api/v1/default-settings`

返回工作日和周末推荐计分配置。

### `POST /api/v1/identity/check`

检查规范化后的手机号是否已经绑定成员：

```json
{"phone":"13800138000"}
```

```json
{
  "data": {
    "exists": true,
    "phone": "+8613800138000",
    "verificationRequired": false
  }
}
```

当前私人模式不验证短信，所以 `verificationRequired` 为 `false`。未来启用短信验证码时，该字段可直接驱动客户端进入验证码页面。

### `POST /api/v1/sessions`

通过已绑定手机号恢复成员身份并签发新的成员令牌：

```json
{"phone":"13800138000"}
```

新令牌签发后，旧成员令牌失效。创建者响应还会包含家庭邀请码。

### `POST /api/v1/families`

```json
{
  "familyName": "我们的早睡计划",
  "nickname": "小兰",
  "phone": "13800138000",
  "timezone": "Asia/Shanghai"
}
```

`settings` 可选；省略时使用推荐配置。响应包含 `token`、`joinCode` 和 `family`。

### `POST /api/v1/families/join`

```json
{
  "joinCode": "AB12CD34",
  "nickname": "另一位",
  "phone": "13900139000"
}
```

响应包含该成员的 `token` 和家庭视图。家庭已有两名成员时返回 `409 family_full`。

## 家庭与设置

### `GET /api/v1/family`

返回当前成员、双方成员、活动周动态统计、历史归档、`pendingExemptions` 和 `rewardReview`。如果服务器当前睡觉日期已经进入新周，该读取会先冻结有记录的上一周、清理未处理申请并切换活动周，因此打开 App 即可看到新周。活动周的 `summary.expectedCheckins` 按截至当前睡觉日期已进行的天数计算；归档周固定按 7 天计算。`activeWeek.rewardRuleVersion` 和每个归档的 `rewardRuleVersion` 指定前端应使用的内置奖励版本。奖励金额由客户端根据周积分显示为手工结算参考，后端不维护奖励结算状态或共同账户流水。

### `GET /api/v1/family/export`

导出当前家庭的完整 JSON 备份。所有成员均可调用。响应中的 `formatVersion` 当前为 `1`，`family` 包含业务数据、手机号和家庭邀请码，但成员令牌摘要及邀请码摘要已移除。

```json
{
  "data": {
    "formatVersion": 1,
    "exportedAt": "2026-08-27T10:00:00Z",
    "family": {}
  }
}
```

### `POST /api/v1/family/restore`

仅创建者可调用，请求体是导出接口返回的 `data` 对象。只允许恢复相同家庭 ID、相同成员组成且结构合法的备份；后端保留当前成员手机号、角色、验证状态和登录凭证。请求体上限为 16 MiB。成功后返回恢复后的家庭视图，恢复前文件仍会保存在同名 `.bak` 中。

### `PATCH /api/v1/family/settings`

仅创建者可以调用。请求体是完整设置对象：

`score` 和 `fine` 均接受整数正数、零或负数；各非末级 `end` 必须有值并按夜间时间严格递增。`rewardNote` 仅为旧版家庭文件与归档数据的兼容字段，最多 2000 字节；新版 App 不再展示或编辑该字段，奖励改由 App 内置规则计算。

```json
{
  "idealTime": "23:00",
  "cutoffHour": 6,
  "rewardNote": "旧版兼容字段，新版 App 忽略此内容。",
  "weekdayTiers": [
    {"end":"22:30","score":3,"fine":0},
    {"end":"23:00","score":2,"fine":0},
    {"end":"23:30","score":1,"fine":0},
    {"end":"00:00","score":0,"fine":0},
    {"end":"00:30","score":-1,"fine":20},
    {"end":"01:00","score":-2,"fine":50},
    {"end":"01:30","score":-3,"fine":100},
    {"end":"","score":-3,"fine":100}
  ],
  "weekendTiers": [
    {"end":"22:30","score":5,"fine":0},
    {"end":"23:00","score":4,"fine":0},
    {"end":"23:30","score":3,"fine":0},
    {"end":"00:00","score":2,"fine":0},
    {"end":"00:30","score":1,"fine":0},
    {"end":"01:00","score":0,"fine":0},
    {"end":"01:30","score":-1,"fine":20},
    {"end":"","score":-2,"fine":50}
  ]
}
```

## 打卡

### `PUT /api/v1/checkins/now`

用服务器在家庭时区中的当前时间打卡。凌晨截止时间之前自动归到前一晚。

### `PUT /api/v1/checkins/{YYYY-MM-DD}`

补卡或覆盖当前成员当天的记录：

```json
{"time":"23:10","source":"backfill"}
```

只能写活动周。双人家庭中该接口生成待确认变更，原记录与分数保持不变；单人家庭直接生效。完整家庭视图中的 `pendingChanges` 会返回待确认项。

### `DELETE /api/v1/checkins/{YYYY-MM-DD}`

双人家庭中生成删除待确认项；单人家庭直接删除。对方同意前原记录保持有效。

### `POST /api/v1/checkin-changes/{id}/approve`

由非发起成员确认待处理的补卡、修改或删除。确认后变更写入活动周并重新计分。发起人不能确认自己的申请。

### `POST /api/v1/checkin-changes/{id}/reject`

由非发起成员拒绝待处理变更。拒绝后移除申请，原记录和本周分数不变。

## 特殊情况豁免

### `POST /api/v1/exemptions`

为当前成员申请活动周内某一天的特殊情况豁免：

```json
{"date":"2026-08-26"}
```

每位成员每自然月最多 2 次。双人家庭生成 `pendingExemptions` 待确认项；单人家庭直接生效。通过后该日作为有效记录计入完成率，但固定为 0 分、0 罚金，且不计入平均入睡时间。

### `POST /api/v1/exemption-changes/{id}/approve`

由非发起成员同意豁免申请。通过后写入活动周，周切换时随历史周报冻结。

### `POST /api/v1/exemption-changes/{id}/reject`

由非发起成员拒绝豁免申请，不改变当天原有记录。

## 规则复盘

### `POST /api/v1/reward-review/complete`

仅创建者可调用。把 30 天规则复盘周期重置为当前时间。该接口只确认双方已经复盘规则，不生成账单、不标记奖励已结算，也不写入共同账户流水。

## 主要错误码

| HTTP | code | 含义 |
|---:|---|---|
| 400 | `invalid_json` | JSON 无效或存在未知字段 |
| 400 | `invalid_backup` | 备份格式、家庭、成员或内部数据不合法 |
| 400 | `invalid_input` | 时间、日期或规则不合法 |
| 401 | `unauthorized` | 成员令牌缺失或失效 |
| 404 | `not_found` | 用户、家庭或邀请码不存在 |
| 409 | `phone_exists` | 手机号已经绑定现有成员 |
| 409 | `family_full` | 家庭已有两名成员 |
| 409 | `archived_week` | 试图修改非活动周 |
| 409 | `self_approval` | 发起人试图确认自己的修改 |
| 409 | `exemption_limit` | 当前成员本自然月已经用满 2 次豁免 |
| 409 | `exempt_day` | 已通过豁免的日期不能再修改普通打卡 |
