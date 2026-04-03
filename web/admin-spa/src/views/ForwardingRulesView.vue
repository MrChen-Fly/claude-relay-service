<template>
  <div class="tab-content">
    <div class="card p-4 sm:p-6">
      <div class="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-3">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold tracking-[0.18em] text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
            >
              MODEL ROUTING
            </span>
            <span
              class="rounded-full border border-gray-200 px-3 py-1 text-xs text-gray-600 dark:border-gray-700 dark:text-gray-300"
            >
              账户级 / 平台级模型 ID 转发
            </span>
          </div>

          <div>
            <h3 class="mb-1 text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              转发规则
            </h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 sm:text-base">
              在请求调度到具体供应商账户后，按规则把前端模型 ID 重写成上游真实模型
              ID。账户留空时表示平台级规则，填写后只对该账户生效。
            </p>
          </div>
        </div>

        <button
          class="inline-flex items-center rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          @click="openCreateDialog"
        >
          <i class="fas fa-plus mr-2" />
          新建规则
        </button>
      </div>

      <div class="mb-6 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <div v-for="card in summaryCards" :key="card.label" class="stat-card">
          <div class="flex items-center justify-between gap-4">
            <div>
              <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
                {{ card.label }}
              </p>
              <p class="text-xl font-bold text-gray-900 dark:text-gray-100 sm:text-2xl">
                {{ card.value }}
              </p>
              <p class="mt-2 text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
                {{ card.description }}
              </p>
            </div>
            <div class="stat-icon flex-shrink-0" :class="card.iconBg">
              <i :class="card.icon" />
            </div>
          </div>
        </div>
      </div>

      <div
        class="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-800/50"
      >
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">平台</p>
            <el-select
              v-model="filterForm.platform"
              class="w-full"
              clearable
              placeholder="全部平台"
              @change="handleFilterPlatformChange"
            >
              <el-option label="全部平台" value="" />
              <el-option
                v-for="platform in platformOptions"
                :key="platform.value"
                :label="platform.label"
                :value="platform.value"
              />
            </el-select>
          </div>

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">账户</p>
            <el-select
              v-model="filterForm.accountId"
              class="w-full"
              clearable
              :disabled="!filterForm.platform"
              filterable
              :loading="filterAccountLoading"
              :no-data-text="filterForm.platform ? '没有匹配的账户' : '请先选择平台'"
              :placeholder="filterForm.platform ? '搜索账户名或 ID' : '请先选择平台'"
              remote
              :remote-method="searchFilterAccounts"
              reserve-keyword
              @visible-change="handleFilterAccountVisibleChange"
            >
              <el-option label="全部账户" value="" />
              <el-option
                v-for="account in filterAccountOptions"
                :key="`${account.platform}:${account.id}`"
                :label="account.label"
                :value="account.id"
              />
            </el-select>
          </div>

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">状态</p>
            <el-select v-model="filterForm.enabled" class="w-full" clearable placeholder="全部状态">
              <el-option label="全部状态" value="" />
              <el-option label="仅启用" value="true" />
              <el-option label="仅停用" value="false" />
            </el-select>
          </div>

          <div>
            <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
              关键字
            </p>
            <el-input
              v-model="filterForm.keyword"
              clearable
              placeholder="规则名 / 源模型 / 目标模型"
              @keyup.enter="loadRules"
            />
          </div>
        </div>

        <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            账户筛选支持按账户名或账户 ID 远程查询。
          </p>

          <div class="flex flex-wrap gap-3">
            <button
              class="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
              @click="resetFilters"
            >
              重置筛选
            </button>
            <button
              class="rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-gray-700 dark:bg-blue-600 dark:hover:bg-blue-500"
              @click="loadRules"
            >
              刷新列表
            </button>
          </div>
        </div>
      </div>

      <div class="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">规则列表</h4>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            匹配顺序: 账户级优先于平台级，再按优先级和更新时间排序。
          </p>
        </div>
        <div class="text-sm text-gray-500 dark:text-gray-400">
          <i v-if="loading" class="fas fa-spinner fa-spin mr-2" />
          共 {{ rules.length }} 条规则
        </div>
      </div>

      <div v-if="loading" class="flex items-center justify-center py-12">
        <i class="fas fa-spinner fa-spin mr-2 text-blue-500" />
        <span class="text-sm text-gray-500 dark:text-gray-400">正在加载规则...</span>
      </div>

      <el-empty
        v-else-if="rules.length === 0"
        class="rounded-lg border border-dashed border-gray-200 py-10 dark:border-gray-700"
        description="暂无匹配的转发规则"
        :image-size="96"
      />

      <el-table v-else border :data="rules" row-key="id" stripe style="width: 100%">
        <el-table-column label="规则" min-width="220">
          <template #default="{ row }">
            <div class="space-y-2 py-1">
              <div class="flex flex-wrap items-center gap-2">
                <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {{ row.name }}
                </span>
                <el-tag size="small" :type="row.enabled ? 'success' : 'info'">
                  {{ row.enabled ? '启用' : '停用' }}
                </el-tag>
                <el-tag effect="plain" size="small">
                  {{ matchTypeLabel(row.matchType) }}
                </el-tag>
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400">ID: {{ row.id }}</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="范围" min-width="220">
          <template #default="{ row }">
            <div class="space-y-2 py-1">
              <div class="flex flex-wrap items-center gap-2">
                <el-tag effect="dark" size="small">{{ platformLabel(row.platform) }}</el-tag>
                <el-tag size="small" :type="row.accountId ? 'warning' : 'primary'">
                  {{ row.accountId ? '账户级' : '平台级' }}
                </el-tag>
              </div>

              <div v-if="row.accountId" class="text-sm text-gray-700 dark:text-gray-300">
                <div class="font-medium text-gray-900 dark:text-gray-100">
                  {{ accountName(row.platform, row.accountId) }}
                </div>
                <div
                  v-if="accountName(row.platform, row.accountId) !== row.accountId"
                  class="text-xs text-gray-500 dark:text-gray-400"
                >
                  {{ row.accountId }}
                </div>
              </div>
              <div v-else class="text-sm text-gray-600 dark:text-gray-400">该平台下所有账户</div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="模型改写" min-width="320">
          <template #default="{ row }">
            <div class="space-y-2 py-1">
              <div class="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/70">
                <div class="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">
                  Source
                </div>
                <div class="mt-1 break-all font-medium text-gray-900 dark:text-gray-100">
                  {{ row.sourceModel }}
                </div>
                <div class="my-2 text-xs uppercase tracking-[0.2em] text-blue-500">to</div>
                <div class="break-all font-medium text-blue-700 dark:text-blue-300">
                  {{ row.targetModel }}
                </div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column align="center" label="优先级" width="100">
          <template #default="{ row }">
            <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ row.priority }}
            </span>
          </template>
        </el-table-column>

        <el-table-column label="更新时间" min-width="180">
          <template #default="{ row }">
            <span class="text-sm text-gray-600 dark:text-gray-400">
              {{ formatDate(row.updatedAt) }}
            </span>
          </template>
        </el-table-column>

        <el-table-column fixed="right" label="操作" width="220">
          <template #default="{ row }">
            <div class="flex flex-wrap gap-2 py-1">
              <button
                class="rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 transition hover:bg-blue-100 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
                @click="openEditDialog(row)"
              >
                编辑
              </button>
              <button
                class="rounded-md bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50"
                @click="toggleRule(row)"
              >
                {{ row.enabled ? '停用' : '启用' }}
              </button>
              <button
                class="rounded-md bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50"
                @click="deleteRule(row)"
              >
                删除
              </button>
            </div>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog
      v-model="dialogVisible"
      destroy-on-close
      :title="editingRuleId ? '编辑转发规则' : '新建转发规则'"
      width="760px"
      @closed="handleDialogClosed"
    >
      <div class="grid gap-4 md:grid-cols-2">
        <div class="md:col-span-2">
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            规则名称
          </p>
          <el-input v-model="form.name" placeholder="例如: OpenAI Responses GPT-5.4 映射" />
        </div>

        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">平台</p>
          <el-select
            v-model="form.platform"
            class="w-full"
            placeholder="请选择平台"
            @change="handleFormPlatformChange"
          >
            <el-option
              v-for="platform in platformOptions"
              :key="platform.value"
              :label="platform.label"
              :value="platform.value"
            />
          </el-select>
          <p class="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {{ selectedPlatformNotice }}
          </p>
        </div>

        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">账户</p>
          <el-select
            v-model="form.accountId"
            class="w-full"
            clearable
            :disabled="!form.platform"
            filterable
            :loading="formAccountLoading"
            :no-data-text="form.platform ? '没有匹配的账户' : '请先选择平台'"
            :placeholder="form.platform ? '搜索账户名或 ID，留空则平台级生效' : '请先选择平台'"
            remote
            :remote-method="searchFormAccounts"
            reserve-keyword
            @visible-change="handleFormAccountVisibleChange"
          >
            <el-option label="平台级规则（该平台下所有账户）" value="" />
            <el-option
              v-for="account in formAccountOptions"
              :key="`${account.platform}:${account.id}`"
              :label="account.label"
              :value="account.id"
            />
          </el-select>
        </div>

        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">源模型</p>
          <el-input v-model="form.sourceModel" placeholder="例如: gpt-5.4" />
        </div>

        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
            目标模型
          </p>
          <el-input v-model="form.targetModel" placeholder="例如: st/OpenAI/gpt-5.4-2026-03-05" />
        </div>

        <div>
          <p class="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">优先级</p>
          <el-input-number v-model="form.priority" class="w-full" :max="100000" :min="0" />
        </div>

        <div class="flex items-end">
          <div
            class="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-800/50"
          >
            <div class="flex items-center justify-between gap-4">
              <div>
                <p class="text-sm font-medium text-gray-900 dark:text-gray-100">启用规则</p>
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  停用后会保留规则，但不会参与匹配。
                </p>
              </div>
              <el-switch v-model="form.enabled" />
            </div>
          </div>
        </div>
      </div>

      <div
        class="mt-5 rounded-lg border border-blue-200 bg-blue-50 px-4 py-4 text-sm text-blue-900 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-200"
      >
        <div class="font-semibold">当前规则说明</div>
        <div class="mt-2 leading-6">
          当前版本仅支持 <code>exact</code> 精确匹配。执行顺序为:
          账户级优先于平台级，随后按优先级和更新时间继续排序。
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-3">
          <el-button @click="dialogVisible = false">取消</el-button>
          <el-button :loading="saving" type="primary" @click="saveRule">保存规则</el-button>
        </div>
      </template>
    </el-dialog>

    <ConfirmModal
      :cancel-text="confirmModalConfig.cancelText"
      :confirm-text="confirmModalConfig.confirmText"
      :message="confirmModalConfig.message"
      :show="showConfirmModal"
      :title="confirmModalConfig.title"
      :type="confirmModalConfig.type"
      @cancel="handleCancelModal"
      @confirm="handleConfirmModal"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import ConfirmModal from '@/components/common/ConfirmModal.vue'
