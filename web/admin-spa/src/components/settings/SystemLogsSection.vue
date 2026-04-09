<template>
  <div class="space-y-6">
    <div class="glass-card rounded-2xl border border-gray-200/80 p-5 dark:border-gray-700/70">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div class="flex items-center gap-3">
            <div
              class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-600 text-white shadow-lg"
            >
              <i class="fas fa-file-alt"></i>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">系统日志</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                查看最近系统运行日志，支持按文件、级别和关键词筛选。
              </p>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            class="btn bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            :class="{ 'cursor-not-allowed opacity-60': downloading || !filters.file }"
            :disabled="downloading || !filters.file"
            @click="downloadCurrentLog"
          >
            <i class="fas fa-download mr-2"></i>
            {{ downloading ? '下载中...' : '下载当前日志' }}
          </button>

          <button
            class="btn btn-primary px-4 py-2"
            :class="{ 'cursor-not-allowed opacity-60': loading }"
            :disabled="loading"
            @click="loadLogs()"
          >
            <div v-if="loading" class="loading-spinner mr-2"></div>
            <i v-else class="fas fa-sync-alt mr-2"></i>
            {{ loading ? '刷新中...' : '刷新日志' }}
          </button>
        </div>
      </div>

      <div
        class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/80"
      >
        <div class="flex flex-wrap items-center gap-3">
          <label class="inline-flex items-center gap-3 text-sm text-gray-700 dark:text-gray-300">
            <input
              v-model="autoRefreshEnabled"
              class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              type="checkbox"
            />
            自动轮询
          </label>

          <div v-if="autoRefreshEnabled" class="flex items-center gap-2 text-sm">
            <span class="text-gray-500 dark:text-gray-400">间隔</span>
            <select
              v-model.number="autoRefreshSeconds"
              class="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            >
              <option :value="10">10 秒</option>
              <option :value="15">15 秒</option>
              <option :value="30">30 秒</option>
              <option :value="60">60 秒</option>
            </select>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
          <span>最近刷新：{{ lastFetchedLabel }}</span>
          <span
            v-if="backgroundRefreshing"
            class="inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"
          >
            <span class="h-2 w-2 rounded-full bg-emerald-500"></span>
            自动同步中
          </span>
        </div>
      </div>

      <div class="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.6fr)_180px_160px_auto]">
        <label class="space-y-2">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">日志文件</span>
          <select
            v-model="filters.file"
            class="form-input dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            @change="loadLogs()"
          >
            <option v-for="file in files" :key="file.name" :value="file.name">
              {{ getFileLabel(file) }}
            </option>
          </select>
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">日志级别</span>
          <select
            v-model="filters.level"
            class="form-input dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            @change="loadLogs()"
          >
            <option v-for="level in availableLevels" :key="level" :value="level">
              {{ getLevelFilterLabel(level) }}
            </option>
          </select>
        </label>

        <label class="space-y-2">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">最近条数</span>
          <select
            v-model.number="filters.limit"
            class="form-input dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
            @change="loadLogs()"
          >
            <option :value="50">50 条</option>
            <option :value="120">120 条</option>
            <option :value="200">200 条</option>
            <option :value="300">300 条</option>
          </select>
        </label>

        <div class="space-y-2">
          <span class="text-sm font-medium text-gray-700 dark:text-gray-300">关键词</span>
          <div class="flex gap-2">
            <input
              v-model.trim="filters.search"
              class="form-input dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
              placeholder="例如 error / cache / 账号名"
              type="text"
              @keydown.enter.prevent="loadLogs()"
            />
            <button
              class="btn bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
              @click="loadLogs()"
            >
              查询
            </button>
          </div>
        </div>
      </div>

      <div class="mt-5 grid gap-4 md:grid-cols-3">
        <div class="rounded-2xl bg-slate-50 p-4 dark:bg-gray-800/70">
          <div class="text-xs font-medium uppercase tracking-[0.24em] text-slate-500">文件</div>
          <div class="mt-2 text-base font-semibold text-gray-900 dark:text-gray-100">
            {{ selectedFileMeta?.name || '未找到日志文件' }}
          </div>
          <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {{
              selectedFileMeta
                ? `${formatSize(selectedFileMeta.size)} · ${formatDateTime(selectedFileMeta.updatedAt)}`
                : '当前 logs 目录下没有可展示日志。'
            }}
          </div>
        </div>

        <div class="rounded-2xl bg-amber-50 p-4 dark:bg-amber-900/10">
          <div class="text-xs font-medium uppercase tracking-[0.24em] text-amber-600">当前结果</div>
          <div class="mt-2 text-3xl font-semibold text-gray-900 dark:text-gray-100">
            {{ filteredEntries }}
          </div>
          <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            总行数 {{ totalEntries }}，当前返回 {{ entries.length }}。
            <span v-if="hasMore">还有更多匹配结果未加载。</span>
          </div>
        </div>

        <div class="rounded-2xl bg-rose-50 p-4 dark:bg-rose-900/10">
          <div class="text-xs font-medium uppercase tracking-[0.24em] text-rose-600">高优先级</div>
          <div class="mt-2 flex items-end gap-4">
            <div>
              <div class="text-3xl font-semibold text-gray-900 dark:text-gray-100">
                {{ errorCount }}
              </div>
              <div class="text-sm text-gray-500 dark:text-gray-400">errors</div>
            </div>
            <div>
              <div class="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                {{ warnCount }}
              </div>
              <div class="text-sm text-gray-500 dark:text-gray-400">warnings</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-if="summary.sampleSize" class="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <section class="glass-card rounded-2xl border border-gray-200/80 p-5 dark:border-gray-700/70">
        <div class="flex items-center justify-between gap-4">
          <div>
            <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">错误聚合摘要</h4>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              基于当前筛选结果的最近 {{ summary.sampleSize }} 条日志聚合。
            </p>
          </div>
        </div>

        <div v-if="summary.topMessages.length" class="mt-4 space-y-3">
          <article
            v-for="message in summary.topMessages"
            :key="`${message.level}:${message.message}`"
            class="rounded-2xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-700 dark:bg-gray-800/80"
          >
            <div class="flex flex-wrap items-center gap-3">
              <span
                class="inline-flex min-w-[76px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
                :class="getLevelClass(message.level)"
              >
                {{ message.level }}
              </span>
              <span class="text-xs text-gray-500 dark:text-gray-400"
                >出现 {{ message.count }} 次</span
              >
            </div>
            <p class="mt-2 text-sm leading-6 text-gray-800 dark:text-gray-100">
              {{ message.message }}
            </p>
          </article>
        </div>

        <div
          v-else
          class="mt-4 rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          当前筛选结果中没有 error / warning 聚合项。
        </div>
      </section>

      <section class="glass-card rounded-2xl border border-gray-200/80 p-5 dark:border-gray-700/70">
        <div>
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">类型热点</h4>
          <p class="text-sm text-gray-500 dark:text-gray-400">
            便于快速判断当前日志更偏向请求、启动还是安全事件。
          </p>
        </div>

        <div v-if="summary.topTypes.length" class="mt-4 space-y-3">
          <div
            v-for="item in summary.topTypes"
            :key="item.type"
            class="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/80"
          >
            <span class="font-mono text-sm text-gray-800 dark:text-gray-100">{{ item.type }}</span>
            <span
              class="inline-flex items-center rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white dark:bg-slate-100 dark:text-slate-900"
            >
              {{ item.count }}
            </span>
          </div>
        </div>

        <div
          v-else
          class="mt-4 rounded-2xl border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
        >
          当前筛选结果中没有可聚合的日志类型。
        </div>
      </section>
    </div>

    <div v-if="loading && !entries.length" class="py-12 text-center">
      <div class="loading-spinner mx-auto mb-4"></div>
      <p class="text-gray-500 dark:text-gray-400">正在加载系统日志...</p>
    </div>

    <div
      v-else-if="!files.length"
      class="rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
    >
      当前 `logs/` 目录下没有可展示的系统日志文件。
    </div>

    <div
      v-else-if="!entries.length"
      class="rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
    >
      当前筛选条件下没有匹配日志。
    </div>

    <div v-else class="space-y-3">
      <article
        v-for="entry in entries"
        :key="entry.id"
        class="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800/80"
      >
        <div class="flex flex-col gap-4 p-4 lg:flex-row lg:items-start">
          <div class="flex items-center gap-3">
            <span
              class="inline-flex min-w-[76px] items-center justify-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
              :class="getLevelClass(entry.level)"
            >
              {{ entry.level || 'info' }}
            </span>
          </div>

          <div class="min-w-0 flex-1">
            <div
              class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500 dark:text-gray-400"
            >
              <span>{{ formatDateTime(entry.timestamp) }}</span>
              <span>行 {{ entry.lineNumber }}</span>
              <span v-if="entry.metadata?.type">type: {{ entry.metadata.type }}</span>
            </div>
            <pre
              class="mt-2 whitespace-pre-wrap break-words rounded-xl bg-gray-50 px-4 py-3 font-mono text-sm leading-6 text-gray-800 dark:bg-gray-900/70 dark:text-gray-100"
              >{{ entry.message }}</pre
            >
          </div>
        </div>

        <details
          v-if="hasDetails(entry)"
          class="border-t border-gray-100 bg-gray-50/70 dark:border-gray-700 dark:bg-gray-900/40"
        >
          <summary
            class="cursor-pointer select-none px-4 py-3 text-sm font-medium text-gray-700 dark:text-gray-300"
          >
            查看详情
          </summary>
          <pre
            class="overflow-x-auto px-4 pb-4 font-mono text-xs leading-6 text-gray-700 dark:text-gray-300"
            >{{ formatEntryDetails(entry) }}</pre
          >
        </details>
      </article>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { APP_CONFIG, formatBytes, formatDateTime, showToast } from '@/utils/tools'
