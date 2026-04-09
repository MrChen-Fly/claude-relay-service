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
                <h3 class="text-lg font-bold sm:text-xl">OpenAI 缓存观测</h3>
                <p class="mt-1 text-sm text-slate-200">
                  {{ overview.summary }}
                </p>
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
          <section class="rounded-3xl border border-amber-200 bg-amber-50/80 p-5">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p class="text-sm font-semibold text-amber-800">线上参数建议</p>
                <p class="mt-1 text-sm text-amber-700">
                  {{ diagnostics.message }}
                </p>
              </div>
              <span class="rounded-full bg-white px-3 py-1 text-xs font-medium text-amber-700">
                样本 {{ formatNumber(diagnostics.sampleSize) }}
              </span>
            </div>

            <div v-if="l2Recommendations.length > 0" class="mt-4 space-y-3">
              <div
                v-for="item in l2Recommendations"
                :key="item.id"
                class="rounded-2xl border border-white/80 bg-white/90 p-4 shadow-sm"
              >
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <span :class="getPriorityBadgeClass(item.priority)">
                        {{ getPriorityLabel(item.priority) }}
                      </span>
                      <p class="text-sm font-semibold text-slate-900">
                        {{ item.title }}
                      </p>
                    </div>
                    <p class="mt-2 text-sm text-slate-700">
                      {{ item.summary }}
                    </p>
                    <p class="mt-2 text-xs text-slate-500">
                      {{ item.rationale }}
                    </p>
                  </div>

                  <div
                    class="min-w-[180px] rounded-2xl bg-slate-50 px-4 py-3 text-xs text-slate-600"
                  >
                    <p>
                      <span class="font-medium text-slate-800">当前:</span>
                      {{ item.currentValue }}
                    </p>
                    <p class="mt-1">
                      <span class="font-medium text-slate-800">建议:</span>
                      {{ item.suggestedValue }}
                    </p>
                    <p class="mt-2 text-[11px] text-slate-500">
                      {{ formatRecommendationParams(item.params) }}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div
              v-else
              class="mt-4 rounded-2xl border border-dashed border-amber-200 bg-white/70 px-4 py-5 text-sm text-amber-700"
            >
              当前还没有足够样本生成线上参数建议，先继续积累真实 lookups。
            </div>
          </section>

          <section class="grid gap-4 lg:grid-cols-3">
            <article v-for="card in layerCards" :key="card.key" :class="card.className">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <p class="text-sm font-semibold" :class="card.titleClass">
                      {{ card.title }}
                    </p>
                    <span :class="card.badgeClass">{{ card.status }}</span>
                  </div>
                  <p class="mt-3 text-sm font-semibold text-slate-900">
                    {{ card.summary }}
                  </p>
                  <p class="mt-1 text-xs text-slate-500">
                    {{ card.detail }}
                  </p>
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
          </section>
        </div>

        <div class="space-y-4">
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
                <p class="mt-1 text-lg font-semibold" :class="item.className">
                  {{ item.value }}
                </p>
                <p class="mt-1 text-[11px] text-slate-500">
                  {{ item.detail }}
                </p>
              </div>
            </div>
          </section>

          <section class="rounded-3xl border border-slate-200 bg-slate-50/90 p-5">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="text-sm font-semibold text-slate-900">当前参数快照</p>
                <p class="mt-1 text-sm text-slate-500">
                  用于和线上调参建议对照，确认这轮是阈值问题、召回问题，还是参与率问题。
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
              <span class="text-xs font-medium text-slate-500">
                总计 {{ formatNumber(group.total) }}
              </span>
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
                  <p class="mt-0.5 truncate text-[11px] text-slate-500">
                    {{ item.reason }}
                  </p>
                </div>
                <span class="ml-3 text-sm font-semibold text-slate-900">
                  {{ formatNumber(item.count) }}
                </span>
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
import { formatNumber } from '@/utils/tools'

const props = defineProps({
  cacheMetrics: {
    type: Object,
    default: () => createDefaultCacheMetrics()
  }
})

const emptyMetrics = createDefaultCacheMetrics()

