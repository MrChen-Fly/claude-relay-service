<template>
  <div class="mb-4 sm:mb-6 md:mb-8">
    <div class="card overflow-hidden p-0">
      <div
        class="border-b border-slate-200 bg-gradient-to-r from-slate-950 via-slate-900 to-teal-900 px-5 py-5 text-white sm:px-6"
      >
        <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div class="max-w-3xl">
            <div class="flex items-center gap-3">
              <span
                class="inline-flex h-10 w-10 items-center justify-center rounded-2xl bg-white/10 text-lg text-teal-200"
              >
                <i class="fas fa-wave-square" />
              </span>
              <div>
                <div class="flex flex-wrap items-center gap-2">
                  <h3 class="text-lg font-bold sm:text-xl">OpenAI 缓存观测</h3>
                  <span
                    class="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-teal-100"
                  >
                    默认视角 {{ primaryLabel }}
                  </span>
                </div>
                <p class="mt-1 text-sm text-slate-200">{{ overview.summary }}</p>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span v-for="badge in headerBadges" :key="badge.label" :class="badge.className">
              {{ badge.label }}
            </span>
          </div>
        </div>

        <div class="mt-5 grid gap-3 md:grid-cols-3">
          <div class="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
            <p class="text-xs font-medium uppercase tracking-[0.16em] text-slate-200">当前阶段</p>
            <p class="mt-2 text-base font-semibold">{{ overview.stage }}</p>
          </div>
          <div class="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
            <p class="text-xs font-medium uppercase tracking-[0.16em] text-slate-200">调优焦点</p>
            <p class="mt-2 text-base font-semibold">{{ overview.focus }}</p>
          </div>
          <div class="rounded-2xl bg-white/10 px-4 py-3 backdrop-blur">
            <p class="text-xs font-medium uppercase tracking-[0.16em] text-slate-200">主要阻塞</p>
            <p class="mt-2 text-base font-semibold">{{ overview.blocker }}</p>
          </div>
        </div>
      </div>

      <div class="grid gap-4 px-4 py-4 sm:px-6 sm:py-6 xl:grid-cols-[1.2fr,0.8fr]">
        <div class="space-y-4">
          <section class="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">观测窗口</p>
                <p class="mt-1 text-sm text-slate-500">{{ scopeInfo.note }}</p>
              </div>
              <span class="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700">
                当前默认 {{ primaryLabel }}
              </span>
            </div>

            <div class="mt-4 grid gap-4 xl:grid-cols-2">
              <article
                v-for="card in scopeCards"
                :key="card.key"
                class="rounded-3xl border p-5"
                :class="card.className"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold text-slate-900">{{ card.title }}</p>
                      <span :class="card.badgeClass">{{ card.badge }}</span>
                    </div>
                    <p class="mt-2 text-sm text-slate-700">{{ card.summary }}</p>
                    <p class="mt-1 text-xs text-slate-500">{{ card.meta }}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-xs text-slate-500">命中</p>
                    <p class="mt-1 text-2xl font-bold text-slate-900">
                      {{ formatNumber(card.hits) }}
                    </p>
                  </div>
                </div>

                <div class="mt-4 grid grid-cols-3 gap-3">
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                    <p class="text-xs text-slate-500">Lookups</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      {{ formatNumber(card.lookups) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                    <p class="text-xs text-slate-500">Bypass</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      {{ formatNumber(card.bypasses) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                    <p class="text-xs text-slate-500">请求</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      {{ formatNumber(card.requests) }}
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section class="rounded-3xl border border-amber-200 bg-amber-50/80 p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-amber-800">线上参数建议</p>
                <p class="mt-1 text-sm text-amber-700">{{ diagnostics.message }}</p>
              </div>
              <span class="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-700">
                {{ primaryLabel }}样本 {{ formatNumber(diagnostics.sampleSize) }}
              </span>
            </div>

            <div v-if="l2Recommendations.length > 0" class="mt-4 space-y-3">
              <div
                v-for="item in l2Recommendations"
                :key="item.id"
                class="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <span :class="getPriorityBadgeClass(item.priority)">
                    {{ getPriorityLabel(item.priority) }}
                  </span>
                  <p class="text-sm font-semibold text-slate-900">{{ item.title }}</p>
                </div>
                <p class="mt-2 text-sm text-slate-700">{{ item.summary }}</p>
                <p class="mt-2 text-xs text-slate-500">{{ item.rationale }}</p>
                <div class="mt-3 grid gap-3 sm:grid-cols-2">
                  <div class="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <p>
                      <span class="font-medium text-slate-800">当前:</span> {{ item.currentValue }}
                    </p>
                    <p class="mt-1">
                      <span class="font-medium text-slate-800">建议:</span>
                      {{ item.suggestedValue }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600">
                    <p class="font-medium text-slate-800">参数</p>
                    <p class="mt-1">{{ formatRecommendationParams(item.params) }}</p>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else
              class="mt-4 rounded-2xl border border-dashed border-amber-200 bg-white/70 px-4 py-5 text-sm text-amber-700"
            >
              当前默认视角样本不足，先继续积累真实 lookups。
            </div>
          </section>

          <section>
            <div class="mb-3">
              <p class="text-sm font-semibold text-slate-900">{{ primaryLabel }}层级表现</p>
              <p class="mt-1 text-sm text-slate-500">
                下方卡片只读取默认视角，不再把历史累计值直接混进当前判断。
              </p>
            </div>

            <div class="grid gap-4 lg:grid-cols-3">
              <article v-for="card in layerCards" :key="card.key" :class="card.className">
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold" :class="card.titleClass">{{ card.title }}</p>
                      <span :class="card.badgeClass">{{ card.status }}</span>
                    </div>
                    <p class="mt-3 text-sm font-semibold text-slate-900">{{ card.summary }}</p>
                    <p class="mt-1 text-xs text-slate-500">{{ card.detail }}</p>
                  </div>
                  <div class="text-right">
                    <p class="text-xs text-slate-500">命中率</p>
                    <p class="mt-1 text-3xl font-bold" :class="card.metricClass">
                      {{ formatRatioPercent(card.hitRate) }}
                    </p>
                  </div>
                </div>

                <div class="mt-4 grid grid-cols-2 gap-3">
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                    <p class="text-xs text-slate-500">命中</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      {{ formatNumber(card.hitCount) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                    <p class="text-xs text-slate-500">Lookups</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      {{ formatNumber(card.lookups) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                    <p class="text-xs text-slate-500">写入</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      {{ formatNumber(card.writes) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm">
                    <p class="text-xs text-slate-500">Bypass</p>
                    <p class="mt-1 text-lg font-semibold text-slate-900">
                      {{ formatNumber(card.bypasses) }}
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </section>
        </div>

        <div class="space-y-4">
          <section class="rounded-3xl border border-sky-200 bg-sky-50/80 p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-sky-900">本次进程 vs 累计历史</p>
                <p class="mt-1 text-sm text-sky-700">
                  先看本次进程是否还有新的热点，再用累计历史确认长期结构问题。
                </p>
              </div>
            </div>

            <div class="mt-4 space-y-3">
              <article
                v-for="row in comparisonRows"
                :key="row.key"
                class="rounded-3xl border border-white/80 bg-white/90 p-4 shadow-sm"
              >
                <div class="flex items-start justify-between gap-3">
                  <div>
                    <p class="text-sm font-semibold text-slate-900">{{ row.title }}</p>
                    <p class="mt-1 text-xs text-slate-500">{{ row.blocker }}</p>
                  </div>
                </div>

                <div class="mt-4 grid gap-3 sm:grid-cols-2">
                  <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p class="text-xs font-medium text-slate-500">本次进程</p>
                    <p class="mt-2 text-lg font-semibold text-slate-900">
                      {{ row.processHitRate }}
                    </p>
                    <p class="mt-1 text-xs text-slate-500">
                      Lookups {{ row.processLookups }} · Bypass {{ row.processBypasses }}
                    </p>
                  </div>
                  <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                    <p class="text-xs font-medium text-slate-500">累计历史</p>
                    <p class="mt-2 text-lg font-semibold text-slate-900">
                      {{ row.cumulativeHitRate }}
                    </p>
                    <p class="mt-1 text-xs text-slate-500">
                      Lookups {{ row.cumulativeLookups }} · Bypass {{ row.cumulativeBypasses }}
                    </p>
                  </div>
                </div>
              </article>
            </div>
          </section>

          <section class="rounded-3xl border border-emerald-200 bg-emerald-50/80 p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-emerald-800">L2 实时诊断</p>
                <p class="mt-1 text-sm text-emerald-700">
                  当前 Embedding 模型 {{ l2ConfigSnapshot.embeddingModel }}
                </p>
              </div>
              <span class="rounded-full bg-white px-3 py-1 text-xs font-medium text-emerald-700">
                {{ getReadinessLabel(diagnostics.tuningReadiness) }}
              </span>
            </div>

            <div class="mt-4 grid grid-cols-2 gap-3">
              <div
                v-for="item in diagnosticCards"
                :key="item.label"
                class="rounded-2xl bg-white/90 px-4 py-3 shadow-sm"
              >
                <p class="text-xs text-slate-500">{{ item.label }}</p>
                <p class="mt-1 text-lg font-semibold" :class="item.className">{{ item.value }}</p>
                <p class="mt-1 text-[11px] text-slate-500">{{ item.detail }}</p>
              </div>
            </div>
          </section>

          <section class="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">当前参数快照</p>
                <p class="mt-1 text-sm text-slate-500">
                  参数单独看，避免和历史累计指标混在一起误判。
                </p>
              </div>
              <span class="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600">
                focus: {{ getPrimaryIssueLabel(diagnostics.primaryIssue) }}
              </span>
            </div>

            <div class="mt-4 flex flex-wrap gap-2">
              <span
                v-for="chip in configChips"
                :key="chip.label"
                class="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700"
              >
                {{ chip.label }} {{ chip.value }}
              </span>
            </div>
          </section>
        </div>
      </div>

      <div class="border-t border-slate-200 bg-slate-50/70 px-4 py-4 sm:px-6 sm:py-6">
        <div class="mb-3">
          <p class="text-sm font-semibold text-slate-900">{{ primaryLabel }}绕过热点</p>
          <p class="mt-1 text-sm text-slate-500">
            这里只看默认视角，用来定位当前部署后的新流量究竟卡在哪一层。
          </p>
        </div>

        <div class="grid gap-4 lg:grid-cols-3">
          <section
            v-for="group in bypassGroups"
            :key="group.key"
            class="rounded-3xl border bg-white p-5 shadow-sm"
            :class="group.className"
          >
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">{{ group.title }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ group.description }}</p>
              </div>
              <span class="text-xs font-medium text-slate-500"
                >总计 {{ formatNumber(group.total) }}</span
              >
            </div>

            <div v-if="group.items.length > 0" class="mt-4 space-y-2">
              <div
                v-for="item in group.items"
                :key="`${group.key}-${item.reason}`"
                class="flex items-center justify-between rounded-2xl bg-slate-50 px-3 py-2"
              >
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-slate-800">
                    {{ formatCacheBypassReason(item.reason) }}
                  </p>
                  <p class="mt-0.5 truncate text-[11px] text-slate-500">{{ item.reason }}</p>
                </div>
                <span class="ml-3 text-sm font-semibold text-slate-900">{{
                  formatNumber(item.count)
                }}</span>
              </div>
            </div>
            <p v-else class="mt-4 text-sm text-slate-500">当前没有明显的绕过热点。</p>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'

import { createDefaultCacheMetrics } from '@/stores/dashboard'
import { formatDateTime, formatNumber } from '@/utils/tools'

const props = defineProps({
  cacheMetrics: {
    type: Object,
    default: () => createDefaultCacheMetrics()
  }
})

const emptyMetrics = createDefaultCacheMetrics()

const bypassReasonLabels = {
  dynamic_tools: '携带 tools 或动态字段',
  dynamic_request: '动态请求参数',
  stream_request: '流式请求',
  structured_output_request: '结构化输出请求',
  tool_custom: '携带 custom 工具',
  unsupported_input_item: '输入项不支持',
  text_too_long: '文本过长',
  temperature_too_high: '温度过高',
  cache_disabled: '缓存未启用'
}

const toSafeNumber = (value) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

const formatRatioPercent = (value) => `${(toSafeNumber(value) * 100).toFixed(1)}%`
const formatThreshold = (value) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : '--'
}
const formatDays = (seconds) => `${Math.max(1, Math.round(toSafeNumber(seconds) / 86400))}d`
const formatCacheBypassReason = (reason) =>
  bypassReasonLabels[reason] || reason?.split('_').filter(Boolean).join(' ') || '未知原因'
const formatRecommendationParams = (params) =>
  Array.isArray(params) && params.length > 0
    ? params.join(' / ')
    : '优先处理请求结构和召回样本，再决定是否改参数。'
const formatScopeTime = (value, fallback = '未记录时间点') => formatDateTime(value) || fallback

function getLayerView(metrics, scopeKey) {
  if (!metrics || typeof metrics !== 'object') {
    return null
  }
  if (scopeKey === 'sinceProcessStart' && metrics.sinceProcessStart) {
    return metrics.sinceProcessStart
  }
  if (scopeKey === 'cumulative' && metrics.cumulative) {
    return metrics.cumulative
  }
  return metrics
}

const scopeInfo = computed(() => props.cacheMetrics?.scope || emptyMetrics.scope)
const primaryScopeKey = computed(() =>
  scopeInfo.value.primary === 'sinceProcessStart' ? 'sinceProcessStart' : 'cumulative'
)
const primaryLabel = computed(() =>
  primaryScopeKey.value === 'sinceProcessStart' ? '本次进程' : '累计历史'
)

const l1Metrics = computed(() => props.cacheMetrics?.l1 || emptyMetrics.l1)
const l2Metrics = computed(() => props.cacheMetrics?.l2 || emptyMetrics.l2)
const l3Metrics = computed(() => props.cacheMetrics?.l3 || emptyMetrics.l3)

const l1PrimaryMetrics = computed(() => getLayerView(l1Metrics.value, primaryScopeKey.value))
const l2PrimaryMetrics = computed(() => getLayerView(l2Metrics.value, primaryScopeKey.value))
const l3PrimaryMetrics = computed(() => getLayerView(l3Metrics.value, primaryScopeKey.value))
const l1ProcessMetrics = computed(() => getLayerView(l1Metrics.value, 'sinceProcessStart'))
const l2ProcessMetrics = computed(() => getLayerView(l2Metrics.value, 'sinceProcessStart'))
const l3ProcessMetrics = computed(() => getLayerView(l3Metrics.value, 'sinceProcessStart'))
const l1CumulativeMetrics = computed(() => getLayerView(l1Metrics.value, 'cumulative'))
const l2CumulativeMetrics = computed(() => getLayerView(l2Metrics.value, 'cumulative'))
const l3CumulativeMetrics = computed(() => getLayerView(l3Metrics.value, 'cumulative'))

const l2ConfigSnapshot = computed(
  () => l2PrimaryMetrics.value?.configSnapshot || emptyMetrics.l2.configSnapshot
)
const diagnostics = computed(
  () => l2PrimaryMetrics.value?.diagnostics || emptyMetrics.l2.diagnostics
)
const l2Recommendations = computed(() =>
  Array.isArray(l2PrimaryMetrics.value?.recommendations)
    ? l2PrimaryMetrics.value.recommendations
    : []
)

const getLayerHitRate = (key, metrics) =>
  key === 'l2'
    ? toSafeNumber(metrics?.rates?.semanticHitRate)
    : toSafeNumber(metrics?.rates?.hitRate)
const getLayerHitCount = (key, metrics) =>
  key === 'l2'
    ? toSafeNumber(metrics?.counters?.cache_hit_semantic)
    : toSafeNumber(metrics?.counters?.cache_hit_exact)

function aggregateCacheView(layers) {
  return layers.reduce(
    (result, { key, metrics }) => {
      result.lookups += toSafeNumber(metrics?.totals?.lookups)
      result.requests += toSafeNumber(metrics?.totals?.requests)
      result.bypasses += toSafeNumber(metrics?.counters?.cache_bypass)
      result.hits += getLayerHitCount(key, metrics)
      return result
    },
    { lookups: 0, requests: 0, bypasses: 0, hits: 0 }
  )
}

const processAggregate = computed(() =>
  aggregateCacheView([
    { key: 'l1', metrics: l1ProcessMetrics.value },
    { key: 'l2', metrics: l2ProcessMetrics.value },
    { key: 'l3', metrics: l3ProcessMetrics.value }
  ])
)
const cumulativeAggregate = computed(() =>
  aggregateCacheView([
    { key: 'l1', metrics: l1CumulativeMetrics.value },
    { key: 'l2', metrics: l2CumulativeMetrics.value },
    { key: 'l3', metrics: l3CumulativeMetrics.value }
  ])
)

const primaryBypassReason = computed(() => {
  const reasonMap = new Map()
  ;[l1PrimaryMetrics.value, l2PrimaryMetrics.value, l3PrimaryMetrics.value].forEach((metrics) => {
    ;(metrics?.bypassReasons || []).forEach((item) => {
      if (item?.reason) {
        reasonMap.set(item.reason, (reasonMap.get(item.reason) || 0) + toSafeNumber(item.count))
      }
    })
  })
  let topReason = null
  reasonMap.forEach((count, reason) => {
    if (!topReason || count > topReason.count) {
      topReason = { reason, count }
    }
  })
  return topReason
})

const overview = computed(() => ({
  summary:
    getLayerHitCount('l1', l1PrimaryMetrics.value) +
      getLayerHitCount('l2', l2PrimaryMetrics.value) +
      getLayerHitCount('l3', l3PrimaryMetrics.value) >
    0
      ? `${primaryLabel.value}已经出现真实命中，当前重点是继续放大复用，而不是再看旧累计噪音。`
      : diagnostics.value.message,
  stage:
    diagnostics.value.primaryIssue === 'threshold'
      ? '召回后筛选'
      : diagnostics.value.primaryIssue === 'bypass'
        ? '参与率不足'
        : '样本预热',
  focus:
    diagnostics.value.primaryIssue === 'threshold'
      ? '优先放宽接受线'
      : diagnostics.value.primaryIssue === 'bypass'
        ? '优先降低 bypass'
        : `继续积累${primaryLabel.value}样本`,
  blocker: primaryBypassReason.value
    ? `${formatCacheBypassReason(primaryBypassReason.value.reason)} · ${formatNumber(primaryBypassReason.value.count)}`
    : '暂无明显阻塞'
}))

const headerBadges = computed(() => [
  {
    label: scopeInfo.value.baselineAvailable ? '已切分本次进程' : '仅累计历史',
    className:
      'rounded-full bg-white/10 px-3 py-1 font-medium text-slate-100 ring-1 ring-inset ring-white/20'
  },
  {
    label: `L2 ${l2PrimaryMetrics.value?.enabled ? '开启' : '关闭'}`,
    className:
      'rounded-full bg-emerald-500/15 px-3 py-1 font-medium text-emerald-100 ring-1 ring-inset ring-emerald-300/30'
  },
  {
    label: getReadinessLabel(diagnostics.value.tuningReadiness),
    className:
      'rounded-full bg-white/10 px-3 py-1 font-medium text-slate-100 ring-1 ring-inset ring-white/20'
  }
])

const scopeCards = computed(() => [
  {
    key: 'sinceProcessStart',
    title: '本次进程',
    badge: scopeInfo.value.baselineAvailable ? '推荐视角' : '基线缺失',
    badgeClass: scopeInfo.value.baselineAvailable
      ? 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700'
      : 'rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700',
    summary: scopeInfo.value.baselineAvailable
      ? '只统计这次服务启动之后的缓存行为，用来判断当前部署后的真实问题。'
      : '当前没有启动基线，这一栏暂时不能代表真实本次进程统计。',
    meta: scopeInfo.value.baselineAvailable
      ? `进程启动 ${formatScopeTime(scopeInfo.value.processStartedAt)} · 基线 ${formatScopeTime(scopeInfo.value.baselineCapturedAt)}`
      : '等待下一次服务启动时抓取基线',
    className: 'border-emerald-200 bg-emerald-50/70',
    ...processAggregate.value
  },
  {
    key: 'cumulative',
    title: '累计历史',
    badge: primaryScopeKey.value === 'cumulative' ? '当前默认' : '仅作参考',
    badgeClass:
      primaryScopeKey.value === 'cumulative'
        ? 'rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700'
        : 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700',
    summary: '直接读取 Redis 累计计数，适合看长期趋势，不适合判断刚部署后的新问题。',
    meta: scopeInfo.value.baselineCapturedAt
      ? `当前进程切分点 ${formatScopeTime(scopeInfo.value.baselineCapturedAt)}`
      : 'Redis 累计计数',
    className: 'border-slate-200 bg-slate-50/80',
    ...cumulativeAggregate.value
  }
])

const diagnosticCards = computed(() => [
  {
    label: '语义命中率',
    value: formatRatioPercent(l2PrimaryMetrics.value?.rates?.semanticHitRate),
    detail: `命中 ${formatNumber(l2PrimaryMetrics.value?.counters?.cache_hit_semantic)}`,
    className: 'text-emerald-600'
  },
  {
    label: '排序拒绝率',
    value: formatRatioPercent(l2PrimaryMetrics.value?.rates?.rankedRejectRate),
    detail: `拒绝 ${formatNumber(l2PrimaryMetrics.value?.counters?.cache_reject_ranked)}`,
    className: 'text-amber-600'
  },
  {
    label: 'Embedding 命中率',
    value: formatRatioPercent(l2PrimaryMetrics.value?.rates?.embeddingHitRate),
    detail: `请求 ${formatNumber(l2PrimaryMetrics.value?.totals?.embeddingRequests)}`,
    className: 'text-teal-600'
  },
  {
    label: 'Bypass 占比',
    value: formatRatioPercent(l2PrimaryMetrics.value?.summary?.bypassRate),
    detail: `bypass ${formatNumber(l2PrimaryMetrics.value?.counters?.cache_bypass)}`,
    className: 'text-rose-600'
  }
])

const configChips = computed(() => [
  { label: '相似度', value: formatThreshold(l2ConfigSnapshot.value.similarityThreshold) },
  { label: 'Rerank', value: formatThreshold(l2ConfigSnapshot.value.rankAcceptanceThreshold) },
  { label: 'Recall Token', value: formatNumber(l2ConfigSnapshot.value.recallTokenLimit) },
  { label: 'Recent', value: formatNumber(l2ConfigSnapshot.value.recallRecentLimit) },
  { label: 'Total', value: formatNumber(l2ConfigSnapshot.value.recallTotalLimit) },
  { label: 'Entry TTL', value: formatDays(l2ConfigSnapshot.value.entryTtlSeconds) },
  { label: 'Embedding TTL', value: formatDays(l2ConfigSnapshot.value.embeddingTtlSeconds) }
])

function buildLayerCard(key, title, metrics, className, badgeClass, titleClass, metricClass) {
  const hitCount = getLayerHitCount(key, metrics)
  const lookups = toSafeNumber(metrics?.totals?.lookups)
  const writes = toSafeNumber(metrics?.counters?.cache_write)
  const bypasses = toSafeNumber(metrics?.counters?.cache_bypass)
  const hitRate = getLayerHitRate(key, metrics)

  let status = '等待样本'
  let summary = '当前样本还不够，先继续观察 lookup 和写入是否稳定出现。'
  if (!metrics?.enabled) {
    status = '已关闭'
    summary = '当前层未参与缓存链路。'
  } else if (hitCount > 0) {
    status = '已有命中'
    summary = key === 'l2' ? diagnostics.value.message : '这一层已经开始带来可见的缓存复用收益。'
  } else if (lookups > 0 || writes > 0) {
    status = '预热中'
    summary = '缓存已经开始查找和写入，但还没有形成稳定命中。'
  } else if (bypasses > 0) {
    status = '绕过偏多'
    summary = '当前更应该先看 bypass 原因，而不是直接调参数。'
  }

  return {
    key,
    title,
    className,
    badgeClass,
    titleClass,
    metricClass,
    status,
    summary,
    detail: `${primaryLabel.value} · 请求 ${formatNumber(metrics?.totals?.requests)} · 可参与率 ${formatRatioPercent(metrics?.summary?.participationRate)}`,
    hitRate,
    hitCount,
    lookups,
    writes,
    bypasses
  }
}

const layerCards = computed(() => [
  buildLayerCard(
    'l1',
    'L1 精确缓存',
    l1PrimaryMetrics.value,
    'rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5',
    'rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700',
    'text-sky-700',
    'text-sky-600'
  ),
  buildLayerCard(
    'l2',
    'L2 语义缓存',
    l2PrimaryMetrics.value,
    'rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5',
    'rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700',
    'text-emerald-700',
    'text-emerald-600'
  ),
  buildLayerCard(
    'l3',
    'L3 全局缓存',
    l3PrimaryMetrics.value,
    'rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5',
    'rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700',
    'text-violet-700',
    'text-violet-600'
  )
])

function buildComparisonRow(key, title, processMetrics, cumulativeMetrics) {
  const processReason = processMetrics?.summary?.topBypassReason?.reason
  const cumulativeReason = cumulativeMetrics?.summary?.topBypassReason?.reason

  return {
    key,
    title,
    blocker: formatCacheBypassReason(processReason || cumulativeReason),
    processHitRate: scopeInfo.value.baselineAvailable
      ? formatRatioPercent(getLayerHitRate(key, processMetrics))
      : '--',
    processLookups: scopeInfo.value.baselineAvailable
      ? formatNumber(processMetrics?.totals?.lookups)
      : '--',
    processBypasses: scopeInfo.value.baselineAvailable
      ? formatNumber(processMetrics?.counters?.cache_bypass)
      : '--',
    cumulativeHitRate: formatRatioPercent(getLayerHitRate(key, cumulativeMetrics)),
    cumulativeLookups: formatNumber(cumulativeMetrics?.totals?.lookups),
    cumulativeBypasses: formatNumber(cumulativeMetrics?.counters?.cache_bypass)
  }
}

const comparisonRows = computed(() => [
  buildComparisonRow('l1', 'L1 精确缓存', l1ProcessMetrics.value, l1CumulativeMetrics.value),
  buildComparisonRow('l2', 'L2 语义缓存', l2ProcessMetrics.value, l2CumulativeMetrics.value),
  buildComparisonRow('l3', 'L3 全局缓存', l3ProcessMetrics.value, l3CumulativeMetrics.value)
])

const bypassGroups = computed(() => [
  {
    key: 'l1',
    title: 'L1 主要绕过原因',
    description: '优先看重复请求为什么没有进入精确缓存。',
    total: toSafeNumber(l1PrimaryMetrics.value?.counters?.cache_bypass),
    items: (l1PrimaryMetrics.value?.bypassReasons || []).slice(0, 4),
    className: 'border-sky-200'
  },
  {
    key: 'l2',
    title: 'L2 主要绕过原因',
    description: '如果语义缓存起不来，先确认哪些请求根本没有参与 L2。',
    total: toSafeNumber(l2PrimaryMetrics.value?.counters?.cache_bypass),
    items: (l2PrimaryMetrics.value?.bypassReasons || []).slice(0, 4),
    className: 'border-emerald-200'
  },
  {
    key: 'l3',
    title: 'L3 主要绕过原因',
    description: '跨 API Key 复用拉不起来时，先看这里的参与阻塞。',
    total: toSafeNumber(l3PrimaryMetrics.value?.counters?.cache_bypass),
    items: (l3PrimaryMetrics.value?.bypassReasons || []).slice(0, 4),
    className: 'border-violet-200'
  }
])

function getPriorityBadgeClass(priority) {
  return (
    {
      high: 'rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700',
      medium: 'rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700',
      low: 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700'
    }[priority] || 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700'
  )
}

function getPriorityLabel(priority) {
  return { high: '高优先级', medium: '中优先级', low: '观察项' }[priority] || '观察项'
}

function getReadinessLabel(readiness) {
  return { high: '可直接调参', medium: '可谨慎调参', low: '先补样本' }[readiness] || '先补样本'
}

function getPrimaryIssueLabel(issue) {
  return (
    {
      threshold: '阈值偏严',
      recall: '召回不足',
      bypass: '参与率不足',
      insufficient_data: '样本不足'
    }[issue] || '继续观察'
  )
}
</script>
