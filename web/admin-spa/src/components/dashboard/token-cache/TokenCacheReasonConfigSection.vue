<template>
  <div class="grid grid-cols-1 gap-4 xl:grid-cols-2">
    <section
      class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">命中来源</h4>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            只保留最近窗口里最常用的复用来源。
          </p>
        </div>
        <div class="text-right">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">总命中</p>
          <p class="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {{ formatNumber(tokenCacheRecent.hits) }}
          </p>
        </div>
      </div>

      <div
        v-if="Number(tokenCacheRecent.hits) <= 0"
        class="mt-4 rounded-2xl bg-gray-50 px-4 py-6 text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
      >
        当前窗口还没有命中请求。
      </div>
      <div v-else class="mt-4 space-y-2">
        <div
          v-for="item in hitSourceItems"
          :key="item.key"
          class="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
        >
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-900 dark:text-gray-100">
              {{ item.label }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ item.note }}
            </p>
          </div>
          <div class="text-right">
            <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ formatNumber(item.count) }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {{ item.share }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <section
      class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
    >
      <div class="flex items-start justify-between gap-3">
        <div>
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100">未复用原因</h4>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            只看最常见的阻碍，不再展开一整页配置说明。
          </p>
        </div>
        <div class="text-right">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">总请求</p>
          <p class="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {{ formatNumber(tokenCacheRecent.requests) }}
          </p>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <div
          v-for="item in reuseGapItems"
          :key="item.key"
          class="rounded-2xl px-4 py-3"
          :class="item.surfaceClass"
        >
          <p class="text-[11px] uppercase tracking-wide" :class="item.kickerClass">
            {{ item.label }}
          </p>
          <p class="mt-2 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {{ formatNumber(item.count) }}
          </p>
          <p class="mt-1 text-xs" :class="item.noteClass">占总请求 {{ item.share }}</p>
        </div>
      </div>

      <div
        v-if="topIssueItems.length === 0"
        class="mt-4 rounded-2xl bg-gray-50 px-4 py-6 text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
      >
        当前没有明显的绕过或语义跳过原因。
      </div>
      <div v-else class="mt-4 space-y-2">
        <div
          v-for="item in topIssueItems"
          :key="item.key"
          class="flex items-center justify-between gap-3 rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ item.label }}
              </p>
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
                :class="item.badgeClass"
              >
                {{ item.category }}
              </span>
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">占该类 {{ item.share }}</p>
          </div>
          <p class="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ formatNumber(item.count) }}
          </p>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import { formatTokenCacheReasonLabel } from '@/components/dashboard/token-cache/tokenCacheUi'
import { useDashboardStore } from '@/stores/dashboard'
import { formatNumber } from '@/utils/tools'

const { tokenCacheMetrics } = storeToRefs(useDashboardStore())

const emptyTokenCacheSummary = Object.freeze({
  requests: 0,
  hits: 0,
  misses: 0,
  bypasses: 0,
  exactHits: 0,
  toolResultHits: 0,
  semanticHits: 0,
  semanticSkips: 0
})

const tokenCacheRecent = computed(() => tokenCacheMetrics.value?.recent || emptyTokenCacheSummary)
const recentBypassReasons = computed(() => tokenCacheMetrics.value?.bypassReasons?.recent || [])
const recentSemanticSkipReasons = computed(
  () => tokenCacheMetrics.value?.semanticSkipReasons?.recent || []
)

const toNumber = (value) => Number(value) || 0

const toPercentLabel = (numerator, denominator) => {
  const safeDenominator = toNumber(denominator)
  if (safeDenominator <= 0) {
    return '0.0%'
  }

  return `${((toNumber(numerator) / safeDenominator) * 100).toFixed(1)}%`
}

const hitSourceItems = computed(() => {
  const recent = tokenCacheRecent.value
  const totalHits = toNumber(recent.hits)

  return [
    {
      key: 'exact',
      label: '精确命中',
      note: '同一请求直接复用',
      count: toNumber(recent.exactHits)
    },
    {
      key: 'tool-result',
      label: '工具结果',
      note: '复用相同工具输出',
      count: toNumber(recent.toolResultHits)
    },
    {
      key: 'semantic',
      label: '语义复用',
      note: '相似文本命中缓存',
      count: toNumber(recent.semanticHits)
    }
  ].map((item) => ({
    ...item,
    share: toPercentLabel(item.count, totalHits)
  }))
})

const reuseGapItems = computed(() => {
  const recent = tokenCacheRecent.value
  const totalRequests = toNumber(recent.requests)

  return [
    {
      key: 'misses',
      label: '未命中',
      count: toNumber(recent.misses),
      surfaceClass: 'bg-amber-50 dark:bg-amber-900/20',
      kickerClass: 'text-amber-700 dark:text-amber-300',
      noteClass: 'text-amber-700/80 dark:text-amber-300/80'
    },
    {
      key: 'bypasses',
      label: '绕过',
      count: toNumber(recent.bypasses),
      surfaceClass: 'bg-rose-50 dark:bg-rose-900/20',
      kickerClass: 'text-rose-700 dark:text-rose-300',
      noteClass: 'text-rose-700/80 dark:text-rose-300/80'
    },
    {
      key: 'semantic-skips',
      label: '语义跳过',
      count: toNumber(recent.semanticSkips),
      surfaceClass: 'bg-sky-50 dark:bg-sky-900/20',
      kickerClass: 'text-sky-700 dark:text-sky-300',
      noteClass: 'text-sky-700/80 dark:text-sky-300/80'
    }
  ].map((item) => ({
    ...item,
    share: toPercentLabel(item.count, totalRequests)
  }))
})

const topIssueItems = computed(() => {
  const bypassItems = recentBypassReasons.value.map((item) => ({
    key: `bypass-${item.reason}`,
    label: formatTokenCacheReasonLabel(item.reason),
    category: '绕过',
    count: toNumber(item.count),
    share: toPercentLabel(item.count, tokenCacheRecent.value.bypasses),
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
  }))

  const semanticItems = recentSemanticSkipReasons.value.map((item) => ({
    key: `semantic-${item.reason}`,
    label: formatTokenCacheReasonLabel(item.reason, 'semanticSkip'),
    category: '语义跳过',
    count: toNumber(item.count),
    share: toPercentLabel(item.count, tokenCacheRecent.value.semanticSkips),
    badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300'
  }))

  return [...bypassItems, ...semanticItems]
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)
    .slice(0, 3)
})
</script>
