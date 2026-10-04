/** 年龄 */
export type BirdAge = '幼' | '亚成' | '成';

/** 环志状态 */
export type RingStatus = '初捕' | '重捕' | '回收';

/**
 * 对账状态（环志组留底字段）：
 * - 正常：按登记当时点位编号与监测组台账（含改号历史）对得上
 * - 挂起：编号在台账中查无此点，等监测组补台账；环志组不得自行造点位
 */
export type ReconcileStatus = '正常' | '挂起';

/** 环志记录（环志组留底） */
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
  /** 鸟点 id（可能因旧数据回填前缺失，此时按 siteNoSnapshot 对账） */
  siteId: string;
  /** 登记当时的点位编号快照——监测组改号后，历史记录仍按此编号查得回来 */
  siteNoSnapshot: string;
  /** 调查批次 id */
  sessionId: string;
  /** 登记当时的批次号快照（环志组留底） */
  sessionNoSnapshot: string;
  /** 对账状态 */
  reconcile: ReconcileStatus;
  /** 挂起原因（对不上时记录差异说明） */
  reconcileNote?: string;
  /** 是否为升级时按现有鸟点回填的旧数据（旧数据原本没记点位归属） */
  legacyBackfilled: boolean;
  /** 备注 */
  remark?: string;
}

/** 金属环号格式：一般为「环前缀-序号」，如 A-12345 */
export const RING_PREFIXES: string[] = ['A', 'B', 'C', 'D', 'E'];

/** 彩环颜色组合可选值 */
export const COLOR_RING_PRESETS: string[] = ['无', '红-黄', '蓝-白', '绿-橙', '黑-红', '黄-蓝-白'];

export const BIRD_AGES: BirdAge[] = ['幼', '亚成', '成'];
export const RING_STATUSES: RingStatus[] = ['初捕', '重捕', '回收'];
export const RECONCILE_STATUSES: ReconcileStatus[] = ['正常', '挂起'];

export const STATUS_COLOR: Record<RingStatus, string> = {
  初捕: 'success',
  重捕: 'warning',
  回收: 'danger',
};

export const RECONCILE_COLOR: Record<ReconcileStatus, 'success' | 'warning'> = {
  正常: 'success',
  挂起: 'warning',
};
