import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { BirdSite, Habitat, MapMode, SiteStatus } from '../types/bird-site';

/** 监测组改号 / 登记点位时违反编号台账约束（编号冲突等） */
export class SiteLedgerError extends Error {}

export interface SiteInput {
  siteNo: string;
  name: string;
  lng: number;
  lat: number;
  habitat: Habitat;
  netCount: number;
  note?: string;
}

interface SiteState {
  sites: BirdSite[];
  /** 地图模式：amap（有 key 时）/ grid（退化 SVG 网格） */
  mapMode: MapMode;
  hydrated: boolean;
}

/**
 * 鸟点台账（监测组维护）：停用 / 改号只影响「当下有效点位」，
 * 不回写环志组历史记录；改号时旧编号进入 formerSiteNos 供对账。
 */
export const useSiteStore = defineStore('site', {
  state: (): SiteState => ({ sites: [], mapMode: 'grid', hydrated: false }),

  getters: {
    siteName(state) {
      return (siteId: string): string => {
        const site = state.sites.find((item) => item.id === siteId);
        if (!site) return '未知鸟点';
        return site.status === '停用' ? `${site.name}（已停用）` : site.name;
      };
    },
    /** 不带停用后缀的点位名，供批次页按名称过滤与比对 */
    rawSiteName(state) {
      return (siteId: string): string => state.sites.find((item) => item.id === siteId)?.name ?? '未知鸟点';
    },
    siteOptions(state): Array<{ label: string; value: string }> {
      return state.sites.map((site) => ({
        label: `${site.siteNo} · ${site.name}${site.status === '停用' ? '（已停用）' : ''}`,
        value: site.id,
      }));
    },
    /** 当下有效（启用）点位：新环志记录只能选这些 */
    activeSites(state): BirdSite[] {
      return state.sites.filter((site) => site.status === '启用');
    },
    activeSiteOptions(): Array<{ label: string; value: string }> {
      return this.activeSites.map((site: BirdSite) => ({ label: `${site.siteNo} · ${site.name}`, value: site.id }));
    },
    totalNets(state): number {
      return state.sites.reduce((sum, site) => sum + site.netCount, 0);
    },
  },

  actions: {
    async hydrate() {
      this.sites = await db.sites.orderBy('siteNo').toArray();
      this.hydrated = true;
    },

    setMapMode(mode: MapMode) {
      this.mapMode = mode;
    },

    /** 新编号是否与台账中任一现号 / 历史编号冲突（excludedId 用于改号时排除自身） */
    assertNoConflict(siteNo: string, excludedId = ''): void {
      const no = siteNo.trim();
      const conflict = this.sites.some(
        (site) => site.id !== excludedId && (site.siteNo === no || site.formerSiteNos.includes(no)),
      );
      if (conflict) {
        throw new SiteLedgerError(`点位编号 ${no} 已在监测组台账中（含历史编号），不能重复使用`);
      }
    },

    async addSite(input: SiteInput): Promise<BirdSite> {
      this.assertNoConflict(input.siteNo);
      const site: BirdSite = {
        id: uid('site'),
        siteNo: input.siteNo.trim(),
        name: input.name.trim(),
        lng: Number(input.lng) || 0,
        lat: Number(input.lat) || 0,
        habitat: input.habitat,
        netCount: Number(input.netCount) || 0,
        status: '启用',
        formerSiteNos: [],
        note: input.note?.trim() || undefined,
      };
      // 只写监测组自己的点位表：失败仅回滚点位表，环志组记录不受影响
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(site));
      });
      this.sites = [...this.sites, site].sort((a, b) => a.siteNo.localeCompare(b.siteNo));
      return site;
    },

    /** 更新点位属性（编号、状态不在此改：编号走改号，状态走停用 / 启用） */
    async updateSite(id: string, patch: Partial<SiteInput>) {
      const current = this.sites.find((site) => site.id === id);
      if (!current) return;
      if (patch.siteNo && patch.siteNo.trim() !== current.siteNo) {
        throw new SiteLedgerError('点位编号变更请走「改号」操作以保留历史编号，不能直接覆盖');
      }
      const next: BirdSite = { ...current, ...patch, siteNo: current.siteNo };
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(next));
      });
      this.sites = this.sites.map((site) => (site.id === id ? next : site));
    },

    /**
     * 改号：新编号须与台账中任何现号 / 历史编号不冲突；
     * 旧编号追加进 formerSiteNos，环志组按登记当时编号对账仍能对上。
     * 事务只含点位表，失败只回滚监测组这份台账。
     */
    async renumberSite(id: string, newSiteNo: string): Promise<BirdSite> {
      const current = this.sites.find((site) => site.id === id);
      if (!current) throw new SiteLedgerError('点位不存在');
      const no = newSiteNo.trim();
      if (!no) throw new SiteLedgerError('新点位编号不能为空');
      this.assertNoConflict(no, id);

      const next: BirdSite = {
        ...current,
        siteNo: no,
        formerSiteNos: current.formerSiteNos.includes(current.siteNo)
          ? current.formerSiteNos
          : [...current.formerSiteNos, current.siteNo],
      };
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(next));
      });
      this.sites = this.sites.map((site) => (site.id === id ? next : site));
      return next;
    },

    /** 停用点位（按生境调整）：只拦新登记，历史环志记录原样保留、可查 */
    async setSiteStatus(id: string, status: SiteStatus): Promise<BirdSite | undefined> {
      const current = this.sites.find((site) => site.id === id);
      if (!current || current.status === status) return current;
      const next: BirdSite = { ...current, status };
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(next));
      });
      this.sites = this.sites.map((site) => (site.id === id ? next : site));
      return next;
    },

    async removeSite(id: string) {
      await db.transaction('rw', db.sites, async () => {
        await db.sites.delete(id);
      });
      this.sites = this.sites.filter((site) => site.id !== id);
    },
  },
});
