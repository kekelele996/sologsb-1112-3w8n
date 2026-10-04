import 'fake-indexeddb/auto';
import Dexie from 'dexie';

// 1) 先以「旧系统 v2」结构造历史库：鸟点没有 active/noHistory，环志记录没有快照/对账字段
async function buildLegacy() {
  const legacy = new Dexie('gbbirdring-db');
  legacy.version(2).stores({
    rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
    morphs: 'id, ringId, measuredAt',
    sites: 'id, siteNo, habitat, name',
    sessions: 'id, sessionNo, date, siteId, closed',
    meta: 'key',
  });
  await legacy.sites.bulkPut([
    { id: 'site-001', siteNo: 'S-01', name: '一号点', lng: 1, lat: 1, habitat: '芦苇湿地', netCount: 3 },
    { id: 'site-002', siteNo: 'S-02', name: '二号点', lng: 1, lat: 1, habitat: '滩涂', netCount: 4 },
  ]);
  await legacy.sessions.bulkPut([
    { id: 'sess-001', sessionNo: 'B01', date: '2024-01-01', siteId: 'site-001', startedAt: '05:00', endedAt: '11:00', netRounds: 6, cloudCover: 2, windForce: 2, closed: true, leader: '甲' },
  ]);
  await legacy.rings.bulkPut([
    // 旧数据 A：有 siteId 指向现存点位，但无任何快照字段 → 补编号、正常
    { id: 'r-A', ringNo: 'A-1', colorRing: '无', speciesCn: '黄眉柳莺', speciesSci: '', age: '成', ringDate: '2024-01-01', netNo: '1', netRound: 1, status: '初捕', ringer: '甲', siteId: 'site-001', sessionId: 'sess-001' },
    // 旧数据 B：siteId 指向已消失点位 → 按现有鸟点回填，标记 legacyBackfilled
    { id: 'r-B', ringNo: 'A-2', colorRing: '无', speciesCn: '黄眉柳莺', speciesSci: '', age: '成', ringDate: '2024-01-02', netNo: '1', netRound: 1, status: '初捕', ringer: '甲', siteId: 'site-gone', sessionId: 'sess-001' },
  ]);
  await legacy.close();
}

// 2) 用应用当前 db（v3）打开同一库，触发 upgrade
async function openApp() {
  const mod = await import('../src/utils/db.ts');
  return mod.db;
}

const assert = (cond: unknown, msg: string) => {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exitCode = 1;
  } else {
    console.log('PASS:', msg);
  }
};

await buildLegacy();
const db = await openApp();

const sites = await db.sites.toArray();
const rings = await db.rings.toArray();
const sessions = await db.sessions.toArray();

assert(sites.every((s) => s.active === true), '旧鸟点升级后默认 active=true');
assert(sites.every((s) => Array.isArray(s.noHistory) && s.noHistory.length === 0), '旧鸟点补 noHistory=[]');
assert(sessions[0].closedAt, '已关闭批次补 closedAt');

const a = rings.find((r) => r.id === 'r-A');
const b = rings.find((r) => r.id === 'r-B');

assert(a?.siteNoSnapshot === 'S-01', `r-A 点位编号回填为 S-01（实际 ${a?.siteNoSnapshot}）`);
assert(a?.reconcile === '正常', 'r-A 对账正常');
assert(a?.sessionNoSnapshot === 'B01', `r-A 批次号回填 B01（实际 ${a?.sessionNoSnapshot}）`);
assert(b?.siteId === 'site-001' && b?.siteNoSnapshot === 'S-01', `r-B 按现有鸟点回填（实际 siteId=${b?.siteId} no=${b?.siteNoSnapshot}）`);
assert(b?.legacyBackfilled === true, 'r-B 标记为旧数据回填');
assert(b?.reconcile === '正常', 'r-B 回填后可正常使用');

// 3) 改号场景：台账改号后，旧快照编号仍匹配（含历史编号）
const ledger = await import('../src/utils/ledger.ts');
const site = await db.sites.get('site-001');
await db.sites.put({ ...site, siteNo: 'S-11', noHistory: [{ from: 'S-01', to: 'S-11', reason: '按生境调整', changedAt: 'x' }] });
const sites2 = await db.sites.toArray();
const verdictOld = ledger.reconcileBySiteNo('S-01', sites2);
const verdictNew = ledger.reconcileBySiteNo('S-11', sites2);
const verdictUnknown = ledger.reconcileBySiteNo('S-99', sites2);
assert(verdictOld.status === '正常', '改号后旧编号 S-01 仍对得上');
assert(verdictNew.status === '正常', '新编号 S-11 对得上');
assert(verdictUnknown.status === '挂起', '台账没有的 S-99 挂起');
assert(ledger.findSiteByNo(sites2, 'S-01')?.id === 'site-001', '按旧编号能找回点位');

db.close();
