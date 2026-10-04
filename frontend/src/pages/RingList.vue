<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { Refresh, Search } from '@element-plus/icons-vue';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import RingCodeInput from '../components/common/RingCodeInput.vue';
import SpeciesPicker from '../components/common/SpeciesPicker.vue';
import { useRingStore } from '../stores/ringStore';
import { useSiteStore } from '../stores/siteStore';
import { useSessionStore } from '../stores/sessionStore';
import {
  BIRD_AGES,
  RECONCILE_STATUSES,
  RING_STATUSES,
  STATUS_COLOR,
  type BirdAge,
  type RingRecord,
  type RingStatus,
} from '../types/ring-record';
import { formatDate } from '../utils/format';
import { speciesCount } from '../utils/stats';
import { findSiteByNo, ringSiteLabel } from '../utils/ledger';

const route = useRoute();
const router = useRouter();
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

function defaultForm(): RingForm {
  const firstSite = siteStore.activeSites[0];
  const firstSession = firstSite ? sessionStore.openSessionsForSite(firstSite.id)[0] : undefined;
  return {
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
    siteId: firstSite?.id ?? '',
    sessionId: firstSession?.id ?? '',
    remark: '',
  };
}

const form = ref<RingForm>(defaultForm());

const rules: FormRules = {
  ringNo: [{ required: true, message: '请输入金属环号', trigger: 'blur' }],
  speciesCn: [{ required: true, message: '请选择或输入鸟种中文名', trigger: 'change' }],
  ringer: [{ required: true, message: '请输入环志人', trigger: 'blur' }],
  siteId: [{ required: true, message: '请选择监测组当下有效的鸟点', trigger: 'change' }],
  sessionId: [{ required: true, message: '请选择进行中的调查批次', trigger: 'change' }],
};

const kwParam = computed(() => (typeof route.query.kw === 'string' ? route.query.kw : ''));
const speciesParam = computed(() => (typeof route.query.species === 'string' ? route.query.species : ''));
const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));
const reconcileParam = computed(() => (typeof route.query.reconcile === 'string' ? route.query.reconcile : ''));
const sessionParam = computed(() => (typeof route.query.sessionSelect === 'string' ? route.query.sessionSelect : ''));
/** 按登记当时点位编号精确查（监测组改号后，用旧编号也能把历史记录查回来） */
const siteNoParam = computed(() => (typeof route.query.siteNo === 'string' ? route.query.siteNo : ''));

const visible = computed(() => {
  const kw = kwParam.value.trim().toLowerCase();
  const siteNo = siteNoParam.value.trim().toLowerCase();
  return ringStore.rings.filter((record) => {
    if (speciesParam.value && record.speciesCn !== speciesParam.value) return false;
    if (statusParam.value && record.status !== statusParam.value) return false;
    if (reconcileParam.value && record.reconcile !== reconcileParam.value) return false;
    if (sessionParam.value && record.sessionId !== sessionParam.value) return false;
    if (siteNo && record.siteNoSnapshot.trim().toLowerCase() !== siteNo) return false;
    if (kw) {
      const haystack =
        `${record.ringNo} ${record.colorRing} ${record.speciesCn} ${record.speciesSci} ${record.ringer} ${record.netNo} ${record.siteNoSnapshot} ${record.sessionNoSnapshot}`.toLowerCase();
      if (!haystack.includes(kw)) return false;
    }
    return true;
  });
});

/** 环号查重：编辑时排除自身 */
const existedRecord = computed(() => {
  const found = ringStore.findByRingNo(form.value.ringNo);
  return found && found.id !== editingId.value ? found : undefined;
});
const existedHistory = computed(() => (existedRecord.value ? ringStore.historyOf(form.value.ringNo) : []));

const entityOptions = computed(() => speciesCount(ringStore.rings).map((item) => item.speciesCn));

/** 新登记只选有效点位；切换点位时批次重置为该点位下进行中的批次 */
const formSessions = computed(() => sessionStore.openSessionsForSite(form.value.siteId));

watch(
  () => form.value.siteId,
  (siteId, oldSiteId) => {
    if (dialogVisible.value && !editingId.value && siteId !== oldSiteId) {
      form.value.sessionId = sessionStore.openSessionsForSite(siteId)[0]?.id ?? '';
    }
  },
);

function openCreate() {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = defaultForm();
  dialogVisible.value = true;
}

