import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import { findSiteByNo, siteHasNo } from '../utils/ledger';
import type { BirdSite, Habitat, MapMode } from '../types/bird-site';

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

/** 鸟点与地图/网格模式（监测组台账） */
export const useSiteStore = defineStore('site', {
  state: (): SiteState => ({ sites: [], mapMode: 'grid', hydrated: false }),

  getters: {
    siteName(state) {
      return (siteId: string): string => state.sites.find((site) => site.id === siteId)?.name ?? '未知鸟点';
    },
    siteOptions(state): Array<{ label: string; value: string }> {
      return state.sites.map((site) => ({ label: `${site.siteNo} · ${site.name}`, value: site.id }));
    },
    /** 新登记环志记录时只列有效点位 */
    activeSites(state): BirdSite[] {
      return state.sites.filter((site) => site.active);
    },
    activeSiteOptions(): Array<{ label: string; value: string }> {
      return this.activeSites.map((site: BirdSite) => ({ label: `${site.siteNo} · ${site.name}`, value: site.id }));
    },
    totalNets(state): number {
      return state.sites.reduce((sum, site) => sum + site.netCount, 0);
    },
    activeCount(state): number {
      return state.sites.filter((site) => site.active).length;
    },
    inactiveCount(): number {
      return this.sites.length - this.activeCount;
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

    /** 编号（当前编号或历史编号）是否已被占用 */
    noTaken(siteNo: string, excludeId = ''): boolean {
      const target = siteNo.trim().toLowerCase();
      return this.sites.some(
        (site) => site.id !== excludeId && siteHasNo(site, target),
      );
    },

    findByNo(siteNo: string): BirdSite | undefined {
      return findSiteByNo(this.sites, siteNo);
    },

    /** 监测组登记鸟点：编号不得与任何点位的当前/历史编号冲突 */
    async addSite(input: SiteInput): Promise<BirdSite> {
      const siteNo = input.siteNo.trim();
      if (this.noTaken(siteNo)) {
        throw new Error(`点位编号 ${siteNo} 已存在（含已改号点位的旧编号），请换一个编号`);
      }
      const site: BirdSite = {
        id: uid('site'),
        siteNo,
        name: input.name.trim(),
        lng: Number(input.lng) || 0,
        lat: Number(input.lat) || 0,
        habitat: input.habitat,
        netCount: Number(input.netCount) || 0,
        active: true,
        noHistory: [],
        note: input.note?.trim() || undefined,
      };
      // 监测组自己的台账事务：失败只回滚这一张表，环志组已登记记录不受影响
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(site));
      });
      this.sites = [...this.sites, site].sort((a, b) => a.siteNo.localeCompare(b.siteNo));
      return site;
    },

    /**
     * 编辑鸟点台账信息。点位编号不走这里——改号必须走 renumberSite 留痕，
     * 否则环志组按旧编号就查不回来了。
     */
    async updateSite(id: string, patch: Partial<Omit<SiteInput, 'siteNo'>>) {
      const current = this.sites.find((site) => site.id === id);
      if (!current) return;
      const next: BirdSite = { ...current, ...patch };
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(next));
      });
      this.sites = this.sites.map((site) => (site.id === id ? next : site));
    },

    /**
     * 监测组改号（按生境调整）：新编号不得撞号；旧编号记入 noHistory 留痕，
     * 环志组历史记录按旧编号仍可回溯到本点位。
     * 事务只覆盖 sites 表，失败只回滚监测组自己这份台账。
     */
    async renumberSite(id: string, newNo: string, reason: string): Promise<BirdSite> {
      const current = this.sites.find((site) => site.id === id);
      if (!current) throw new Error('鸟点不存在');
      const target = newNo.trim();
      if (!target) throw new Error('请输入新点位编号');
      if (target.toLowerCase() === current.siteNo.toLowerCase()) {
        throw new Error('新编号与当前编号相同，无需改号');
      }
      if (this.noTaken(target, id)) {
        throw new Error(`点位编号 ${target} 已被占用（含已改号点位的旧编号）`);
      }
      const next: BirdSite = {
        ...current,
        siteNo: target,
        noHistory: [
          ...current.noHistory,
          { from: current.siteNo, to: target, reason: reason.trim() || '按生境调整', changedAt: new Date().toISOString() },
        ],
      };
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(next));
      });
      this.sites = this.sites.map((site) => (site.id === id ? next : site));
      return next;
    },

    /** 监测组停用点位（按生境调整）：停用后不再接受新登记，历史记录不动 */
    async deactivateSite(id: string, reason: string): Promise<BirdSite> {
      const current = this.sites.find((site) => site.id === id);
      if (!current) throw new Error('鸟点不存在');
      if (!current.active) return current;
      const next: BirdSite = {
        ...current,
        active: false,
        deactivatedAt: new Date().toISOString(),
        deactivateReason: reason.trim() || '按生境调整停用',
      };
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(next));
      });
      this.sites = this.sites.map((site) => (site.id === id ? next : site));
      return next;
    },

    /** 重新启用点位（生境恢复或调整撤销） */
    async activateSite(id: string): Promise<BirdSite> {
      const current = this.sites.find((site) => site.id === id);
      if (!current) throw new Error('鸟点不存在');
      if (current.active) return current;
      const next: BirdSite = { ...current, active: true, deactivatedAt: undefined, deactivateReason: undefined };
      await db.transaction('rw', db.sites, async () => {
        await db.sites.put(toPlain(next));
      });
      this.sites = this.sites.map((site) => (site.id === id ? next : site));
      return next;
    },
  },
});
