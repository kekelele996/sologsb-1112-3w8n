<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import SiteMap from '../components/common/SiteMap.vue';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useSiteFilter } from '../hooks/useSiteFilter';
import { useSiteStore } from '../stores/siteStore';
import { useAmap } from '../hooks/useAmap';
import { useSessionStore } from '../stores/sessionStore';
import { HABITATS, type BirdSite, type Habitat } from '../types/bird-site';
import { distanceKm, habitatColor } from '../utils/geo';

const siteStore = useSiteStore();
const sessionStore = useSessionStore();
const amap = useAmap();
const filter = useSiteFilter();

const dialogVisible = ref(false);
const editingId = ref('');
const selectedId = ref('');
const formRef = ref<FormInstance>();
/** 改号弹窗 */
const renumberVisible = ref(false);
const renumberTarget = ref<BirdSite | null>(null);
const renumberFormRef = ref<FormInstance>();
const renumberForm = ref({ siteNo: '', reason: '' });
const renumberRules: FormRules = {
  siteNo: [{ required: true, message: '请输入新点位编号', trigger: 'blur' }],
  reason: [{ required: true, message: '请填写改号原因（按生境调整等）', trigger: 'blur' }],
};

interface SiteForm {
  siteNo: string;
  name: string;
  lng: number;
  lat: number;
  habitat: Habitat;
  netCount: number;
  note: string;
}

const form = ref<SiteForm>({
  siteNo: '',
  name: '',
  lng: 118.05,
  lat: 38.92,
  habitat: '芦苇湿地',
  netCount: 8,
  note: '',
});

const rules: FormRules = {
  siteNo: [{ required: true, message: '请输入点位编号', trigger: 'blur' }],
  name: [{ required: true, message: '请输入点位名称', trigger: 'blur' }],
};

const visible = computed(() => filter.apply(siteStore.sites, sessionStore.sessions));
const selected = computed(() => siteStore.sites.find((site) => site.id === selectedId.value));

/** 与已有点位的最小间距（km），用于提示点位过近 */
const nearest = computed(() => {
  if (!selected.value) return undefined;
  const others = siteStore.sites.filter((site) => site.id !== selected.value?.id);
  if (others.length === 0) return undefined;
  return others
    .map((site) => ({ site, km: distanceKm(site, selected.value!) }))
    .sort((a, b) => a.km - b.km)[0];
});

function nextSiteNo(): string {
  const used = new Set(siteStore.sites.map((site) => Number(site.siteNo.replace(/\D/g, ''))).filter((n) => Number.isFinite(n)));
  let n = siteStore.sites.length + 1;
  while (used.has(n)) n += 1;
  return `S-${String(n).padStart(2, '0')}`;
}

function openCreate() {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = {
    siteNo: nextSiteNo(),
    name: '',
    lng: 118.05,
    lat: 38.92,
    habitat: '芦苇湿地',
    netCount: 8,
    note: '',
  };
  dialogVisible.value = true;
}

function openEdit(site: BirdSite) {
  editingId.value = site.id;
  formRef.value?.clearValidate();
  form.value = {
    siteNo: site.siteNo,
    name: site.name,
    lng: site.lng,
    lat: site.lat,
    habitat: site.habitat,
    netCount: site.netCount,
    note: site.note ?? '',
  };
  dialogVisible.value = true;
}

/** 地图 / 网格拾取坐标 → 回填表单 */
function handlePick(point: { lng: number; lat: number }) {
  form.value.lng = point.lng;
  form.value.lat = point.lat;
  ElMessage.success(`已拾取坐标 ${point.lng}°E, ${point.lat}°N`);
}

async function submit() {
  const ok = await formRef.value?.validate().catch(() => false);
  if (!ok) return;
  const payload = {
    siteNo: form.value.siteNo,
    name: form.value.name,
    lng: Number(form.value.lng) || 0,
    lat: Number(form.value.lat) || 0,
    habitat: form.value.habitat,
    netCount: Number(form.value.netCount) || 0,
    note: form.value.note,
  };
  try {
    if (editingId.value) {
      // 点位编号在表单中禁用，不随编辑提交；改号走专门的留痕动作
      await siteStore.updateSite(editingId.value, payload);
      ElMessage.success(`已更新鸟点 ${payload.siteNo}`);
    } else {
      const created = await siteStore.addSite(payload);
      selectedId.value = created.id;
      ElMessage.success(`已登记鸟点 ${payload.siteNo} · ${payload.name}（${payload.habitat}）`);
    }
    dialogVisible.value = false;
  } catch (error) {
    ElMessage.error((error as Error).message);
  }
}

function openRenumber(site: BirdSite) {
  renumberTarget.value = site;
  renumberForm.value = { siteNo: '', reason: '' };
  renumberVisible.value = true;
}

