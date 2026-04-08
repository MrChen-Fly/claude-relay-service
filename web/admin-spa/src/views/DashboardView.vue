<template>
  <div>
    <!-- 主要统计 -->
    <div
      class="mb-4 grid grid-cols-1 gap-3 sm:mb-6 sm:grid-cols-2 sm:gap-4 md:mb-8 md:gap-6 lg:grid-cols-4"
    >
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              总API Keys
            </p>
            <p class="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
              {{ dashboardData.totalApiKeys }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              活跃: {{ dashboardData.activeApiKeys || 0 }}
            </p>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-blue-500 to-blue-600">
            <i class="fas fa-key" />
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div class="flex-1">
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              服务账户
            </p>
            <div class="flex flex-wrap items-baseline gap-x-2">
              <p class="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
                {{ dashboardData.totalAccounts }}
              </p>
              <!-- 各平台账户数量展示 -->
              <div v-if="dashboardData.accountsByPlatform" class="flex items-center gap-2">
                <!-- Claude账户 -->
                <div
                  v-if="
                    dashboardData.accountsByPlatform.claude &&
                    dashboardData.accountsByPlatform.claude.total > 0
                  "
                  class="inline-flex items-center gap-0.5"
                  :title="`Claude: ${dashboardData.accountsByPlatform.claude.total} 个 (正常: ${dashboardData.accountsByPlatform.claude.normal})`"
                >
                  <i class="fas fa-brain text-xs text-indigo-600" />
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{
                    dashboardData.accountsByPlatform.claude.total
                  }}</span>
                </div>
                <!-- Claude Console账户 -->
                <div
                  v-if="
                    dashboardData.accountsByPlatform['claude-console'] &&
                    dashboardData.accountsByPlatform['claude-console'].total > 0
                  "
                  class="inline-flex items-center gap-0.5"
                  :title="`Console: ${dashboardData.accountsByPlatform['claude-console'].total} 个 (正常: ${dashboardData.accountsByPlatform['claude-console'].normal})`"
                >
                  <i class="fas fa-terminal text-xs text-purple-600" />
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{
                    dashboardData.accountsByPlatform['claude-console'].total
                  }}</span>
                </div>
                <!-- Gemini账户 -->
                <div
                  v-if="
                    dashboardData.accountsByPlatform.gemini &&
                    dashboardData.accountsByPlatform.gemini.total > 0
                  "
                  class="inline-flex items-center gap-0.5"
                  :title="`Gemini: ${dashboardData.accountsByPlatform.gemini.total} 个 (正常: ${dashboardData.accountsByPlatform.gemini.normal})`"
                >
                  <i class="fas fa-robot text-xs text-yellow-600" />
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{
                    dashboardData.accountsByPlatform.gemini.total
                  }}</span>
                </div>
                <!-- Bedrock账户 -->
                <div
                  v-if="
                    dashboardData.accountsByPlatform.bedrock &&
                    dashboardData.accountsByPlatform.bedrock.total > 0
                  "
                  class="inline-flex items-center gap-0.5"
                  :title="`Bedrock: ${dashboardData.accountsByPlatform.bedrock.total} 个 (正常: ${dashboardData.accountsByPlatform.bedrock.normal})`"
                >
                  <i class="fab fa-aws text-xs text-orange-600" />
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{
                    dashboardData.accountsByPlatform.bedrock.total
                  }}</span>
                </div>
                <!-- OpenAI账户 -->
                <div
                  v-if="
                    dashboardData.accountsByPlatform.openai &&
                    dashboardData.accountsByPlatform.openai.total > 0
                  "
                  class="inline-flex items-center gap-0.5"
                  :title="`OpenAI: ${dashboardData.accountsByPlatform.openai.total} 个 (正常: ${dashboardData.accountsByPlatform.openai.normal})`"
                >
                  <i class="fas fa-openai text-xs text-gray-100" />
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{
                    dashboardData.accountsByPlatform.openai.total
                  }}</span>
                </div>
                <!-- Azure OpenAI账户 -->
                <div
                  v-if="
                    dashboardData.accountsByPlatform.azure_openai &&
                    dashboardData.accountsByPlatform.azure_openai.total > 0
                  "
                  class="inline-flex items-center gap-0.5"
                  :title="`Azure OpenAI: ${dashboardData.accountsByPlatform.azure_openai.total} 个 (正常: ${dashboardData.accountsByPlatform.azure_openai.normal})`"
                >
                  <i class="fab fa-microsoft text-xs text-blue-600" />
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{
                    dashboardData.accountsByPlatform.azure_openai.total
                  }}</span>
                </div>
                <!-- OpenAI-Responses账户 -->
                <div
                  v-if="
                    dashboardData.accountsByPlatform['openai-responses'] &&
                    dashboardData.accountsByPlatform['openai-responses'].total > 0
                  "
                  class="inline-flex items-center gap-0.5"
                  :title="`OpenAI Responses: ${dashboardData.accountsByPlatform['openai-responses'].total} 个 (正常: ${dashboardData.accountsByPlatform['openai-responses'].normal})`"
                >
                  <i class="fas fa-server text-xs text-cyan-600" />
                  <span class="text-xs font-medium text-gray-700 dark:text-gray-300">{{
                    dashboardData.accountsByPlatform['openai-responses'].total
                  }}</span>
                </div>
              </div>
            </div>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              正常: {{ dashboardData.normalAccounts || 0 }}
              <span v-if="dashboardData.abnormalAccounts > 0" class="text-red-600">
                | 异常: {{ dashboardData.abnormalAccounts }}
              </span>
              <span
                v-if="dashboardData.pausedAccounts > 0"
                class="text-gray-600 dark:text-gray-400"
              >
                | 停止调度: {{ dashboardData.pausedAccounts }}
              </span>
              <span v-if="dashboardData.rateLimitedAccounts > 0" class="text-yellow-600">
                | 限流: {{ dashboardData.rateLimitedAccounts }}
              </span>
            </p>
          </div>
          <div class="stat-icon ml-2 flex-shrink-0 bg-gradient-to-br from-green-500 to-green-600">
            <i class="fas fa-user-circle" />
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              今日请求
            </p>
            <p class="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
              {{ dashboardData.todayRequests }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              总请求: {{ formatNumber(dashboardData.totalRequests || 0) }}
            </p>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-purple-500 to-purple-600">
            <i class="fas fa-chart-line" />
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              系统状态
            </p>
            <p class="text-2xl font-bold text-green-600 sm:text-3xl">
              {{ dashboardData.systemStatus }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              运行时间: {{ formattedUptime }}
            </p>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-yellow-500 to-orange-500">
            <i class="fas fa-heartbeat" />
          </div>
        </div>
      </div>
    </div>

    <!-- 账户余额/配额汇总 -->
    <div class="mb-4 grid grid-cols-1 gap-3 sm:mb-6 sm:grid-cols-2 sm:gap-4 md:mb-8 md:gap-6">
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              账户余额/配额
            </p>
            <p class="text-2xl font-bold text-gray-900 dark:text-gray-100 sm:text-3xl">
              {{ formatCurrencyUsd(balanceSummary.totalBalance || 0) }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              低余额: {{ balanceSummary.lowBalanceCount || 0 }} | 总成本:
              {{ formatCurrencyUsd(balanceSummary.totalCost || 0) }}
            </p>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-emerald-500 to-green-600">
            <i class="fas fa-wallet" />
          </div>
        </div>

        <div class="mt-3 flex items-center justify-between gap-3">
          <p class="text-xs text-gray-500 dark:text-gray-400">
            更新时间: {{ formatLastUpdate(balanceSummaryUpdatedAt) }}
          </p>
          <button
            class="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all duration-200 hover:border-gray-300 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:border-gray-500"
            :disabled="loadingBalanceSummary"
            @click="loadBalanceSummary"
          >
            <i :class="['fas', loadingBalanceSummary ? 'fa-spinner fa-spin' : 'fa-sync-alt']" />
            刷新
          </button>
        </div>
      </div>

      <div class="card p-4 sm:p-6">
        <div class="mb-3 flex items-center justify-between">
          <h3 class="text-sm font-semibold text-gray-900 dark:text-gray-100">低余额账户</h3>
          <span class="text-xs text-gray-500 dark:text-gray-400">
            {{ lowBalanceAccounts.length }} 个
          </span>
        </div>

        <div
          v-if="loadingBalanceSummary"
          class="py-6 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          正在加载...
        </div>
        <div
          v-else-if="lowBalanceAccounts.length === 0"
          class="py-6 text-center text-sm text-green-600 dark:text-green-400"
        >
          全部正常
        </div>
        <div v-else class="max-h-64 space-y-2 overflow-y-auto">
          <div
            v-for="account in lowBalanceAccounts"
            :key="account.accountId"
            class="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-900/20"
          >
            <div class="flex items-center justify-between gap-2">
              <div class="truncate text-sm font-medium text-gray-900 dark:text-gray-100">
                {{ account.name || account.accountId }}
              </div>
              <span
                class="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600 dark:bg-gray-700 dark:text-gray-300"
              >
                {{ getBalancePlatformLabel(account.platform) }}
              </span>
            </div>
            <div class="mt-1 text-xs text-gray-600 dark:text-gray-400">
              <span v-if="account.balance">余额: {{ account.balance.formattedAmount }}</span>
              <span v-else
                >今日成本: {{ formatCurrencyUsd(account.statistics?.dailyCost || 0) }}</span
              >
            </div>
            <div v-if="account.quota && typeof account.quota.percentage === 'number'" class="mt-2">
              <div
                class="mb-1 flex items-center justify-between text-xs text-gray-600 dark:text-gray-400"
              >
                <span>配额使用</span>
                <span class="text-red-600 dark:text-red-400">
                  {{ account.quota.percentage.toFixed(1) }}%
                </span>
              </div>
              <div class="h-2 w-full rounded-full bg-gray-200 dark:bg-gray-700">
                <div
                  class="h-2 rounded-full bg-red-500"
                  :style="{ width: `${Math.min(100, account.quota.percentage)}%` }"
                ></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Token统计和性能指标 -->
    <div
      class="mb-4 grid grid-cols-1 gap-3 sm:mb-6 sm:grid-cols-2 sm:gap-4 md:mb-8 md:gap-6 lg:grid-cols-4"
    >
      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div class="mr-8 flex-1">
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              今日Token
            </p>
            <div class="mb-2 flex flex-wrap items-baseline gap-2">
              <p class="text-xl font-bold text-blue-600 sm:text-2xl md:text-3xl">
                {{
                  formatNumber(
                    (dashboardData.todayInputTokens || 0) +
                      (dashboardData.todayOutputTokens || 0) +
                      (dashboardData.todayCacheCreateTokens || 0) +
                      (dashboardData.todayCacheReadTokens || 0)
                  )
                }}
              </p>
              <span class="text-sm font-medium text-green-600"
                >/ {{ costsData.todayCosts.formatted.totalCost }}</span
              >
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              <div class="flex flex-wrap items-center justify-between gap-x-4">
                <span
                  >输入:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.todayInputTokens || 0)
                  }}</span></span
                >
                <span
                  >输出:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.todayOutputTokens || 0)
                  }}</span></span
                >
                <span v-if="(dashboardData.todayCacheCreateTokens || 0) > 0" class="text-purple-600"
                  >缓存创建:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.todayCacheCreateTokens || 0)
                  }}</span></span
                >
                <span v-if="(dashboardData.todayCacheReadTokens || 0) > 0" class="text-purple-600"
                  >缓存读取:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.todayCacheReadTokens || 0)
                  }}</span></span
                >
              </div>
            </div>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-indigo-500 to-indigo-600">
            <i class="fas fa-coins" />
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div class="mr-8 flex-1">
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              总Token消耗
            </p>
            <div class="mb-2 flex flex-wrap items-baseline gap-2">
              <p class="text-xl font-bold text-emerald-600 sm:text-2xl md:text-3xl">
                {{
                  formatNumber(
                    (dashboardData.totalInputTokens || 0) +
                      (dashboardData.totalOutputTokens || 0) +
                      (dashboardData.totalCacheCreateTokens || 0) +
                      (dashboardData.totalCacheReadTokens || 0)
                  )
                }}
              </p>
              <span class="text-sm font-medium text-green-600"
                >/ {{ costsData.totalCosts.formatted.totalCost }}</span
              >
            </div>
            <div class="text-xs text-gray-500 dark:text-gray-400">
              <div class="flex flex-wrap items-center justify-between gap-x-4">
                <span
                  >输入:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.totalInputTokens || 0)
                  }}</span></span
                >
                <span
                  >输出:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.totalOutputTokens || 0)
                  }}</span></span
                >
                <span v-if="(dashboardData.totalCacheCreateTokens || 0) > 0" class="text-purple-600"
                  >缓存创建:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.totalCacheCreateTokens || 0)
                  }}</span></span
                >
                <span v-if="(dashboardData.totalCacheReadTokens || 0) > 0" class="text-purple-600"
                  >缓存读取:
                  <span class="font-medium">{{
                    formatNumber(dashboardData.totalCacheReadTokens || 0)
                  }}</span></span
                >
              </div>
            </div>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-emerald-500 to-emerald-600">
            <i class="fas fa-database" />
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              实时RPM
              <span class="text-xs text-gray-400">({{ dashboardData.metricsWindow }}分钟)</span>
            </p>
            <p class="text-2xl font-bold text-orange-600 sm:text-3xl">
              {{ dashboardData.realtimeRPM || 0 }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              每分钟请求数
              <span v-if="dashboardData.isHistoricalMetrics" class="text-yellow-600">
                <i class="fas fa-exclamation-circle" /> 历史数据
              </span>
            </p>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-orange-500 to-orange-600">
            <i class="fas fa-tachometer-alt" />
          </div>
        </div>
      </div>

      <div class="stat-card">
        <div class="flex items-center justify-between">
          <div>
            <p class="mb-1 text-xs font-semibold text-gray-600 dark:text-gray-400 sm:text-sm">
              实时TPM
              <span class="text-xs text-gray-400">({{ dashboardData.metricsWindow }}分钟)</span>
            </p>
            <p class="text-2xl font-bold text-rose-600 sm:text-3xl">
              {{ formatNumber(dashboardData.realtimeTPM || 0) }}
            </p>
            <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
              每分钟Token数
              <span v-if="dashboardData.isHistoricalMetrics" class="text-yellow-600">
                <i class="fas fa-exclamation-circle" /> 历史数据
              </span>
            </p>
          </div>
          <div class="stat-icon flex-shrink-0 bg-gradient-to-br from-rose-500 to-rose-600">
            <i class="fas fa-rocket" />
          </div>
        </div>
      </div>
    </div>

    <!-- OpenAI 缓存观测 -->
    <div class="mb-4 sm:mb-6 md:mb-8">
      <div class="card p-4 sm:p-6">
        <div class="flex flex-col gap-4">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
                OpenAI 缓存观测
              </h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {{ cacheOverview.summary }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
              <span
                class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 font-medium text-blue-700 dark:border-blue-900/60 dark:bg-blue-900/20 dark:text-blue-300"
              >
                L1 {{ l1CacheMetrics.enabled ? '开启' : '关闭' }}
              </span>
              <span
                class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 font-medium text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300"
              >
                L2 {{ l2CacheMetrics.enabled ? '开启' : '关闭' }}
              </span>
              <span
                class="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 font-medium text-violet-700 dark:border-violet-900/60 dark:bg-violet-900/20 dark:text-violet-300"
              >
                L3 {{ l3CacheMetrics.enabled ? '开启' : '关闭' }}
              </span>
              <span
                class="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 font-medium text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300"
              >
                {{ l2ModeLabel }}
              </span>
              <span
                class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-200"
              >
                阈值 {{ formatSimilarityThreshold(l2CacheMetrics.similarityThreshold) }}
              </span>
            </div>
          </div>

          <div
            class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40"
          >
            <div class="grid grid-cols-1 gap-3 md:grid-cols-3">
              <div class="rounded-xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400">当前阶段</p>
                <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {{ cacheOverview.stage }}
                </p>
              </div>
              <div class="rounded-xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400">下一步关注</p>
                <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {{ cacheOverview.focus }}
                </p>
              </div>
              <div class="rounded-xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                <p class="text-xs font-medium text-gray-500 dark:text-gray-400">主要阻塞</p>
                <p class="mt-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {{ cacheOverview.blocker }}
                </p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div
              class="rounded-3xl border border-sky-100 bg-gradient-to-br from-sky-50 via-white to-white p-5 dark:border-sky-900/40 dark:from-sky-950/20 dark:via-gray-900 dark:to-gray-900"
            >
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold text-sky-700 dark:text-sky-300">
                        L1 精确缓存
                      </p>
                      <span :class="l1CacheSummary.badgeClass">{{ l1CacheSummary.state }}</span>
                    </div>
                    <p class="mt-3 text-base font-semibold text-gray-900 dark:text-gray-100">
                      {{ l1CacheSummary.summary }}
                    </p>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {{ l1CacheSummary.detail }}
                    </p>
                  </div>
                  <div class="text-left lg:text-right">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">命中率</p>
                    <p class="mt-1 text-3xl font-bold text-sky-600 dark:text-sky-300">
                      {{ formatRatioPercent(l1CacheMetrics.rates.hitRate) }}
                    </p>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">命中</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l1CacheMetrics.counters.cache_hit_exact) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">查找</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l1CacheMetrics.totals.lookups) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">写入</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l1CacheMetrics.counters.cache_write) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Bypass</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l1CacheMetrics.counters.cache_bypass) }}
                    </p>
                  </div>
                </div>

                <p class="text-xs text-gray-500 dark:text-gray-400">
                  可参与率 {{ formatRatioPercent(l1CacheMetrics.summary?.participationRate) }} ·
                  Miss {{ formatNumber(l1CacheMetrics.counters.cache_miss) }} · 请求
                  {{ formatNumber(l1CacheMetrics.totals.requests) }}
                </p>
              </div>
            </div>

            <div
              class="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 via-white to-white p-5 dark:border-emerald-900/40 dark:from-emerald-950/20 dark:via-gray-900 dark:to-gray-900"
            >
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold text-emerald-700 dark:text-emerald-300">
                        L2 语义缓存
                      </p>
                      <span :class="l2CacheSummary.badgeClass">{{ l2CacheSummary.state }}</span>
                      <span
                        class="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300"
                      >
                        {{ l2ModeLabel }}
                      </span>
                    </div>
                    <p class="mt-3 text-base font-semibold text-gray-900 dark:text-gray-100">
                      {{ l2CacheSummary.summary }}
                    </p>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {{ l2CacheSummary.detail }}
                    </p>
                  </div>
                  <div class="text-left lg:text-right">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">
                      {{ l2PrimaryMetricLabel }}
                    </p>
                    <p class="mt-1 text-3xl font-bold text-emerald-600 dark:text-emerald-300">
                      {{ formatRatioPercent(l2PrimaryMetricRate) }}
                    </p>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">
                      {{ l2PrimaryMetricCountLabel }}
                    </p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l2PrimaryMetricCount) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Lookups</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l2CacheMetrics.totals.lookups) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Embedding 请求</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l2CacheMetrics.totals.embeddingRequests) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Bypass</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l2CacheMetrics.counters.cache_bypass) }}
                    </p>
                  </div>
                </div>

                <p class="text-xs text-gray-500 dark:text-gray-400">
                  可参与率 {{ formatRatioPercent(l2CacheMetrics.summary?.participationRate) }} ·
                  Embedding {{ l2CacheMetrics.embeddingModel }} · 写入
                  {{ formatNumber(l2CacheMetrics.counters.cache_write) }}
                </p>
              </div>
            </div>

            <div
              class="rounded-3xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-white p-5 dark:border-violet-900/40 dark:from-violet-950/20 dark:via-gray-900 dark:to-gray-900"
            >
              <div class="flex flex-col gap-4">
                <div class="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div class="flex flex-wrap items-center gap-2">
                      <p class="text-sm font-semibold text-violet-700 dark:text-violet-300">
                        L3 全局缓存
                      </p>
                      <span :class="l3CacheSummary.badgeClass">{{ l3CacheSummary.state }}</span>
                    </div>
                    <p class="mt-3 text-base font-semibold text-gray-900 dark:text-gray-100">
                      {{ l3CacheSummary.summary }}
                    </p>
                    <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {{ l3CacheSummary.detail }}
                    </p>
                  </div>
                  <div class="text-left lg:text-right">
                    <p class="text-xs font-medium text-gray-500 dark:text-gray-400">命中率</p>
                    <p class="mt-1 text-3xl font-bold text-violet-600 dark:text-violet-300">
                      {{ formatRatioPercent(l3CacheMetrics.rates.hitRate) }}
                    </p>
                  </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">命中</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l3CacheMetrics.counters.cache_hit_exact) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">查找</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l3CacheMetrics.totals.lookups) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">写入</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l3CacheMetrics.counters.cache_write) }}
                    </p>
                  </div>
                  <div class="rounded-2xl bg-white/80 px-4 py-3 shadow-sm dark:bg-slate-950/60">
                    <p class="text-xs text-gray-500 dark:text-gray-400">Bypass</p>
                    <p class="mt-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
                      {{ formatNumber(l3CacheMetrics.counters.cache_bypass) }}
                    </p>
                  </div>
                </div>

                <p class="text-xs text-gray-500 dark:text-gray-400">
                  可参与率 {{ formatRatioPercent(l3CacheMetrics.summary?.participationRate) }} ·
                  Miss {{ formatNumber(l3CacheMetrics.counters.cache_miss) }} · 请求
                  {{ formatNumber(l3CacheMetrics.totals.requests) }}
                </p>
              </div>
            </div>
          </div>

          <div class="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <div
              class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    L1 主要绕过原因
                  </p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    先看第一项，通常就是 L1 没起量的主要原因。
                  </p>
                </div>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  总计 {{ formatNumber(l1CacheMetrics.counters.cache_bypass) }}
                </span>
              </div>
              <div v-if="l1BypassReasons.length > 0" class="mt-3 space-y-2">
                <div
                  v-for="item in l1BypassReasons"
                  :key="`l1-${item.reason}`"
                  class="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-slate-950/60"
                >
                  <div class="min-w-0">
                    <p class="truncate font-medium text-gray-800 dark:text-gray-100">
                      {{ formatCacheBypassReason(item.reason) }}
                    </p>
                    <p class="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                      {{ item.reason }}
                    </p>
                  </div>
                  <span class="ml-3 text-sm font-semibold text-sky-600 dark:text-sky-300">
                    {{ formatNumber(item.count) }}
                  </span>
                </div>
              </div>
              <p v-else class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                暂时没有明显的 L1 绕过原因。
              </p>
            </div>

            <div
              class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    L2 主要绕过原因
                  </p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    如果 L2 一直没开始检索，优先先看这里。
                  </p>
                </div>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  总计 {{ formatNumber(l2CacheMetrics.counters.cache_bypass) }}
                </span>
              </div>
              <div v-if="l2BypassReasons.length > 0" class="mt-3 space-y-2">
                <div
                  v-for="item in l2BypassReasons"
                  :key="`l2-${item.reason}`"
                  class="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-slate-950/60"
                >
                  <div class="min-w-0">
                    <p class="truncate font-medium text-gray-800 dark:text-gray-100">
                      {{ formatCacheBypassReason(item.reason) }}
                    </p>
                    <p class="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                      {{ item.reason }}
                    </p>
                  </div>
                  <span class="ml-3 text-sm font-semibold text-emerald-600 dark:text-emerald-300">
                    {{ formatNumber(item.count) }}
                  </span>
                </div>
              </div>
              <p v-else class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                暂时没有明显的 L2 绕过原因。
              </p>
            </div>

            <div
              class="rounded-2xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/40"
            >
              <div class="flex items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-semibold text-gray-800 dark:text-gray-100">
                    L3 主要绕过原因
                  </p>
                  <p class="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    如果 L3 一直没开始共享命中，优先先看这里。
                  </p>
                </div>
                <span class="text-xs text-gray-500 dark:text-gray-400">
                  总计 {{ formatNumber(l3CacheMetrics.counters.cache_bypass) }}
                </span>
              </div>
              <div v-if="l3BypassReasons.length > 0" class="mt-3 space-y-2">
                <div
                  v-for="item in l3BypassReasons"
                  :key="`l3-${item.reason}`"
                  class="flex items-center justify-between rounded-xl bg-white px-3 py-2 text-sm shadow-sm dark:bg-slate-950/60"
                >
                  <div class="min-w-0">
                    <p class="truncate font-medium text-gray-800 dark:text-gray-100">
                      {{ formatCacheBypassReason(item.reason) }}
                    </p>
                    <p class="mt-0.5 truncate text-xs text-gray-400 dark:text-gray-500">
                      {{ item.reason }}
                    </p>
                  </div>
                  <span class="ml-3 text-sm font-semibold text-violet-600 dark:text-violet-300">
                    {{ formatNumber(item.count) }}
                  </span>
                </div>
              </div>
              <p v-else class="mt-3 text-sm text-gray-500 dark:text-gray-400">
                暂时没有明显的 L3 绕过原因。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模型消费统计 -->
    <div class="mb-8">
      <div class="mb-4 flex flex-col gap-4 sm:mb-6">
        <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 sm:text-xl">
          模型使用分布与Token使用趋势
        </h3>
        <div class="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-end">
          <!-- 快捷日期选择 -->
          <div
            class="flex flex-shrink-0 gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 dark:bg-gray-700"
          >
            <button
              v-for="option in dateFilter.presetOptions"
              :key="option.value"
              :class="[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                dateFilter.preset === option.value && dateFilter.type === 'preset'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              ]"
              @click="setDateFilterPreset(option.value)"
            >
              {{ option.label }}
            </button>
          </div>

          <!-- 粒度切换按钮 -->
          <div class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
            <button
              :class="[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                trendGranularity === 'day'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              ]"
              @click="setTrendGranularity('day')"
            >
              <i class="fas fa-calendar-day mr-1" />按天
            </button>
            <button
              :class="[
                'rounded-md px-3 py-1 text-sm font-medium transition-colors',
                trendGranularity === 'hour'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              ]"
              @click="setTrendGranularity('hour')"
            >
              <i class="fas fa-clock mr-1" />按小时
            </button>
          </div>

          <!-- Element Plus 日期范围选择器 -->
          <div class="flex items-center gap-2">
            <el-date-picker
              v-model="dateFilter.customRange"
              class="custom-date-picker w-full lg:w-auto"
              :default-time="defaultTime"
              :disabled-date="disabledDate"
              end-placeholder="结束日期"
              format="YYYY-MM-DD HH:mm:ss"
              range-separator="至"
              size="default"
              start-placeholder="开始日期"
              style="max-width: 400px"
              type="datetimerange"
              value-format="YYYY-MM-DD HH:mm:ss"
              @change="onCustomDateRangeChange"
            />
            <span v-if="trendGranularity === 'hour'" class="text-xs text-orange-600">
              <i class="fas fa-info-circle" /> 最多24小时
            </span>
          </div>

          <!-- 刷新控制 -->
          <div class="flex items-center gap-2">
            <!-- 自动刷新控制 -->
            <div class="flex items-center rounded-lg bg-gray-100 px-3 py-1 dark:bg-gray-700">
              <label class="relative inline-flex cursor-pointer items-center">
                <input v-model="autoRefreshEnabled" class="peer sr-only" type="checkbox" />
                <!-- 更小的开关 -->
                <div
                  class="peer relative h-5 w-9 rounded-full bg-gray-300 transition-all duration-200 after:absolute after:left-[2px] after:top-0.5 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform after:duration-200 after:content-[''] peer-checked:bg-blue-500 peer-checked:after:translate-x-4 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-300 dark:bg-gray-600 dark:after:bg-gray-300 dark:peer-focus:ring-blue-600"
                />
                <span
                  class="ml-2.5 flex select-none items-center gap-1 text-sm font-medium text-gray-600 dark:text-gray-300"
                >
                  <i class="fas fa-redo-alt text-xs text-gray-500 dark:text-gray-400" />
                  <span>自动刷新</span>
                  <span
                    v-if="autoRefreshEnabled"
                    class="ml-1 font-mono text-xs text-blue-600 transition-opacity"
                    :class="refreshCountdown > 0 ? 'opacity-100' : 'opacity-0'"
                  >
                    {{ refreshCountdown }}s
                  </span>
                </span>
              </label>
            </div>

            <!-- 刷新按钮 -->
            <button
              class="flex items-center gap-1 rounded-md border border-gray-300 bg-white px-3 py-1 text-sm font-medium text-blue-600 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:hover:bg-gray-700 sm:gap-2"
              :disabled="isRefreshing"
              title="立即刷新数据"
              @click="refreshAllData()"
            >
              <i :class="['fas fa-sync-alt text-xs', { 'animate-spin': isRefreshing }]" />
              <span class="hidden sm:inline">{{ isRefreshing ? '刷新中' : '刷新' }}</span>
            </button>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <!-- 饼图 -->
        <div class="card p-4 sm:p-6">
          <h4 class="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200 sm:text-lg">
            Token使用分布
          </h4>
          <div class="relative" style="height: 250px">
            <canvas ref="modelUsageChart" />
          </div>
        </div>

        <!-- 详细数据表格 -->
        <div class="card p-4 sm:p-6">
          <h4 class="mb-4 text-base font-semibold text-gray-800 dark:text-gray-200 sm:text-lg">
            详细统计数据
          </h4>
          <div v-if="dashboardModelStats.length === 0" class="py-8 text-center">
            <p class="text-sm text-gray-500 sm:text-base">暂无模型使用数据</p>
          </div>
          <div v-else class="max-h-[250px] overflow-auto sm:max-h-[300px]">
            <table class="min-w-full">
              <thead class="sticky top-0 bg-gray-50 dark:bg-gray-700">
                <tr>
                  <th
                    class="px-2 py-2 text-left text-xs font-medium text-gray-700 dark:text-gray-300 sm:px-4"
                  >
                    模型
                  </th>
                  <th
                    class="hidden px-2 py-2 text-right text-xs font-medium text-gray-700 dark:text-gray-300 sm:table-cell sm:px-4"
                  >
                    请求数
                  </th>
                  <th
                    class="px-2 py-2 text-right text-xs font-medium text-gray-700 dark:text-gray-300 sm:px-4"
                  >
                    总Token
                  </th>
                  <th
                    class="px-2 py-2 text-right text-xs font-medium text-gray-700 dark:text-gray-300 sm:px-4"
                  >
                    费用
                  </th>
                  <th
                    class="hidden px-2 py-2 text-right text-xs font-medium text-gray-700 dark:text-gray-300 sm:table-cell sm:px-4"
                  >
                    占比
                  </th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-200 dark:divide-gray-600">
                <tr
                  v-for="stat in dashboardModelStats"
                  :key="stat.model"
                  class="hover:bg-gray-50 dark:hover:bg-gray-700"
                >
                  <td class="px-2 py-2 text-xs text-gray-900 dark:text-gray-100 sm:px-4 sm:text-sm">
                    <span class="block max-w-[100px] truncate sm:max-w-none" :title="stat.model">
                      {{ stat.model }}
                    </span>
                  </td>
                  <td
                    class="hidden px-2 py-2 text-right text-xs text-gray-600 dark:text-gray-400 sm:table-cell sm:px-4 sm:text-sm"
                  >
                    {{ formatNumber(stat.requests) }}
                  </td>
                  <td
                    class="px-2 py-2 text-right text-xs text-gray-600 dark:text-gray-400 sm:px-4 sm:text-sm"
                  >
                    {{ formatNumber(stat.allTokens) }}
                  </td>
                  <td
                    class="px-2 py-2 text-right text-xs font-medium text-green-600 sm:px-4 sm:text-sm"
                  >
                    {{ stat.formatted ? stat.formatted.total : '$0.000000' }}
                  </td>
                  <td
                    class="hidden px-2 py-2 text-right text-xs font-medium sm:table-cell sm:px-4 sm:text-sm"
                  >
                    <span
                      class="inline-flex items-center rounded-full bg-blue-100 px-2 py-1 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300"
                    >
                      {{ calculatePercentage(stat.allTokens, dashboardModelStats) }}%
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>

    <!-- Token使用趋势图 -->
    <div class="mb-4 sm:mb-6 md:mb-8">
      <div class="card p-4 sm:p-6">
        <div class="sm:h-[300px]" style="height: 250px">
          <canvas ref="usageTrendChart" />
        </div>
      </div>
    </div>

    <!-- API Keys 使用趋势图 -->
    <div class="mb-4 sm:mb-6 md:mb-8">
      <div class="card p-4 sm:p-6">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
            API Keys 使用趋势
          </h3>
          <!-- 维度切换按钮 -->
          <div class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
            <button
              :class="[
                'rounded-md px-2 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm',
                apiKeysTrendMetric === 'requests'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              ]"
              @click="((apiKeysTrendMetric = 'requests'), updateApiKeysUsageTrendChart())"
            >
              <i class="fas fa-exchange-alt mr-1" /><span class="hidden sm:inline">请求次数</span
              ><span class="sm:hidden">请求</span>
            </button>
            <button
              :class="[
                'rounded-md px-2 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm',
                apiKeysTrendMetric === 'tokens'
                  ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800'
                  : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
              ]"
              @click="((apiKeysTrendMetric = 'tokens'), updateApiKeysUsageTrendChart())"
            >
              <i class="fas fa-coins mr-1" /><span class="hidden sm:inline">Token 数量</span
              ><span class="sm:hidden">Token</span>
            </button>
          </div>
        </div>
        <div class="mb-4 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
          <span v-if="apiKeysTrendData.totalApiKeys > 10">
            共 {{ apiKeysTrendData.totalApiKeys }} 个 API Key，显示使用量前 10 个
          </span>
          <span v-else> 共 {{ apiKeysTrendData.totalApiKeys }} 个 API Key </span>
        </div>
        <div class="sm:h-[350px]" style="height: 300px">
          <canvas ref="apiKeysUsageTrendChart" />
        </div>
      </div>
    </div>

    <!-- 账号使用趋势图 -->
    <div class="mb-4 sm:mb-6 md:mb-8">
      <div class="card p-4 sm:p-6">
        <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
            <h3 class="text-base font-semibold text-gray-900 dark:text-gray-100 sm:text-lg">
              账号使用趋势
            </h3>
            <span class="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
              当前分组：{{ accountUsageTrendData.groupLabel || '未选择' }}
            </span>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-700">
              <button
                v-for="option in accountGroupOptions"
                :key="option.value"
                :class="[
                  'rounded-md px-2 py-1 text-xs font-medium transition-colors sm:px-3 sm:text-sm',
                  accountUsageGroup === option.value
                    ? 'bg-white text-blue-600 shadow-sm dark:bg-gray-800'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-gray-100'
                ]"
                @click="handleAccountUsageGroupChange(option.value)"
              >
                {{ option.label }}
              </button>
            </div>
          </div>
        </div>
        <div
          class="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-600 dark:text-gray-400 sm:text-sm"
        >
          <span>共 {{ accountUsageTrendData.totalAccounts || 0 }} 个账号</span>
          <span
            v-if="accountUsageTrendData.topAccounts && accountUsageTrendData.topAccounts.length"
          >
            显示消耗排名前 {{ accountUsageTrendData.topAccounts.length }} 个账号
          </span>
        </div>
        <div
          v-if="!accountUsageTrendData.data || accountUsageTrendData.data.length === 0"
          class="py-12 text-center text-sm text-gray-500 dark:text-gray-400"
        >
          暂无账号使用数据
        </div>
        <div v-else class="sm:h-[350px]" style="height: 300px">
          <canvas ref="accountUsageTrendChart" />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { storeToRefs } from 'pinia'