import * as httpApis from '@/utils/http_apis'
import { formatDate, showToast } from '@/utils/tools'

const loading = ref(false)
const saving = ref(false)
const dialogVisible = ref(false)
const editingRuleId = ref('')
const rules = ref([])
const platformOptions = ref([])
const knownAccounts = ref([])
const filterAccountOptions = ref([])
const formAccountOptions = ref([])
const filterAccountLoading = ref(false)
const formAccountLoading = ref(false)
const showConfirmModal = ref(false)
const confirmResolver = ref(null)
const confirmModalConfig = ref({
  title: '',
  message: '',
  type: 'danger',
  confirmText: '确认',
  cancelText: '取消'
})

const filterForm = ref({
  platform: '',
  accountId: '',
  enabled: '',
  keyword: ''
})

const buildEmptyForm = () => ({
  name: '',
  platform: '',
  accountId: '',
  sourceModel: '',
  targetModel: '',
  priority: 100,
  enabled: true
})

const form = ref(buildEmptyForm())

let filterSearchTimer = null
let formSearchTimer = null
let filterRequestId = 0
let formRequestId = 0

const getAccountKey = (platform, accountId) => `${platform || ''}:${accountId || ''}`

const platformMap = computed(() => {
  return new Map(platformOptions.value.map((item) => [item.value, item]))
})