function openEdit(record: RingRecord) {
  editingId.value = record.id;
  formRef.value?.clearValidate();
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
  try {
    if (editingId.value) {
      await ringStore.updateRing(editingId.value, payload);
      ElMessage.success(`已更新环志记录 ${payload.ringNo}`);
    } else {
      await ringStore.addRing(payload, {
        activeSites: siteStore.activeSites,
        openSessions: sessionStore.openSessions,
      });
      ElMessage.success(`已登记环志记录 ${payload.ringNo}（${payload.speciesCn}）`);
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

/** 两边按点位编号对账：环志组只判差异，点位要靠监测组补台账 */
async function reconcile() {
  const result = await ringStore.reconcileAll(siteStore.sites);
  if (result.suspended > 0) {
    ElMessage.warning(`对账完成：共核对 ${result.checked} 条，${result.suspended} 条挂起等监测组补台账，本轮解除挂起 ${result.cleared} 条`);
  } else {
    ElMessage.success(`对账完成：共核对 ${result.checked} 条，全部与监测组台账对得上`);
  }
}

/** 按登记当时点位编号回查（输入旧编号即可查改号前的历史记录） */
const siteNoSearch = ref(siteNoParam.value);
watch(siteNoParam, (value) => (siteNoSearch.value = value));
const siteNoResolve = computed(() => (siteNoSearch.value.trim() ? findSiteByNo(siteStore.sites, siteNoSearch.value) : undefined));

function applySiteNoSearch() {
  const value = siteNoSearch.value.trim();
  const query = { ...route.query };
  if (value) query.siteNo = value;
  else delete query.siteNo;
  void router.replace({ query });
}

function siteLabel(record: RingRecord): string {
  return ringSiteLabel(record, siteStore.sites);
}

function showHistory(ringNo: string) {
  historyRingNo.value = ringNo;
  historyVisible.value = true;
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
const suspendedCount = computed(() => ringStore.suspendedRings.length);

function rowClassName(scope: { row: RingRecord }): string {
  return scope.row.reconcile === '挂起' ? 'row-suspended' : '';
}
</script>

<template>
  <div>
    <h2 class="page-title">环志记录录入与检索</h2>
    <p class="page-desc">
      环志组留底：金属环号自动查重；新登记只能落到监测组当下有效的鸟点与进行中的批次，登记当时的点位编号随记录留底，监测组改号后历史仍按旧编号可查。两边按点位编号对账，对不上的挂起等监测组补台账。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记环志记录</el-button>
      <el-button :icon="Refresh" @click="reconcile">按点位编号对账</el-button>
      <el-tag v-if="suspendedCount > 0" type="warning" effect="dark">挂起 {{ suspendedCount }} 条 · 等监测组补台账</el-tag>
      <el-tag v-if="ringStore.duplicate" type="warning" effect="plain">
        查重命中：{{ ringStore.duplicate.ringNo }}（{{ ringStore.duplicate.speciesCn }}）
      </el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'species', label: '鸟种', options: entityOptions, width: 140 },
        { key: 'status', label: '状态', options: [...RING_STATUSES], width: 110 },
        { key: 'reconcile', label: '对账', options: [...RECONCILE_STATUSES], width: 100 },
        { key: 'sessionSelect', label: '调查批次', options: sessionStore.sessions.map((s) => s.sessionNo), width: 130 },
      ]"
      keyword-placeholder="搜索环号 / 鸟种 / 环志人 / 点位编号"
      :result-count="visible.length"
      :total-count="ringStore.rings.length"
    />

    <div class="snapshot-filter">
      <span class="snapshot-label">按登记当时点位编号查</span>
      <el-input
        v-model="siteNoSearch"
        style="width: 180px"
        placeholder="如：S-03（支持改号前旧编号）"
        clearable
        @keyup.enter="applySiteNoSearch"
        @clear="applySiteNoSearch"
      />
      <el-button :icon="Search" @click="applySiteNoSearch">查历史</el-button>
      <el-tag v-if="siteNoParam" :type="siteNoResolve ? 'success' : 'warning'" size="small" effect="plain">
        {{ siteNoResolve ? `编号 ${siteNoParam} 现为 ${siteNoResolve.siteNo} · ${siteNoResolve.name}` : `编号 ${siteNoParam} 台账查无此点` }}
      </el-tag>
    </div>

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的环志记录" action-text="登记环志记录" @action="openCreate" />

    <el-card v-else shadow="never" class="block">
      <el-table :data="visible" size="small" border :row-class-name="rowClassName">
        <el-table-column prop="ringNo" label="金属环号" width="110" />
        <el-table-column prop="colorRing" label="彩环" width="90" />
        <el-table-column prop="speciesCn" label="鸟种" width="100" />
        <el-table-column label="环志日期" width="100">
          <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="scope">
            <el-tag :type="STATUS_COLOR[scope.row.status as RingStatus]" size="small">{{ scope.row.status }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="ringer" label="环志人" width="80" />
        <el-table-column label="登记点位编号" width="150">
          <template #default="scope">
            <span :class="{ 'snapshot-missing': scope.row.reconcile === '挂起' }">{{ scope.row.siteNoSnapshot || '—' }}</span>
            <el-tag v-if="scope.row.legacyBackfilled" type="info" size="small" effect="plain" class="backfill-tag">回填</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="鸟点" min-width="130" show-overflow-tooltip>
          <template #default="scope">{{ siteLabel(scope.row) }}</template>
        </el-table-column>
        <el-table-column label="对账" width="80">
          <template #default="scope">
            <el-tag :type="scope.row.reconcile === '正常' ? 'success' : 'warning'" size="small">{{ scope.row.reconcile }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reconcileNote" label="挂起原因" min-width="160" show-overflow-tooltip />
        <el-table-column label="操作" width="180" fixed="right">
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
        <el-form-item v-if="!editingId" label="鸟点" prop="siteId">
          <el-select v-model="form.siteId" style="width: 320px" placeholder="仅监测组当下有效的鸟点">
            <el-option
              v-for="site in siteStore.activeSites"
              :key="site.id"
              :label="`${site.siteNo} · ${site.name}（${site.habitat}）`"
              :value="site.id"
            />
          </el-select>
          <div class="field-hint">停用点位不在此列；点位由监测组维护，环志组不能自行登记新点位</div>
        </el-form-item>
        <el-form-item v-else label="鸟点">
          <el-input :model-value="siteLabel(ringStore.rings.find((r) => r.id === editingId)!)" disabled style="width: 320px" />
          <div class="field-hint">点位归属是登记当时的历史事实，不再改动；如需按编号核对请看「登记点位编号」列</div>
        </el-form-item>
        <el-form-item v-if="!editingId" label="调查批次" prop="sessionId">
          <el-select v-model="form.sessionId" style="width: 320" :placeholder="formSessions.length ? '选择进行中的批次' : '该点位暂无进行中批次'">
            <el-option
              v-for="session in formSessions"
              :key="session.id"
              :label="`${session.sessionNo} · ${session.date} · 进行中`"
              :value="session.id"
            />
          </el-select>
          <div class="field-hint">已关闭批次不再接受新登记；批次随鸟点联动</div>
        </el-form-item>
        <el-form-item v-else label="调查批次">
          <el-input :model-value="ringStore.rings.find((r) => r.id === editingId)?.sessionNoSnapshot ?? '—'" disabled style="width: 320px" />
          <div class="field-hint">批次归属为登记当时的留底，历史记录不随批次关闭而变化</div>
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

    <el-dialog v-model="historyVisible" :title="`环号历史记录 · ${historyRingNo}`" width="760px">
      <el-table :data="historyRows" size="small" border>
        <el-table-column prop="ringNo" label="环号" width="110" />
        <el-table-column prop="speciesCn" label="鸟种" width="100" />
        <el-table-column label="环志日期" width="110">
          <template #default="scope">{{ formatDate(scope.row.ringDate) }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="80" />
        <el-table-column prop="netNo" label="网号" width="90" />
        <el-table-column prop="ringer" label="环志人" width="80" />
        <el-table-column prop="siteNoSnapshot" label="登记点位编号" width="110" />
        <el-table-column label="对账" width="80">
          <template #default="scope">
            <el-tag :type="scope.row.reconcile === '正常' ? 'success' : 'warning'" size="small">{{ scope.row.reconcile }}</el-tag>
          </template>
        </el-table-column>
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
.snapshot-filter {
  display: flex;
  gap: 8px;
  align-items: center;
  margin: 0 0 12px;
  flex-wrap: wrap;
}
.snapshot-label {
  font-size: 13px;
  color: #6f5a3e;
}
.block {
  border-radius: 8px;
}
.ring-form {
  margin-top: 10px;
}
.field-hint {
  font-size: 12px;
  color: #8a99a5;
  line-height: 1.5;
}
.snapshot-missing {
  color: #b26a00;
  font-weight: 600;
}
.backfill-tag {
  margin-left: 4px;
}
:deep(.row-suspended) {
  background-color: #fff7e6;
}
</style>