import Chart from 'chart.js/auto'

import { useDashboardStore } from '@/stores/dashboard'
import { useThemeStore } from '@/stores/theme'
import { formatNumber, showToast } from '@/utils/tools'

import { getBalanceSummaryApi } from '@/utils/http_apis'

const dashboardStore = useDashboardStore()
const themeStore = useThemeStore()
const { isDarkMode } = storeToRefs(themeStore)

const {
  dashboardData,
  costsData,
  dashboardModelStats,
  trendData,
  apiKeysTrendData,
  accountUsageTrendData,
  accountUsageGroup,
  formattedUptime,
  dateFilter,
  trendGranularity,
  apiKeysTrendMetric
} = storeToRefs(dashboardStore)

const {
  loadDashboardData,
  loadApiKeysTrend,
  setDateFilterPreset,
  onCustomDateRangeChange,
  setTrendGranularity,
  refreshChartsData,
  setAccountUsageGroup,
  disabledDate
} = dashboardStore

// 日期选择器默认时间
const defaultTime = [new Date(2000, 1, 1, 0, 0, 0), new Date(2000, 2, 1, 23, 59, 59)]

// Chart 实例
const modelUsageChart = ref(null)
const usageTrendChart = ref(null)
const apiKeysUsageTrendChart = ref(null)
const accountUsageTrendChart = ref(null)
let modelUsageChartInstance = null
let usageTrendChartInstance = null
let apiKeysUsageTrendChartInstance = null
let accountUsageTrendChartInstance = null

