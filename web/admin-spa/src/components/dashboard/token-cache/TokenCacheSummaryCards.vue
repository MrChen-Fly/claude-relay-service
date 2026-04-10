<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
    <div v-for="card in summaryCards" :key="card.title" class="stat-card">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
            {{ card.title }}
          </p>
          <p class="text-2xl font-bold sm:text-3xl" :class="card.valueClass">
            {{ card.value }}
          </p>
          <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {{ card.primary }}
          </p>
          <p class="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
            {{ card.secondary }}
          </p>
        </div>
        <div class="stat-icon flex-shrink-0" :class="card.iconClass">
          <i :class="card.icon" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { useDashboardStore } from '@/stores/dashboard'
import { formatNumber } from '@/utils/tools'

const { tokenCacheMetrics } = storeToRefs(useDashboardStore())

const emptyTokenCacheSummary = Object.freeze({
  requests: 0,
  eligibleRequests: 0,
  hits: 0,
  misses: 0,
  bypasses: 0,
  stores: 0,
  exactHits: 0,
  toolResultHits: 0,
  semanticHits: 0,
  toolResultStores: 0,
  semanticChunkedRequests: 0,
  semanticChunkedChunks: 0,
  semanticSkips: 0,
  semanticVerifiedHits: 0,
  grayZoneChecks: 0,
  providerCalls: 0,
  providerErrors: 0,
  hitRate: 0,
  eligibleRate: 0,
  providerErrorRate: 0
})

const tokenCacheRecent = computed(() => tokenCacheMetrics.value?.recent || emptyTokenCacheSummary)
const tokenCacheTotal = computed(() => tokenCacheMetrics.value?.total || emptyTokenCacheSummary)
const windowLabel = computed(() => `${tokenCacheMetrics.value?.windowMinutes || 60} 分钟`)

const formatPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`

const summaryCards = computed(() => [
  {
    title: `近 ${windowLabel.value} 命中率`,
    value: formatPercent(tokenCacheRecent.value.hitRate),
    primary: `命中 ${formatNumber(tokenCacheRecent.value.hits)} / 可缓存 ${formatNumber(tokenCacheRecent.value.eligibleRequests)}`,
    secondary: `累计命中率 ${formatPercent(tokenCacheTotal.value.hitRate)}`,
    valueClass: 'text-emerald-600',
    iconClass: 'bg-gradient-to-br from-emerald-500 to-green-600',
    icon: 'fas fa-bullseye'
  },
  {
    title: '缓存覆盖率',
    value: formatPercent(tokenCacheRecent.value.eligibleRate),
    primary: `可缓存 ${formatNumber(tokenCacheRecent.value.eligibleRequests)} / 总请求 ${formatNumber(tokenCacheRecent.value.requests)}`,
    secondary: `未命中 ${formatNumber(tokenCacheRecent.value.misses)} / 新写入 ${formatNumber(tokenCacheRecent.value.stores)}`,
    valueClass: 'text-sky-600',
    iconClass: 'bg-gradient-to-br from-sky-500 to-cyan-600',
    icon: 'fas fa-filter'
  },
  {
    title: '命中来源',
    value: formatNumber(
      (Number(tokenCacheRecent.value.exactHits) || 0) +
        (Number(tokenCacheRecent.value.toolResultHits) || 0) +
        (Number(tokenCacheRecent.value.semanticHits) || 0)
    ),
    primary: `精确 ${formatNumber(tokenCacheRecent.value.exactHits)} · 工具 ${formatNumber(tokenCacheRecent.value.toolResultHits)} · 语义 ${formatNumber(tokenCacheRecent.value.semanticHits)}`,
    secondary: `工具写入 ${formatNumber(tokenCacheRecent.value.toolResultStores)} · 语义校验 ${formatNumber(tokenCacheRecent.value.semanticVerifiedHits)}`,
    valueClass: 'text-violet-600',
    iconClass: 'bg-gradient-to-br from-violet-500 to-fuchsia-600',
    icon: 'fas fa-layer-group'
  },
  {
    title: '语义分块',
    value: formatNumber(tokenCacheRecent.value.semanticChunkedChunks),
    primary: `分块请求 ${formatNumber(tokenCacheRecent.value.semanticChunkedRequests)} 次`,
    secondary: `共拆 ${formatNumber(tokenCacheRecent.value.semanticChunkedChunks)} 块 · 跳过 ${formatNumber(tokenCacheRecent.value.semanticSkips)}`,
    valueClass: 'text-amber-600',
    iconClass: 'bg-gradient-to-br from-amber-500 to-orange-600',
    icon: 'fas fa-road-barrier'
  },
  {
    title: '上游错误',
    value: formatNumber(tokenCacheRecent.value.providerErrors),
    primary: `调用 ${formatNumber(tokenCacheRecent.value.providerCalls)} 次 / 灰区校验 ${formatNumber(tokenCacheRecent.value.grayZoneChecks)} 次`,
    secondary: `错误率 ${formatPercent(tokenCacheRecent.value.providerErrorRate)}`,
    valueClass: 'text-rose-600',
    iconClass: 'bg-gradient-to-br from-rose-500 to-red-600',
    icon: 'fas fa-heartbeat'
  }
])
</script>
