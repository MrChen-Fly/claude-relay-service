const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')
const { promisify } = require('util')
const redis = require('../models/redis')
const { collectConnectionMetrics, collectNetworkTotals } = require('./systemMonitorNetwork')
const {
  createUnavailableMetric,
  parseRedisInfo,
  roundNumber,
  toFloat,
  toInt
} = require('./systemMonitorUtils')

const execFileAsync = promisify(execFile)
const MIN_SAMPLE_WINDOW_MS = 250

class SystemMonitorService {
  constructor(options = {}) {
    this.os = options.osModule || os
    this.fs = options.fsModule || fs
    this.redis = options.redisModule || redis
    this.commandRunner = options.commandRunner || execFileAsync
    this.platform = options.platform || process.platform
    this.networkTotalsPath = options.networkTotalsPath
    this.lastCpuSnapshot = this.captureCpuSnapshot()
    this.lastNetworkSnapshot = null
  }

  captureCpuSnapshot() {
    const cpus = this.os.cpus() || []
    return cpus.reduce(
      (snapshot, cpu) => {
        const times = cpu.times || {}
        const total =
          (times.user || 0) +
          (times.nice || 0) +
          (times.sys || 0) +
          (times.idle || 0) +
          (times.irq || 0)

        snapshot.total += total
        snapshot.idle += times.idle || 0
        return snapshot
      },
      {
        timestamp: Date.now(),
        total: 0,
        idle: 0,
        logicalCores: cpus.length
      }
    )
  }

  collectCpuMetrics() {
    const currentSnapshot = this.captureCpuSnapshot()
    const previousSnapshot = this.lastCpuSnapshot
    this.lastCpuSnapshot = currentSnapshot

    if (!previousSnapshot || currentSnapshot.total <= previousSnapshot.total) {
      return createUnavailableMetric('CPU 采样尚未准备完成', {
        logicalCores: currentSnapshot.logicalCores || 0
      })
    }

    const totalDiff = currentSnapshot.total - previousSnapshot.total
    const idleDiff = currentSnapshot.idle - previousSnapshot.idle
    const usagePercent = ((totalDiff - idleDiff) / totalDiff) * 100

    return {
      available: true,
      usagePercent: roundNumber(usagePercent),
      logicalCores: currentSnapshot.logicalCores || previousSnapshot.logicalCores || 0,
      sampleWindowMs: Math.max(0, currentSnapshot.timestamp - previousSnapshot.timestamp)
    }
  }

  collectMemoryMetrics() {
    const totalBytes = this.os.totalmem()
    const availableBytes = this.os.freemem()
    const usedBytes = Math.max(0, totalBytes - availableBytes)

    return {
      available: true,
      totalBytes,
      availableBytes,
      usedBytes,
      usagePercent: totalBytes > 0 ? roundNumber((usedBytes / totalBytes) * 100) : 0
    }
  }

  collectProcessMetrics() {
    const memory = process.memoryUsage()

    return {
      available: true,
      pid: process.pid,
      uptimeSeconds: roundNumber(process.uptime()),
      memory: {
        rssBytes: memory.rss,
        heapTotalBytes: memory.heapTotal,
        heapUsedBytes: memory.heapUsed,
        externalBytes: memory.external,
        arrayBuffersBytes: memory.arrayBuffers || 0
      }
    }
  }

  collectHostMetrics() {
    return {
      hostname: this.os.hostname(),
      platform: this.platform,
      release: this.os.release(),
      arch: this.os.arch(),
      systemUptimeSeconds: roundNumber(this.os.uptime()),
      nodeVersion: process.version,
      loadAverage: this.os.loadavg()
    }
  }

  async getSnapshot() {
    const [network, redisMetrics] = await Promise.all([
      this.collectNetworkMetrics(),
      this.collectRedisMetrics()
    ])

    return {
      timestamp: new Date().toISOString(),
      host: this.collectHostMetrics(),
      cpu: this.collectCpuMetrics(),
      memory: this.collectMemoryMetrics(),
      process: this.collectProcessMetrics(),
      network,
      redis: redisMetrics,
      warnings: [...network.warnings, ...redisMetrics.warnings]
    }
  }

