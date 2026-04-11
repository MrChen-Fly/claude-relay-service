<template>
  <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
    <div
      v-for="card in summaryCards"
      :key="card.title"
      class="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/60"
    >
      <p class="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {{ card.title }}
      </p>
      <p class="mt-3 text-3xl font-bold tracking-tight" :class="card.valueClass">
        {{ card.value }}
      </p>
      <p class="mt-3 text-sm font-medium text-gray-900 dark:text-gray-100">
        {{ card.primary }}
      </p>
      <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
        {{ card.secondary }}
      </p>
    </div>
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
  eligibleRequests: 0,
  hits: 0,
  stores: 0,
  exactHits: 0,
  toolResultHits: 0,
  semanticHits: 0,
  providerPromptCacheRequests: 0,
  providerPromptCacheReadRequests: 0,
  providerPromptCacheWriteRequests: 0,
  providerPromptCacheReadTokens: 0,
  providerPromptCacheWriteTokens: 0,
  hitRate: 0,
  bypasses: 0,
  semanticSkips: 0
})

const tokenCacheRecent = computed(() => tokenCacheMetrics.value?.recent || emptyTokenCacheSummary)
const recentBypassReasons = computed(() => tokenCacheMetrics.value?.bypassReasons?.recent || [])
const recentSemanticSkipReasons = computed(
  () => tokenCacheMetrics.value?.semanticSkipReasons?.recent || []
)
const windowLabel = computed(() => `${tokenCacheMetrics.value?.windowMinutes || 60} 分钟`)

const clampPercent = (value) => {
  const normalized = Number(value)
  if (!Number.isFinite(normalized)) {
    return '0%'
  }

  const percentage = Math.min(Math.max(normalized * 100, 0), 100)
  return `${percentage.toFixed(1)}%`
}

const topIssue = computed(() => {
  const bypassItems = recentBypassReasons.value.map((item) => ({
    key: `bypass-${item.reason}`,
    label: formatTokenCacheReasonLabel(item.reason),
    category: '绕过',
    count: Number(item.count) || 0,
    total: Number(tokenCacheRecent.value.bypasses) || 0
  }))

  const semanticItems = recentSemanticSkipReasons.value.map((item) => ({
    key: `semantic-${item.reason}`,
    label: formatTokenCacheReasonLabel(item.reason, 'semanticSkip'),
    category: '语义跳过',
    count: Number(item.count) || 0,
    total: Number(tokenCacheRecent.value.semanticSkips) || 0
  }))

  const [firstIssue] = [...bypassItems, ...semanticItems]
    .filter((item) => item.count > 0)
    .sort((left, right) => right.count - left.count)

  if (!firstIssue) {
    return null
  }

  const safeTotal = firstIssue.total > 0 ? firstIssue.total : 0
  const share = safeTotal > 0 ? `${((firstIssue.count / safeTotal) * 100).toFixed(1)}%` : '0.0%'

  return {
    ...firstIssue,
    share
  }
})

const buildProviderPromptCacheSummary = (recent) => {
  const readRequests = Number(recent.providerPromptCacheReadRequests) || 0
  const writeRequests = Number(recent.providerPromptCacheWriteRequests) || 0
  const readTokens = Number(recent.providerPromptCacheReadTokens) || 0
  const writeTokens = Number(recent.providerPromptCacheWriteTokens) || 0

  if (readRequests <= 0 && writeRequests <= 0 && readTokens <= 0 && writeTokens <= 0) {
    return '上游 Prompt Cache 暂无读写回报。'
  }

  return `上游 Prompt Cache：复用 ${formatNumber(readRequests)} 次 · 建档 ${formatNumber(writeRequests)} 次 · 读 ${formatNumber(readTokens)} token · 建 ${formatNumber(writeTokens)} token`
}

const summaryCards = computed(() => {
  const recent = tokenCacheRecent.value
  const issue = topIssue.value
  const hasRequests = Number(recent.requests) > 0

  return [
    {
      title: `近 ${windowLabel.value} 本地命中率`,
      value: clampPercent(recent.hitRate),
      primary: `命中 ${formatNumber(recent.hits)} / 可缓存 ${formatNumber(recent.eligibleRequests)}`,
      secondary: '这里只统计 relay 本地复用；上游 Prompt Cache 单独展示。',
      valueClass: 'text-emerald-600 dark:text-emerald-400'
    },
    {
      title: '本地复用',
      value: formatNumber(recent.hits),
      primary: `精确 ${formatNumber(recent.exactHits)} · 工具 ${formatNumber(recent.toolResultHits)} · 语义 ${formatNumber(recent.semanticHits)}`,
      secondary: buildProviderPromptCacheSummary(recent),
      valueClass: 'text-violet-600 dark:text-violet-400'
    },
    {
      title: '主要阻碍',
      value: issue ? formatNumber(issue.count) : hasRequests ? '正常' : '--',
      primary: issue
        ? issue.label
        : hasRequests
          ? '当前没有明显的绕过或语义跳过'
          : '当前窗口暂无请求',
      secondary: issue
        ? `${issue.category} · 占该类 ${issue.share}`
        : hasRequests
          ? '普通用户可以先忽略高级诊断。'
          : '等有真实请求后再看这里。',
      valueClass: issue ? 'text-amber-600 dark:text-amber-400' : 'text-gray-700 dark:text-gray-200'
    }
  ]
})
</script>
