<template>
  <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
    <section class="card p-4 sm:p-6">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
            命中来源分布
          </h4>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            最近命中的来源拆分，快速判断复用主要依赖哪一层。
          </p>
        </div>
        <div class="text-right">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            命中总数
          </p>
          <p class="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {{ formatNumber(tokenCacheRecent.hits) }}
          </p>
        </div>
      </div>

      <div
        v-if="Number(tokenCacheRecent.hits) <= 0"
        class="mt-5 rounded-2xl bg-gray-50 px-4 py-6 text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
      >
        当前窗口还没有命中请求。
      </div>
      <div v-else class="mt-5">
        <div class="flex h-3 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <div
            v-for="item in hitSourceItems"
            :key="item.key"
            class="h-full transition-all duration-300"
            :class="item.barClass"
            :style="{ width: item.width }"
          />
        </div>

        <div class="mt-4 space-y-3">
          <div
            v-for="item in hitSourceItems"
            :key="item.key"
            class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
          >
            <div class="flex items-center justify-between gap-3">
              <div class="flex min-w-0 items-center gap-2">
                <span class="h-2.5 w-2.5 flex-shrink-0 rounded-full" :class="item.dotClass" />
                <p class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                  {{ item.label }}
                </p>
              </div>
              <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {{ formatNumber(item.count) }}
              </span>
            </div>
            <div class="mt-2 flex items-center justify-between gap-3 text-xs">
              <span class="text-gray-500 dark:text-gray-400">{{ item.note }}</span>
              <span class="font-medium text-gray-500 dark:text-gray-400">{{ item.share }}</span>
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card p-4 sm:p-6">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
            未复用原因
          </h4>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            先看请求去向，再看最近最常见的绕过和语义跳过原因。
          </p>
        </div>
        <div class="text-right">
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">总请求</p>
          <p class="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
            {{ formatNumber(tokenCacheRecent.requests) }}
          </p>
        </div>
      </div>

      <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
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

      <div class="mt-5">
        <div class="mb-3 flex items-center justify-between gap-3">
          <h5 class="text-sm font-semibold text-gray-900 dark:text-gray-100">主要原因</h5>
          <span class="text-xs text-gray-500 dark:text-gray-400">
            仅统计可归因的绕过与语义跳过
          </span>
        </div>

        <div
          v-if="topIssueItems.length === 0"
          class="rounded-2xl bg-gray-50 px-4 py-6 text-sm text-gray-500 dark:bg-gray-800/60 dark:text-gray-400"
        >
          当前窗口没有明显的绕过或语义跳过原因。
        </div>
        <div v-else class="space-y-3">
          <div
            v-for="item in topIssueItems"
            :key="item.key"
            class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
          >
            <div class="flex items-start justify-between gap-3">
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
                <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  在{{ item.category }}中占 {{ item.share }}
                </p>
              </div>
              <span class="text-sm font-semibold text-gray-700 dark:text-gray-200">
                {{ formatNumber(item.count) }}
              </span>
            </div>
            <div class="mt-3 h-2 overflow-hidden rounded-full bg-white dark:bg-gray-900/60">
              <div
                class="h-full rounded-full transition-all duration-300"
                :class="item.barClass"
                :style="{ width: item.width }"
              />
            </div>
          </div>
        </div>
      </div>
    </section>

    <section class="card p-4 sm:p-6">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h4 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
            运行快照
          </h4>
          <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
            只保留当前诊断最常用的配置和存储规模。
          </p>
        </div>
        <span
          class="text-xs text-gray-400 dark:text-gray-500"
          :class="{ 'text-sky-500 dark:text-sky-400': tokenCacheStorageLoading }"
        >
          {{ tokenCacheStorageLoading ? '同步中' : '存储快照' }}
        </span>
      </div>

      <div class="mt-5 flex flex-wrap gap-2">
        <span
          v-for="badge in runtimeBadges"
          :key="badge.label"
          class="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700 dark:bg-gray-800 dark:text-gray-200"
        >
          {{ badge.label }} · {{ badge.value }}
        </span>
      </div>

      <div class="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div
          v-for="item in runtimeSnapshotItems"
          :key="item.label"
          class="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-gray-800/60"
        >
          <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {{ item.label }}
          </p>
          <p class="mt-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
            {{ item.value }}
          </p>
        </div>
      </div>

      <div class="mt-5 rounded-2xl bg-gray-50 p-4 dark:bg-gray-800/60">
        <div class="flex items-center justify-between gap-3">
          <div>
            <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
              存储总键数
            </p>
            <p class="mt-1 text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100">
              {{ formatNumber(storageStats.totalKeys) }}
            </p>
          </div>
          <p class="text-xs text-gray-500 dark:text-gray-400">Redis 键分布</p>
        </div>

        <div
          v-if="tokenCacheStorageError"
          class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300"
        >
          {{ tokenCacheStorageError }}
        </div>

        <div class="mt-4 grid grid-cols-2 gap-2">
          <div
            v-for="item in storageCards"
            :key="item.label"
            class="rounded-xl bg-white px-3 py-2 dark:bg-gray-900/60"
          >
            <p class="text-[11px] uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {{ item.label }}
            </p>
            <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
              {{ formatNumber(item.value) }}
            </p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { storeToRefs } from 'pinia'

