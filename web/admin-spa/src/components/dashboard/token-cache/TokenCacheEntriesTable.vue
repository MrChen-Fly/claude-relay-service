<template>
  <div class="card mt-6 p-4 sm:p-6">
    <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
          缓存条目
        </h4>
        <p class="text-sm text-gray-500 dark:text-gray-400">
          这里展示缓存存储中的响应条目，可直接定位并删除异常缓存键。
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <span class="text-xs text-gray-500 dark:text-gray-400">
          已加载 {{ formatNumber(tokenCacheEntries.length) }} 条
        </span>
        <button
          class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500"
          :disabled="entriesRefreshing || tokenCacheEntriesLoading || tokenCacheEntriesLoadingMore"
          @click="handleRefreshEntries"
        >
          <i
            :class="[
              'fas',
              entriesRefreshing || tokenCacheEntriesLoading
                ? 'fa-spinner fa-spin'
                : 'fa-rotate-right'
            ]"
          />
          刷新条目
        </button>
      </div>
    </div>

    <div
      v-if="tokenCacheEntriesError"
      class="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300"
    >
      {{ tokenCacheEntriesError }}
    </div>

    <div
      v-if="tokenCacheEntriesLoading && tokenCacheEntries.length === 0"
      class="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
    >
      正在加载缓存条目…
    </div>

    <div
      v-else-if="tokenCacheEntries.length === 0"
      class="rounded-xl bg-gray-50 px-4 py-8 text-center text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
    >
      当前没有可展示的缓存条目。
    </div>

    <div v-else>
      <div class="overflow-x-auto">
        <table class="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
          <thead>
            <tr class="text-left text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
              <th class="pb-3 pr-4 font-semibold">缓存键</th>
              <th class="px-4 pb-3 font-semibold">状态码</th>
              <th class="px-4 pb-3 font-semibold">写入时间</th>
              <th class="px-4 pb-3 font-semibold">剩余时长</th>
              <th class="pb-3 pl-4 text-right font-semibold">操作</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-100 dark:divide-gray-800">
            <tr v-for="entry in tokenCacheEntries" :key="entry.key">
              <td class="py-3 pr-4 align-top">
                <div class="max-w-[420px]">
                  <code
                    class="block truncate text-xs font-medium text-gray-900 dark:text-gray-100"
                    :title="entry.key"
                  >
                    {{ entry.key }}
                  </code>
                </div>
              </td>
              <td class="px-4 py-3 align-top">
                <span
                  class="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold"
                  :class="getTokenCacheStatusBadgeClass(entry.statusCode)"
                >
                  {{ entry.statusCode }}
                </span>
              </td>
              <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                {{ formatTokenCacheEntryTime(entry.createdAt) }}
              </td>
              <td class="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                {{ formatTokenCacheEntryTtl(entry.ttlSeconds, entry.createdAt) }}
              </td>
              <td class="py-3 pl-4 text-right align-top">
                <button
                  class="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 transition-all duration-200 hover:border-red-300 disabled:cursor-not-allowed disabled:opacity-50 dark:border-red-900/60 dark:bg-red-900/20 dark:text-red-300"
                  :disabled="tokenCacheEntriesDeletingKey === entry.key"
                  @click="handleDeleteTokenCacheEntry(entry.key)"
                >
                  <i
                    :class="[
                      'fas',
                      tokenCacheEntriesDeletingKey === entry.key
                        ? 'fa-spinner fa-spin'
                        : 'fa-trash-can'
                    ]"
                  />
                  删除
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p class="text-xs text-gray-500 dark:text-gray-400">
          {{
            tokenCacheEntriesPagination.hasMore
              ? '还有更多条目，按需继续加载。'
              : '已展示当前可用条目。'
          }}
        </p>
        <button
          v-if="tokenCacheEntriesPagination.hasMore"
          class="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500"
          :disabled="tokenCacheEntriesLoadingMore"
          @click="loadMoreTokenCacheEntries"
        >
          <i
            :class="['fas', tokenCacheEntriesLoadingMore ? 'fa-spinner fa-spin' : 'fa-arrow-down']"
          />
          加载更多
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { storeToRefs } from 'pinia'

import { useDashboardStore } from '@/stores/dashboard'
import { formatNumber } from '@/utils/tools'

const dashboardStore = useDashboardStore()
const {
  tokenCacheEntries,
  tokenCacheEntriesLoading,
  tokenCacheEntriesLoadingMore,
  tokenCacheEntriesDeletingKey,
  tokenCacheEntriesError,
  tokenCacheEntriesPagination
} = storeToRefs(dashboardStore)

const {
  loadTokenCacheEntries,
  loadTokenCacheStorageStats,
  loadMoreTokenCacheEntries,
  deleteTokenCacheEntry
} = dashboardStore

const entriesRefreshing = ref(false)

const handleRefreshEntries = async () => {
  if (entriesRefreshing.value) {
    return
  }

  entriesRefreshing.value = true
  try {
    await Promise.all([loadTokenCacheEntries({ reset: true }), loadTokenCacheStorageStats()])
  } finally {
    entriesRefreshing.value = false
  }
}

const handleDeleteTokenCacheEntry = async (key) => {
  const normalizedKey = String(key || '').trim()
  if (!normalizedKey || tokenCacheEntriesDeletingKey.value) {
    return
  }

  if (!window.confirm(`确认删除缓存条目 ${normalizedKey} 吗？`)) {
    return
  }

  await deleteTokenCacheEntry(normalizedKey)
}

const formatTokenCacheEntryTime = (timestamp) => {
  const value = Number(timestamp) || 0
  if (value <= 0) return '未知'

  return new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatTokenCacheEntryTtl = (ttlSeconds, createdAt) => {
  const ttl = Number(ttlSeconds) || 0
  if (ttl <= 0) return '无过期时间'

  const created = Number(createdAt) || 0
  const remainingMs = created > 0 ? created + ttl * 1000 - Date.now() : ttl * 1000
  if (remainingMs <= 0) return '已过期'

  const remainingSeconds = Math.ceil(remainingMs / 1000)
  if (remainingSeconds >= 86400) {
    return `${(remainingSeconds / 86400).toFixed(remainingSeconds % 86400 === 0 ? 0 : 1)} 天`
  }
  if (remainingSeconds >= 3600) {
    return `${(remainingSeconds / 3600).toFixed(remainingSeconds % 3600 === 0 ? 0 : 1)} 小时`
  }
  if (remainingSeconds >= 60) return `${Math.ceil(remainingSeconds / 60)} 分钟`
  return `${remainingSeconds} 秒`
}

const getTokenCacheStatusBadgeClass = (statusCode) => {
  const code = Number(statusCode) || 0
  if (code >= 200 && code < 300) {
    return 'border border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300'
  }
  if (code >= 300 && code < 400) {
    return 'border border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-900/60 dark:bg-sky-900/20 dark:text-sky-300'
  }
  if (code >= 400 && code < 500) {
    return 'border border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300'
  }
  return 'border border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-900/20 dark:text-rose-300'
}
</script>