const knownAccountMap = computed(() => {
  return new Map(knownAccounts.value.map((item) => [getAccountKey(item.platform, item.id), item]))
})

const summaryCards = computed(() => {
  const enabledCount = rules.value.filter((item) => item.enabled).length
  const accountScopedCount = rules.value.filter((item) => item.accountId).length
  const platformScopedCount = rules.value.filter((item) => !item.accountId).length

  return [
    {
      label: '规则总数',
      value: rules.value.length,
      description: '包含启用和停用规则',
      icon: 'fas fa-stream',
      iconBg: 'bg-gradient-to-br from-slate-500 to-slate-700'
    },
    {
      label: '启用中',
      value: enabledCount,
      description: '会参与实际模型改写',
      icon: 'fas fa-bolt',
      iconBg: 'bg-gradient-to-br from-emerald-500 to-teal-600'
    },
    {
      label: '账户级',
      value: accountScopedCount,
      description: '仅对指定账户生效',
      icon: 'fas fa-user-lock',
      iconBg: 'bg-gradient-to-br from-amber-500 to-orange-600'
    },
    {
      label: '平台级',
      value: platformScopedCount,
      description: '对平台下全部账户通用',
      icon: 'fas fa-layer-group',
      iconBg: 'bg-gradient-to-br from-blue-500 to-cyan-600'
    }
  ]
})