const bypassReasonLabels = {
  cache_disabled: '缓存未启用',
  missing_tenant: '缺少租户标识',
  stream_request: '流式请求',
  invalid_request_body: '请求体无效',
  dynamic_tools: '携带 tools 或动态字段',
  dynamic_request: '动态请求参数',
  request_background: '后台异步请求',
  request_web_search_options: '携带 web_search_options',
  tool_invalid_payload: 'tools 参数结构无效',
  tool_invalid_function: 'function tool 定义无效',
  tool_web_search_preview: '携带 web_search_preview 工具',
  tool_file_search: '携带 file_search 工具',
  tool_computer_use_preview: '携带 computer_use_preview 工具',
  tool_image_generation: '携带 image_generation 工具',
  tool_code_interpreter: '携带 code_interpreter 工具',
  tool_mcp: '携带 mcp 工具',
  temperature_too_high: '温度过高',
  unsupported_endpoint: '当前端点不支持',
  missing_embedding_base_api: '缺少 Embedding 地址',
  missing_account_credentials: '缺少 Embedding 凭证',
  structured_output_request: '结构化输出请求',
  missing_model: '缺少模型参数',
  unsupported_content_type: '内容类型不支持',
  unsupported_content_part: '内容片段不支持',
  unsupported_input_item: '输入项不支持',
  unsupported_instructions: 'instructions 不支持',
  missing_text_input: '缺少可嵌入文本',
  text_too_long: '文本过长',
  embedding_request_failed: 'Embedding 请求失败'
}

const l1Metrics = computed(() => props.cacheMetrics?.l1 || emptyMetrics.l1)
const l2Metrics = computed(() => props.cacheMetrics?.l2 || emptyMetrics.l2)
const l3Metrics = computed(() => props.cacheMetrics?.l3 || emptyMetrics.l3)
const l2ConfigSnapshot = computed(
  () => l2Metrics.value.configSnapshot || emptyMetrics.l2.configSnapshot
)
const diagnostics = computed(() => l2Metrics.value.diagnostics || emptyMetrics.l2.diagnostics)
const l2Recommendations = computed(() =>
  Array.isArray(l2Metrics.value.recommendations) ? l2Metrics.value.recommendations : []
)

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

const formatRecommendationParams = (params) => {
  if (!Array.isArray(params) || params.length === 0) {
    return '优先处理请求结构和召回样本，再决定是否改参数。'
  }

  return params.join(' / ')
}

const getLayerHitRate = (key, metrics) =>
  key === 'l2' ? toSafeNumber(metrics.rates?.semanticHitRate) : toSafeNumber(metrics.rates?.hitRate)

const getLayerHitCount = (key, metrics) =>
  key === 'l2'
    ? toSafeNumber(metrics.counters?.cache_hit_semantic)
    : toSafeNumber(metrics.counters?.cache_hit_exact)

const getPrimaryIssueLabel = (issue) => {
  const labelMap = {
    threshold: '阈值偏严',
    recall: '召回不足',
    bypass: '参与率不足',
    insufficient_data: '样本不足'
  }

  return labelMap[issue] || '继续观察'
}

