import type { BirdSite } from '../types/bird-site';
import type { ReconStatus, RingRecord } from '../types/ring-record';

/**
 * 点位对账规则（两边各自留底，只按点位编号对账）：
 * 环志记录登记当时快照的点位编号，若等于监测组台账中某个点位的
 * 当前编号或任一历史编号，则对得上（已对账）；否则先挂起，等监测组补台账。
 * 环志组不替监测组造点位，因此这里只读台账、不创建任何点位。
 */
export function resolveReconStatus(snapshotSiteNo: string, sites: BirdSite[]): ReconStatus {
  const no = snapshotSiteNo?.trim();
  if (!no) return '挂起';
  return sites.some((site) => site.siteNo === no || site.formerSiteNos.includes(no)) ? '已对账' : '挂起';
}

/** 一批环志记录按监测组当前点位台账逐条对账 */
export function reconcileRecords(records: RingRecord[], sites: BirdSite[]): Map<string, ReconStatus> {
  const result = new Map<string, ReconStatus>();
  records.forEach((record) => {
    result.set(record.id, resolveReconStatus(record.siteNoSnapshot, sites));
  });
  return result;
}

/** 单条记录是否对得上（供登记前校验与 UI 提示） */
export function isReconcilable(snapshotSiteNo: string, sites: BirdSite[]): boolean {
  return resolveReconStatus(snapshotSiteNo, sites) === '已对账';
}
