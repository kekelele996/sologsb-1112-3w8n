import { db, SCHEMA_VERSION } from './db';
import type { BirdSite } from '../types/bird-site';
import type { SurveySession } from '../types/session';
import type { RingRecord } from '../types/ring-record';
import { resolveReconStatus } from './recon';

export interface BackupPayload {
  app: string;
  schemaVersion: number;
  exportedAt: string;
  rings: unknown[];
  morphs: unknown[];
  sites: unknown[];
  sessions: unknown[];
}

/** 汇总全部本地表为 JSON 备份（schema 迁移前先导出） */
export async function buildBackup(): Promise<BackupPayload> {
  const [rings, morphs, sites, sessions] = await Promise.all([
    db.rings.toArray(),
    db.morphs.toArray(),
    db.sites.toArray(),
    db.sessions.toArray(),
  ]);
  return {
    app: 'gbbirdring',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    rings,
    morphs,
    sites,
    sessions,
  };
}

export async function exportBackupJson(): Promise<string> {
  return JSON.stringify(await buildBackup(), null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 导出 CSV（环志汇总表打印用） */
export function downloadCsv<T extends Record<string, unknown>>(
  filename: string,
  rows: T[],
  columns: Array<{ key: keyof T; title: string }>,
): void {
  const header = columns.map((c) => `"${c.title}"`).join(',');
  const body = rows
    .map((row) => columns.map((c) => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n');
  downloadText(filename, `\ufeff${header}\n${body}`, 'text/csv');
}

/**
 * 恢复旧版本备份时按双台账规则归一化（与 db v3 升级一致）：
 * 点位补状态与历史编号；环志记录按现有鸟点回填登记当时快照再对账，
 * 回填不上的挂起等监测组补台账。
 */
function normalizeLegacy(sites: BirdSite[], sessions: SurveySession[], rings: RingRecord[]): void {
  const siteById = new Map(sites.map((site) => [site.id, site]));
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  sites.forEach((site) => {
    if (site.status !== '启用' && site.status !== '停用') site.status = '启用';
    if (!Array.isArray(site.formerSiteNos)) site.formerSiteNos = [];
  });

  rings.forEach((ring) => {
    const site = siteById.get(ring.siteId);
    if (typeof ring.siteNoSnapshot !== 'string') ring.siteNoSnapshot = site?.siteNo ?? '';
    if (typeof ring.siteNameSnapshot !== 'string') ring.siteNameSnapshot = site?.name ?? '';
    if (typeof ring.sessionNoSnapshot !== 'string') {
      ring.sessionNoSnapshot = sessionById.get(ring.sessionId)?.sessionNo ?? '';
    }
    if (ring.reconStatus !== '已对账' && ring.reconStatus !== '挂起') {
      ring.reconStatus = resolveReconStatus(ring.siteNoSnapshot, sites);
    }
  });
}

/** 恢复 JSON 备份 */
export async function importBackup(text: string): Promise<{ rings: number; morphs: number; sites: number; sessions: number }> {
  const payload = JSON.parse(text) as Partial<BackupPayload>;
  if (!payload || payload.app !== 'gbbirdring') {
    throw new Error('备份文件格式不匹配（缺少 app=gbbirdring 标记）');
  }
  const sites = (payload.sites ?? []) as BirdSite[];
  const sessions = (payload.sessions ?? []) as SurveySession[];
  const rings = (payload.rings ?? []) as RingRecord[];
  normalizeLegacy(sites, sessions, rings);
  const counts = {
    rings: rings.length,
    morphs: payload.morphs?.length ?? 0,
    sites: sites.length,
    sessions: sessions.length,
  };
  await db.transaction('rw', db.rings, db.morphs, db.sites, db.sessions, async () => {
    await Promise.all([db.rings.clear(), db.morphs.clear(), db.sites.clear(), db.sessions.clear()]);
    if (rings.length) await db.rings.bulkPut(rings as never[]);
    if (payload.morphs?.length) await db.morphs.bulkPut(payload.morphs as never[]);
    if (sites.length) await db.sites.bulkPut(sites as never[]);
    if (sessions.length) await db.sessions.bulkPut(sessions as never[]);
  });
  return counts;
}
