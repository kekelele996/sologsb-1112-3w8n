import Dexie, { type Table } from 'dexie';
import type { RingRecord } from '../types/ring-record';
import type { Morphometrics } from '../types/morphometrics';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import { resolveReconStatus } from './recon';

/** IndexedDB 库名（浏览器本地存储，无后端） */
export const DB_NAME = 'gbbirdring-db';

/** 当前 schema 版本，与 db.version(n) 对应 */
export const SCHEMA_VERSION = 3;

class BirdRingDB extends Dexie {
  rings!: Table<RingRecord, string>;
  morphs!: Table<Morphometrics, string>;
  sites!: Table<BirdSite, string>;
  sessions!: Table<SurveySession, string>;
  meta!: Table<{ key: string; value: string }, string>;

  constructor() {
    super(DB_NAME);

    // v1：建表声明索引
    this.version(1).stores({
      rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId',
      morphs: 'id, ringId, measuredAt',
      sites: 'id, siteNo, habitat, name',
      sessions: 'id, sessionNo, date, siteId, closed',
      meta: 'key',
    });

    // v2：环志表增加 (speciesCn+ringDate) 复合索引，鸟种按日期检索更快；并回填历史彩环字段。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(2)
      .stores({
        rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        await tx
          .table('rings')
          .toCollection()
          .modify((row: RingRecord) => {
            if (typeof row.colorRing !== 'string') {
              row.colorRing = '无';
            }
          });
      });

    // v3：环志组与监测组双台账拆分。
    // - 鸟点（监测组）：补 status（启用/停用）与 formerSiteNos（改号历史编号链），并建 status 索引；
    // - 环志记录（环志组）：补登记当时的点位 / 批次编号快照与 reconStatus 对账状态；
    //   旧数据没记点位归属，按现有鸟点回填快照再标记对账结果，回填不上的挂起等监测组补台账。
    // 升级前请在顶栏「导出备份」导出 JSON。
    this.version(3)
      .stores({
        rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, reconStatus, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name, status',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const sites = await tx.table<BirdSite, string>('sites').toArray();
        const sessions = await tx.table<SurveySession, string>('sessions').toArray();
        const siteById = new Map(sites.map((site) => [site.id, site]));
        const sessionById = new Map(sessions.map((session) => [session.id, session]));

        // 监测组台账补齐：旧点位默认启用、无历史编号
        await tx
          .table('sites')
          .toCollection()
          .modify((site: BirdSite) => {
            if (site.status !== '启用' && site.status !== '停用') site.status = '启用';
            if (!Array.isArray(site.formerSiteNos)) site.formerSiteNos = [];
          });

        // 环志组台账补齐：按现有鸟点回填登记当时快照，再按点位编号对账
        await tx
          .table('rings')
          .toCollection()
          .modify((ring: RingRecord) => {
            const site = siteById.get(ring.siteId);
            if (typeof ring.siteNoSnapshot !== 'string') {
              ring.siteNoSnapshot = site?.siteNo ?? '';
            }
            if (typeof ring.siteNameSnapshot !== 'string') {
              ring.siteNameSnapshot = site?.name ?? '';
            }
            if (typeof ring.sessionNoSnapshot !== 'string') {
              ring.sessionNoSnapshot = sessionById.get(ring.sessionId)?.sessionNo ?? '';
            }
            if (ring.reconStatus !== '已对账' && ring.reconStatus !== '挂起') {
              ring.reconStatus = resolveReconStatus(ring.siteNoSnapshot, sites);
            }
          });
      });
  }
}

export const db = new BirdRingDB();

export async function getMeta(key: string): Promise<string | undefined> {
  const row = await db.meta.get(key);
  return row?.value;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