const selectedPlatformNotice = computed(() => {
  if (!form.value.platform) {
    return '先选择平台，再决定是否限制到某个账户。'
  }

  const platform = platformMap.value.get(form.value.platform)
  if (!platform) {
    return '先选择平台，再决定是否限制到某个账户。'
  }

  return platform.runtimeSupported
    ? `${platform.label} 已接入运行时匹配，规则保存后会直接参与调度。`
    : `${platform.label} 的规则框架已就绪，当前运行时接入仍在逐步扩展。`
})

const mergeKnownAccounts = (accounts = []) => {
  if (!Array.isArray(accounts) || accounts.length === 0) {
    return
  }

  const accountMap = new Map(
    knownAccounts.value.map((item) => [getAccountKey(item.platform, item.id), item])
  )

  accounts.forEach((account) => {
    accountMap.set(getAccountKey(account.platform, account.id), account)
  })

  knownAccounts.value = Array.from(accountMap.values())
}

const findKnownAccount = (platform, accountId) => {
  return knownAccountMap.value.get(getAccountKey(platform, accountId)) || null
}

const buildScopedAccountOptions = (accounts = [], platform = '', selectedAccountId = '') => {
  const scopedMap = new Map(accounts.map((item) => [getAccountKey(item.platform, item.id), item]))

  if (platform && selectedAccountId) {
    const selectedAccount = findKnownAccount(platform, selectedAccountId)
    if (selectedAccount) {
      scopedMap.set(getAccountKey(selectedAccount.platform, selectedAccount.id), selectedAccount)
    }
  }

  return Array.from(scopedMap.values())
}

const applyAccountOptionsResult = (result, targetRef, platform, selectedAccountId = '') => {
  if (!result.success) {
    showToast(result.message || '加载账户选项失败', 'error')
    return false
  }

  const payload = result.data || {}
  if (Array.isArray(payload.platforms) && payload.platforms.length > 0) {
    platformOptions.value = payload.platforms
  }

  const accounts = Array.isArray(payload.accounts) ? payload.accounts : []
  mergeKnownAccounts(accounts)

  if (targetRef) {
    targetRef.value = buildScopedAccountOptions(accounts, platform, selectedAccountId)
  }

  return true
}

const loadInitialAccountOptions = async () => {
  const result = await httpApis.getForwardingRuleAccountOptionsApi()
  applyAccountOptionsResult(result, null, '')
}

