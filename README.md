# 鸟类环志记录与鸟点地图（gbbirdring）

面向环志站与鸟类监测志愿者：登记环志编号、鸟种与量度（喙/翅/尾/体重）、鸟点生境与调查批次，并在地图上查看鸟点分布。地图使用高德地图 JS API（key 走 `VITE_AMAP_KEY`），**未配置 key 时自动退化为本地 SVG 网格视图，构建与运行均不依赖该 key**。纯前端单页应用，数据全部保存在浏览器本地。

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
| 状态 | Pinia（ringStore / measureStore / siteStore / sessionStore） |
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
│       └── utils/             # stats.ts / geo.ts / db.ts / export.ts（+ seed.ts / id.ts / plain.ts / format.ts）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 统计台 | 鸟种数、初捕/重捕比、鸟点分布图、鸟种计数与生境分布 |
| `/rings` | 环志记录 | 金属环号 + 彩环双段录入与自动查重；新登记只落到有效鸟点 / 进行中批次，编号随记录留底；按登记点位编号（含旧编号）回查、与监测组台账对账挂起 |
| `/measure` | 量度测量 | 6 项量度带单位与范围校验，与同鸟种历史均值比对给出偏离提示 |
| `/sites` | 鸟点台账 | 监测组维护：地图 / SVG 网格双模式、停用 / 启用、改号留痕（旧编号可回查）、表单拾取坐标 |
| `/sessions` | 调查批次 | 只挂有效鸟点；观测条件录入，关闭批次后统计鸟种数、初捕数与重捕数，关闭后不再接受新登记 |

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbbirdring-db`），表：`rings`、`morphs`、`sites`、`sessions`、`meta`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为环志表增加 `[speciesCn+ringDate]` 复合索引并回填历史彩环字段。升级前可用顶栏「导出备份」导出全量 JSON。
- `db.version(3)` 落实「环志组 / 监测组各自留底、按点位编号对账」：
  - 鸟点（监测组台账）增加 `active` 停用标记与 `noHistory` 改号历史；调查批次增加 `closedAt`。
  - 环志记录（环志组留底）增加登记当时的 `siteNoSnapshot` / `sessionNoSnapshot` 编号快照、`reconcile` 对账状态、`legacyBackfilled` 回填标记。
  - 新登记只能选监测组当下**有效鸟点 + 进行中批次**；监测组改号后，历史记录仍按登记当时旧编号回查；停用点位不再接受新登记。
  - 升级时旧记录没记点位归属的，先按 `siteId` 补编号，`siteId` 已失效的按现有有效鸟点回填再启用并标记「回填」；台账为空或编号查无此点的挂起，等监测组补台账。
- 改号 / 停用 / 关批次只开监测组自己表（`sites` / `sessions`）的事务，失败只回滚台账，环志组已登记记录不受影响；环志记录写入只开 `rings` 表事务。
- 环志记录页「按点位编号对账」以快照编号对台账（含改号历史），对不上的记录置为「挂起」，环志组不替监测组造点位；补完台账后再对账即可解除挂起。
- 首次打开且表为空时写入示例数据（6 个鸟点：含 1 个停用点位与 1 段 S-03→S-13 改号历史；4 个调查批次；19 条环志记录，其中 1 条 S-99 对账挂起示例；14 条量度）。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