async function submitRenumber() {
  const ok = await renumberFormRef.value?.validate().catch(() => false);
  if (!ok || !renumberTarget.value) return;
  try {
    const next = await siteStore.renumberSite(renumberTarget.value.id, renumberForm.value.siteNo, renumberForm.value.reason);
    ElMessage.success(`已改号：${renumberTarget.value.siteNo} → ${next.siteNo}（旧编号留痕，环志历史按旧号仍可查）`);
    renumberVisible.value = false;
  } catch (error) {
    ElMessage.error(`改号失败，已回滚监测组台账：${(error as Error).message}`);
  }
}

async function deactivate(site: BirdSite) {
  const { value } = await ElMessageBox.prompt(`停用鸟点 ${site.siteNo} · ${site.name} 的原因？`, '停用鸟点（按生境调整）', {
    confirmButtonText: '停用',
    cancelButtonText: '取消',
    inputValue: '按生境调整',
    inputValidator: (v) => (v && v.trim() ? true : '请填写停用原因'),
  }).catch(() => ({ value: null }));
  if (value === null) return;
  try {
    await siteStore.deactivateSite(site.id, value);
    ElMessage.success(`鸟点 ${site.siteNo} 已停用，新登记不再落到该点，历史记录保留`);
  } catch (error) {
    ElMessage.error(`停用失败，已回滚：${(error as Error).message}`);
  }
}

async function activate(site: BirdSite) {
  try {
    await siteStore.activateSite(site.id);
    ElMessage.success(`鸟点 ${site.siteNo} 已重新启用`);
  } catch (error) {
    ElMessage.error(`启用失败，已回滚：${(error as Error).message}`);
  }
}

function historyText(site: BirdSite): string {
  if (site.noHistory.length === 0) return '无改号';
  return site.noHistory.map((change) => `${change.from} → ${change.to}（${change.reason}）`).join('；');
}
</script>