import * as httpApis from '@/utils/http_apis'

const isMounted = ref(true)
const loading = ref(false)
const backgroundRefreshing = ref(false)
const downloading = ref(false)
const autoRefreshEnabled = ref(true)
const autoRefreshSeconds = ref(15)
const lastFetchedAt = ref('')
const payload = ref({
  files: [],
  selectedFile: null,
  selectedFileMeta: null,
  entries: [],
  totalEntries: 0,
  filteredEntries: 0,
  hasMore: false,
  summary: {
    sampleSize: 0,
    levelCounts: { error: 0, warn: 0, info: 0, debug: 0 },
    topMessages: [],
    topTypes: []
  },
  availableLevels: ['all', 'error', 'warn', 'info', 'debug']
})
let autoRefreshTimer = null

const filters = ref({
  file: '',
  level: 'all',
  search: '',
  limit: 120
})

const files = computed(() => payload.value.files || [])
const entries = computed(() => payload.value.entries || [])
const availableLevels = computed(
  () => payload.value.availableLevels || ['all', 'error', 'warn', 'info', 'debug']
)
const selectedFileMeta = computed(() => {
  return (
    files.value.find((file) => file.name === filters.value.file) ||
    payload.value.selectedFileMeta ||
    null
  )
})
const totalEntries = computed(() => payload.value.totalEntries || 0)
const filteredEntries = computed(() => payload.value.filteredEntries || 0)
const hasMore = computed(() => payload.value.hasMore === true)
const summary = computed(
  () =>
    payload.value.summary || {
      sampleSize: 0,
      levelCounts: { error: 0, warn: 0, info: 0, debug: 0 },
      topMessages: [],
      topTypes: []
    }
)
const errorCount = computed(() => summary.value.levelCounts?.error || 0)
const warnCount = computed(() => summary.value.levelCounts?.warn || 0)
const lastFetchedLabel = computed(() => {
  if (!lastFetchedAt.value) {
    return '尚未刷新'
  }
  return formatDateTime(lastFetchedAt.value)
})

