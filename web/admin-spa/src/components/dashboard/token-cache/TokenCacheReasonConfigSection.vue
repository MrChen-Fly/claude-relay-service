<template>
  <div class="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-4">
    <div class="card p-4 sm:p-6 xl:col-span-2">
      <div class="mb-4 flex items-center justify-between">
        <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
          绕过分布
        </h4>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          累计绕过 {{ formatNumber(tokenCacheTotal.bypasses) }}
        </span>
      </div>

      <div
        v-if="recentBypassReasons.length === 0"
        class="rounded-xl bg-gray-50 px-4 py-6 text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
      >
        当前窗口没有绕过请求。
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="item in recentBypassReasons.slice(0, 6)"
          :key="item.reason"
          class="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
        >
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ formatTokenCacheReasonLabel(item.reason) }}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-400">
              近窗占比 {{ formatReasonShare(item.count, tokenCacheRecent.bypasses) }}
            </p>
          </div>
          <span
            class="rounded-full bg-white px-3 py-1 text-sm font-semibold text-gray-700 shadow-sm dark:bg-gray-700 dark:text-gray-200"
          >
            {{ formatNumber(item.count) }}
          </span>
        </div>
      </div>
    </div>

    <div class="card p-4 sm:p-6">
      <div class="mb-4 flex items-center justify-between">
        <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
          语义执行
        </h4>
        <span class="text-xs text-gray-500 dark:text-gray-400">
          累计跳过 {{ formatNumber(tokenCacheTotal.semanticSkips) }}
        </span>
      </div>

      <div class="mb-4 grid grid-cols-1 gap-2">
        <div class="rounded-xl bg-sky-50 px-3 py-3 dark:bg-sky-900/20">
          <p class="text-[11px] uppercase tracking-wide text-sky-700 dark:text-sky-300">当前策略</p>
          <p class="mt-1 text-sm font-semibold text-sky-900 dark:text-sky-100">
            {{ formatTokenCacheInputStrategy(tokenCacheMetrics.config.embedInputStrategy) }}
          </p>
        </div>
        <div class="rounded-xl bg-amber-50 px-3 py-3 dark:bg-amber-900/20">
          <p class="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-300">
            分块情况
          </p>
          <p class="mt-1 text-sm font-semibold text-amber-900 dark:text-amber-100">
            {{ formatNumber(tokenCacheRecent.semanticChunkedRequests) }} 次请求 /
            {{ formatNumber(tokenCacheRecent.semanticChunkedChunks) }} 块
          </p>
        </div>
      </div>

      <div
        v-if="recentSemanticSkipReasons.length === 0"
        class="rounded-xl bg-gray-50 px-4 py-6 text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
      >
        近窗口没有语义跳过。
      </div>
      <div v-else class="space-y-3">
        <div
          v-for="item in recentSemanticSkipReasons.slice(0, 5)"
          :key="item.reason"
          class="rounded-xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
        >
          <div class="flex items-center justify-between gap-3">
            <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ formatTokenCacheReasonLabel(item.reason, 'semanticSkip') }}
            </p>
            <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">
              {{ formatNumber(item.count) }}
            </span>
          </div>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            近窗占比 {{ formatReasonShare(item.count, tokenCacheRecent.semanticSkips) }}
          </p>
        </div>
      </div>
    </div>

    <div class="card p-4 sm:p-6">
      <div class="mb-4 flex items-center justify-between gap-3">
        <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
          运行配置
        </h4>
        <span
          class="text-[11px] text-gray-400 dark:text-gray-500"
          :class="{ 'text-sky-500 dark:text-sky-400': tokenCacheStorageLoading }"
        >
          {{ tokenCacheStorageLoading ? '刷新中…' : '缓存存储' }}
        </span>
      </div>

      <div class="mb-4 flex flex-wrap gap-2">
        <span
          v-for="badge in configBadges"
          :key="badge"
          class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {{ badge }}
        </span>
      </div>

      <div class="space-y-3 text-sm">
        <div
          v-for="item in configItems"
          :key="item.label"
          class="flex items-start justify-between gap-3"
        >
          <span class="text-gray-500 dark:text-gray-400">{{ item.label }}</span>
          <span class="text-right font-medium text-gray-900 dark:text-gray-100">
            {{ item.value }}
          </span>
        </div>

        <div class="border-t border-gray-100 pt-3 dark:border-gray-800">
          <div
            v-if="tokenCacheStorageError"
            class="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300"
          >
            {{ tokenCacheStorageError }}
          </div>

          <div class="space-y-2 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-gray-500 dark:text-gray-400">命名空间</span>
              <span
                class="truncate text-right text-xs font-medium text-gray-900 dark:text-gray-100"
              >
                {{ tokenCacheStorageStats.namespace || '未设置' }}
              </span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-xs text-gray-500 dark:text-gray-400">总键数</span>
              <span class="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {{ formatNumber(tokenCacheStorageStats.totalKeys || 0) }}
              </span>
            </div>
            <div class="grid grid-cols-2 gap-2 pt-1">
              <div
                v-for="item in tokenCacheStorageCards"
                :key="item.label"
                class="rounded-lg bg-white px-3 py-2 dark:bg-gray-900/60"
              >
                <p class="text-[11px] uppercase tracking-wide text-gray-400">
                  {{ item.label }}
                </p>
                <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {{ formatNumber(item.value) }}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div class="space-y-2 rounded-xl bg-gray-50 p-3 dark:bg-gray-800/60">
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">语义模型</p>
            <p class="mt-1 break-all text-sm text-gray-700 dark:text-gray-200">
              {{ tokenCacheMetrics.config.embedModel || '未设置' }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">校验模型</p>
            <p class="mt-1 break-all text-sm text-gray-700 dark:text-gray-200">
              {{ tokenCacheMetrics.config.verifyModel || '未设置' }}
            </p>
          </div>
          <div>
            <p class="text-xs font-semibold uppercase tracking-wide text-gray-400">服务地址</p>
            <p class="mt-1 break-all text-sm text-gray-700 dark:text-gray-200">
              {{ tokenCacheMetrics.config.baseUrl || '未设置' }}
            </p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import {
  formatTokenCacheBooleanLabel,
  formatTokenCacheChunkingLabel,
  formatTokenCacheInputCapsLabel,
  formatTokenCacheInputStrategy,
  formatTokenCacheModeShortLabel,
  formatTokenCacheReasonLabel,
  formatTokenCacheToolResultLabel,
  formatTokenCacheTtl
} from '@/components/dashboard/token-cache/tokenCacheUi'
import { useDashboardStore } from '@/stores/dashboard'
import { formatNumber } from '@/utils/tools'

const {
  tokenCacheMetrics,
  tokenCacheStorageStats,
  tokenCacheStorageLoading,
  tokenCacheStorageError
} = storeToRefs(useDashboardStore())

const emptyTokenCacheSummary = Object.freeze({
  bypasses: 0,
  semanticSkips: 0,
  semanticChunkedRequests: 0,
  semanticChunkedChunks: 0
})

const tokenCacheRecent = computed(() => tokenCacheMetrics.value?.recent || emptyTokenCacheSummary)
const tokenCacheTotal = computed(() => tokenCacheMetrics.value?.total || emptyTokenCacheSummary)
const recentBypassReasons = computed(() => tokenCacheMetrics.value?.bypassReasons?.recent || [])
const recentSemanticSkipReasons = computed(
  () => tokenCacheMetrics.value?.semanticSkipReasons?.recent || []
)

const configBadges = computed(() => [
  `模式：${formatTokenCacheModeShortLabel(tokenCacheMetrics.value?.config)}`,
  `语义：${formatTokenCacheInputStrategy(tokenCacheMetrics.value?.config?.embedInputStrategy)}`,
  `工具结果：${formatTokenCacheBooleanLabel(tokenCacheMetrics.value?.config?.toolResultEnabled)}`
])

const configItems = computed(() => [
  {
    label: '默认过期',
    value: formatTokenCacheTtl(tokenCacheMetrics.value?.config?.ttlSeconds)
  },
  {
    label: '相似阈值',
    value: `${tokenCacheMetrics.value?.config?.lowThreshold ?? 0} ~ ${tokenCacheMetrics.value?.config?.highThreshold ?? 0}`
  },
  {
    label: '灰区校验',
    value: formatTokenCacheBooleanLabel(tokenCacheMetrics.value?.config?.grayZoneVerifierEnabled)
  },
  {
    label: '近邻索引',
    value: formatTokenCacheBooleanLabel(tokenCacheMetrics.value?.config?.useANNIndex)
  },
  {
    label: '输入上限',
    value: formatTokenCacheInputCapsLabel(tokenCacheMetrics.value?.config)
  },
  {
    label: '分块策略',
    value: formatTokenCacheChunkingLabel(tokenCacheMetrics.value?.config)
  },
  {
    label: '工具结果缓存',
    value: formatTokenCacheToolResultLabel(tokenCacheMetrics.value?.config)
  }
])

const tokenCacheStorageCards = computed(() => [
  { label: '响应', value: tokenCacheStorageStats.value?.entryCount || 0 },
  { label: '提示词', value: tokenCacheStorageStats.value?.promptCount || 0 },
  { label: '向量', value: tokenCacheStorageStats.value?.embeddingCount || 0 },
  { label: '指标', value: tokenCacheStorageStats.value?.metricsKeyCount || 0 }
])

const formatReasonShare = (count, total) => {
  const denominator = Math.max(Number(total) || 0, 1)
  return `${(((Number(count) || 0) / denominator) * 100).toFixed(1)}%`
}
</script>
