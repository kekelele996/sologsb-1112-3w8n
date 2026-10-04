import Dexie, { type Table } from 'dexie';
import type { RingRecord } from '../types/ring-record';
import type { Morphometrics } from '../types/morphometrics';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import { findSiteByNo } from './ledger';

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

    // v3：两个组各自留底 + 按点位编号对账。
    // - 鸟点台账：active 停用标记、noHistory 改号历史（停用/改号由监测组维护）
    // - 调查批次：closedAt 关闭时间
    // - 环志记录：siteNoSnapshot / sessionNoSnapshot 登记当时编号快照、reconcile 对账状态
    // 旧数据没记点位归属的，按现有鸟点回填后再启用；实在对不上的先挂起等监测组补台账。
    this.version(3)
      .stores({
        rings: 'id, ringNo, speciesCn, status, ringDate, siteId, sessionId, siteNoSnapshot, reconcile, [speciesCn+ringDate]',
        morphs: 'id, ringId, measuredAt',
        sites: 'id, siteNo, habitat, name, active',
        sessions: 'id, sessionNo, date, siteId, closed',
        meta: 'key',
      })
      .upgrade(async (tx) => {
        const sites = await tx.table<BirdSite, string>('sites').toArray();
        const sessions = await tx.table<SurveySession, string>('sessions').toArray();
        const siteById = new Map(sites.map((site) => [site.id, site]));
        const sessionById = new Map(sessions.map((session) => [session.id, session]));
        // 回填默认归属：按点位编号排序的第一个有效鸟点
        const fallbackSite = [...sites].filter((site) => site.active !== false).sort((a, b) => a.siteNo.localeCompare(b.siteNo))[0];

        await tx
          .table('sites')
          .toCollection()
          .modify((site: BirdSite) => {
            if (typeof site.active !== 'boolean') site.active = true;
            if (!Array.isArray(site.noHistory)) site.noHistory = [];
          });

        await tx
          .table('sessions')
          .toCollection()
          .modify((session: SurveySession) => {
            if (typeof session.closed !== 'boolean') session.closed = false;
            if (session.closed && !session.closedAt) session.closedAt = new Date().toISOString();
          });

        await tx
          .table('rings')
          .toCollection()
          .modify((row: RingRecord) => {
            if (typeof row.colorRing !== 'string') row.colorRing = '无';

            // 点位快照回填
            if (typeof row.siteNoSnapshot !== 'string' || !row.siteNoSnapshot.trim()) {
              const ownSite = siteById.get(row.siteId);
              if (ownSite) {
                // 能按 id 找回台账：旧记录当时没抄编号，直接补抄当前编号并视为正常
                row.siteNoSnapshot = ownSite.siteNo;
              } else if (siteById.size > 0) {
                // id 对不上（旧数据没记点位归属）：按现有鸟点回填再启用
                row.siteNoSnapshot = fallbackSite.siteNo;
                row.siteId = fallbackSite.id;
                row.legacyBackfilled = true;
                row.reconcile = '正常';
                row.reconcileNote = '升级时按现有鸟点回填点位归属';
              } else {
                // 台账为空，无法回填：挂起等监测组补台账
                row.siteNoSnapshot = '';
                row.legacyBackfilled = true;
                row.reconcile = '挂起';
                row.reconcileNote = '旧数据未记点位归属，台账为空，等监测组补台账';
              }
            } else if (!findSiteByNo(sites, row.siteNoSnapshot)) {
              // 有快照编号但台账查无此点（监测组台账缺失）：挂起
              row.reconcile = '挂起';
              row.reconcileNote = `点位编号 ${row.siteNoSnapshot} 在监测组台账中查无此点，等监测组补台账`;
            }

            if (typeof row.sessionNoSnapshot !== 'string') {
              row.sessionNoSnapshot = sessionById.get(row.sessionId)?.sessionNo ?? '';
            }
            if (row.reconcile !== '挂起' && (typeof row.reconcile !== 'string' || !row.reconcile)) {
              row.reconcile = '正常';
            }
            if (typeof row.legacyBackfilled !== 'boolean') row.legacyBackfilled = false;
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