const accountGroupOptions = [
  { value: 'claude', label: 'Claude' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'droid', label: 'Droid' }
]

const accountTrendUpdating = ref(false)
const emptyCacheMetrics = {
  l1: {
    enabled: true,
    bypassReasons: [],
    counters: {
      cache_hit_exact: 0,
      cache_miss: 0,
      cache_bypass: 0,
      cache_write: 0
    },
    totals: {
      lookups: 0,
      requests: 0
    },
    rates: {
      hitRate: 0
    }
  },
  l2: {
    enabled: true,
    embeddingModel: 'text-embedding-3-small',
    similarityThreshold: 0.95,
    bypassReasons: [],
    counters: {
      cache_hit_semantic: 0,
      cache_miss: 0,
      cache_bypass: 0,
      cache_write: 0,
      embedding_hit: 0,
      embedding_miss: 0
    },
    totals: {
      lookups: 0,
      requests: 0,
      embeddingRequests: 0
    },
    rates: {
      semanticHitRate: 0,
      embeddingHitRate: 0
    }
  },
  l3: {
    enabled: true,
    bypassReasons: [],
    counters: {
      cache_hit_exact: 0,
      cache_miss: 0,
      cache_bypass: 0,
      cache_write: 0
    },
    totals: {
      lookups: 0,
      requests: 0
    },
    rates: {
      hitRate: 0
    }
  }
}

