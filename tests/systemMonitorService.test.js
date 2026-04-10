const { SystemMonitorService } = require('../src/services/systemMonitorService')

describe('systemMonitorService', () => {
  it('collects cpu, memory, network and redis metrics', async () => {
    const osModule = {
      cpus: jest.fn(() => [
        { times: { user: 160, nice: 0, sys: 30, idle: 210, irq: 0 } },
        { times: { user: 140, nice: 0, sys: 20, idle: 250, irq: 0 } }
      ]),
      totalmem: jest.fn(() => 16 * 1024 * 1024 * 1024),
      freemem: jest.fn(() => 6 * 1024 * 1024 * 1024),
      uptime: jest.fn(() => 7200),
      loadavg: jest.fn(() => [1.2, 0.8, 0.6]),
      hostname: jest.fn(() => 'relay-host'),
      release: jest.fn(() => '6.8.0'),
      arch: jest.fn(() => 'x64')
    }

    const redisInfo = {
      memory: ['used_memory:10485760', 'used_memory_peak:15728640', 'mem_fragmentation_ratio:1.2'],
      clients: ['connected_clients:8'],
      server: ['redis_version:7.2.0', 'uptime_in_seconds:3600']
    }
    const redisModule = {
      isConnected: true,
      getClientSafe: jest.fn(() => ({
        info: jest.fn((section) => Promise.resolve(`${redisInfo[section].join('\n')}\n`))
      }))
    }
    const fsModule = {
      readFileSync: jest.fn(() =>
        [
          'Inter-|   Receive                                                |  Transmit',
          ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
          '  eth0: 5000 0 0 0 0 0 0 0 9000 0 0 0 0 0 0 0',
          '    lo: 1000 0 0 0 0 0 0 0 1000 0 0 0 0 0 0 0'
        ].join('\n')
      )
    }
    const commandRunner = jest.fn().mockResolvedValue({
      stdout: [
        'Netid State',
        'tcp ESTAB 0 0 127.0.0.1:8150 127.0.0.1:9000',
        'tcp ESTAB 0 0 10.0.0.1:443 10.0.0.2:50000'
      ].join('\n')
    })

    const service = new SystemMonitorService({
      osModule,
      redisModule,
      fsModule,
      commandRunner,
      platform: 'linux'
    })

    service.lastCpuSnapshot = {
      idle: 300,
      total: 600,
      timestamp: Date.now() - 1000,
      logicalCores: 2
    }
    service.lastNetworkSnapshot = {
      bytesReceived: 1000,
      bytesSent: 3000,
      timestamp: Date.now() - 2000
    }

    const snapshot = await service.getSnapshot()

    expect(snapshot.host).toEqual(
      expect.objectContaining({
        hostname: 'relay-host',
        platform: 'linux',
        arch: 'x64'
      })
    )
    expect(snapshot.cpu).toEqual(
      expect.objectContaining({
        available: true,
        logicalCores: 2,
        usagePercent: expect.any(Number)
      })
    )
    expect(snapshot.memory).toEqual(
      expect.objectContaining({
        totalBytes: 16 * 1024 * 1024 * 1024,
        availableBytes: 6 * 1024 * 1024 * 1024
      })
    )
    expect(snapshot.process).toEqual(
      expect.objectContaining({
        pid: process.pid,
        memory: expect.objectContaining({
          rssBytes: expect.any(Number),
          heapUsedBytes: expect.any(Number)
        })
      })
    )
    expect(snapshot.network.connections).toEqual(
      expect.objectContaining({
        available: true,
        established: 2
      })
    )
    expect(snapshot.network.throughput.available).toBe(true)
    expect(snapshot.network.throughput.bytesReceivedPerSec).toBeGreaterThanOrEqual(1900)
    expect(snapshot.network.throughput.bytesReceivedPerSec).toBeLessThanOrEqual(2100)
    expect(snapshot.network.throughput.bytesSentPerSec).toBeGreaterThanOrEqual(2900)
    expect(snapshot.network.throughput.bytesSentPerSec).toBeLessThanOrEqual(3100)
    expect(snapshot.redis).toEqual(
      expect.objectContaining({
        available: true,
        connected: true,
        memoryUsedBytes: 10485760,
        peakMemoryBytes: 15728640,
        connectedClients: 8,
        version: '7.2.0'
      })
    )
  })

  it('returns explicit degraded status when optional collectors are unavailable', async () => {
    const service = new SystemMonitorService({
      osModule: {
        cpus: jest.fn(() => [{ times: { user: 1, nice: 0, sys: 1, idle: 8, irq: 0 } }]),
        totalmem: jest.fn(() => 8 * 1024 * 1024 * 1024),
        freemem: jest.fn(() => 2 * 1024 * 1024 * 1024),
        uptime: jest.fn(() => 300),
        loadavg: jest.fn(() => [0, 0, 0]),
        hostname: jest.fn(() => 'relay-host'),
        release: jest.fn(() => 'test'),
        arch: jest.fn(() => 'x64')
      },
      redisModule: {
        isConnected: false
      },
      fsModule: {
        readFileSync: jest.fn(() => {
          throw new Error('missing /proc/net/dev')
        })
      },
      commandRunner: jest.fn().mockRejectedValue(new Error('ss not found')),
      platform: 'linux'
    })

    const snapshot = await service.getSnapshot()

    expect(snapshot.network.connections).toEqual(
      expect.objectContaining({
        available: false
      })
    )
    expect(snapshot.network.throughput).toEqual(
      expect.objectContaining({
        available: false
      })
    )
    expect(snapshot.redis).toEqual(
      expect.objectContaining({
        available: false,
        connected: false
      })
    )
    expect(snapshot.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('网络连接数'),
        expect.stringContaining('网络流量'),
        expect.stringContaining('Redis')
      ])
    )
  })
})
