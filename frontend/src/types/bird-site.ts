/** 生境类型 */
export type Habitat = '芦苇湿地' | '滩涂' | '次生林' | '农田' | '城市绿地';

/** 一次点位改号记录（监测组台账留痕，旧编号据此仍可查） */
export interface SiteNoChange {
  /** 旧点位编号 */
  from: string;
  /** 新点位编号 */
  to: string;
  /** 改号原因（按生境调整等） */
  reason: string;
  /** 改号时间 ISO */
  changedAt: string;
}

/** 鸟点（监测组维护的台账） */
export interface BirdSite {
  id: string;
  /** 当前点位编号（唯一） */
  siteNo: string;
  /** 点位名称 */
  name: string;
  /** 经度 */
  lng: number;
  /** 纬度 */
  lat: number;
  /** 生境 */
  habitat: Habitat;
  /** 网位数 */
  netCount: number;
  /** 是否有效：监测组按生境调整可停用，停用后不再接受新环志记录，但历史记录仍挂在该点位上 */
  active: boolean;
  /** 停用时间 ISO（仅停用时有值） */
  deactivatedAt?: string;
  /** 停用原因 */
  deactivateReason?: string;
  /** 改号历史：时间正序，环志组按登记当时的旧编号对账时沿此回溯 */
  noHistory: SiteNoChange[];
  /** 备注 */
  note?: string;
}

export const HABITATS: Habitat[] = ['芦苇湿地', '滩涂', '次生林', '农田', '城市绿地'];

/** 生境配色（地图标记与 SVG 网格共用） */
export const HABITAT_COLOR: Record<Habitat, string> = {
  芦苇湿地: '#2f7d6f',
  滩涂: '#c8a165',
  次生林: '#3f6b3a',
  农田: '#a3b565',
  城市绿地: '#7f8fa6',
};

/** 停用点位的统一灰色 */
export const INACTIVE_COLOR = '#b6bfbd';

/** 地图/网格模式 */
export type MapMode = 'amap' | 'grid';

/** 默认经纬度范围（渤海湾南岸环志区），用于 SVG 网格视图 */
export const DEFAULT_BOUNDS = {
  minLng: 117.4,
  maxLng: 118.4,
  minLat: 38.6,
  maxLat: 39.4,
};

/** SVG 网格行列数 */
export const GRID_COLS = 8;
export const GRID_ROWS = 6;