// 余额/配额汇总
const balanceSummary = ref({
  totalBalance: 0,
  totalCost: 0,
  lowBalanceCount: 0,
  platforms: {}
})
const loadingBalanceSummary = ref(false)
const balanceSummaryUpdatedAt = ref(null)

const getBalancePlatformLabel = (platform) => {
  const map = {
    claude: 'Claude',
    'claude-console': 'Claude Console',
    gemini: 'Gemini',
    'gemini-api': 'Gemini API',
    openai: 'OpenAI',
    'openai-responses': 'OpenAI Responses',
    azure_openai: 'Azure OpenAI',
    bedrock: 'Bedrock',
    droid: 'Droid',
    ccr: 'CCR'
  }
  return map[platform] || platform
}

const lowBalanceAccounts = computed(() => {
  const result = []
  const platforms = balanceSummary.value?.platforms || {}

  Object.entries(platforms).forEach(([platform, data]) => {
    const list = Array.isArray(data?.accounts) ? data.accounts : []
    list.forEach((entry) => {
      const accountData = entry?.data
      if (!accountData) return

      const amount = accountData.balance?.amount
      const percentage = accountData.quota?.percentage

      const isLowBalance = typeof amount === 'number' && amount < 10
      const isHighUsage = typeof percentage === 'number' && percentage > 90

      if (isLowBalance || isHighUsage) {
        result.push({
          ...accountData,
          name: entry?.name || accountData.accountId,
          platform: accountData.platform || platform
        })
      }
    })
  })

  return result
})