const stopAutoRefresh = () => {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
}

const startAutoRefresh = () => {
  stopAutoRefresh()
  if (!isMounted.value || !autoRefreshEnabled.value) {
    return
  }

  autoRefreshTimer = window.setInterval(() => {
    if (!isMounted.value || document.hidden) {
      return
    }
    loadLogs({ silent: true })
  }, autoRefreshSeconds.value * 1000)
}

const loadLogs = async (options = {}) => {
  if (!isMounted.value) return

  const silent = options.silent === true
  if ((silent && backgroundRefreshing.value) || (!silent && loading.value)) {
    return
  }

  if (silent) {
    backgroundRefreshing.value = true
  } else {
    loading.value = true
  }
  try {
    const response = await httpApis.getSystemLogsApi({
      file: filters.value.file || undefined,
      level: filters.value.level || 'all',
      search: filters.value.search || undefined,
      limit: filters.value.limit
    })

    if (!isMounted.value) return

    if (response.success) {
      payload.value = response.data || payload.value
      filters.value.file = response.data?.selectedFile || ''
      filters.value.level = response.data?.filters?.level || filters.value.level
      filters.value.search = response.data?.filters?.search || filters.value.search
      filters.value.limit = response.data?.filters?.limit || filters.value.limit
      lastFetchedAt.value = new Date().toISOString()
      return
    }

    showToast(response.message || '加载系统日志失败', 'error')
  } catch (error) {
    if (!isMounted.value) return
    showToast('加载系统日志失败', 'error')
  } finally {
    if (isMounted.value) {
      if (silent) {
        backgroundRefreshing.value = false
      } else {
        loading.value = false
      }
    }
  }
}

