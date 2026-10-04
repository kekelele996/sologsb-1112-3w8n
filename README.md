# 鸟类环志记录与鸟点地图（gbbirdring）

面向环志站与鸟类监测志愿者：登记环志编号、鸟种与量度（喙/翅/尾/体重）、鸟点生境与调查批次，并在地图上查看鸟点分布。地图使用高德地图 JS API（key 走 `VITE_AMAP_KEY`），**未配置 key 时自动退化为本地 SVG 网格视图，构建与运行均不依赖该 key**。纯前端单页应用，数据全部保存在浏览器本地。

## 环志组 / 监测组双台账规则

系统按现实中两组分工建两套台账（同一个本地数据库内的不同表），各改各的、互不代写：

| 规则 | 实现 |
| --- | --- |
| 环志记录、量度由环志组维护；鸟点、调查批次由监测组维护 | `rings/morphs` 与 `sites/sessions` 分属不同 store，写库各开各表的事务 |
| 监测组按生境调整可**停用**点位（可再启用）、可**关闭**调查批次 | 鸟点有 `status`，批次沿用 `closed`；停用 / 关闭只拦截新登记 |
| 新环志记录只能落在监测组**当下启用的点位 + 未关闭批次**上，且批次须属于该点位 | 登记前只读监测组台账校验（`assertRegisterable`），不满足直接拒绝 |
| 环志组**不能替监测组造点位 / 批次** | 校验失败报 `RingRegisterError`，环志组侧无任何点位写入入口；点位不做物理删除 |
| 历史记录要按**登记当时的点位编号**查得回来 | 登记时快照 `siteNoSnapshot / siteNameSnapshot / sessionNoSnapshot`，列表、筛选、统计台均按快照显示 |
| 监测组**改号**：旧编号不丢 | 旧号追加进点位 `formerSiteNos`，环志组按旧号对账仍能对上；编号不能在普通编辑里直接覆盖 |
| 两边**按点位编号对账**，对不上的先挂起等监测组补台账 | 「按点位编号对账」比对快照编号与现号 / 历史编号；挂起记录红底标记，补台账后再对账自动恢复 |
| 监测组改号 / 关批次失败只回滚自己那份 | 监测组写操作只开 `sites` 或 `sessions` 单表事务，环志表从不参与 |
| 旧数据没记点位归属 | schema v3 升级时按现有鸟点回填快照并标记对账状态，回填不上的挂起；JSON 备份恢复走同一套归一化 |

> 示例数据覆盖了三种关键情景：`S-01` 由旧编号 `S-11` 改号而来（旧号记录仍已对账）、`S-07` 为按生境停用的点位、旧记录 `S-99` 在监测组台账缺失而挂起。


## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21812>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| 构建 | Vite 6（`npm run build` 含 `vue-tsc --noEmit` 类型检查） |
| UI | Element Plus 2 |
| 路由 | Vue Router 4（5 条业务路由 + 404） |
| 状态管理 | Pinia（ringStore / measureStore / siteStore / sessionStore） |
| 地图 | 高德地图 JS API（可选，按需动态加载）+ 本地 SVG 网格退化视图 |
| 存储 | IndexedDB（Dexie，库名 `gbbirdring-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 地图 key 说明（可选）

- 未配置 `VITE_AMAP_KEY`：`<SiteMap>` 渲染本地 SVG 网格视图，标记按生境配色落在对应格位，表单拾取坐标即落到格位中心；**构建与运行都不依赖该 key**。
- 配置后：`.env` 里填 `VITE_AMAP_KEY=<你的 key>`，再 `docker compose up -d --build`（compose 通过 build args 传入，Dockerfile 用 `ARG VITE_AMAP_KEY` 注入 Vite）。高德控制台需为该访问域名开启 JS API。

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21812
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射 / 可选 VITE_AMAP_KEY build arg
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT、可选 VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # ring-record / morphometrics / bird-site / session（+ ui.ts）
│       ├── stores/            # ringStore / measureStore / siteStore / sessionStore
│       ├── components/common/ # SiteMap / MeasureInput / RingCodeInput / SpeciesPicker / StatBadge / FilterBar / EmptyPanel
│       ├── hooks/             # useSiteFilter / useAmap
│       ├── pages/             # RingBoard / RingList / MeasureEntry / SiteList / SessionList
│       ├── router/index.ts    # 路由表
│       └── utils/             # stats.ts / geo.ts / db.ts / export.ts / recon.ts（+ seed.ts / id.ts / plain.ts / format.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 统计台 | 鸟种数、初捕/重捕比、鸟点分布图、鸟种计数与生境分布；挂起记录顶部告警 |
| `/rings` | 环志记录 | 金属环号 + 彩环双段录入与自动查重，重复时提示并跳转历史记录；只选启用点位 / 未关闭批次，含「按点位编号对账」与对账状态筛选 |
| `/measure` | 量度测量 | 6 项量度带单位与范围校验，与同鸟种历史均值比对给出偏离提示 |
| `/sites` | 鸟点台账 | 地图 / SVG 网格双模式切换，表单拾取坐标即时落点，点位间距提示；支持停用 / 再启用与改号（旧号入历史编号） |
| `/sessions` | 调查批次 | 观测条件录入，关闭批次后统计鸟种数、初捕数与重捕数；新建批次只挂启用点位 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbbirdring-db`），表：`rings`、`morphs`、`sites`、`sessions`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2)` 为环志表增加 `[speciesCn+ringDate]` 复合索引并回填历史彩环字段。
- `db.version(3)` 落实双台账：点位补 `status / formerSiteNos` 与 `status` 索引，环志记录补点位 / 批次编号快照与 `reconStatus`；旧数据按现有鸟点回填快照再对账，回填不上的挂起。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入示例数据（7 个鸟点、5 个调查批次、20 条环志记录与 14 条量度，含改号 / 停用 / 挂起三种情景）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
