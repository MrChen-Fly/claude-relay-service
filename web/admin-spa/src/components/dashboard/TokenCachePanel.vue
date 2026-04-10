<template>
  <div class="mb-8 space-y-4">
    <div
      class="flex flex-col gap-4 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60 sm:p-5"
    >
      <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div class="space-y-2">
          <div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
              Token Cache
            </h3>
            <p class="text-sm text-gray-500 dark:text-gray-400">
              只看最近命中率、复用次数和没复用的主因。
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
        </div>
      </div>
    </div>

    <div
      v-if="!tokenCacheMetrics.enabled"
      class="card rounded-2xl border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-800/60 dark:text-gray-400"
    >
      当前未启用 Token Cache。启用后这里只展示最关键的复用结果，其余诊断信息都收进折叠区。
    </div>

    <template v-else>
      <TokenCacheSummaryCards />

      <details
        class="group overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm transition-all duration-200 open:shadow-md dark:border-gray-800 dark:bg-gray-900/60"
      >
        <summary
          class="flex cursor-pointer list-none flex-col gap-3 px-4 py-4 marker:hidden sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between"
        >
          <div>
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">高级诊断</p>
            <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
              只有在排查问题时再展开，查看命中来源、主要未复用原因和缓存条目。
            </p>
          </div>

          <div class="flex items-center gap-2 text-xs">
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

        <div
          class="border-t border-gray-100 px-4 pb-4 pt-4 dark:border-gray-800 sm:px-6 sm:pb-6 sm:pt-6"
        >
          <TokenCacheReasonConfigSection />

          <div class="mt-4 border-t border-gray-100 pt-4 dark:border-gray-800">
            <TokenCacheEntriesTable embedded />
          </div>

          <div class="mt-4 flex justify-end border-t border-gray-100 pt-4 dark:border-gray-800">
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
      </details>
    </template>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import TokenCacheEntriesTable from '@/components/dashboard/token-cache/TokenCacheEntriesTable.vue'
import TokenCacheReasonConfigSection from '@/components/dashboard/token-cache/TokenCacheReasonConfigSection.vue'
import TokenCacheSummaryCards from '@/components/dashboard/token-cache/TokenCacheSummaryCards.vue'
import { useDashboardStore } from '@/stores/dashboard'

const dashboardStore = useDashboardStore()
const { tokenCacheClearing, tokenCacheMetrics } = storeToRefs(dashboardStore)
const { clearTokenCache, loadTokenCacheEntries, loadTokenCacheStorageStats } = dashboardStore

const panelRefreshing = ref(false)

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
