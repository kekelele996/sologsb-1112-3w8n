import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { reconcileRecords, resolveReconStatus } from '../utils/recon';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import type { BirdAge, RingRecord, RingStatus } from '../types/ring-record';

/** 环志组登记时违反监测组台账约束（点位停用 / 批次关闭等） */
export class RingRegisterError extends Error {}

export interface RingInput {
  ringNo: string;
  colorRing: string;
  speciesCn: string;
  speciesSci: string;
  age: BirdAge;
  ringDate?: string;
  netNo: string;
  netRound: number;
  status: RingStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark?: string;
}

interface RingState {
  rings: RingRecord[];
  /** 环号重复时命中的历史记录 id */
  duplicateId: string;
  hydrated: boolean;
}

/**
 * 登记前校验监测组台账：点位须存在且启用、批次须存在且未关闭、批次须落在所选点位上。
 * 环志组不替监测组造点位 / 批次，任一条不满足都拒绝登记。
 */
function assertRegisterable(site?: BirdSite, session?: SurveySession): asserts site is BirdSite {
  if (!site) {
    throw new RingRegisterError('所选鸟点不在监测组台账中，环志组不能代建点位，请先由监测组登记');
  }
  if (site.status === '停用') {
    throw new RingRegisterError(`鸟点 ${site.siteNo} · ${site.name} 已被监测组停用，新环志记录不能落在停用点位上`);
  }
  if (!session) {
    throw new RingRegisterError('所选调查批次不存在，请改选监测组台账中的有效批次');
  }
  if (session.closed) {
    throw new RingRegisterError(`调查批次 ${session.sessionNo} 已关闭，关闭批次后不再接收新环志记录`);
  }
  if (session.siteId !== site.id) {
    throw new RingRegisterError(`调查批次 ${session.sessionNo} 不属于鸟点 ${site.siteNo}，点位与批次对不上`);
  }
}

/** 环志记录与查重结果 */
export const useRingStore = defineStore('ring', {
  state: (): RingState => ({ rings: [], duplicateId: '', hydrated: false }),

  getters: {
    findByRingNo(state) {
      return (ringNo: string): RingRecord | undefined =>
        state.rings.find((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase());
    },
    /** 同一环号的全部历史记录（含重捕 / 回收） */
    historyOf(state) {
      return (ringNo: string): RingRecord[] =>
        state.rings
          .filter((record) => record.ringNo.toLowerCase() === ringNo.trim().toLowerCase())
          .sort((a, b) => a.ringDate.localeCompare(b.ringDate));
    },
    duplicate(state): RingRecord | undefined {
      return state.rings.find((record) => record.id === state.duplicateId);
    },
    /** 按点位编号对不上、挂起等监测组补台账的记录 */
    pendingRings(state): RingRecord[] {
      return state.rings.filter((record) => record.reconStatus === '挂起');
    },
  },

  actions: {
    async hydrate() {
      this.rings = await db.rings.orderBy('ringDate').reverse().toArray();
      this.hydrated = true;
    },

    setDuplicate(id: string) {
      this.duplicateId = id;
    },

    /**
     * 新增环志记录：环号已存在时返回命中的历史记录，由页面提示并跳转。
     * 登记前只读取监测组当下有效台账（启用点位 + 未关闭批次）做校验；
     * 对不上不造点位，直接抛 RingRegisterError。
     * 写库只开环志表事务——监测组台账不参与，监测组那边的成败不影响环志组已登记数据。
     */
    async addRing(input: RingInput): Promise<{ record?: RingRecord; duplicate?: RingRecord }> {
      const existed = this.findByRingNo(input.ringNo);
      if (existed) {
        this.duplicateId = existed.id;
        return { duplicate: existed };
      }

      // 跨组只读：以监测组当前台账为准，不在环志组事务里写他们的表
      const [site, session] = await Promise.all([db.sites.get(input.siteId), db.sessions.get(input.sessionId)]);
      assertRegisterable(site, session);

      const record: RingRecord = {
        id: uid('ring'),
        ringNo: input.ringNo.trim(),
        colorRing: input.colorRing || '无',
        speciesCn: input.speciesCn.trim(),
        speciesSci: input.speciesSci.trim(),
        age: input.age,
        ringDate: input.ringDate ?? new Date().toISOString(),
        netNo: input.netNo.trim(),
        netRound: Number(input.netRound) || 1,
        status: input.status,
        ringer: input.ringer.trim(),
        siteId: input.siteId,
        // 快照登记当时的编号：点位日后停用 / 改号，历史记录仍按此编号查得回来
        siteNoSnapshot: site!.siteNo,
        siteNameSnapshot: site!.name,
        sessionId: input.sessionId,
        sessionNoSnapshot: session!.sessionNo,
        reconStatus: '已对账',
        remark: input.remark?.trim() || undefined,
      };

      // 仅环志组自己的表参与事务
      await db.transaction('rw', db.rings, async () => {
        await db.rings.put(toPlain(record));
      });
      this.rings = [record, ...this.rings];
      this.duplicateId = '';
      return { record };
    },

    async updateRing(id: string, patch: Partial<RingInput>) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;

      const next: RingRecord = { ...current, ...patch };
      // 点位归属被改到别的点位：仍须落在当下有效点位上，并重拍登记快照、重新对账
      if (patch.siteId && patch.siteId !== current.siteId) {
        const site = await db.sites.get(patch.siteId);
        if (!site || site.status === '停用') {
          throw new RingRegisterError('改挂的鸟点不存在或已停用，环志记录只能落到监测组当下启用的点位上');
        }
        next.siteNoSnapshot = site.siteNo;
        next.siteNameSnapshot = site.name;
        next.reconStatus = resolveReconStatus(site.siteNo, [site]);
      }
      if (patch.sessionId && patch.sessionId !== current.sessionId) {
        const session = await db.sessions.get(patch.sessionId);
        if (!session || session.closed) {
          throw new RingRegisterError('改挂的调查批次不存在或已关闭');
        }
        if (session.siteId !== next.siteId) {
          throw new RingRegisterError('改挂的调查批次不属于所选鸟点，点位与批次对不上');
        }
        next.sessionNoSnapshot = session.sessionNo;
      }

      await db.transaction('rw', db.rings, async () => {
        await db.rings.put(toPlain(next));
      });
      this.rings = this.rings.map((record) => (record.id === id ? next : record));
    },

    /**
     * 两边按点位编号对账：以监测组当前点位台账（含各点位历史编号）为准，
     * 逐条比对登记当时的点位编号快照。只更新环志组自己的表；
     * 对不上的挂起，等监测组补台账后再跑一次即可自动恢复已对账。
     * 返回本次新挂起 / 已恢复条数。
     */
    async reconcileWith(sites: BirdSite[]): Promise<{ pending: number; resolved: number }> {
      const statusById = reconcileRecords(this.rings, sites);
      const updates: RingRecord[] = [];
      let pending = 0;
      let resolved = 0;
      this.rings = this.rings.map((record) => {
        const status = statusById.get(record.id) ?? '挂起';
        if (status === record.reconStatus) return record;
        if (status === '挂起') pending += 1;
        else resolved += 1;
        const updated = { ...record, reconStatus: status };
        updates.push(updated);
        return updated;
      });
      if (updates.length > 0) {
        await db.transaction('rw', db.rings, async () => {
          await db.rings.bulkPut(updates.map(toPlain));
        });
      }
      return { pending, resolved };
    },

    async removeRing(id: string) {
      await db.transaction('rw', db.rings, async () => {
        await db.rings.delete(id);
      });
      this.rings = this.rings.filter((record) => record.id !== id);
    },
  },
});
