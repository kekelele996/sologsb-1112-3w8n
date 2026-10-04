import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { SurveySession } from '../types/session';

/** 监测组建批次时点位不在有效台账中 */
export class SessionLedgerError extends Error {}

export interface SessionInput {
  sessionNo: string;
  date: string;
  siteId: string;
  /** 开始时间 HH:mm */
  startedAt: string;
  /** 结束时间 HH:mm */
  endedAt: string;
  /** 计划网次 */
  netRounds: number;
  /** 云量（成，0~10） */
  cloudCover: number;
  /** 风力（级） */
  windForce: number;
  leader: string;
  remark?: string;
}

interface SessionState {
  sessions: SurveySession[];
  hydrated: boolean;
}

/** 调查批次（监测组维护）与统计派生值 */
export const useSessionStore = defineStore('session', {
  state: (): SessionState => ({ sessions: [], hydrated: false }),

  getters: {
    byId(state) {
      return (id: string): SurveySession | undefined => state.sessions.find((session) => session.id === id);
    },
    sessionOptions(state): Array<{ label: string; value: string }> {
      return state.sessions.map((session) => ({
        label: `${session.sessionNo} · ${session.date} · ${session.closed ? '已关闭' : '进行中'}`,
        value: session.id,
      }));
    },
    /** 当下有效（未关闭）批次：新环志记录只能落在这些批次上 */
    openSessions(state): SurveySession[] {
      return state.sessions.filter((session) => !session.closed);
    },
  },

  actions: {
    async hydrate() {
      this.sessions = await db.sessions.orderBy('date').reverse().toArray();
      this.hydrated = true;
    },

    /** 新建批次：所属鸟点须是监测组台账中当下启用的点位（环志组不会用到停用点位的批次） */
    async addSession(input: SessionInput): Promise<SurveySession> {
      const site = await db.sites.get(input.siteId);
      if (!site) {
        throw new SessionLedgerError('所选鸟点不在监测组台账中，请先登记鸟点再建批次');
      }
      if (site.status === '停用') {
        throw new SessionLedgerError(`鸟点 ${site.siteNo} 已停用，不能在停用点位上新建调查批次`);
      }
      const session: SurveySession = {
        id: uid('session'),
        sessionNo: input.sessionNo.trim(),
        date: input.date,
        siteId: input.siteId,
        startedAt: input.startedAt,
        endedAt: input.endedAt,
        netRounds: Number(input.netRounds) || 0,
        cloudCover: Number(input.cloudCover) || 0,
        windForce: Number(input.windForce) || 0,
        closed: false,
        leader: input.leader.trim(),
        remark: input.remark?.trim() || undefined,
      };
      // 只写监测组自己的批次表
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.put(toPlain(session));
      });
      this.sessions = [session, ...this.sessions];
      return session;
    },

    async updateSession(id: string, patch: Partial<SessionInput>) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      const next: SurveySession = { ...current, ...patch };
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.put(toPlain(next));
      });
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    /** 关闭批次后出统计；只回滚自己那份，环志组已登记记录不受影响 */
    async closeSession(id: string) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      const next: SurveySession = { ...current, closed: true, endedAt: current.endedAt || new Date().toTimeString().slice(0, 5) };
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.put(toPlain(next));
      });
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    async removeSession(id: string) {
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.delete(id);
      });
      this.sessions = this.sessions.filter((session) => session.id !== id);
    },
  },
});
