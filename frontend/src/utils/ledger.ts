import type { BirdSite } from '../types/bird-site';
import type { ReconcileStatus } from '../types/ring-record';

export interface ReconcileVerdict {
  status: ReconcileStatus;
  note?: string;
}

/** 点位编号是否为该鸟点当前编号或历史编号（监测组改号后旧编号仍要查得回来） */
export function siteHasNo(site: BirdSite, siteNo: string): boolean {
  const target = siteNo.trim().toLowerCase();
  if (!target) return false;
  if (site.siteNo.trim().toLowerCase() === target) return true;
  return site.noHistory.some((change) => change.from.trim().toLowerCase() === target || change.to.trim().toLowerCase() === target);
}

/** 按点位编号在监测组台账中定位鸟点（先当前编号，再历史编号） */
export function findSiteByNo(sites: BirdSite[], siteNo: string): BirdSite | undefined {
  const target = siteNo.trim().toLowerCase();
  return (
    sites.find((site) => site.siteNo.trim().toLowerCase() === target) ??
    sites.find((site) => site.noHistory.some((change) => change.from.trim().toLowerCase() === target))
  );
}

/**
 * 两边按点位编号对账：
 * 环志组登记当时快照的编号若在监测组台账（含改号历史）中查不到，则记录挂起等补台账。
 * 停用点位不算差异——历史记录继续挂在原点位上。
 */
export function reconcileBySiteNo(siteNoSnapshot: string, sites: BirdSite[]): ReconcileVerdict {
  const snapshot = siteNoSnapshot.trim();
  if (!snapshot) {
    return { status: '挂起', note: '记录未登记点位编号，等监测组补台账' };
  }
  if (findSiteByNo(sites, snapshot)) {
    return { status: '正常', note: undefined };
  }
  return { status: '挂起', note: `点位编号 ${snapshot} 在监测组台账中查无此点，等监测组补台账` };
}

/** 环志留底的点位显示：先按 siteId 找，找不到用快照编号标注台账缺失 */
export function ringSiteLabel(record: { siteId: string; siteNoSnapshot?: string }, sites: BirdSite[]): string {
  const site = sites.find((item) => item.id === record.siteId);
  if (site) return site.name;
  const no = record.siteNoSnapshot?.trim();
  return no ? `台账缺失（${no}）` : '未知鸟点';
}
