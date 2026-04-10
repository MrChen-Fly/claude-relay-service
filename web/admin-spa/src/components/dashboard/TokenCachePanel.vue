<template>
  <div class="mb-8">
    <div
      class="mb-4 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
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
              class="inline-flex items-center rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
            >
              {{ tokenCacheModeShortLabel }}
            </span>
          </div>
          <div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              缓存复用概览
            </h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              参考 prompt-cache 重做。纯文本走语义复用，工具请求走精确命中和工具结果复用。
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

      <div class="grid grid-cols-1 gap-2 text-xs text-gray-500 dark:text-gray-400 sm:grid-cols-3">
        <div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/70">
          <span class="font-medium text-gray-700 dark:text-gray-200">复用模式：</span>
          {{ tokenCacheModeLabel }}
        </div>
        <div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/70">
          <span class="font-medium text-gray-700 dark:text-gray-200">语义模型：</span>
          {{ tokenCacheMetrics.config.embedModel || '未设置' }}
        </div>
        <div class="rounded-xl bg-gray-50 px-3 py-2 dark:bg-gray-800/70">
          <span class="font-medium text-gray-700 dark:text-gray-200">工具缓存：</span>
          {{ tokenCacheMetrics.config.toolResultEnabled ? '开启' : '关闭' }}
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
      <TokenCacheEntriesTable />
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
  formatTokenCacheModeLabel,
  formatTokenCacheModeShortLabel
} from '@/components/dashboard/token-cache/tokenCacheUi'
import { useDashboardStore } from '@/stores/dashboard'

const dashboardStore = useDashboardStore()
const { tokenCacheClearing, tokenCacheMetrics } = storeToRefs(dashboardStore)
const { clearTokenCache, loadTokenCacheEntries, loadTokenCacheStorageStats } = dashboardStore

const panelRefreshing = ref(false)

const tokenCacheModeLabel = computed(() =>
  formatTokenCacheModeLabel(tokenCacheMetrics.value?.config)
)
const tokenCacheModeShortLabel = computed(() =>
  formatTokenCacheModeShortLabel(tokenCacheMetrics.value?.config)
)

const handleRefreshPanel = async () => {
  if (panelRefreshing.value) {
    return
  }

  panelRefreshing.value = true
  try {
    await Promise.all([loadTokenCacheEntries({ reset: true }), loadTokenCacheStorageStats()])
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