const formatCurrencyUsd = (amount) => {
  const value = Number(amount)
  if (!Number.isFinite(value)) return '$0.00'
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(6)}`
}

const formatRatioPercent = (value) => `${((Number(value) || 0) * 100).toFixed(1)}%`

const formatSimilarityThreshold = (value) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue.toFixed(2) : '--'
}

const toSafeNumber = (value) => {
  const numericValue = Number(value)
  return Number.isFinite(numericValue) ? numericValue : 0
}

const getTopBypassReason = (reasons) => {
  if (!Array.isArray(reasons) || reasons.length === 0) {
    return null
  }

  return reasons[0]
}

const buildCacheBadgeClass = (tone) => {
  const toneMap = {
    slate:
      'rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900/70 dark:text-slate-200',
    sky: 'rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 dark:border-sky-900/60 dark:bg-sky-900/20 dark:text-sky-300',
    emerald:
      'rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-900/20 dark:text-emerald-300',
    violet:
      'rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-semibold text-violet-700 dark:border-violet-900/60 dark:bg-violet-900/20 dark:text-violet-300',
    amber:
      'rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-300'
  }

  return toneMap[tone] || toneMap.slate
}

const cacheBypassReasonLabels = {
  cache_disabled: '缓存未启用',
  missing_tenant: '缺少租户标识',
  stream_request: '流式请求',
  invalid_request_body: '请求体无效',
  dynamic_tools: '携带 tools 或动态字段',
  dynamic_request: '动态请求参数',
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

const formatCacheBypassReason = (reason) => {
  if (!reason) {
    return '未知原因'
  }

  return cacheBypassReasonLabels[reason] || reason.split('_').filter(Boolean).join(' ')
}

const formatLastUpdate = (isoString) => {
  if (!isoString) return '未知'
  const date = new Date(isoString)
  if (Number.isNaN(date.getTime())) return '未知'
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

const loadBalanceSummary = async () => {
  loadingBalanceSummary.value = true
  const response = await getBalanceSummaryApi()
  if (response?.success) {
    balanceSummary.value = response.data || {
      totalBalance: 0,
      totalCost: 0,
      lowBalanceCount: 0,
      platforms: {}
    }
    balanceSummaryUpdatedAt.value = new Date().toISOString()
  } else if (response?.message) {
    console.debug('加载余额汇总失败:', response.message)
    showToast('加载余额汇总失败', 'error')
  }
  loadingBalanceSummary.value = false
}

// 自动刷新相关
const autoRefreshEnabled = ref(false)
const autoRefreshInterval = ref(30) // 秒
const autoRefreshTimer = ref(null)
const refreshCountdown = ref(0)
const countdownTimer = ref(null)
const isRefreshing = ref(false)

// 计算倒计时显示
// const refreshCountdownDisplay = computed(() => {
//   if (!autoRefreshEnabled.value || refreshCountdown.value <= 0) return ''
//   return `${refreshCountdown.value}秒后刷新`
// })

// 图表颜色配置（根据主题动态调整）
const chartColors = computed(() => ({
  text: isDarkMode.value ? '#e5e7eb' : '#374151',
  grid: isDarkMode.value ? 'rgba(75, 85, 99, 0.3)' : 'rgba(0, 0, 0, 0.1)',
  legend: isDarkMode.value ? '#e5e7eb' : '#374151'
}))

const l1CacheMetrics = computed(() => dashboardData.value.cacheMetrics?.l1 || emptyCacheMetrics.l1)
const l2CacheMetrics = computed(() => dashboardData.value.cacheMetrics?.l2 || emptyCacheMetrics.l2)
const l3CacheMetrics = computed(() => dashboardData.value.cacheMetrics?.l3 || emptyCacheMetrics.l3)
const l1BypassReasons = computed(() => (l1CacheMetrics.value.bypassReasons || []).slice(0, 3))
const l2BypassReasons = computed(() => (l2CacheMetrics.value.bypassReasons || []).slice(0, 3))
const l3BypassReasons = computed(() => (l3CacheMetrics.value.bypassReasons || []).slice(0, 3))
const l2PrimaryMetricLabel = computed(() => '语义命中率')
const l2PrimaryMetricCountLabel = computed(() => '语义命中')
const l2PrimaryMetricRate = computed(() => l2CacheMetrics.value.rates.semanticHitRate)
const l2PrimaryMetricCount = computed(() => l2CacheMetrics.value.counters.cache_hit_semantic)
const l2ModeLabel = computed(() => {
  if (!l2CacheMetrics.value.enabled) {
    return '已关闭'
  }

  return '命中返回'
})

const getMetricsSummaryData = (metrics) => {
  const summary = metrics.summary || {}
  return {
    participationRate: toSafeNumber(summary.participationRate),
    bypassRate: toSafeNumber(summary.bypassRate),
    cacheableRequests: toSafeNumber(summary.cacheableRequests),
    bypassedRequests: toSafeNumber(summary.bypassedRequests),
    topBypassReason: summary.topBypassReason || getTopBypassReason(metrics.bypassReasons)
  }
}

const l1CacheSummary = computed(() => {
  const metrics = l1CacheMetrics.value
  const hits = toSafeNumber(metrics.counters.cache_hit_exact)
  const writes = toSafeNumber(metrics.counters.cache_write)
  const lookups = toSafeNumber(metrics.totals.lookups)
  const summary = getMetricsSummaryData(metrics)

  if (!metrics.enabled) {
    return {
      state: '已关闭',
      summary: 'L1 当前没有参与精确缓存。',
      detail: '服务端关闭后，所有请求都会直接跳过 L1。',
      badgeClass: buildCacheBadgeClass('slate')
    }
  }

  if (hits > 0) {
    return {
      state: '已有命中',
      summary: 'L1 已经开始稳定复用重复请求。',
      detail: `可参与率 ${formatRatioPercent(summary.participationRate)}，命中率 ${formatRatioPercent(metrics.rates.hitRate)}，头号阻塞 ${summary.topBypassReason ? formatCacheBypassReason(summary.topBypassReason.reason) : '暂无'}。`,
      badgeClass: buildCacheBadgeClass('sky')
    }
  }

  if (lookups > 0 || writes > 0) {
    return {
      state: '正在预热',
      summary: 'L1 已经开始查找和写入，但还没形成明显复用。',
      detail: `可参与请求 ${formatNumber(summary.cacheableRequests)} 次，写入 ${formatNumber(writes)} 次，下一步关注是否出现首个稳定命中。`,
      badgeClass: buildCacheBadgeClass('emerald')
    }
  }

  if (summary.bypassedRequests > 0) {
    return {
      state: '大多绕过',
      summary: '当前请求多数还没进入 L1。',
      detail: summary.topBypassReason
        ? `可参与率只有 ${formatRatioPercent(summary.participationRate)}，最主要原因是 ${formatCacheBypassReason(summary.topBypassReason.reason)}。`
        : '优先看 bypass 原因，先把可参与率拉起来。',
      badgeClass: buildCacheBadgeClass('amber')
    }
  }

  return {
    state: '等待样本',
    summary: 'L1 还没有足够样本。',
    detail: '再跑几轮重复请求后，可参与率和命中率才会变得有参考价值。',
    badgeClass: buildCacheBadgeClass('slate')
  }
})

const l2CacheSummary = computed(() => {
  const metrics = l2CacheMetrics.value
  const semanticHits = toSafeNumber(metrics.counters.cache_hit_semantic)
  const writes = toSafeNumber(metrics.counters.cache_write)
  const lookups = toSafeNumber(metrics.totals.lookups)
  const embeddingRequests = toSafeNumber(metrics.totals.embeddingRequests)
  const summary = getMetricsSummaryData(metrics)

  if (!metrics.enabled) {
    return {
      state: '已关闭',
      summary: 'L2 当前没有参与语义缓存。',
      detail: '服务端关闭后，所有请求都会直接跳过 L2。',
      badgeClass: buildCacheBadgeClass('slate')
    }
  }

  if (semanticHits > 0) {
    return {
      state: '已命中返回',
      summary: 'L2 已经开始直接返回语义相近结果。',
      detail: `可参与率 ${formatRatioPercent(summary.participationRate)}，语义命中率 ${formatRatioPercent(metrics.rates.semanticHitRate)}，Embedding 命中率 ${formatRatioPercent(metrics.rates.embeddingHitRate)}。`,
      badgeClass: buildCacheBadgeClass('emerald')
    }
  }

  if (lookups > 0 || embeddingRequests > 0 || writes > 0) {
    return {
      state: '正在检索',
      summary: 'L2 已经开始做 embedding 检索，但还没形成稳定语义命中。',
      detail: `可参与请求 ${formatNumber(summary.cacheableRequests)} 次，Embedding 请求 ${formatNumber(embeddingRequests)} 次，阈值 ${formatSimilarityThreshold(metrics.similarityThreshold)}。`,
      badgeClass: buildCacheBadgeClass('sky')
    }
  }

  if (summary.bypassedRequests > 0) {
    return {
      state: '大多绕过',
      summary: '当前请求多数还没进入 L2。',
      detail: summary.topBypassReason
        ? `可参与率只有 ${formatRatioPercent(summary.participationRate)}，当前最大阻塞是 ${formatCacheBypassReason(summary.topBypassReason.reason)}。`
        : '先把可参与率拉起来，再看语义命中率。',
      badgeClass: buildCacheBadgeClass('amber')
    }
  }

  return {
    state: '等待样本',
    summary: 'L2 还没有足够样本。',
    detail: `当前模式为命中返回，Embedding 模型 ${metrics.embeddingModel || '--'}。`,
    badgeClass: buildCacheBadgeClass('slate')
  }
})

const l3CacheSummary = computed(() => {
  const metrics = l3CacheMetrics.value
  const hits = toSafeNumber(metrics.counters.cache_hit_exact)
  const writes = toSafeNumber(metrics.counters.cache_write)
  const lookups = toSafeNumber(metrics.totals.lookups)
  const summary = getMetricsSummaryData(metrics)

  if (!metrics.enabled) {
    return {
      state: '已关闭',
      summary: 'L3 当前没有参与全局共享缓存。',
      detail: '服务端关闭后，不会产生跨 API Key 的复用收益。',
      badgeClass: buildCacheBadgeClass('slate')
    }
  }

  if (hits > 0) {
    return {
      state: '已有命中',
      summary: 'L3 已经开始带来跨 API Key 的共享复用。',
      detail: `可参与率 ${formatRatioPercent(summary.participationRate)}，命中率 ${formatRatioPercent(metrics.rates.hitRate)}，继续观察是否持续增长。`,
      badgeClass: buildCacheBadgeClass('violet')
    }
  }

  if (lookups > 0 || writes > 0) {
    return {
      state: '正在预热',
      summary: 'L3 已经开始查找和写入，但跨 Key 复用还没起量。',
      detail: `可参与请求 ${formatNumber(summary.cacheableRequests)} 次，写入 ${formatNumber(writes)} 次，下一步关注首个稳定全局命中。`,
      badgeClass: buildCacheBadgeClass('emerald')
    }
  }

  if (summary.bypassedRequests > 0) {
    return {
      state: '大多绕过',
      summary: '当前请求多数还没进入 L3。',
      detail: summary.topBypassReason
        ? `可参与率只有 ${formatRatioPercent(summary.participationRate)}，最主要原因是 ${formatCacheBypassReason(summary.topBypassReason.reason)}。`
        : '先看 bypass 原因，再判断是否适合做跨 Key 共享。',
      badgeClass: buildCacheBadgeClass('amber')
    }
  }

  return {
    state: '等待样本',
    summary: 'L3 还没有足够样本。',
    detail: '等出现更多跨 API Key 的重复请求后，L3 的价值才会更明显。',
    badgeClass: buildCacheBadgeClass('slate')
  }
})

const primaryBypassReason = computed(() => {
  const reasonMap = new Map()

  ;[...l1BypassReasons.value, ...l2BypassReasons.value, ...l3BypassReasons.value].forEach(
    (item) => {
      if (!item?.reason) {
        return
      }

      const count = toSafeNumber(item.count)
      reasonMap.set(item.reason, (reasonMap.get(item.reason) || 0) + count)
    }
  )

  let topReason = null
  reasonMap.forEach((count, reason) => {
    if (!topReason || count > topReason.count) {
      topReason = { reason, count }
    }
  })

  return topReason
})

const cacheOverview = computed(() => {
  const l1Metrics = l1CacheMetrics.value
  const l2Metrics = l2CacheMetrics.value
  const l3Metrics = l3CacheMetrics.value
  const l1Summary = getMetricsSummaryData(l1Metrics)
  const l2Summary = getMetricsSummaryData(l2Metrics)
  const l3Summary = getMetricsSummaryData(l3Metrics)
  const l1Hits = toSafeNumber(l1Metrics.counters.cache_hit_exact)
  const l2Hits = toSafeNumber(l2Metrics.counters.cache_hit_semantic)
  const l3Hits = toSafeNumber(l3Metrics.counters.cache_hit_exact)
  const topReason = primaryBypassReason.value
  const blocker = topReason
    ? `${formatCacheBypassReason(topReason.reason)} · ${formatNumber(topReason.count)}`
    : '暂无明显阻塞'
  const bestParticipationRate = Math.max(
    l1Summary.participationRate,
    l2Summary.participationRate,
    l3Summary.participationRate
  )

  if (!l1Metrics.enabled && !l2Metrics.enabled && !l3Metrics.enabled) {
    return {
      summary: 'L1、L2、L3 都已关闭，当前不会产生缓存收益。',
      stage: '缓存关闭',
      focus: '先确认开关配置',
      blocker: '功能未启用'
    }
  }

  if (l1Hits > 0 || l2Hits > 0 || l3Hits > 0) {
    return {
      summary: '缓存已经开始产生真实收益，当前重点从“能不能参与”切换到“命中能不能持续增长”。',
      stage: '已进入复用',
      focus: l3Hits > 0 ? '继续放大 L3 跨 Key 复用' : '继续提升命中率',
      blocker
    }
  }

  if (l2Summary.cacheableRequests > 0) {
    return {
      summary: 'L2 已经进入检索阶段，说明缓存链在工作，下一步重点是把可参与请求转成真实命中。',
      stage: '语义预热',
      focus: '先拿到首个稳定语义命中',
      blocker
    }
  }

  if (l1Summary.cacheableRequests > 0 || l3Summary.cacheableRequests > 0) {
    return {
      summary: 'Exact cache 已经开始预热，但样本还不足，当前更该关注重复请求是否稳定出现。',
      stage: 'Exact 预热',
      focus: '继续拉高重复请求命中',
      blocker
    }
  }

  if (bestParticipationRate > 0) {
    return {
      summary: '缓存已经开始参与，但命中样本还不够，当前先盯住可参与率是否继续提升。',
      stage: '参与中',
      focus: '继续提升可参与率',
      blocker
    }
  }

  if (topReason) {
    return {
      summary: `当前缓存主要卡在 bypass，${formatCacheBypassReason(topReason.reason)} 是最明显的阻塞。`,
      stage: '绕过偏多',
      focus: '先降低 bypass',
      blocker
    }
  }

  return {
    summary: '目前还没有足够的数据判断缓存是否开始生效。',
    stage: '等待样本',
    focus: '先看查找和写入',
    blocker
  }
})

function formatCostValue(cost) {
  if (!Number.isFinite(cost)) {
    return '$0.000000'
  }
  if (cost >= 1) {
    return `$${cost.toFixed(2)}`
  }
  if (cost >= 0.01) {
    return `$${cost.toFixed(3)}`
  }
  return `$${cost.toFixed(6)}`
}

// 计算百分比
function calculatePercentage(value, stats) {
  if (!stats || stats.length === 0) return 0
  const total = stats.reduce((sum, stat) => sum + stat.allTokens, 0)
  if (total === 0) return 0
  return ((value / total) * 100).toFixed(1)
}

// 创建模型使用饼图
function createModelUsageChart() {
  if (!modelUsageChart.value) return

  if (modelUsageChartInstance) {
    modelUsageChartInstance.destroy()
  }

  const data = dashboardModelStats.value || []
  const chartData = {
    labels: data.map((d) => d.model),
    datasets: [
      {
        data: data.map((d) => d.allTokens),
        backgroundColor: [
          '#3B82F6',
          '#10B981',
          '#F59E0B',
          '#EF4444',
          '#8B5CF6',
          '#EC4899',
          '#14B8A6',
          '#F97316',
          '#6366F1',
          '#84CC16'
        ],
        borderWidth: 0
      }
    ]
  }

  modelUsageChartInstance = new Chart(modelUsageChart.value, {
    type: 'doughnut',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 15,
            usePointStyle: true,
            font: {
              size: 12
            },
            color: chartColors.value.legend
          }
        },
        tooltip: {
          callbacks: {
            label: function (context) {
              const label = context.label || ''
              const value = formatNumber(context.parsed)
              const percentage = calculatePercentage(context.parsed, data)
              return `${label}: ${value} (${percentage}%)`
            }
          }
        }
      }
    }
  })
}

// 创建使用趋势图
function createUsageTrendChart() {
  if (!usageTrendChart.value) return

  if (usageTrendChartInstance) {
    usageTrendChartInstance.destroy()
  }

  const data = trendData.value || []

  // 准备多维度数据
  const inputData = data.map((d) => d.inputTokens || 0)
  const outputData = data.map((d) => d.outputTokens || 0)
  const cacheCreateData = data.map((d) => d.cacheCreateTokens || 0)
  const cacheReadData = data.map((d) => d.cacheReadTokens || 0)
  const requestsData = data.map((d) => d.requests || 0)
  const costData = data.map((d) => d.cost || 0)

  // 根据数据类型确定标签字段和格式
  const labelField = data[0]?.date ? 'date' : 'hour'
  const labels = data.map((d) => {
    // 优先使用后端提供的label字段
    if (d.label) {
      return d.label
    }

    if (labelField === 'hour') {
      // 格式化小时显示
      const date = new Date(d.hour)
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      const hour = String(date.getHours()).padStart(2, '0')
      return `${month}/${day} ${hour}:00`
    }
    // 按天显示时，只显示月/日，不显示年份
    const dateStr = d.date
    if (dateStr && dateStr.includes('-')) {
      const parts = dateStr.split('-')
      if (parts.length >= 3) {
        return `${parts[1]}/${parts[2]}`
      }
    }
    return d.date
  })

  const chartData = {
    labels: labels,
    datasets: [
      {
        label: '输入Token',
        data: inputData,
        borderColor: themeStore.currentColorScheme.primary,
        backgroundColor: `${themeStore.currentColorScheme.primary}1a`,
        tension: 0.3
      },
      {
        label: '输出Token',
        data: outputData,
        borderColor: themeStore.currentColorScheme.accent,
        backgroundColor: `${themeStore.currentColorScheme.accent}1a`,
        tension: 0.3
      },
      {
        label: '缓存创建Token',
        data: cacheCreateData,
        borderColor: 'rgb(59, 130, 246)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.3
      },
      {
        label: '缓存读取Token',
        data: cacheReadData,
        borderColor: themeStore.currentColorScheme.secondary,
        backgroundColor: `${themeStore.currentColorScheme.secondary}1a`,
        tension: 0.3
      },
      {
        label: '费用 (USD)',
        data: costData,
        borderColor: 'rgb(34, 197, 94)',
        backgroundColor: 'rgba(34, 197, 94, 0.1)',
        tension: 0.3,
        yAxisID: 'y2'
      },
      {
        label: '请求数',
        data: requestsData,
        borderColor: 'rgb(16, 185, 129)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.3,
        yAxisID: 'y1'
      }
    ]
  }

  usageTrendChartInstance = new Chart(usageTrendChart.value, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        title: {
          display: true,
          text: 'Token使用趋势',
          font: {
            size: 16,
            weight: 'bold'
          },
          color: chartColors.value.text
        },
        legend: {
          position: 'top',
          labels: {
            color: chartColors.value.legend
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          itemSort: function (a, b) {
            // 按值倒序排列，费用和请求数特殊处理
            const aLabel = a.dataset.label || ''
            const bLabel = b.dataset.label || ''

            // 费用和请求数使用不同的轴，单独处理
            if (aLabel === '费用 (USD)' || bLabel === '费用 (USD)') {
              return aLabel === '费用 (USD)' ? -1 : 1
            }
            if (aLabel === '请求数' || bLabel === '请求数') {
              return aLabel === '请求数' ? 1 : -1
            }

            // 其他按token值倒序
            return b.parsed.y - a.parsed.y
          },
          callbacks: {
            label: function (context) {
              const label = context.dataset.label || ''
              let value = context.parsed.y

              if (label === '费用 (USD)') {
                // 格式化费用显示
                if (value < 0.01) {
                  return label + ': $' + value.toFixed(6)
                } else {
                  return label + ': $' + value.toFixed(4)
                }
              } else if (label === '请求数') {
                return label + ': ' + value.toLocaleString() + ' 次'
              } else {
                // 格式化token数显示
                if (value >= 1000000) {
                  return label + ': ' + (value / 1000000).toFixed(2) + 'M tokens'
                } else if (value >= 1000) {
                  return label + ': ' + (value / 1000).toFixed(2) + 'K tokens'
                } else {
                  return label + ': ' + value.toLocaleString() + ' tokens'
                }
              }
            }
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          display: true,
          title: {
            display: true,
            text: trendGranularity === 'hour' ? '时间' : '日期',
            color: chartColors.value.text
          },
          ticks: {
            color: chartColors.value.text
          },
          grid: {
            color: chartColors.value.grid
          }
        },
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          min: 0,
          title: {
            display: true,
            text: 'Token数量',
            color: chartColors.value.text
          },
          ticks: {
            callback: function (value) {
              return formatNumber(value)
            },
            color: chartColors.value.text
          },
          grid: {
            color: chartColors.value.grid
          }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          min: 0,
          title: {
            display: true,
            text: '请求数',
            color: chartColors.value.text
          },
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            callback: function (value) {
              return value.toLocaleString()
            },
            color: chartColors.value.text
          }
        },
        y2: {
          type: 'linear',
          display: false, // 隐藏费用轴，在tooltip中显示
          position: 'right',
          min: 0
        }
      }
    }
  })
}

// 创建API Keys使用趋势图
function createApiKeysUsageTrendChart() {
  if (!apiKeysUsageTrendChart.value) return

  if (apiKeysUsageTrendChartInstance) {
    apiKeysUsageTrendChartInstance.destroy()
  }

  const data = apiKeysTrendData.value.data || []
  const metric = apiKeysTrendMetric.value

  // 颜色数组
  const colors = [
    '#3B82F6',
    '#10B981',
    '#F59E0B',
    '#EF4444',
    '#8B5CF6',
    '#EC4899',
    '#14B8A6',
    '#F97316',
    '#6366F1',
    '#84CC16'
  ]

  // 准备数据集
  const datasets =
    apiKeysTrendData.value.topApiKeys?.map((apiKeyId, index) => {
      const data = apiKeysTrendData.value.data.map((item) => {
        if (!item.apiKeys || !item.apiKeys[apiKeyId]) return 0
        return metric === 'tokens'
          ? item.apiKeys[apiKeyId].tokens
          : item.apiKeys[apiKeyId].requests || 0
      })

      // 获取API Key名称
      const apiKeyName =
        apiKeysTrendData.value.data.find((item) => item.apiKeys && item.apiKeys[apiKeyId])?.apiKeys[
          apiKeyId
        ]?.name || `API Key ${apiKeyId}`

      return {
        label: apiKeyName,
        data: data,
        borderColor: colors[index % colors.length],
        backgroundColor: colors[index % colors.length] + '20',
        tension: 0.4,
        fill: false
      }
    }) || []

  // 根据数据类型确定标签字段
  const labelField = data[0]?.date ? 'date' : 'hour'

  const chartData = {
    labels: data.map((d) => {
      // 优先使用后端提供的label字段
      if (d.label) {
        return d.label
      }

      if (labelField === 'hour') {
        // 格式化小时显示
        const date = new Date(d.hour)
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hour = String(date.getHours()).padStart(2, '0')
        return `${month}/${day} ${hour}:00`
      }
      // 按天显示时，只显示月/日，不显示年份
      const dateStr = d.date
      if (dateStr && dateStr.includes('-')) {
        const parts = dateStr.split('-')
        if (parts.length >= 3) {
          return `${parts[1]}/${parts[2]}`
        }
      }
      return d.date
    }),
    datasets: datasets
  }

  apiKeysUsageTrendChartInstance = new Chart(apiKeysUsageTrendChart.value, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 20,
            usePointStyle: true,
            font: {
              size: 12
            },
            color: chartColors.value.legend
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          itemSort: function (a, b) {
            // 按值倒序排列
            return b.parsed.y - a.parsed.y
          },
          callbacks: {
            label: function (context) {
              const label = context.dataset.label || ''
              const value = context.parsed.y
              const dataIndex = context.dataIndex
              const dataPoint = apiKeysTrendData.value.data[dataIndex]

              // 获取所有数据集在这个时间点的值，用于排名
              const allValues = context.chart.data.datasets
                .map((dataset, idx) => ({
                  value: dataset.data[dataIndex] || 0,
                  index: idx
                }))
                .sort((a, b) => b.value - a.value)

              // 找出当前数据集的排名
              const rank = allValues.findIndex((item) => item.index === context.datasetIndex) + 1

              // 准备排名标识
              let rankIcon = ''
              if (rank === 1) rankIcon = '🥇 '
              else if (rank === 2) rankIcon = '🥈 '
              else if (rank === 3) rankIcon = '🥉 '

              if (apiKeysTrendMetric.value === 'tokens') {
                // 格式化token显示
                let formattedValue = ''
                if (value >= 1000000) {
                  formattedValue = (value / 1000000).toFixed(2) + 'M'
                } else if (value >= 1000) {
                  formattedValue = (value / 1000).toFixed(2) + 'K'
                } else {
                  formattedValue = value.toLocaleString()
                }

                // 获取对应API Key的费用信息
                const apiKeyId = apiKeysTrendData.value.topApiKeys[context.datasetIndex]
                const apiKeyData = dataPoint?.apiKeys?.[apiKeyId]
                const cost = apiKeyData?.formattedCost || '$0.00'

                return `${rankIcon}${label}: ${formattedValue} tokens (${cost})`
              } else {
                return `${rankIcon}${label}: ${value.toLocaleString()} 次`
              }
            }
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          display: true,
          title: {
            display: true,
            text: trendGranularity === 'hour' ? '时间' : '日期',
            color: chartColors.value.text
          },
          ticks: {
            color: chartColors.value.text
          },
          grid: {
            color: chartColors.value.grid
          }
        },
        y: {
          beginAtZero: true,
          min: 0,
          title: {
            display: true,
            text: apiKeysTrendMetric.value === 'tokens' ? 'Token 数量' : '请求次数',
            color: chartColors.value.text
          },
          ticks: {
            callback: function (value) {
              return formatNumber(value)
            },
            color: chartColors.value.text
          },
          grid: {
            color: chartColors.value.grid
          }
        }
      }
    }
  })
}

// 更新API Keys使用趋势图
async function updateApiKeysUsageTrendChart() {
  await loadApiKeysTrend(apiKeysTrendMetric.value)
  await nextTick()
  createApiKeysUsageTrendChart()
}

function createAccountUsageTrendChart() {
  if (!accountUsageTrendChart.value) return

  if (accountUsageTrendChartInstance) {
    accountUsageTrendChartInstance.destroy()
  }

  const trend = accountUsageTrendData.value?.data || []
  const topAccounts = accountUsageTrendData.value?.topAccounts || []

  const colors = [
    '#2563EB',
    '#059669',
    '#D97706',
    '#DC2626',
    '#7C3AED',
    '#F472B6',
    '#0EA5E9',
    '#F97316',
    '#6366F1',
    '#22C55E'
  ]

  const datasets = topAccounts.map((accountId, index) => {
    const dataPoints = trend.map((item) => {
      if (!item.accounts || !item.accounts[accountId]) return 0
      return item.accounts[accountId].cost || 0
    })

    const accountName =
      trend.find((item) => item.accounts && item.accounts[accountId])?.accounts[accountId]?.name ||
      `账号 ${String(accountId).slice(0, 6)}`

    return {
      label: accountName,
      data: dataPoints,
      borderColor: colors[index % colors.length],
      backgroundColor: colors[index % colors.length] + '20',
      tension: 0.4,
      fill: false
    }
  })

  const labelField = trend[0]?.date ? 'date' : 'hour'

  const chartData = {
    labels: trend.map((item) => {
      if (item.label) {
        return item.label
      }

      if (labelField === 'hour') {
        const date = new Date(item.hour)
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hour = String(date.getHours()).padStart(2, '0')
        return `${month}/${day} ${hour}:00`
      }

      if (item.date && item.date.includes('-')) {
        const parts = item.date.split('-')
        if (parts.length >= 3) {
          return `${parts[1]}/${parts[2]}`
        }
      }

      return item.date
    }),
    datasets
  }

  const topAccountIds = topAccounts

  accountUsageTrendChartInstance = new Chart(accountUsageTrendChart.value, {
    type: 'line',
    data: chartData,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            padding: 20,
            usePointStyle: true,
            font: {
              size: 12
            },
            color: chartColors.value.legend
          }
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          itemSort: (a, b) => b.parsed.y - a.parsed.y,
          callbacks: {
            label: function (context) {
              const label = context.dataset.label || ''
              const value = context.parsed.y || 0
              const dataIndex = context.dataIndex
              const datasetIndex = context.datasetIndex
              const accountId = topAccountIds[datasetIndex]
              const dataPoint = accountUsageTrendData.value.data[dataIndex]
              const accountDetail = dataPoint?.accounts?.[accountId]

              const allValues = context.chart.data.datasets
                .map((dataset, idx) => ({
                  value: dataset.data[dataIndex] || 0,
                  index: idx
                }))
                .sort((a, b) => b.value - a.value)

              const rank = allValues.findIndex((item) => item.index === datasetIndex) + 1
              let rankIcon = ''
              if (rank === 1) rankIcon = '🥇 '
              else if (rank === 2) rankIcon = '🥈 '
              else if (rank === 3) rankIcon = '🥉 '

              const formattedCost = accountDetail?.formattedCost || formatCostValue(value)
              const requests = accountDetail?.requests || 0

              return `${rankIcon}${label}: ${formattedCost} / ${requests.toLocaleString()} 次`
            }
          }
        }
      },
      scales: {
        x: {
          type: 'category',
          display: true,
          title: {
            display: true,
            text: trendGranularity.value === 'hour' ? '时间' : '日期',
            color: chartColors.value.text
          },
          ticks: {
            color: chartColors.value.text
          },
          grid: {
            color: chartColors.value.grid
          }
        },
        y: {
          beginAtZero: true,
          min: 0,
          title: {
            display: true,
            text: '消耗金额 (USD)',
            color: chartColors.value.text
          },
          ticks: {
            callback: (value) => formatCostValue(Number(value)),
            color: chartColors.value.text
          },
          grid: {
            color: chartColors.value.grid
          }
        }
      }
    }
  })
}

async function handleAccountUsageGroupChange(group) {
  if (accountUsageGroup.value === group || accountTrendUpdating.value) {
    return
  }
  accountTrendUpdating.value = true
  try {
    await setAccountUsageGroup(group)
    await nextTick()
    createAccountUsageTrendChart()
  } finally {
    accountTrendUpdating.value = false
  }
}

// 监听数据变化更新图表
watch(dashboardModelStats, () => {
  nextTick(() => createModelUsageChart())
})

watch(trendData, () => {
  nextTick(() => createUsageTrendChart())
})

watch(apiKeysTrendData, () => {
  nextTick(() => createApiKeysUsageTrendChart())
})

watch(accountUsageTrendData, () => {
  nextTick(() => createAccountUsageTrendChart())
})

// 刷新所有数据
async function refreshAllData() {
  if (isRefreshing.value) return

  isRefreshing.value = true
  try {
    await Promise.all([loadDashboardData(), refreshChartsData(), loadBalanceSummary()])
  } finally {
    isRefreshing.value = false
  }
}

// 启动自动刷新
function startAutoRefresh() {
  if (!autoRefreshEnabled.value) return

  // 重置倒计时
  refreshCountdown.value = autoRefreshInterval.value

  // 清除现有定时器
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value)
  }
  if (autoRefreshTimer.value) {
    clearTimeout(autoRefreshTimer.value)
  }

  // 启动倒计时
  countdownTimer.value = setInterval(() => {
    refreshCountdown.value--
    if (refreshCountdown.value <= 0) {
      clearInterval(countdownTimer.value)
    }
  }, 1000)

  // 设置刷新定时器
  autoRefreshTimer.value = setTimeout(async () => {
    await refreshAllData()
    // 递归调用以继续自动刷新
    if (autoRefreshEnabled.value) {
      startAutoRefresh()
    }
  }, autoRefreshInterval.value * 1000)
}

// 停止自动刷新
function stopAutoRefresh() {
  if (countdownTimer.value) {
    clearInterval(countdownTimer.value)
    countdownTimer.value = null
  }
  if (autoRefreshTimer.value) {
    clearTimeout(autoRefreshTimer.value)
    autoRefreshTimer.value = null
  }
  refreshCountdown.value = 0
}

// 切换自动刷新
// function toggleAutoRefresh() {
//   autoRefreshEnabled.value = !autoRefreshEnabled.value
//   if (autoRefreshEnabled.value) {
//     startAutoRefresh()
//   } else {
//     stopAutoRefresh()
//   }
// }

// 监听自动刷新状态变化
watch(autoRefreshEnabled, (newVal) => {
  if (newVal) {
    startAutoRefresh()
  } else {
    stopAutoRefresh()
  }
})

// 监听主题变化，重新创建图表
watch(isDarkMode, () => {
  nextTick(() => {
    createModelUsageChart()
    createUsageTrendChart()
    createApiKeysUsageTrendChart()
    createAccountUsageTrendChart()
  })
})

// 监听色系变化，重新创建图表
watch(
  () => themeStore.colorScheme,
  () => {
    nextTick(() => {
      createModelUsageChart()
      createUsageTrendChart()
      createApiKeysUsageTrendChart()
      createAccountUsageTrendChart()
    })
  }
)

// 初始化
onMounted(async () => {
  // 加载所有数据
  await refreshAllData()

  // 创建图表
  await nextTick()
  createModelUsageChart()
  createUsageTrendChart()
  createApiKeysUsageTrendChart()
  createAccountUsageTrendChart()
})

// 清理
onUnmounted(() => {
  stopAutoRefresh()
  // 销毁图表实例
  if (modelUsageChartInstance) {
    modelUsageChartInstance.destroy()
  }
  if (usageTrendChartInstance) {
    usageTrendChartInstance.destroy()
  }
  if (apiKeysUsageTrendChartInstance) {
    apiKeysUsageTrendChartInstance.destroy()
  }
  if (accountUsageTrendChartInstance) {
    accountUsageTrendChartInstance.destroy()
  }
})
</script>

<style scoped>
/* 日期选择器基本样式调整 - 让Element Plus官方暗黑模式生效 */
.custom-date-picker {
  font-size: 13px;
}

/* 旋转动画 */
@keyframes spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

.animate-spin {
  animation: spin 1s linear infinite;
}
</style>
