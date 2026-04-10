<template>
  <div class="mb-8 space-y-6">
    <div
      class="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
    >
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <span
              class="inline-flex items-center rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 dark:bg-sky-900/30 dark:text-sky-300"
            >
              请求缓存
            </span>
            <span
              class="inline-flex items-center rounded-full px-3 py-1 text-xs font-medium"
              :class="
                tokenCacheMetrics.enabled
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              "
            >
              {{ tokenCacheModeShortLabel }}
            </span>
            <span
              class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              近 {{ windowLabel }}
            </span>
          </div>
          <div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              Token Cache 总览
            </h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              只保留关键结果，重点看有没有复用、命中来自哪里，以及为什么没有复用。
            </p>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500"
            :disabled="panelRefreshing || tokenCacheClearing"
            @click="handleRefreshPanel"
          >
            <i :class="['fas', panelRefreshing ? 'fa-spinner fa-spin' : 'fa-rotate-right']" />
            刷新面板
          </button>
          <button
            class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 shadow-sm transition-all duration-200 hover:border-red-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300"
            :disabled="panelRefreshing || tokenCacheClearing"
            @click="handleClearTokenCache"
          >
            <i :class="['fas', tokenCacheClearing ? 'fa-spinner fa-spin' : 'fa-trash-can']" />
            清空缓存
          </button>
        </div>
      </div>

      <div
        class="grid grid-cols-1 gap-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-2 xl:grid-cols-4"
      >
        <div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/70">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            复用模式
          </p>
          <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ tokenCacheModeLabel }}
          </p>
        </div>
        <div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/70">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            语义策略
          </p>
          <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ tokenCacheInputStrategy }}
          </p>
        </div>
        <div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/70">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            工具结果
          </p>
          <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ tokenCacheMetrics.config.toolResultEnabled ? '开启' : '关闭' }}
          </p>
        </div>
        <div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/70">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            存储规模
          </p>
          <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ storageSummary }}
          </p>
        </div>
      </div>
    </div>

    <div
      v-if="!tokenCacheMetrics.enabled"
      class="card rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400"
    >
      当前未启用缓存复用。启用后即可在这里查看命中率、语义复用和工具结果复用情况。
    </div>

    <template v-else>
      <TokenCacheSummaryCards />
      <TokenCacheReasonConfigSection />

      <details
        class="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 open:shadow-md dark:border-gray-800 dark:bg-gray-900/60"
      >
        <summary
          class="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 marker:hidden sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between"
        >
          <div>
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">缓存条目与手动清理</p>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              低频诊断区。只在需要定位异常缓存键、核对 TTL 或手动删除条目时展开。
            </p>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span
              class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
            >
              已加载 {{ formatNumber(tokenCacheEntries.length) }} 条
            </span>
            <span
              class="inline-flex items-center rounded-full px-3 py-1 font-medium"
              :class="
                tokenCacheEntriesLoading || panelRefreshing
                  ? 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'
              "
            >
              {{
                tokenCacheEntriesLoading || panelRefreshing
                  ? '同步中'
                  : tokenCacheEntriesPagination.hasMore
                    ? '还有更多'
                    : '已同步'
              }}
            </span>
            <span
              class="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1 font-medium text-gray-600 transition-colors group-open:bg-sky-50 group-open:text-sky-700 dark:bg-gray-800 dark:text-gray-300 dark:group-open:bg-sky-900/30 dark:group-open:text-sky-300"
            >
              展开查看
              <i
                class="fas fa-chevron-down text-[10px] transition-transform duration-200 group-open:rotate-180"
              />
            </span>
          </div>
        </summary>

        <div class="border-t border-gray-100 px-4 pb-4 dark:border-gray-800 sm:px-6 sm:pb-6">
          <TokenCacheEntriesTable embedded />
        </div>
      </details>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'

import TokenCacheEntriesTable from '@/components/dashboard/token-cache/TokenCacheEntriesTable.vue'
import TokenCacheReasonConfigSection from '@/components/dashboard/token-cache/TokenCacheReasonConfigSection.vue'
import TokenCacheSummaryCards from '@/components/dashboard/token-cache/TokenCacheSummaryCards.vue'
import {
  formatTokenCacheInputStrategy,
  formatTokenCacheModeLabel,
  formatTokenCacheModeShortLabel
} from '@/components/dashboard/token-cache/tokenCacheUi'
import { useDashboardStore } from '@/stores/dashboard'
import { formatNumber } from '@/utils/tools'

const dashboardStore = useDashboardStore()
const {
  tokenCacheClearing,
  tokenCacheEntries,
  tokenCacheEntriesLoading,
  tokenCacheEntriesPagination,
  tokenCacheMetrics,
  tokenCacheStorageStats
} = storeToRefs(dashboardStore)
const { clearTokenCache, loadTokenCacheEntries, loadTokenCacheStorageStats } = dashboardStore

const panelRefreshing = ref(false)

const tokenCacheModeLabel = computed(() =>
  formatTokenCacheModeLabel(tokenCacheMetrics.value?.config)
)
const tokenCacheModeShortLabel = computed(() =>
  formatTokenCacheModeShortLabel(tokenCacheMetrics.value?.config)
)
const tokenCacheInputStrategy = computed(() =>
  formatTokenCacheInputStrategy(tokenCacheMetrics.value?.config?.embedInputStrategy)
)
const windowLabel = computed(() => `${tokenCacheMetrics.value?.windowMinutes || 60} 分钟`)
const storageSummary = computed(() => {
  const storage = tokenCacheStorageStats.value || {}
  const totalKeys = Number(storage.totalKeys) || 0
  const entryCount = Number(storage.entryCount) || 0

  if (totalKeys <= 0 && entryCount <= 0) {
    return '暂无数据'
  }

  return `${formatNumber(totalKeys)} 键 / ${formatNumber(entryCount)} 响应`
})

const handleRefreshPanel = async () => {
  if (panelRefreshing.value) {
    return
  }

  panelRefreshing.value = true
  try {
    await Promise.all([loadTokenCacheStorageStats(), loadTokenCacheEntries({ reset: true })])
  } finally {
    panelRefreshing.value = false
  }
}

const handleClearTokenCache = async () => {
  if (tokenCacheClearing.value) {
    return
  }

  if (!window.confirm('确认清空当前缓存吗？这会删除精确、语义和工具结果缓存。')) {
    return
  }

  const cleared = await clearTokenCache()
  if (cleared) {
    await handleRefreshPanel()
  }
}
</script>