const primaryBypassReason = computed(() => {
  const reasonMap = new Map()

  ;[l1Metrics.value, l2Metrics.value, l3Metrics.value].forEach((metrics) => {
    ;(metrics.bypassReasons || []).forEach((item) => {
      if (!item?.reason) {
        return
      }

      reasonMap.set(item.reason, (reasonMap.get(item.reason) || 0) + toSafeNumber(item.count))
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

const layerCards = computed(() => [
  buildLayerCard('l1', l1Metrics.value),
  buildLayerCard('l2', l2Metrics.value),
  buildLayerCard('l3', l3Metrics.value)
])

const overview = computed(() => {
  const bestLayer = [...layerCards.value]
    .filter((item) => item.metrics.enabled)
    .sort((left, right) => right.hitCount - left.hitCount || right.hitRate - left.hitRate)[0]
  const blocker = primaryBypassReason.value
    ? `${formatCacheBypassReason(primaryBypassReason.value.reason)} · ${formatNumber(primaryBypassReason.value.count)}`
    : '暂无明显阻塞'

  if (!l1Metrics.value.enabled && !l2Metrics.value.enabled && !l3Metrics.value.enabled) {
    return {
      summary: '当前 L1、L2、L3 都处于关闭状态，缓存链路不会产生收益。',
      stage: '缓存关闭',
      focus: '先确认服务端开关',
      blocker: '功能未启用'
    }
  }

  if (diagnostics.value.primaryIssue === 'threshold') {
    return {
      summary: '候选已经能召回，但通过率卡在相似度或 rerank 接受线，适合先做小步阈值调优。',
      stage: '召回后筛选',
      focus: '先放宽接受线',
      blocker
    }
  }

  if (diagnostics.value.primaryIssue === 'recall') {
    return {
      summary: 'L2 已在工作，但 hybrid recall 覆盖仍然偏窄，先扩大召回窗口比继续压阈值更有效。',
      stage: '召回池偏窄',
      focus: '优先加宽 recall 窗口',
      blocker
    }
  }

  if (bestLayer && bestLayer.hitCount > 0) {
    return {
      summary: '缓存已经开始贡献真实命中，当前重点是稳定放大命中，而不是继续堆展示指标。',
      stage: '进入复用阶段',
      focus: `继续放大 ${bestLayer.title} 的命中收益`,
      blocker
    }
  }

  if (diagnostics.value.primaryIssue === 'bypass') {
    return {
      summary: '当前最大问题仍是参与率，不是阈值本身；先把更多请求送进缓存链路。',
      stage: '参与率不足',
      focus: '优先降低 bypass',
      blocker
    }
  }

  return {
    summary: diagnostics.value.message,
    stage: '样本预热',
    focus: '继续积累 lookups',
    blocker
  }
})

const headerBadges = computed(() => [
  {
    label: `L1 ${l1Metrics.value.enabled ? '开启' : '关闭'}`,
    className:
      'rounded-full bg-sky-500/15 px-3 py-1 font-medium text-sky-100 ring-1 ring-inset ring-sky-300/30'
  },
  {
    label: `L2 ${l2Metrics.value.enabled ? '开启' : '关闭'}`,
    className:
      'rounded-full bg-emerald-500/15 px-3 py-1 font-medium text-emerald-100 ring-1 ring-inset ring-emerald-300/30'
  },
  {
    label: `L3 ${l3Metrics.value.enabled ? '开启' : '关闭'}`,
    className:
      'rounded-full bg-violet-500/15 px-3 py-1 font-medium text-violet-100 ring-1 ring-inset ring-violet-300/30'
  },
  {
    label: getReadinessLabel(diagnostics.value.tuningReadiness),
    className:
      'rounded-full bg-white/10 px-3 py-1 font-medium text-slate-100 ring-1 ring-inset ring-white/20'
  }
])

const diagnosticCards = computed(() => [
  {
    label: '语义命中率',
    value: formatRatioPercent(l2Metrics.value.rates?.semanticHitRate),
    detail: `命中 ${formatNumber(l2Metrics.value.counters?.cache_hit_semantic)}`,
    className: 'text-emerald-600'
  },
  {
    label: '排序拒绝率',
    value: formatRatioPercent(
      l2Metrics.value.rates?.rankedRejectRate || diagnostics.value.rankedRejectRate
    ),
    detail: `拒绝 ${formatNumber(l2Metrics.value.counters?.cache_reject_ranked)}`,
    className: 'text-amber-600'
  },
  {
    label: 'Follow-up 补强率',
    value: formatRatioPercent(
      l2Metrics.value.rates?.followUpEnrichmentRate || diagnostics.value.followUpEnrichmentRate
    ),
    detail: `补强 ${formatNumber(l2Metrics.value.counters?.followup_enriched)}`,
    className: 'text-sky-600'
  },
  {
    label: 'Recall 分片命中率',
    value: formatRatioPercent(
      l2Metrics.value.rates?.recallShardHitRate || diagnostics.value.recallShardHitRate
    ),
    detail: `lookups ${formatNumber(l2Metrics.value.counters?.recall_lookup)}`,
    className: 'text-violet-600'
  },
  {
    label: 'Embedding 命中率',
    value: formatRatioPercent(l2Metrics.value.rates?.embeddingHitRate),
    detail: `请求 ${formatNumber(l2Metrics.value.totals?.embeddingRequests)}`,
    className: 'text-teal-600'
  },
  {
    label: 'Bypass 占比',
    value: formatRatioPercent(l2Metrics.value.summary?.bypassRate),
    detail: `bypass ${formatNumber(l2Metrics.value.counters?.cache_bypass)}`,
    className: 'text-rose-600'
  }
])

const configChips = computed(() => [
  { label: '相似度', value: formatThreshold(l2ConfigSnapshot.value.similarityThreshold) },
  { label: 'Rerank', value: formatThreshold(l2ConfigSnapshot.value.rankAcceptanceThreshold) },
  { label: 'Recall Token', value: formatNumber(l2ConfigSnapshot.value.recallTokenLimit) },
  { label: 'Per Token', value: formatNumber(l2ConfigSnapshot.value.recallPerTokenLimit) },
  { label: 'Recent', value: formatNumber(l2ConfigSnapshot.value.recallRecentLimit) },
  { label: 'Total', value: formatNumber(l2ConfigSnapshot.value.recallTotalLimit) },
  { label: 'Max Candidates', value: formatNumber(l2ConfigSnapshot.value.maxCandidates) },
  { label: 'Entry TTL', value: formatDays(l2ConfigSnapshot.value.entryTtlSeconds) },
  { label: 'Embedding TTL', value: formatDays(l2ConfigSnapshot.value.embeddingTtlSeconds) },
  {
    label: 'Context Buffer',
    value: l2ConfigSnapshot.value.contextBufferEnabled
      ? `${formatNumber(l2ConfigSnapshot.value.contextBufferMaxItems)} 条`
      : '关闭'
  }
])

const bypassGroups = computed(() => [
  {
    key: 'l1',
    title: 'L1 主要绕过原因',
    description: '优先看重复请求为什么没有进入精确缓存。',
    total: toSafeNumber(l1Metrics.value.counters?.cache_bypass),
    items: (l1Metrics.value.bypassReasons || []).slice(0, 4),
    className: 'border-sky-200'
  },
  {
    key: 'l2',
    title: 'L2 主要绕过原因',
    description: '如果语义缓存起不来，先确认哪些请求根本没有参与 L2。',
    total: toSafeNumber(l2Metrics.value.counters?.cache_bypass),
    items: (l2Metrics.value.bypassReasons || []).slice(0, 4),
    className: 'border-emerald-200'
  },
  {
    key: 'l3',
    title: 'L3 主要绕过原因',
    description: '跨 API Key 复用拉不起来时，先看这里的参与阻塞。',
    total: toSafeNumber(l3Metrics.value.counters?.cache_bypass),
    items: (l3Metrics.value.bypassReasons || []).slice(0, 4),
    className: 'border-violet-200'
  }
])

function buildLayerCard(key, metrics) {
  const toneMap = {
    l1: {
      title: 'L1 精确缓存',
      className: 'rounded-3xl border border-sky-200 bg-gradient-to-br from-sky-50 to-white p-5',
      badgeClass: 'rounded-full bg-sky-100 px-3 py-1 text-xs font-medium text-sky-700',
      titleClass: 'text-sky-700',
      metricClass: 'text-sky-600'
    },
    l2: {
      title: 'L2 语义缓存',
      className:
        'rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white p-5',
      badgeClass: 'rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700',
      titleClass: 'text-emerald-700',
      metricClass: 'text-emerald-600'
    },
    l3: {
      title: 'L3 全局缓存',
      className:
        'rounded-3xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white p-5',
      badgeClass: 'rounded-full bg-violet-100 px-3 py-1 text-xs font-medium text-violet-700',
      titleClass: 'text-violet-700',
      metricClass: 'text-violet-600'
    }
  }

  const hitCount = getLayerHitCount(key, metrics)
  const lookups = toSafeNumber(metrics.totals?.lookups)
  const writes = toSafeNumber(metrics.counters?.cache_write)
  const bypasses = toSafeNumber(metrics.counters?.cache_bypass)
  const hitRate = getLayerHitRate(key, metrics)
  const participationRate = formatRatioPercent(metrics.summary?.participationRate)
  const requests = formatNumber(metrics.totals?.requests)

  let status = '等待样本'
  let summary = '当前样本还不够，先继续观察 lookup 和写入是否稳定出现。'

  if (!metrics.enabled) {
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
    ...toneMap[key],
    status,
    summary,
    detail: `请求 ${requests} · 可参与率 ${participationRate}`,
    hitRate,
    hitCount,
    lookups,
    writes,
    bypasses,
    metrics
  }
}

function getPriorityBadgeClass(priority) {
  const classMap = {
    high: 'rounded-full bg-rose-100 px-3 py-1 text-xs font-medium text-rose-700',
    medium: 'rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-700',
    low: 'rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700'
  }

  return classMap[priority] || classMap.low
}

function getPriorityLabel(priority) {
  const labelMap = {
    high: '高优先级',
    medium: '中优先级',
    low: '观察项'
  }

  return labelMap[priority] || labelMap.low
}

function getReadinessLabel(readiness) {
  const labelMap = {
    high: '可直接调参',
    medium: '可谨慎调参',
    low: '先补样本'
  }

  return labelMap[readiness] || labelMap.low
}
</script>