import {
  formatTokenCacheBooleanLabel,
  formatTokenCacheChunkingLabel,
  formatTokenCacheInputCapsLabel,
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
  requests: 0,
  hits: 0,
  misses: 0,
  bypasses: 0,
  exactHits: 0,
  toolResultHits: 0,
  semanticHits: 0,
  semanticSkips: 0
})

const emptyStorageStats = Object.freeze({
  entryCount: 0,
  promptCount: 0,
  embeddingCount: 0,
  metricsKeyCount: 0,
  totalKeys: 0
})

const tokenCacheRecent = computed(() => tokenCacheMetrics.value?.recent || emptyTokenCacheSummary)
const storageStats = computed(() => tokenCacheStorageStats.value || emptyStorageStats)
const recentBypassReasons = computed(() => tokenCacheMetrics.value?.bypassReasons?.recent || [])
const recentSemanticSkipReasons = computed(
  () => tokenCacheMetrics.value?.semanticSkipReasons?.recent || []
)

const toNumber = (value) => Number(value) || 0

const toPercentValue = (numerator, denominator) => {
  const safeDenominator = toNumber(denominator)
  if (safeDenominator <= 0) {
    return 0
  }

  return Math.min(Math.max((toNumber(numerator) / safeDenominator) * 100, 0), 100)
}

const toPercentLabel = (numerator, denominator) =>
  `${toPercentValue(numerator, denominator).toFixed(1)}%`
const toWidth = (value) => `${Math.min(Math.max(Number(value) || 0, 0), 100).toFixed(1)}%`

const hitSourceItems = computed(() => {
  const recent = tokenCacheRecent.value
  const totalHits = toNumber(recent.hits)

  return [
    {
      key: 'exact',
      label: '精确命中',
      note: '同一请求直接复用',
      count: toNumber(recent.exactHits),
      dotClass: 'bg-emerald-500',
      barClass: 'bg-emerald-500'
    },
    {
      key: 'tool-result',
      label: '工具结果',
      note: '工具输出被直接复用',
      count: toNumber(recent.toolResultHits),
      dotClass: 'bg-sky-500',
      barClass: 'bg-sky-500'
    },
    {
      key: 'semantic',
      label: '语义复用',
      note: '相似请求命中缓存',
      count: toNumber(recent.semanticHits),
      dotClass: 'bg-violet-500',
      barClass: 'bg-violet-500'
    }
  ].map((item) => {
    const percentValue = toPercentValue(item.count, totalHits)
    return {
      ...item,
      share: toPercentLabel(item.count, totalHits),
      width: toWidth(percentValue)
    }
  })
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
    width: toWidth(toPercentValue(item.count, tokenCacheRecent.value.bypasses)),
    badgeClass: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
    barClass: 'bg-amber-500'
  }))

  const semanticItems = recentSemanticSkipReasons.value.map((item) => ({
    key: `semantic-${item.reason}`,
    label: formatTokenCacheReasonLabel(item.reason, 'semanticSkip'),
    category: '语义跳过',
    count: toNumber(item.count),
    share: toPercentLabel(item.count, tokenCacheRecent.value.semanticSkips),
    width: toWidth(toPercentValue(item.count, tokenCacheRecent.value.semanticSkips)),
    badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
    barClass: 'bg-sky-500'
  }))

  return [...bypassItems, ...semanticItems]
    .sort((left, right) => right.count - left.count)
    .slice(0, 5)
})

const runtimeBadges = computed(() => {
  const config = tokenCacheMetrics.value?.config || {}

  return [
    {
      label: '灰区校验',
      value: formatTokenCacheBooleanLabel(config.grayZoneVerifierEnabled)
    },
    {
      label: 'ANN 索引',
      value: formatTokenCacheBooleanLabel(config.useANNIndex)
    },
    {
      label: '分块策略',
      value: formatTokenCacheChunkingLabel(config)
    }
  ]
})

const runtimeSnapshotItems = computed(() => {
  const config = tokenCacheMetrics.value?.config || {}

  return [
    {
      label: '默认过期',
      value: formatTokenCacheTtl(config.ttlSeconds)
    },
    {
      label: '相似阈值',
      value: `${config.lowThreshold ?? 0} ~ ${config.highThreshold ?? 0}`
    },
    {
      label: '输入上限',
      value: formatTokenCacheInputCapsLabel(config)
    },
    {
      label: '工具结果缓存',
      value: formatTokenCacheToolResultLabel(config)
    }
  ]
})

const storageCards = computed(() => [
  { label: '响应', value: storageStats.value.entryCount || 0 },
  { label: '提示词', value: storageStats.value.promptCount || 0 },
  { label: '向量', value: storageStats.value.embeddingCount || 0 },
  { label: '指标', value: storageStats.value.metricsKeyCount || 0 }
])
</script>
