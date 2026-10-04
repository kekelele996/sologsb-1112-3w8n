<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import SiteMap from '../components/common/SiteMap.vue';
import FilterBar from '../components/common/FilterBar.vue';
import EmptyPanel from '../components/common/EmptyPanel.vue';
import { useSiteFilter } from '../hooks/useSiteFilter';
import { useSiteStore } from '../stores/siteStore';
import { useAmap } from '../hooks/useAmap';
import { useSessionStore } from '../stores/sessionStore';
import { HABITATS, SITE_STATUSES, type BirdSite, type Habitat } from '../types/bird-site';
import { distanceKm, habitatColor } from '../utils/geo';

const siteStore = useSiteStore();
const sessionStore = useSessionStore();
const amap = useAmap();
const filter = useSiteFilter();
const route = useRoute();

const dialogVisible = ref(false);
const editingId = ref('');
const selectedId = ref('');
const formRef = ref<FormInstance>();
/** 改号弹窗状态 */
const renumberVisible = ref(false);
const renumberId = ref('');
const renumberNo = ref('');

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

const statusParam = computed(() => (typeof route.query.status === 'string' ? route.query.status : ''));

const visible = computed(() =>
  filter.apply(siteStore.sites, sessionStore.sessions).filter((site) => {
    if (statusParam.value && site.status !== statusParam.value) return false;
    return true;
  }),
);
const activeCount = computed(() => siteStore.activeSites.length);
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

function openCreate() {
  editingId.value = '';
  formRef.value?.clearValidate();
  form.value = {
    siteNo: `S-${String(siteStore.sites.length + 1).padStart(2, '0')}`,
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
    name: form.value.name,
    lng: Number(form.value.lng) || 0,
    lat: Number(form.value.lat) || 0,
    habitat: form.value.habitat,
    netCount: Number(form.value.netCount) || 0,
    note: form.value.note,
  };
  try {
    if (editingId.value) {
      await siteStore.updateSite(editingId.value, payload);
      ElMessage.success(`已更新鸟点 ${form.value.siteNo}`);
    } else {
      const created = await siteStore.addSite({ ...payload, siteNo: form.value.siteNo });
      selectedId.value = created.id;
      ElMessage.success(`已登记鸟点 ${created.siteNo} · ${created.name}（${created.habitat}）`);
    }
  } catch (error) {
    ElMessage.error((error as Error).message);
    return;
  }
  dialogVisible.value = false;
}

function openRenumber(site: BirdSite) {
  renumberId.value = site.id;
  renumberNo.value = site.siteNo;
  renumberVisible.value = true;
}

/** 监测组改号：旧编号自动留在点位台账历史编号里，环志组按旧编号仍可对账 */
async function submitRenumber() {
  const site = siteStore.sites.find((item) => item.id === renumberId.value);
  if (!site) return;
  const no = renumberNo.value.trim();
  if (!no) {
    ElMessage.error('新点位编号不能为空');
    return;
  }
  if (no === site.siteNo) {
    renumberVisible.value = false;
    return;
  }
  try {
    await siteStore.renumberSite(site.id, no);
  } catch (error) {
    ElMessage.error((error as Error).message);
    return;
  }
  ElMessage.success(`点位已改号 ${site.siteNo} → ${no}，旧编号保留在台账中供环志组对账`);
  renumberVisible.value = false;
}

/** 监测组按生境停用 / 重新启用点位（停用只拦新登记，不动历史环志记录） */
async function toggleStatus(site: BirdSite) {
  const next = site.status === '启用' ? '停用' : '启用';
  if (next === '停用') {
    const confirmed = await ElMessageBox.confirm(
      `确认停用鸟点 ${site.siteNo} · ${site.name}？停用后新环志记录不能再落此点位，历史记录不受影响。`,
      '停用鸟点',
      { type: 'warning' },
    )
      .then(() => true)
      .catch(() => false);
    if (!confirmed) return;
  }
  try {
    await siteStore.setSiteStatus(site.id, next);
  } catch (error) {
    ElMessage.error((error as Error).message);
    return;
  }
  ElMessage.success(next === '停用' ? `鸟点 ${site.siteNo} 已停用` : `鸟点 ${site.siteNo} 已重新启用`);
}

</script>