const fetchFilterAccountOptions = async (keyword = '') => {
  if (!filterForm.value.platform) {
    filterAccountOptions.value = []
    return
  }

  const requestId = ++filterRequestId
  filterAccountLoading.value = true

  try {
    const result = await httpApis.getForwardingRuleAccountOptionsApi({
      platform: filterForm.value.platform,
      keyword: keyword.trim()
    })

    if (requestId !== filterRequestId) {
      return
    }

    applyAccountOptionsResult(
      result,
      filterAccountOptions,
      filterForm.value.platform,
      filterForm.value.accountId
    )
  } finally {
    if (requestId === filterRequestId) {
      filterAccountLoading.value = false
    }
  }
}

const fetchFormAccountOptions = async (keyword = '') => {
  if (!form.value.platform) {
    formAccountOptions.value = []
    return
  }

  const requestId = ++formRequestId
  formAccountLoading.value = true

  try {
    const result = await httpApis.getForwardingRuleAccountOptionsApi({
      platform: form.value.platform,
      keyword: keyword.trim()
    })

    if (requestId !== formRequestId) {
      return
    }

    applyAccountOptionsResult(result, formAccountOptions, form.value.platform, form.value.accountId)
  } finally {
    if (requestId === formRequestId) {
      formAccountLoading.value = false
    }
  }
}

const loadRules = async () => {
  loading.value = true

  try {
    const params = {}
    if (filterForm.value.platform) params.platform = filterForm.value.platform
    if (filterForm.value.accountId) params.accountId = filterForm.value.accountId
    if (filterForm.value.enabled !== '') params.enabled = filterForm.value.enabled
    if (filterForm.value.keyword.trim()) params.keyword = filterForm.value.keyword.trim()

    const result = await httpApis.getForwardingRulesApi(params)
    if (result.success) {
      rules.value = result.data || []
      return
    }

    showToast(result.message || '加载转发规则失败', 'error')
  } finally {
    loading.value = false
  }
}

const ensurePlatformOptionsLoaded = async () => {
  if (platformOptions.value.length === 0) {
    await loadInitialAccountOptions()
  }
}

const getDefaultPlatform = () => {
  const runtimePlatform = platformOptions.value.find((item) => item.runtimeSupported)
  return runtimePlatform?.value || platformOptions.value[0]?.value || ''
}

const openCreateDialog = async () => {
  await ensurePlatformOptionsLoaded()

  const platform = getDefaultPlatform()
  editingRuleId.value = ''
  form.value = {
    ...buildEmptyForm(),
    platform
  }
  formAccountOptions.value = []
  dialogVisible.value = true

  if (platform) {
    await fetchFormAccountOptions('')
  }
}

const openEditDialog = async (rule) => {
  await ensurePlatformOptionsLoaded()

  editingRuleId.value = rule.id
  form.value = {
    name: rule.name,
    platform: rule.platform,
    accountId: rule.accountId || '',
    sourceModel: rule.sourceModel,
    targetModel: rule.targetModel,
    priority: rule.priority,
    enabled: rule.enabled
  }
  formAccountOptions.value = []
  dialogVisible.value = true

  if (form.value.platform) {
    await fetchFormAccountOptions('')
  }
}

const handleFormPlatformChange = async () => {
  form.value.accountId = ''
  formAccountOptions.value = []
  clearTimeout(formSearchTimer)

  if (form.value.platform) {
    await fetchFormAccountOptions('')
  }
}

const handleFilterPlatformChange = async () => {
  filterForm.value.accountId = ''
  filterAccountOptions.value = []
  clearTimeout(filterSearchTimer)

  if (filterForm.value.platform) {
    await fetchFilterAccountOptions('')
  }
}

const handleFilterAccountVisibleChange = async (visible) => {
  if (visible && filterForm.value.platform && filterAccountOptions.value.length === 0) {
    await fetchFilterAccountOptions('')
  }
}

const handleFormAccountVisibleChange = async (visible) => {
  if (visible && form.value.platform && formAccountOptions.value.length === 0) {
    await fetchFormAccountOptions('')
  }
}