  async collectNetworkMetrics() {
    const warnings = []
    const connections = await collectConnectionMetrics({
      platform: this.platform,
      commandRunner: this.commandRunner
    }).catch((error) => {
      const message = `网络连接数不可用: ${error.message}`
      warnings.push(message)
      return createUnavailableMetric(message, { established: null })
    })
    const totals = await collectNetworkTotals({
      platform: this.platform,
      commandRunner: this.commandRunner,
      fsModule: this.fs,
      networkTotalsPath: this.networkTotalsPath
    }).catch((error) => {
      const message = `网络流量不可用: ${error.message}`
      warnings.push(message)
      return createUnavailableMetric(message, {
        bytesReceived: null,
        bytesSent: null,
        totalBytes: null
      })
    })

    let throughput = createUnavailableMetric('等待网络流量采样', {
      bytesReceivedPerSec: null,
      bytesSentPerSec: null,
      bytesTotalPerSec: null
    })

    if (totals.available) {
      const currentSnapshot = {
        timestamp: Date.now(),
        bytesReceived: totals.bytesReceived,
        bytesSent: totals.bytesSent
      }

      if (this.lastNetworkSnapshot) {
        const elapsedMs = currentSnapshot.timestamp - this.lastNetworkSnapshot.timestamp
        if (elapsedMs >= MIN_SAMPLE_WINDOW_MS) {
          const receivedDelta = Math.max(
            0,
            currentSnapshot.bytesReceived - this.lastNetworkSnapshot.bytesReceived
          )
          const sentDelta = Math.max(
            0,
            currentSnapshot.bytesSent - this.lastNetworkSnapshot.bytesSent
          )

          throughput = {
            available: true,
            bytesReceivedPerSec: Math.round(receivedDelta / (elapsedMs / 1000)),
            bytesSentPerSec: Math.round(sentDelta / (elapsedMs / 1000)),
            bytesTotalPerSec: Math.round((receivedDelta + sentDelta) / (elapsedMs / 1000))
          }
        }
      }

      this.lastNetworkSnapshot = currentSnapshot
    }

    return {
      connections,
      totals,
      throughput,
      warnings
    }
  }

  async collectRedisMetrics() {
    if (!this.redis.isConnected) {
      return {
        available: false,
        connected: false,
        message: 'Redis 未连接',
        warnings: ['Redis 不可用: Redis 未连接']
      }
    }

    try {
      const client = this.redis.getClientSafe ? this.redis.getClientSafe() : this.redis.getClient()
      const [memoryInfoRaw, clientsInfoRaw, serverInfoRaw] = await Promise.all([
        client.info('memory'),
        client.info('clients'),
        client.info('server')
      ])
      const memoryInfo = parseRedisInfo(memoryInfoRaw)
      const clientsInfo = parseRedisInfo(clientsInfoRaw)
      const serverInfo = parseRedisInfo(serverInfoRaw)

      return {
        available: true,
        connected: true,
        memoryUsedBytes: toInt(memoryInfo.used_memory),
        peakMemoryBytes: toInt(memoryInfo.used_memory_peak),
        fragmentationRatio: toFloat(memoryInfo.mem_fragmentation_ratio),
        connectedClients: toInt(clientsInfo.connected_clients),
        version: serverInfo.redis_version || '',
        uptimeSeconds: toInt(serverInfo.uptime_in_seconds),
        warnings: []
      }
    } catch (error) {
      return {
        available: false,
        connected: true,
        message: `Redis 指标采集失败: ${error.message}`,
        warnings: [`Redis 不可用: ${error.message}`]
      }
    }
  }
}

const systemMonitorService = new SystemMonitorService()

module.exports = systemMonitorService
module.exports.SystemMonitorService = SystemMonitorService