const downloadCurrentLog = async () => {
  if (!filters.value.file || downloading.value) return

  downloading.value = true
  try {
    const token = localStorage.getItem('authToken')
    const query = new URLSearchParams({ file: filters.value.file })
    const response = await fetch(`${APP_CONFIG.apiPrefix}/admin/system-logs/download?${query}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    })

    if (!response.ok) {
      throw new Error(`下载失败: ${response.status}`)
    }

    const blob = await response.blob()
    const downloadUrl = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = downloadUrl
    link.download = parseDownloadFileName(response.headers.get('content-disposition'))
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(downloadUrl)
    showToast(`已下载 ${link.download}`, 'success')
  } catch (error) {
    showToast(error.message || '下载系统日志失败', 'error')
  } finally {
    downloading.value = false
  }
}

const parseDownloadFileName = (contentDisposition) => {
  const matched = contentDisposition?.match(/filename="?([^"]+)"?/)
  return matched?.[1] || filters.value.file || 'system-log.log'
}

const getLevelFilterLabel = (level) => {
  const labels = {
    all: '全部级别',
    error: '仅错误',
    warn: '仅警告',
    info: '信息',
    debug: '调试'
  }
  return labels[level] || level
}

const getFileLabel = (file) => {
  const kindLabels = {
    application: '主日志',
    error: '错误日志',
    security: '安全日志',
    exceptions: '异常日志',
    rejections: '拒绝日志'
  }
  return `${kindLabels[file.kind] || '日志'} · ${file.name}`
}

const getLevelClass = (level) => {
  const classes = {
    error: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
    warn: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
    info: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200',
    debug: 'bg-slate-100 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200'
  }
  return classes[level] || classes.info
}

const formatSize = (bytes) => {
  if (!Number.isFinite(bytes)) return '-'
  return formatBytes(bytes, bytes < 1024 * 1024 ? 1 : 2)
}

const hasDetails = (entry) => {
  return Boolean(Object.keys(entry.metadata || {}).length)
}

const formatEntryDetails = (entry) => {
  return JSON.stringify(entry.metadata || {}, null, 2)
}

onMounted(() => {
  loadLogs()
  startAutoRefresh()
})

onBeforeUnmount(() => {
  isMounted.value = false
  stopAutoRefresh()
})

watch([autoRefreshEnabled, autoRefreshSeconds], () => {
  startAutoRefresh()
})
</script>

<style scoped>
.glass-card {
  background: white;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08);
}

:root.dark .glass-card {
  background: linear-gradient(180deg, rgba(17, 24, 39, 0.96), rgba(15, 23, 42, 0.92));
}

.form-input {
  @apply w-full rounded-xl border border-gray-300 px-4 py-2.5 text-sm transition-all duration-200 focus:border-transparent focus:ring-2 focus:ring-blue-500;
}

.btn {
  @apply inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
}

.btn-primary {
  @apply bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500;
}

.loading-spinner {
  @apply h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600;
}
</style>