<template>
  <div>
    <h2 class="page-title">鸟点台账与地图定位</h2>
    <p class="page-desc">
      地图与 SVG 网格双模式：配置 VITE_AMAP_KEY 时使用高德 JS API，未配置时自动退化为本地 SVG 网格视图；表单拾取坐标即在地图 / 网格上落点。
    </p>

    <div class="toolbar">
      <el-button type="primary" @click="openCreate">登记鸟点</el-button>
      <el-tag :type="amap.keyPresent ? 'success' : 'info'" effect="plain">
        高德 key：{{ amap.keyPresent ? '已配置' : '未配置（网格模式）' }}
      </el-tag>
      <el-tag type="info" effect="plain">
        点位 {{ siteStore.sites.length }} 个（启用 {{ activeCount }} / 停用 {{ siteStore.sites.length - activeCount }}）· 网位合计 {{ siteStore.totalNets }}
      </el-tag>
    </div>

    <FilterBar
      :fields="[
        { key: 'habitat', label: '生境', options: HABITATS, width: 120 },
        { key: 'status', label: '点位状态', options: [...SITE_STATUSES], width: 120 },
        { key: 'session', label: '作业时段', options: sessionStore.sessions.map((s) => s.sessionNo), width: 130 },
      ]"
      keyword-placeholder="搜索点位编号 / 名称 / 备注"
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
                <template v-if="nearest">· 最近点位 {{ nearest.site.siteNo }} 距离 {{ nearest.km }} km</template>
              </span>
            </div>
          </template>
          <SiteMap :sites="visible" :selected-id="selectedId" :height="420" @select="(id: string) => (selectedId = id)" />
        </el-card>
      </el-col>
      <el-col :xs="24" :lg="10">
        <el-card shadow="never" class="block">
          <template #header>鸟点台账</template>
          <el-table :data="visible" size="small" border @row-click="(row: BirdSite) => (selectedId = row.id)">
            <el-table-column prop="siteNo" label="编号" width="80" />
            <el-table-column prop="name" label="名称" min-width="120" />
            <el-table-column label="生境" width="110">
              <template #default="scope">
                <el-tag size="small" effect="plain" :style="{ borderColor: habitatColor(scope.row.habitat as Habitat), color: habitatColor(scope.row.habitat as Habitat) }">
                  {{ scope.row.habitat }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="坐标" width="170">
              <template #default="scope">{{ scope.row.lng }}°E, {{ scope.row.lat }}°N</template>
            </el-table-column>
            <el-table-column prop="netCount" label="网位" width="70" align="right" />
            <el-table-column label="状态" width="80">
              <template #default="scope">
                <el-tag size="small" :type="scope.row.status === '启用' ? 'success' : 'info'" effect="plain">
                  {{ scope.row.status }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="历史编号" width="100">
              <template #default="scope">
                <span v-if="scope.row.formerSiteNos?.length">{{ scope.row.formerSiteNos.join('、') }}</span>
                <span v-else class="muted">—</span>
              </template>
            </el-table-column>
            <el-table-column prop="note" label="备注" show-overflow-tooltip />
            <el-table-column label="操作" width="230" fixed="right">
              <template #default="scope">
                <el-button link type="primary" @click.stop="openEdit(scope.row)">编辑</el-button>
                <el-button link type="warning" @click.stop="openRenumber(scope.row)">改号</el-button>
                <el-button
                  link
                  :type="scope.row.status === '启用' ? 'danger' : 'success'"
                  @click.stop="toggleStatus(scope.row)"
                >
                  {{ scope.row.status === '启用' ? '停用' : '启用' }}
                </el-button>
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
              <el-input
                v-model="form.siteNo"
                placeholder="如：S-07"
                maxlength="12"
                :disabled="!!editingId"
              />
              <div v-if="editingId" class="field-hint">编号一经登记不可直接覆盖；如需改号请用列表中的「改号」，旧编号会保留供环志组对账</div>
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

    <el-dialog v-model="renumberVisible" title="点位改号（监测组台账）" width="460px">
      <el-alert type="info" :closable="false" show-icon class="block">
        旧点位编号会保留在台账「历史编号」中，环志组按登记当时编号对账仍能对上；改号失败只回滚点位台账，环志组已登记记录不受影响。
      </el-alert>
      <el-form label-width="96px" style="margin-top: 12px">
        <el-form-item label="当前编号">
          <el-input :model-value="siteStore.sites.find((s) => s.id === renumberId)?.siteNo" disabled />
        </el-form-item>
        <el-form-item label="新编号">
          <el-input v-model="renumberNo" placeholder="如：S-08" maxlength="12" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="renumberVisible = false">取消</el-button>
        <el-button type="primary" @click="submitRenumber">确认改号</el-button>
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
  margin-top: 2px;
}
.muted {
  color: #b0bdb8;
}
</style>
