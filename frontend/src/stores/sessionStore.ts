import { defineStore } from 'pinia';
import { db } from '../utils/db';
import { uid } from '../utils/id';
import { toPlain } from '../utils/plain';
import type { SurveySession } from '../types/session';

export interface SessionInput {
  sessionNo: string;
  date: string;
  siteId: string;
  startedAt: string;
  endedAt: string;
  netRounds: number;
  cloudCover: number;
  windForce: number;
  leader: string;
  remark?: string;
}

interface SessionState {
  sessions: SurveySession[];
  hydrated: boolean;
}

/** 调查批次与统计派生值（监测组维护） */
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
    /** 可接收新环志记录的批次：未关闭 */
    openSessions(state): SurveySession[] {
      return state.sessions.filter((session) => !session.closed);
    },
    /** 某有效点位下进行中的批次（鸟点停用后该点不再开新登记入口） */
    openSessionsForSite(state) {
      return (siteId: string): SurveySession[] =>
        state.sessions.filter((session) => !session.closed && session.siteId === siteId);
    },
  },

  actions: {
    async hydrate() {
      this.sessions = await db.sessions.orderBy('date').reverse().toArray();
      this.hydrated = true;
    },

    /** 新批次只能挂在监测组当下有效点位上（activeSites 由页面传入，避免 store 循环依赖） */
    async addSession(input: SessionInput, activeSiteIds: string[] = []): Promise<SurveySession> {
      if (activeSiteIds.length > 0 && !activeSiteIds.includes(input.siteId)) {
        throw new Error('只能在当下有效的鸟点上新建调查批次');
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
      // 监测组自己的台账事务：失败只回滚 sessions 表，环志组已登记记录不受影响
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.put(toPlain(session));
      });
      this.sessions = [session, ...this.sessions];
      return session;
    },

    /** 批次进行中时可改台账字段；已关闭批次为历史台账，不再编辑 */
    async updateSession(id: string, patch: Partial<SessionInput>) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      if (current.closed) {
        throw new Error(`批次 ${current.sessionNo} 已关闭，历史台账不可修改`);
      }
      if (patch.siteId) {
        // 编辑时改挂点位同样要求有效点位——由页面保证可选项，这里只兜底空值
        if (!patch.siteId) throw new Error('请选择鸟点');
      }
      const next: SurveySession = { ...current, ...patch };
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.put(toPlain(next));
      });
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
    },

    /**
     * 关闭批次后出统计。事务只覆盖 sessions 表——即便关闭失败，
     * 也只回滚监测组自己这份，环志组已登记记录不受影响。
     */
    async closeSession(id: string): Promise<SurveySession> {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) throw new Error('批次不存在');
      if (current.closed) return current;
      const next: SurveySession = {
        ...current,
        closed: true,
        closedAt: new Date().toISOString(),
        endedAt: current.endedAt || new Date().toTimeString().slice(0, 5),
      };
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.put(toPlain(next));
      });
      this.sessions = this.sessions.map((session) => (session.id === id ? next : session));
      return next;
    },

    /** 删除批次：仅允许删除无环志记录引用的批次（由页面传入引用校验结果） */
    async removeSession(id: string, hasRingRefs = false) {
      const current = this.sessions.find((session) => session.id === id);
      if (!current) return;
      if (hasRingRefs) {
        throw new Error(`批次 ${current.sessionNo} 已有环志记录，不能删除（如需停止使用请关闭批次）`);
      }
      await db.transaction('rw', db.sessions, async () => {
        await db.sessions.delete(id);
      });
      this.sessions = this.sessions.filter((session) => session.id !== id);
    },
  },
});
