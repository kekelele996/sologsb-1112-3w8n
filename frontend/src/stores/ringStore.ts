import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { findSiteByNo, reconcileBySiteNo } from '../utils/ledger';
import type { BirdAge, ReconcileStatus, RingRecord, RingStatus } from '../types/ring-record';
import type { BirdSite } from '../types/bird-site';

type BirdSiteLike = Pick<BirdSite, 'id' | 'siteNo' | 'noHistory'>;

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

/** 环志记录与查重结果（环志组留底，与监测组台账各自保存） */
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
    /** 对账挂起的记录：等监测组补台账 */
    suspendedRings(state): RingRecord[] {
      return state.rings.filter((record) => record.reconcile === '挂起');
    },
    /** 按登记当时点位编号查记录（含监测组已改号的旧编号） */
    bySiteNoSnapshot(state) {
      return (siteNo: string): RingRecord[] => {
        const target = siteNo.trim().toLowerCase();
        return state.rings.filter((record) => record.siteNoSnapshot.trim().toLowerCase() === target);
      };
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
     * 新增环志记录：
     * - 环号已存在时返回命中的历史记录，由页面提示并跳转；
     * - 只能落到监测组当下有效点位 + 进行中批次，且批次须属于该点位；
     * - 登记当时把点位编号 / 批次号抄进留底快照，监测组日后改号 / 关批次不影响历史回查；
     * - 环志组不造点位：点位不在台账里直接拒绝。
     */
    async addRing(
      input: RingInput,
      ledger: {
        activeSites: { id: string; siteNo: string }[];
        openSessions: { id: string; siteId: string; sessionNo: string }[];
      },
    ): Promise<{ record?: RingRecord; duplicate?: RingRecord }> {
      const existed = this.findByRingNo(input.ringNo);
      if (existed) {
        this.duplicateId = existed.id;
        return { duplicate: existed };
      }
      const site = ledger.activeSites.find((item) => item.id === input.siteId);
      if (!site) {
        throw new Error('该鸟点已停用或不在监测组台账中，不能登记新记录（环志组不能替监测组造点位）');
      }
      const session = ledger.openSessions.find((item) => item.id === input.sessionId);
      if (!session) {
        throw new Error('该调查批次已关闭或不存在，不能登记新记录');
      }
      if (session.siteId !== site.id) {
        throw new Error('调查批次不属于所选鸟点，请重新选择');
      }
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
        siteId: site.id,
        siteNoSnapshot: site.siteNo,
        sessionId: session.id,
        sessionNoSnapshot: session.sessionNo,
        reconcile: '正常',
        legacyBackfilled: false,
        remark: input.remark?.trim() || undefined,
      };
      // 环志组自己的留底事务：监测组改号 / 关批次失败只回滚他们那份，不波及这里
      await db.transaction('rw', db.rings, async () => {
        await db.rings.put(toPlain(record));
      });
      this.rings = [record, ...this.rings];
      this.duplicateId = '';
      return { record };
    },

    /**
     * 编辑环志业务字段。点位 / 批次归属属于登记当时的历史事实，不通过编辑改动，
     * 因此这里即便 patch 带了 siteId / sessionId 也剔除。
     */
    async updateRing(id: string, patch: Partial<RingInput>) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;
      const { siteId: _siteId, sessionId: _sessionId, ...rest } = patch;
      const next: RingRecord = { ...current, ...rest };
      await db.transaction('rw', db.rings, async () => {
        await db.rings.put(toPlain(next));
      });
      this.rings = this.rings.map((record) => (record.id === id ? next : record));
    },

    /**
     * 两边按点位编号对账：
     * 拿每条记录登记当时的快照编号去监测组台账（含改号历史）里核对。
     * 对得上的清掉挂起；对不上的挂起来等监测组补台账（环志组不造点位）。
     * 返回本轮对账结果汇总。
     */
    async reconcileAll(sites: BirdSiteLike[]): Promise<{
      checked: number;
      suspended: number;
      cleared: number;
    }> {
      const fullSites = sites as unknown as BirdSite[];
      const nextList = this.rings.map((record) => {
        const verdict = reconcileBySiteNo(record.siteNoSnapshot, fullSites);
        if (record.reconcile === verdict.status && (record.reconcileNote ?? '') === (verdict.note ?? '')) {
          return record;
        }
        return { ...record, reconcile: verdict.status, reconcileNote: verdict.note };
      });
      const changed = nextList.filter((record, index) => record !== this.rings[index]);
      if (changed.length > 0) {
        await db.transaction('rw', db.rings, async () => {
          await Promise.all(changed.map((record) => db.rings.put(toPlain(record))));
        });
        this.rings = nextList;
      }
      return {
        checked: this.rings.length,
        suspended: this.rings.filter((record) => record.reconcile === '挂起').length,
        cleared: changed.filter((record) => record.reconcile === '正常').length,
      };
    },

    /** 监测组补完台账后，尝试解除某条挂起记录 */
    async tryResolve(recordId: string, sites: BirdSiteLike[]): Promise<boolean> {
      const current = this.rings.find((record) => record.id === recordId);
      if (!current || current.reconcile !== '挂起') return false;
      if (!findSiteByNo(sites as unknown as BirdSite[], current.siteNoSnapshot)) return false;
      const next: RingRecord = { ...current, reconcile: '正常', reconcileNote: undefined };
      await db.transaction('rw', db.rings, async () => {
        await db.rings.put(toPlain(next));
      });
      this.rings = this.rings.map((record) => (record.id === recordId ? next : record));
      return true;
    },

    /** 手工调整对账状态（仅备注用途；正常流程由 reconcileAll 判定） */
    async setReconcile(id: string, status: ReconcileStatus, note?: string) {
      const current = this.rings.find((record) => record.id === id);
      if (!current) return;
      const next: RingRecord = { ...current, reconcile: status, reconcileNote: note };
      await db.transaction('rw', db.rings, async () => {
        await db.rings.put(toPlain(next));
      });
      this.rings = this.rings.map((record) => (record.id === id ? next : record));
    },

    async removeRing(id: string) {
      await db.rings.delete(id);
      this.rings = this.rings.filter((record) => record.id !== id);
    },
  },
});
