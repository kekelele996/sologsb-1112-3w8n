<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import RingCodeInput from '../components/common/RingCodeInput.vue';
import SpeciesPicker from '../components/common/SpeciesPicker.vue';
import { useRingStore, RingRegisterError } from '../stores/ringStore';
import { useSiteStore } from '../stores/siteStore';
import { useSessionStore } from '../stores/sessionStore';
import {
  BIRD_AGES,
  RING_STATUSES,
  STATUS_COLOR,
  RECON_COLOR,
  RECON_STATUSES,
  type BirdAge,
  type ReconStatus,
  type RingRecord,
  type RingStatus,
} from '../types/ring-record';
import { formatDate } from '../utils/format';
import { speciesCount } from '../utils/stats';

const route = useRoute();
const ringStore = useRingStore();
const siteStore = useSiteStore();
const sessionStore = useSessionStore();

const dialogVisible = ref(false);
const editingId = ref('');
const formRef = ref<FormInstance>();
const historyVisible = ref(false);
const historyRingNo = ref('');

interface RingForm {
  ringNo: string;
  colorRing: string;
  speciesCn: string;
  speciesSci: string;
  age: BirdAge;
  ringDate: string;
  netNo: string;
  netRound: number;
  status: RingStatus;
  ringer: string;
  siteId: string;
  sessionId: string;
  remark: string;
}

const form = ref<RingForm>({
  ringNo: 'A-',
  colorRing: '无',
  speciesCn: '',
  speciesSci: '',
  age: '成',
  ringDate: new Date().toISOString().slice(0, 10),
  netNo: '1 号网',
  netRound: 1,
  status: '初捕',
  ringer: '',
  siteId: '',
  sessionId: '',
  remark: '',
});

const rules: FormRules = {
  ringNo: [{ required: true, message: '请输入金属环号', trigger: 'blur' }],
  speciesCn: [{ required: true, message: '请选择或输入鸟种中文名', trigger: 'change' }],
  ringer: [{ required: true, message: '请输入环志人', trigger: 'blur' }],
};

const kwParam = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));
const speciesParam = computed(() => (typeof route.query.species === 'string' ? route.query.species : ''));
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));
const sessionParam = computed(() => (typeof route.query.session === 'string' ? route.query.session : ''));
const sessionSelectParam = computed(() => (typeof route.query.sessionSelect === 'string' ? route.query.sessionSelect : ''));
const reconParam = computed(() => (typeof route.query.recon === 'string' ? route.query.recon : ''));

