<template>
  <div class="space-y-6">
    <div class="glass-card rounded-2xl border border-gray-200/80 p-5 dark:border-gray-700/70">
      <div class="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div class="flex items-center gap-3">
            <div
              class="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-600 to-cyan-500 text-white shadow-lg"
            >
              <i class="fas fa-heartbeat"></i>
            </div>
            <div>
              <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">系统监控</h3>
              <p class="text-sm text-gray-500 dark:text-gray-400">
                查看当前主机、进程与 Redis 的实时状态，无需再登录服务器排查。
              </p>
            </div>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <button
            class="btn bg-gray-100 px-4 py-2 text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
            :class="{ 'cursor-not-allowed opacity-60': loading }"
            :disabled="loading"
            @click="loadSnapshot()"
          >
            <div v-if="loading" class="loading-spinner mr-2"></div>
            <i v-else class="fas fa-sync-alt mr-2"></i>
            {{ loading ? '刷新中...' : '立即刷新' }}
          </button>

          <label
            class="inline-flex items-center gap-3 rounded-full bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-300"
          >
            <input
              v-model="autoRefreshEnabled"
              class="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              type="checkbox"
            />
            自动刷新
          </label>

          <select
            v-model.number="autoRefreshSeconds"
            class="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200"
          >
            <option :value="5">5 秒</option>
            <option :value="10">10 秒</option>
            <option :value="15">15 秒</option>
            <option :value="30">30 秒</option>
          </select>
        </div>
      </div>

      <div
        class="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/80"
      >
        <div class="flex flex-wrap items-center gap-3">
          <span class="status-pill" :class="healthTone.className">
            <span class="h-2 w-2 rounded-full" :class="healthTone.dotClass"></span>
            {{ healthTone.label }}
          </span>
          <span class="text-sm text-gray-500 dark:text-gray-400">
            最近刷新：{{ lastFetchedLabel }}
          </span>
          <span
            v-if="backgroundRefreshing"
            class="inline-flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-200"
          >
            <span class="h-2 w-2 rounded-full bg-sky-500"></span>
            后台同步中
          </span>
        </div>
        <div class="text-sm text-gray-500 dark:text-gray-400">
          {{ host.hostname || 'unknown host' }} · {{ host.platform || '--' }} · Node
          {{ host.nodeVersion || '--' }}
        </div>
      </div>

      <div
        v-if="errorMessage"
        class="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/40 dark:bg-rose-900/10 dark:text-rose-200"
      >
        <div class="flex items-start gap-3">
          <i class="fas fa-exclamation-circle mt-0.5"></i>
          <div>{{ errorMessage }}</div>
        </div>
      </div>
    </div>

    <div v-if="loading && !snapshot" class="py-12 text-center">
      <div class="loading-spinner mx-auto mb-4"></div>
      <p class="text-gray-500 dark:text-gray-400">正在采集系统监控数据...</p>
    </div>

    <div
      v-else-if="!snapshot"
      class="rounded-2xl border border-dashed border-gray-300 px-6 py-12 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400"
    >
      暂无系统监控数据，请点击“立即刷新”重试。
    </div>

    <template v-else>
      <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <article
          v-for="metric in primaryMetrics"
          :key="metric.key"
          class="metric-card rounded-2xl border border-gray-200/80 p-4 dark:border-gray-700/70"
        >
          <div class="flex items-center justify-between gap-3">
            <span class="text-sm font-medium text-gray-600 dark:text-gray-300">
              {{ metric.label }}
            </span>
            <span class="metric-badge" :class="metric.badgeClass">{{ metric.badge }}</span>
          </div>
          <div class="mt-4 text-3xl font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {{ metric.value }}
          </div>
          <div class="mt-2 text-sm text-gray-500 dark:text-gray-400">
            {{ metric.meta }}
          </div>
        </article>
      </div>

      <div class="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <section
          class="glass-card rounded-2xl border border-gray-200/80 p-5 dark:border-gray-700/70"
        >
          <div>
            <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">资源明细</h4>
            <p class="text-sm text-gray-500 dark:text-gray-400">当前主机与进程的关键资源拆解。</p>
          </div>

          <div class="mt-4 space-y-3">
            <div
              v-for="metric in secondaryMetrics"
              :key="metric.key"
              class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/80"
            >
              <div class="flex flex-wrap items-center justify-between gap-3">
                <span class="font-medium text-gray-800 dark:text-gray-100">{{ metric.label }}</span>
                <span class="font-mono text-sm text-gray-500 dark:text-gray-300">
                  {{ metric.value }}
                </span>
              </div>
              <div class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {{ metric.meta }}
              </div>
            </div>
          </div>
        </section>

        <section
          class="glass-card rounded-2xl border border-gray-200/80 p-5 dark:border-gray-700/70"
        >
          <div>
            <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">运行环境</h4>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              便于快速确认当前采样来自哪台主机和运行时。
            </p>
          </div>

          <div class="mt-4 space-y-3">
            <div
              v-for="item in environmentMetrics"
              :key="item.key"
              class="flex items-center justify-between rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/80"
            >
              <span class="text-sm text-gray-500 dark:text-gray-400">{{ item.label }}</span>
              <span class="font-mono text-sm text-gray-800 dark:text-gray-100">{{
                item.value
              }}</span>
            </div>
          </div>

          <div
            v-if="warnings.length"
            class="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 dark:border-amber-900/40 dark:bg-amber-900/10"
          >
            <div
              class="flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-200"
            >
              <i class="fas fa-exclamation-triangle"></i>
              采集告警
            </div>
            <ul class="mt-3 space-y-2 text-sm text-amber-700 dark:text-amber-100">
              <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
            </ul>
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatDateTime } from '@/utils/tools'
import * as httpApis from '@/utils/http_apis'
import {
  buildEnvironmentMetrics,
  buildPrimaryMetrics,
  buildSecondaryMetrics,
  createHealthTone
} from '@/components/settings/system-monitor/systemMonitorUi'

