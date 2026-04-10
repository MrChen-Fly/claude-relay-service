import { formatBytes } from '@/utils/tools'

export const formatPercent = (value, available) => {
  if (available === false || !Number.isFinite(value)) {
    return '--'
  }
  return `${Number(value).toFixed(1)}%`
}

export const formatBytesValue = (value) => {
  if (!Number.isFinite(value) || value < 0) {
    return '--'
  }
  return formatBytes(value, value < 1024 * 1024 ? 1 : 2)
}

export const formatThroughput = (value) => {
  if (!Number.isFinite(value) || value < 0) {
    return '--'
  }
  return `${formatBytes(value, value < 1024 * 1024 ? 1 : 2)}/s`
}

export const formatCount = (value) => {
  if (!Number.isFinite(value)) {
    return '--'
  }
  return Number(value).toLocaleString('zh-CN')
}

export const formatDuration = (value) => {
  if (!Number.isFinite(value) || value < 0) {
    return '--'
  }

  const totalSeconds = Math.floor(value)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)

  if (days > 0) {
    return `${days}天 ${hours}小时`
  }
  if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`
  }
  if (minutes > 0) {
    return `${minutes}分钟`
  }
  return `${totalSeconds}秒`
}

export const formatDurationMs = (value) => {
  if (!Number.isFinite(value) || value <= 0) {
    return '--'
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`
  }
  return `${(value / 1000).toFixed(1)} s`
}

export const createHealthTone = ({ warnings, redis, cpu, memory }) => {
  if (warnings.length || redis.available === false) {
    return {
      label: '部分降级',
      className: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200',
      dotClass: 'bg-amber-500'
    }
  }
  if ((cpu.usagePercent || 0) >= 85 || (memory.usagePercent || 0) >= 90) {
    return {
      label: '负载较高',
      className: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200',
      dotClass: 'bg-rose-500'
    }
  }
  return {
    label: '运行平稳',
    className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200',
    dotClass: 'bg-emerald-500'
  }
}

export const buildPrimaryMetrics = ({
  cpu,
  memory,
  processMetrics,
  network,
  redis,
  host,
  lastFetchedLabel
}) => [
  {
    key: 'cpu',
    label: 'CPU 占用',
    value: formatPercent(cpu.usagePercent, cpu.available),
    meta: cpu.available
      ? `${cpu.logicalCores || 0} 核，采样窗口 ${formatDurationMs(cpu.sampleWindowMs)}`
      : cpu.message || '等待采样',
    badge: cpu.available ? '实时' : '采样中',
    badgeClass: cpu.available
      ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-700/80 dark:text-slate-200'
  },
  {
    key: 'memory',
    label: '可用内存',
    value: formatBytesValue(memory.availableBytes),
    meta: `总内存 ${formatBytesValue(memory.totalBytes)} · 已用 ${formatPercent(memory.usagePercent, true)}`,
    badge: '主机',
    badgeClass: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200'
  },
  {
    key: 'process-memory',
    label: '进程内存',
    value: formatBytesValue(processMetrics.memory?.rssBytes),
    meta: `Heap ${formatBytesValue(processMetrics.memory?.heapUsedBytes)} · PID ${processMetrics.pid || '--'}`,
    badge: '进程',
    badgeClass: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-200'
  },
  {
    key: 'redis-memory',
    label: 'Redis 内存',
    value: redis.available ? formatBytesValue(redis.memoryUsedBytes) : '--',
    meta: redis.available
      ? `峰值 ${formatBytesValue(redis.peakMemoryBytes)} · 客户端 ${formatCount(redis.connectedClients)}`
      : redis.message || 'Redis 不可用',
    badge: redis.connected ? '已连接' : '离线',
    badgeClass: redis.connected
      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200'
      : 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-200'
  },
  {
    key: 'connections',
    label: '网络连接数',
    value:
      network.connections?.available === false
        ? '--'
        : formatCount(network.connections?.established),
    meta:
      network.connections?.available === false
        ? network.connections?.message || '连接数不可用'
        : '当前已建立 TCP 连接',
    badge: '连接',
    badgeClass: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-200'
  },
  {
    key: 'throughput',
    label: '网络吞吐',
    value:
      network.throughput?.available === false
        ? '--'
        : formatThroughput(network.throughput?.bytesTotalPerSec),
    meta:
      network.throughput?.available === false
        ? network.throughput?.message || '等待采样'
        : `下行 ${formatThroughput(network.throughput?.bytesReceivedPerSec)} · 上行 ${formatThroughput(network.throughput?.bytesSentPerSec)}`,
    badge: network.throughput?.available ? '流量' : '采样中',
    badgeClass: network.throughput?.available
      ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-200'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-700/80 dark:text-slate-200'
  },
  {
    key: 'system-uptime',
    label: '系统运行时长',
    value: formatDuration(host.systemUptimeSeconds),
    meta: `${host.platform || '--'} ${host.release || '--'}`,
    badge: '主机',
    badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-700/80 dark:text-slate-200'
  },
  {
    key: 'process-uptime',
    label: '程序运行时长',
    value: formatDuration(processMetrics.uptimeSeconds),
    meta: `主机 ${host.hostname || '--'} · 时间 ${lastFetchedLabel}`,
    badge: '服务',
    badgeClass: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/30 dark:text-fuchsia-200'
  }
]

export const buildSecondaryMetrics = ({ network, processMetrics, memory, redis }) => [
  {
    key: 'network-total',
    label: '累计网络流量',
    value:
      network.totals?.available === false
        ? '--'
        : `${formatBytesValue(network.totals?.bytesReceived)} / ${formatBytesValue(network.totals?.bytesSent)}`,
    meta:
      network.totals?.available === false
        ? network.totals?.message || '累计流量不可用'
        : `累计总量 ${formatBytesValue(network.totals?.totalBytes)}`
  },
  {
    key: 'process-heap',
    label: 'Heap 使用',
    value: `${formatBytesValue(processMetrics.memory?.heapUsedBytes)} / ${formatBytesValue(processMetrics.memory?.heapTotalBytes)}`,
    meta: `RSS ${formatBytesValue(processMetrics.memory?.rssBytes)} · External ${formatBytesValue(processMetrics.memory?.externalBytes)}`
  },
  {
    key: 'system-memory',
    label: '主机内存占用',
    value: formatPercent(memory.usagePercent, true),
    meta: `已用 ${formatBytesValue(memory.usedBytes)} · 可用 ${formatBytesValue(memory.availableBytes)}`
  },
  {
    key: 'redis-fragment',
    label: 'Redis 碎片率',
    value: redis.available ? `${Number(redis.fragmentationRatio || 0).toFixed(2)}x` : '--',
    meta: redis.available
      ? `版本 ${redis.version || '--'} · 运行 ${formatDuration(redis.uptimeSeconds)}`
      : redis.message || 'Redis 指标不可用'
  }
]

export const buildEnvironmentMetrics = ({ host, redis }) => [
  { key: 'hostname', label: '主机名', value: host.hostname || '--' },
  { key: 'platform', label: '平台', value: host.platform || '--' },
  { key: 'release', label: '系统版本', value: host.release || '--' },
  { key: 'arch', label: '架构', value: host.arch || '--' },
  { key: 'node', label: 'Node 版本', value: host.nodeVersion || '--' },
  {
    key: 'redis-version',
    label: 'Redis 版本',
    value: redis.available ? redis.version || '--' : '未连接'
  }
]
