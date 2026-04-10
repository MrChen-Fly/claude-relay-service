<template>
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    <div
      v-for="card in summaryCards"
      :key="card.title"
      class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
    >
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {{ card.title }}
          </p>
          <p class="mt-2 text-3xl font-bold tracking-tight" :class="card.valueClass">
            {{ card.value }}
          </p>
          <p class="mt-2 text-sm text-gray-600 dark:text-gray-300">
            {{ card.primary }}
          </p>
          <p class="mt-1 text-xs text-gray-400 dark:text-gray-500">
            {{ card.secondary }}
          </p>
        </div>

        <div
          class="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-sm"
          :class="card.iconClass"
        >
          <i :class="card.icon" />
        </div>
      </div>

      <div class="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
        <div
          class="h-full rounded-full transition-all duration-300"
          :class="card.barClass"
          :style="{ width: card.progress }"
        />
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
  providerErrors: 0,
  hitRate: 0,
  eligibleRate: 0
})

const tokenCacheRecent = computed(() => tokenCacheMetrics.value?.recent || emptyTokenCacheSummary)
const windowLabel = computed(() => `${tokenCacheMetrics.value?.windowMinutes || 60} 分钟`)

const clampPercent = (value) => {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    return '0%'
  }

  const percentage = Math.min(Math.max(normalized * 100, 0), 100)
  return `${percentage.toFixed(1)}%`
}

const ratioPercent = (numerator, denominator) => {
  const safeDenominator = Number(denominator) || 0
  if (safeDenominator <= 0) {
    return '0%'
  }

  const normalizedNumerator = Number(numerator) || 0
  const percentage = Math.min(Math.max((normalizedNumerator / safeDenominator) * 100, 0), 100)
  return `${percentage.toFixed(1)}%`
}

const summaryCards = computed(() => {
  const recent = tokenCacheRecent.value
  const upstreamHandled = (Number(recent.misses) || 0) + (Number(recent.bypasses) || 0)

  return [
    {
      title: `近 ${windowLabel.value} 命中率`,
      value: clampPercent(recent.hitRate),
      primary: `命中 ${formatNumber(recent.hits)} / 可缓存 ${formatNumber(recent.eligibleRequests)}`,
      secondary: '这个值越高，说明缓存复用越稳定。',
      progress: clampPercent(recent.hitRate),
      valueClass: 'text-emerald-600 dark:text-emerald-400',
      iconClass: 'bg-gradient-to-br from-emerald-500 to-green-600',
      barClass: 'bg-emerald-500',
      icon: 'fas fa-bullseye'
    },
    {
      title: '可缓存占比',
      value: clampPercent(recent.eligibleRate),
      primary: `可缓存 ${formatNumber(recent.eligibleRequests)} / 总请求 ${formatNumber(recent.requests)}`,
      secondary: '这个值越高，说明更多请求进入了缓存链路。',
      progress: clampPercent(recent.eligibleRate),
      valueClass: 'text-sky-600 dark:text-sky-400',
      iconClass: 'bg-gradient-to-br from-sky-500 to-cyan-600',
      barClass: 'bg-sky-500',
      icon: 'fas fa-filter'
    },
    {
      title: '复用请求',
      value: formatNumber(recent.hits),
      primary: `精确 ${formatNumber(recent.exactHits)} · 工具 ${formatNumber(recent.toolResultHits)} · 语义 ${formatNumber(recent.semanticHits)}`,
      secondary: `近窗新写入 ${formatNumber(recent.stores)} 次`,
      progress: ratioPercent(recent.hits, recent.requests),
      valueClass: 'text-violet-600 dark:text-violet-400',
      iconClass: 'bg-gradient-to-br from-violet-500 to-fuchsia-600',
      barClass: 'bg-violet-500',
      icon: 'fas fa-layer-group'
    },
    {
      title: '需上游处理',
      value: formatNumber(upstreamHandled),
      primary: `未命中 ${formatNumber(recent.misses)} · 绕过 ${formatNumber(recent.bypasses)}`,
      secondary: `上游异常 ${formatNumber(recent.providerErrors)} 次`,
      progress: ratioPercent(upstreamHandled, recent.requests),
      valueClass: 'text-amber-600 dark:text-amber-400',
      iconClass: 'bg-gradient-to-br from-amber-500 to-orange-600',
      barClass: 'bg-amber-500',
      icon: 'fas fa-arrow-up-right-dots'
    }
  ]
})
</script>