const loading = ref(false)
const backgroundRefreshing = ref(false)
const autoRefreshEnabled = ref(true)
const autoRefreshSeconds = ref(10)
const snapshot = ref(null)
const errorMessage = ref('')
const lastFetchedAt = ref('')
let autoRefreshTimer = null

const host = computed(() => snapshot.value?.host || {})
const cpu = computed(() => snapshot.value?.cpu || {})
const memory = computed(() => snapshot.value?.memory || {})
const processMetrics = computed(() => snapshot.value?.process || {})
const network = computed(() => snapshot.value?.network || {})
const redis = computed(() => snapshot.value?.redis || {})
const warnings = computed(() => snapshot.value?.warnings || [])

const lastFetchedLabel = computed(() => {
  if (!lastFetchedAt.value) {
    return '尚未刷新'
  }
  return formatDateTime(lastFetchedAt.value)
})

const healthTone = computed(() =>
  createHealthTone({
    warnings: warnings.value,
    redis: redis.value,
    cpu: cpu.value,
    memory: memory.value
  })
)

const primaryMetrics = computed(() =>
  buildPrimaryMetrics({
    cpu: cpu.value,
    memory: memory.value,
    processMetrics: processMetrics.value,
    network: network.value,
    redis: redis.value,
    host: host.value,
    lastFetchedLabel: lastFetchedLabel.value
  })
)

const secondaryMetrics = computed(() =>
  buildSecondaryMetrics({
    network: network.value,
    processMetrics: processMetrics.value,
    memory: memory.value,
    redis: redis.value
  })
)

const environmentMetrics = computed(() =>
  buildEnvironmentMetrics({
    host: host.value,
    redis: redis.value
  })
)

const stopAutoRefresh = () => {
  if (autoRefreshTimer) {
    window.clearInterval(autoRefreshTimer)
    autoRefreshTimer = null
  }
}

const startAutoRefresh = () => {
  stopAutoRefresh()
  if (!autoRefreshEnabled.value) {
    return
  }

  autoRefreshTimer = window.setInterval(() => {
    if (document.hidden) {
      return
    }
    loadSnapshot({ silent: true })
  }, autoRefreshSeconds.value * 1000)
}

const loadSnapshot = async (options = {}) => {
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
    const response = await httpApis.getSystemMonitorApi()
    if (response.success) {
      snapshot.value = response.data
      errorMessage.value = ''
      lastFetchedAt.value = response.data?.timestamp || new Date().toISOString()
      return
    }

    errorMessage.value = response.message || '系统监控数据加载失败'
  } catch (error) {
    errorMessage.value = error.message || '系统监控数据加载失败'
  } finally {
    if (silent) {
      backgroundRefreshing.value = false
    } else {
      loading.value = false
    }
  }
}

onMounted(() => {
  loadSnapshot()
  startAutoRefresh()
})

onBeforeUnmount(() => {
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

.metric-card {
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(248, 250, 252, 0.92));
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.05);
}

:root.dark .metric-card {
  background: linear-gradient(180deg, rgba(17, 24, 39, 0.98), rgba(15, 23, 42, 0.9));
}

.metric-badge {
  @apply inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold;
}

.status-pill {
  @apply inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold;
}

.btn {
  @apply inline-flex items-center justify-center rounded-xl text-sm font-semibold transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2;
}

.loading-spinner {
  @apply h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600;
}
</style>