const visible = computed(() => {
  const kw = kwParam.value.trim().toLowerCase();
  return ringStore.rings.filter((record) => {
    if (speciesParam.value && record.speciesCn !== speciesParam.value) return false;
    if (statusParam.value && record.status !== statusParam.value) return false;
    if (reconParam.value && record.reconStatus !== reconParam.value) return false;
    // 批次筛选按登记当时批次号快照匹配，旧批次关闭 / 改名后仍可筛回
    if (sessionSelectParam.value && record.sessionNoSnapshot !== sessionSelectParam.value) return false;
    if (kw) {
      const haystack =
        `${record.ringNo} ${record.colorRing} ${record.speciesCn} ${record.speciesSci} ${record.ringer} ${record.netNo} ${record.siteNoSnapshot} ${record.siteNameSnapshot}`.toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
});

/** 可登记的点位 / 批次：监测组当下启用点位 + 未关闭批次（按点位联动） */
const registerableSites = computed(() => siteStore.activeSites);
const registerableSessions = computed(() => {
  if (!form.value.siteId) return sessionStore.openSessions;
  return sessionStore.openSessions.filter((session) => session.siteId === form.value.siteId);
});
/** 编辑历史记录时，把已停用 / 已关闭的当前归属也列出来（标注），避免选择器空白 */
const formSiteOptions = computed(() => {
  const options = registerableSites.value.map((site) => ({ label: `${site.siteNo} · ${site.name}`, value: site.id, disabled: false }));
  if (editingId.value) {
    const current = siteStore.sites.find((site) => site.id === form.value.siteId);
    if (current && !options.some((item) => item.value === current.id)) {
      options.unshift({ label: `${current.siteNo} · ${current.name}（${current.status}）`, value: current.id, disabled: true });
    }
  }
  return options;
});
const formSessionOptions = computed(() => {
  const options = registerableSessions.value.map((session) => ({
    label: `${session.sessionNo} · ${session.date}（进行中）`,
    value: session.id,
    disabled: false,
  }));
  if (editingId.value) {
    const current = sessionStore.sessions.find((session) => session.id === form.value.sessionId);
    if (current && !options.some((item) => item.value === current.id)) {
      options.unshift({ label: `${current.sessionNo} · ${current.date}（已关闭）`, value: current.id, disabled: true });
    }
  }
  return options;
});
const pendingCount = computed(() => ringStore.pendingRings.length);

/** 环号查重：编辑时排除自身 */
const existedRecord = computed(() => {
  const found = ringStore.findByRingNo(form.value.ringNo);
  return found && found.id !== editingId.value ? found : undefined;
});
const existedHistory = computed(() => (existedRecord.value ? ringStore.historyOf(form.value.ringNo) : []));

const entityOptions = computed(() => speciesCount(ringStore.rings).map((item) => item.speciesCn));

function openCreate() {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = {
    ringNo: 'A-',
    colorRing: '无',
    speciesCn: '红喉歌鸲',
    speciesSci: 'Calliope calliope',
    age: '成',
    ringDate: new Date().toISOString().slice(0, 10),
    netNo: '1 号网',
    netRound: 1,
    status: '初捕',
    ringer: '韩雪',
    siteId: siteStore.activeSites[0]?.id ?? '',
    sessionId: '',
    remark: '',
  };
  // 默认落到该启用点位下第一个未关闭批次
  form.value.sessionId =
    sessionStore.openSessions.find((session) => session.siteId === form.value.siteId)?.id ?? '';
  dialogVisible.value = true;
}

function openEdit(record: RingRecord) {
  editingId.value = record.id;
  form.value = {
    ringNo: record.ringNo,
    colorRing: record.colorRing,
    speciesCn: record.speciesCn,
    speciesSci: record.speciesSci,
    age: record.age,
    ringDate: record.ringDate.slice(0, 10),
    netNo: record.netNo,
    netRound: record.netRound,
    status: record.status,
    ringer: record.ringer,
    siteId: record.siteId,
    sessionId: record.sessionId,
    remark: record.remark ?? '',
  };
  dialogVisible.value = true;
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  if (!editingId.value && existedRecord.value) {
    ringStore.setDuplicate(existedRecord.value.id);
    ElMessage.error(`环号 ${form.value.ringNo} 已存在，已跳转该环号历史记录`);
    historyRingNo.value = form.value.ringNo;
    historyVisible.value = true;
    return;
  }
  const payload = {
    ringNo: form.value.ringNo,
    colorRing: form.value.colorRing,
    speciesCn: form.value.speciesCn,
    speciesSci: form.value.speciesSci,
    age: form.value.age,
    ringDate: new Date(`${form.value.ringDate}T08:00:00`).toISOString(),
    netNo: form.value.netNo,
    netRound: Number(form.value.netRound) || 1,
    status: form.value.status,
    ringer: form.value.ringer,
    siteId: form.value.siteId,
    sessionId: form.value.sessionId,
    remark: form.value.remark,
  };
  if (editingId.value) {
    try {
      await ringStore.updateRing(editingId.value, payload);
      ElMessage.success(`已更新环志记录 ${payload.ringNo}`);
    } catch (error) {
      ElMessage.error((error as Error).message);
      return;
    }
  } else {
    try {
      await ringStore.addRing(payload);
    } catch (error) {
      if (error instanceof RingRegisterError) {
        ElMessage.error(error.message);
        return;
      }
      throw error;
    }
    ElMessage.success(`已登记环志记录 ${payload.ringNo}（${payload.speciesCn}）`);
  }
  dialogVisible.value = false;
}

function showHistory(ringNo: string) {
  historyRingNo.value = ringNo;
  historyVisible.value = true;
}

/** 新建时切换鸟点：批次必须与点位匹配，重置为该点位下第一个未关闭批次 */
watch(
  () => form.value.siteId,
  (siteId, oldId) => {
    if (editingId.value || siteId === oldId) return;
    form.value.sessionId = sessionStore.openSessions.find((session) => session.siteId === siteId)?.id ?? '';
  },
);

/** 两边按点位编号重新对账：监测组补过台账后调用，挂起记录可自动恢复 */
async function runReconcile() {
  const { pending, resolved } = await ringStore.reconcileWith(siteStore.sites);
  if (pending === 0 && resolved === 0) {
    ElMessage.success('对账完成：所有记录点位编号均与监测组台账一致');
  } else {
    ElMessage.warning(`对账完成：新挂起 ${pending} 条（等监测组补台账），恢复已对账 ${resolved} 条`);
  }
}

async function remove(record: RingRecord) {
  const confirmed = await ElMessageBox.confirm(`确认删除环志记录 ${record.ringNo}（${record.speciesCn}）？`, '删除确认', { type: 'warning' })
    .then(() => true)
    .catch(() => false);
  if (!confirmed) return;
  await ringStore.removeRing(record.id);
  ElMessage.success('已删除');
}

const historyRows = computed(() => ringStore.historyOf(historyRingNo.value));

/** 挂起记录整行加红底样式 */
function rowClass(scope: { row: RingRecord }): string {
  return scope.row.reconStatus === '挂起' ? 'row-pending' : '';
}
const statusColor = (status: RingStatus) => STATUS_COLOR[status];
const reconColor = (status: ReconStatus) => RECON_COLOR[status];
</script>

<template>
  <div>
    <h2 class="page-title">环志记录录入与检索</h2>
    <p class="page-desc">
      金属环号 + 彩环组合双段录入，自动查重；新登记只能落在监测组当下启用的点位与未关闭批次上。点位编号、名称与批次号在登记时快照留底，点位停用 / 改号后历史记录仍按登记当时编号查得回来。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记环志记录</el-button>
      <el-button @click="runReconcile">按点位编号对账</el-button>
      <el-tag v-if="ringStore.duplicate" type="warning" effect="plain">
        查重命中：{{ ringStore.duplicate.ringNo }}（{{ ringStore.duplicate.speciesCn }}）
      </el-tag>
      <el-tag v-if="pendingCount > 0" type="danger" effect="plain">
        挂起 {{ pendingCount }} 条：点位编号对不上，等监测组补台账（环志组不代建点位）
      </el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'species', label: '鸟种', options: entityOptions, width: 140 },
        { key: 'status', label: '状态', options: [...RING_STATUSES], width: 110 },
        { key: 'recon', label: '对账', options: [...RECON_STATUSES], width: 110 },
        { key: 'sessionSelect', label: '调查批次', options: [...new Set(ringStore.rings.map((r) => r.sessionNoSnapshot).filter(Boolean))], width: 130 },
      ]"
      keyword-placeholder="搜索环号 / 鸟种 / 环志人 / 网号 / 点位编号"
      :result-count="visible.length"
      :total-count="ringStore.rings.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的环志记录" action-text="登记环志记录" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table
        :data="visible"
        size="small"
        border
        :row-class-name="rowClass"
      >
        <el-table-column prop="ringNo" label="金属环号" width="110" />
        <el-table-column prop="colorRing" label="彩环" width="100" />
        <el-table-column prop="speciesCn" label="鸟种" width="110" />
        <el-table-column prop="speciesSci" label="学名" min-width="170" show-overflow-tooltip />
        <el-table-column prop="age" label="年龄" width="80" />
        <el-table-column label="环志日期" width="110">
          <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
        </el-table-column>
        <el-table-column prop="netNo" label="网号" width="90" />
        <el-table-column prop="netRound" label="网次" width="70" align="right" />
        <el-table-column label="状态" width="90">
          <template #default="scope">
            <el-tag :type="statusColor(scope.row.status)" size="small">{{ scope.row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ringer" label="环志人" width="90" />
        <el-table-column label="登记点位（编号快照）" width="180">
          <template #default="scope">
            <div>{{ scope.row.siteNoSnapshot || '—' }} · {{ scope.row.siteNameSnapshot || '点位缺失' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="对账" width="90">
          <template #default="scope">
            <el-tag :type="reconColor(scope.row.reconStatus)" size="small">
              {{ scope.row.reconStatus }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="scope">
            <el-button link type="primary" @click="showHistory(scope.row.ringNo)">历史</el-button>
            <el-button link type="primary" @click="openEdit(scope.row)">编辑</el-button>
            <el-button link type="danger" @click="remove(scope.row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑环志记录' : '登记环志记录'" width="760px">
      <RingCodeInput
        v-model:ring-no="form.ringNo"
        v-model:color-ring="form.colorRing"
        :existed="existedRecord"
        :history-count="existedHistory.length"
        @view-history="showHistory"
      />

      <el-divider content-position="left">鸟种与环志信息</el-divider>

      <SpeciesPicker v-model:species-cn="form.speciesCn" v-model:species-sci="form.speciesSci" />

      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" class="ring-form">
        <el-form-item label="金属环号" prop="ringNo">
          <el-input v-model="form.ringNo" placeholder="如：A-10231" maxlength="20" />
        </el-form-item>
        <el-form-item label="鸟种中文名" prop="speciesCn">
          <el-input v-model="form.speciesCn" placeholder="与上方鸟种选择一致" maxlength="30" />
        </el-form-item>
        <el-form-item label="学名">
          <el-input v-model="form.speciesSci" maxlength="60" />
        </el-form-item>
        <el-form-item label="年龄">
          <el-select v-model="form.age" style="width: 160px">
            <el-option v-for="age in BIRD_AGES" :key="age" :label="age" :value="age" />
          </el-select>
        </el-form-item>
        <el-form-item label="环志日期">
          <el-date-picker v-model="form.ringDate" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" />
        </el-form-item>
        <el-form-item label="网号">
          <el-input v-model="form.netNo" style="width: 160px" maxlength="20" placeholder="如：3 号网" />
        </el-form-item>
        <el-form-item label="网次">
          <el-input-number v-model="form.netRound" :min="1" :max="20" placeholder="网次" />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="form.status" style="width: 160px">
            <el-option v-for="status in RING_STATUSES" :key="status" :label="status" :value="status" />
          </el-select>
        </el-form-item>
        <el-form-item label="环志人" prop="ringer">
          <el-input v-model="form.ringer" style="width: 160px" maxlength="16" placeholder="如：韩雪" />
        </el-form-item>
        <el-form-item label="鸟点">
          <el-select v-model="form.siteId" style="width: 320px" placeholder="仅可选监测组启用中的点位">
            <el-option
              v-for="site in formSiteOptions"
              :key="site.value"
              :label="site.label"
              :value="site.value"
              :disabled="site.disabled"
            />
            <template #empty>监测组暂无启用点位，请先由监测组在「鸟点台账」登记</template>
          </el-select>
        </el-form-item>
        <el-form-item label="调查批次">
          <el-select v-model="form.sessionId" style="width: 320px" placeholder="仅可选未关闭批次，且须属于所选鸟点">
            <el-option
              v-for="session in formSessionOptions"
              :key="session.value"
              :label="session.label"
              :value="session.value"
              :disabled="session.disabled"
            />
            <template #empty>该点位下没有未关闭批次，请先由监测组新建批次</template>
          </el-select>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" maxlength="80" placeholder="重捕位移、体况等" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="historyVisible" :title="`环号历史记录 · ${historyRingNo}`" width="720px">
      <el-table :data="historyRows" size="small" border>
        <el-table-column prop="ringNo" label="环号" width="110" />
        <el-table-column prop="speciesCn" label="鸟种" width="110" />
        <el-table-column label="环志日期" width="120">
          <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="90" />
        <el-table-column prop="netNo" label="网号" width="100" />
        <el-table-column label="登记点位编号" width="120">
          <template #default="scope">{{ scope.row.siteNoSnapshot || '—' }}</template>
        </el-table-column>
        <el-table-column label="对账" width="90">
          <template #default="scope">
            <el-tag :type="reconColor(scope.row.reconStatus)" size="small">{{ scope.row.reconStatus }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ringer" label="环志人" width="90" />
        <el-table-column prop="remark" label="备注" show-overflow-tooltip />
      </el-table>
      <template #footer>
        <el-button type="primary" @click="historyVisible = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page-title {
  margin: 0 0 4px;
  font-size: 20px;
  color: #1f4a44;
}
.page-desc {
  margin: 0 0 12px;
  color: #6f8480;
  font-size: 13px;
}
.toolbar {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
}
.block {
  border-radius: 8px;
}
.ring-form {
  margin-top: 10px;
}
</style>

<style>
/* 挂起记录整行浅红底，提示等监测组补台账 */
.el-table .row-pending td {
  background-color: #fdf0ef !important;
}
</style>
