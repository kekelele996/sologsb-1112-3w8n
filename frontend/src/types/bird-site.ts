/** 生境类型 */
export type Habitat = '芦苇湿地' | '滩涂' | '次生林' | '农田' | '城市绿地';

/** 点位状态：监测组按生境调整，可停用 / 再启用（停用只拦新登记，不影响历史记录） */
export type SiteStatus = '启用' | '停用';

/** 鸟点（监测组维护的点位台账） */
export interface BirdSite {
  id: string;
  /** 点位编号（当前编号，改号后随之变化） */
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
  /** 状态：启用 / 停用（监测组维护） */
  status: SiteStatus;
  /** 历史点位编号：改号时旧号追加进此列表，供环志组按登记当时编号对账 */
  formerSiteNos: string[];
  /** 备注 */
  note?: string;
}

export const HABITATS: Habitat[] = ['芦苇湿地', '滩涂', '次生林', '农田', '城市绿地'];

export const SITE_STATUSES: SiteStatus[] = ['启用', '停用'];

/** 生境配色（地图标记与 SVG 网格共用） */
export const HABITAT_COLOR: Record<Habitat, string> = {
  芦苇湿地: '#2f7d6f',
  滩涂: '#c8a165',
  次生林: '#3f6b3a',
  农田: '#a3b565',
  城市绿地: '#7f8fa6',
};

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
