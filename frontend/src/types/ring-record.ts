/** 年龄 */
export type BirdAge = '幼' | '亚成' | '成';

/** 环志状态 */
export type RingStatus = '初捕' | '重捕' | '回收';

/**
 * 对账状态（环志组侧）：
 * - 已对账：登记时快照的点位编号，在监测组当前台账里有对应（现号或历史编号）
 * - 挂起：点位编号对不上，等监测组补台账；环志组不替它造点位
 */
export type ReconStatus = '已对账' | '挂起';

/** 环志记录（环志组维护，点位 / 批次信息以登记当时快照留底） */
export interface RingRecord {
  id: string;
  /** 金属环号 */
  ringNo: string;
  /** 彩环组合（可空） */
  colorRing: string;
  /** 鸟种中文名 */
  speciesCn: string;
  /** 学名 */
  speciesSci: string;
  /** 年龄 */
  age: BirdAge;
  /** 环志日期 ISO */
  ringDate: string;
  /** 网号 */
  netNo: string;
  /** 网次 */
  netRound: number;
  /** 状态：初捕 / 重捕 / 回收 */
  status: RingStatus;
  /** 环志人 */
  ringer: string;
  /** 鸟点 id（关联监测组点位台账） */
  siteId: string;
  /** 登记当时的点位编号快照：点位停用 / 改号后，历史记录仍按此编号查得回来 */
  siteNoSnapshot: string;
  /** 登记当时的点位名称快照（点位被删时历史列表仍可显示） */
  siteNameSnapshot: string;
  /** 调查批次 id（关联监测组批次台账） */
  sessionId: string;
  /** 登记当时的批次号快照 */
  sessionNoSnapshot: string;
  /** 对账状态：已对账 / 挂起（两边按点位编号对账的结果） */
  reconStatus: ReconStatus;
  /** 备注 */
  remark?: string;
}

/** 金属环号格式：一般为「环前缀-序号」，如 A-12345 */
export const RING_PREFIXES: string[] = ['A', 'B', 'C', 'D', 'E'];

/** 彩环颜色组合可选值 */
export const COLOR_RING_PRESETS: string[] = ['无', '红-黄', '蓝-白', '绿-橙', '黑-红', '黄-蓝-白'];

export const BIRD_AGES: BirdAge[] = ['幼', '亚成', '成'];
export const RING_STATUSES: RingStatus[] = ['初捕', '重捕', '回收'];

export const RECON_STATUSES: ReconStatus[] = ['已对账', '挂起'];

export const STATUS_COLOR: Record<RingStatus, string> = {
  初捕: 'success',
  重捕: 'warning',
  回收: 'danger',
};

export const RECON_COLOR: Record<ReconStatus, string> = {
  已对账: 'success',
  挂起: 'danger',
};