const searchFilterAccounts = (keyword) => {
  if (!filterForm.value.platform) {
    return
  }

  clearTimeout(filterSearchTimer)
  filterSearchTimer = setTimeout(() => {
    fetchFilterAccountOptions(keyword)
  }, 180)
}

const searchFormAccounts = (keyword) => {
  if (!form.value.platform) {
    return
  }

  clearTimeout(formSearchTimer)
  formSearchTimer = setTimeout(() => {
    fetchFormAccountOptions(keyword)
  }, 180)
}

const resetFilters = async () => {
  clearTimeout(filterSearchTimer)
  filterForm.value = {
    platform: '',
    accountId: '',
    enabled: '',
    keyword: ''
  }
  filterAccountOptions.value = []
  await loadRules()
}

const saveRule = async () => {
  if (!form.value.platform) {
    showToast('请选择平台', 'warning')
    return
  }

  if (!form.value.sourceModel.trim()) {
    showToast('请填写源模型', 'warning')
    return
  }

  if (!form.value.targetModel.trim()) {
    showToast('请填写目标模型', 'warning')
    return
  }

  saving.value = true

  try {
    const payload = {
      name: form.value.name.trim(),
      platform: form.value.platform,
      accountId: form.value.accountId || '',
      sourceModel: form.value.sourceModel.trim(),
      targetModel: form.value.targetModel.trim(),
      priority: form.value.priority,
      enabled: form.value.enabled
    }

    const result = editingRuleId.value
      ? await httpApis.updateForwardingRuleApi(editingRuleId.value, payload)
      : await httpApis.createForwardingRuleApi(payload)

    if (!result.success) {
      showToast(result.message || '保存规则失败', 'error')
      return
    }

    showToast(editingRuleId.value ? '规则已更新' : '规则已创建', 'success')
    dialogVisible.value = false
    await loadRules()
  } finally {
    saving.value = false
  }
}

const toggleRule = async (rule) => {
  const result = await httpApis.toggleForwardingRuleApi(rule.id, { enabled: !rule.enabled })
  if (!result.success) {
    showToast(result.message || '切换规则状态失败', 'error')
    return
  }

  showToast(rule.enabled ? '规则已停用' : '规则已启用', 'success')
  await loadRules()
}

const showConfirm = (
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  type = 'danger'
) => {
  return new Promise((resolve) => {
    confirmModalConfig.value = { title, message, confirmText, cancelText, type }
    confirmResolver.value = resolve
    showConfirmModal.value = true
  })
}

const handleConfirmModal = () => {
  showConfirmModal.value = false
  confirmResolver.value?.(true)
  confirmResolver.value = null
}

const handleCancelModal = () => {
  showConfirmModal.value = false
  confirmResolver.value?.(false)
  confirmResolver.value = null
}

const deleteRule = async (rule) => {
  const confirmed = await showConfirm(
    '删除转发规则',
    `确定删除规则“${rule.name}”吗？删除后将不再参与模型转发。`,
    '确认删除',
    '取消',
    'danger'
  )

  if (!confirmed) {
    return
  }

  const result = await httpApis.deleteForwardingRuleApi(rule.id)
  if (!result.success) {
    showToast(result.message || '删除规则失败', 'error')
    return
  }

  showToast('规则已删除', 'success')
  await loadRules()
}

const handleDialogClosed = () => {
  clearTimeout(formSearchTimer)
  formRequestId += 1
  editingRuleId.value = ''
  form.value = buildEmptyForm()
  formAccountOptions.value = []
  formAccountLoading.value = false
}

const platformLabel = (platform) => {
  return platformMap.value.get(platform)?.label || platform
}

const accountName = (platform, accountId) => {
  return findKnownAccount(platform, accountId)?.name || accountId
}

const matchTypeLabel = (matchType) => {
  return matchType === 'exact' ? '精确匹配' : matchType
}

onMounted(async () => {
  await Promise.all([loadInitialAccountOptions(), loadRules()])
})

onUnmounted(() => {
  clearTimeout(filterSearchTimer)
  clearTimeout(formSearchTimer)
})
</script>