<template>
  <div>
    <h2 class="page-title">鸟点台账与地图定位</h2>
    <p class="page-desc">
      监测组维护：按生境调整可停用鸟点或改号（旧编号留痕，环志组历史记录按旧编号仍可查）；停用点位不再接受新登记。改号 / 停用失败只回滚本台账，不影响环志组已登记记录。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记鸟点</el-button>
      <el-tag :type="amap.keyPresent ? 'success' : 'info'" effect="plain">
        高德 key：{{ amap.keyPresent ? '已配置' : '未配置（网格模式）' }}
      </el-tag>
      <el-tag type="success" effect="plain">有效 {{ siteStore.activeCount }} 个</el-tag>
      <el-tag v-if="siteStore.inactiveCount > 0" type="info" effect="plain">停用 {{ siteStore.inactiveCount }} 个</el-tag>
      <el-tag type="info" effect="plain">网位合计 {{ siteStore.totalNets }}</el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'habitat', label: '生境', options: HABITATS, width: 120 },
        { key: 'session', label: '作业时段', options: sessionStore.sessions.map((s) => s.sessionNo), width: 130 },
      ]"
      keyword-placeholder="搜索点位编号 / 名称 / 备注 / 旧编号"
      :result-count="visible.length"
      :total-count="siteStore.sites.length"
    />

    <EmptyPanel v-if="visible.length === 0" description="没有符合条件的鸟点" action-text="重置筛选条件" @action="filter.reset()" />

    <el-row v-else :gutter="16">
      <el-col :xs="24" :lg="14">
        <el-card shadow="never" class="block">
          <template #header>
            <div class="card-head">
              <span>鸟点分布（{{ visible.length }} 个）</span>
              <span v-if="selected" class="card-note">
                已选 {{ selected.siteNo }} · {{ selected.lng }}°E, {{ selected.lat }}°N
                <template v-if="!selected.active"> · 已停用</template>
                <template v-if="nearest">· 最近点位 {{ nearest.site.siteNo }} 距离 {{ nearest.km }} km</template>
              </span>
            </div>
          </template>
          <SiteMap :sites="visible" :selected-id="selectedId" :height="420" @select="(id: string) => (selectedId = id)" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never" class="block">
          <template #header>鸟点台账（监测组留底）</template>
          <el-table :data="visible" size="small" border @row-click="(row: BirdSite) => (selectedId = row.id)">
            <el-table-column prop="siteNo" label="编号" width="70" />
            <el-table-column prop="name" label="名称" min-width="110" show-overflow-tooltip />
            <el-table-column label="生境" width="100">
              <template #default="scope">
                <el-tag size="small" effect="plain" :style="{ borderColor: habitatColor(scope.row.habitat as Habitat), color: habitatColor(scope.row.habitat as Habitat) }">
                  {{ scope.row.habitat }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="70">
              <template #default="scope">
                <el-tag :type="scope.row.active ? 'success' : 'info'" size="small">{{ scope.row.active ? '有效' : '停用' }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="netCount" label="网位" width="60" align="right" />
            <el-table-column label="改号历史" min-width="120" show-overflow-tooltip>
              <template #default="scope">
                <el-tooltip v-if="scope.row.noHistory.length" :content="historyText(scope.row)" placement="top">
                  <el-tag size="small" type="warning" effect="plain">旧号 {{ scope.row.noHistory[0].from }}</el-tag>
                </el-tooltip>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="190" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click.stop="openEdit(scope.row)">编辑</el-button>
                <el-button link type="warning" @click.stop="openRenumber(scope.row)">改号</el-button>
                <el-button v-if="scope.row.active" link type="info" @click.stop="deactivate(scope.row)">停用</el-button>
                <el-button v-else link type="success" @click.stop="activate(scope.row)">启用</el-button>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
    </el-row>

    <el-dialog v-model="dialogVisible" :title="editingId ? '编辑鸟点' : '登记鸟点'" width="860px">
      <el-row :gutter="16">
        <el-col :xs="24" :md="11">
          <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
            <el-form-item label="点位编号" prop="siteNo">
              <el-input v-model="form.siteNo" placeholder="如：S-07" maxlength="12" :disabled="Boolean(editingId)" />
              <div v-if="editingId" class="field-hint">编号不可直接改；如需改号请关闭本窗，点列表中的「改号」并留痕</div>
            </el-form-item>
            <el-form-item label="点位名称" prop="name">
              <el-input v-model="form.name" placeholder="如：大汶流芦苇荡" maxlength="30" />
            </el-form-item>
            <el-form-item label="经度(°E)">
              <el-input-number v-model="form.lng" :min="117.4" :max="118.4" :step="0.001" :precision="3" placeholder="经度" style="width: 100%" />
            </el-form-item>
            <el-form-item label="纬度(°N)">
              <el-input-number v-model="form.lat" :min="38.6" :max="39.4" :step="0.001" :precision="3" placeholder="纬度" style="width: 100%" />
            </el-form-item>
            <el-form-item label="生境">
              <el-select v-model="form.habitat" style="width: 100%">
                <el-option v-for="habitat in HABITATS" :key="habitat" :label="habitat" :value="habitat" />
              </el-select>
            </el-form-item>
            <el-form-item label="网位数">
              <el-input-number v-model="form.netCount" :min="0" :max="60" placeholder="网位数" style="width: 100%" />
            </el-form-item>
            <el-form-item label="备注">
              <el-input v-model="form.note" type="textarea" :rows="2" maxlength="60" placeholder="网阵布置、注意事项等" />
            </el-form-item>
          </el-form>
        </el-col>
        <el-col :xs="24" :md="13">
          <div class="pick-title">点击地图 / 网格拾取坐标（当前 {{ form.lng }}°E, {{ form.lat }}°N）</div>
          <SiteMap :sites="siteStore.sites" :selected-id="editingId" :height="300" pickable @pick="handlePick" />
        </el-col>
      </el-row>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="renumberVisible" :title="renumberTarget ? `鸟点改号 · ${renumberTarget.siteNo} ${renumberTarget.name}` : '鸟点改号'" width="480px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        class="renumber-alert"
        title="改号会在台账留痕：旧编号进入改号历史，环志组历史记录按登记当时旧编号仍可回查到本点位。"
      />
      <el-form ref="renumberFormRef" :model="renumberForm" :rules="renumberRules" label-width="92px">
        <el-form-item label="当前编号">
          <el-input :model-value="renumberTarget?.siteNo ?? ''" disabled />
        </el-form-item>
        <el-form-item label="新编号" prop="siteNo">
          <el-input v-model="renumberForm.siteNo" placeholder="如：S-13" maxlength="12" />
        </el-form-item>
        <el-form-item label="改号原因" prop="reason">
          <el-input v-model="renumberForm.reason" type="textarea" :rows="2" maxlength="60" placeholder="如：按生境调整，并入十位段编号" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renumberVisible = false">取消</el-button>
        <el-button type="warning" @click="submitRenumber">确认改号</el-button>
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
  margin-bottom: 16px;
  border-radius: 8px;
}
.card-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.card-note {
  font-size: 12px;
  color: #8a99a5;
}
.pick-title {
  font-size: 13px;
  color: #2f4a44;
  margin-bottom: 6px;
}
.field-hint {
  font-size: 12px;
  color: #8a99a5;
  line-height: 1.5;
}
.muted {
  color: #b6bfbd;
}
.renumber-alert {
  margin-bottom: 12px;
}
</style>
