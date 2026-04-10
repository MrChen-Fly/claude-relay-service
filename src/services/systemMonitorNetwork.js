const { toInt } = require('./systemMonitorUtils')

const NETWORK_TOTALS_PATH = '/proc/net/dev'

function countEstablishedConnections(output = '') {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /ESTABLISHED|ESTAB/i.test(line)).length
}

async function collectLinuxConnectionCount(commandRunner) {
  try {
    const { stdout } = await commandRunner('ss', ['-tun', 'state', 'established'], {
      maxBuffer: 1024 * 1024
    })
    return countEstablishedConnections(stdout)
  } catch (error) {
    const { stdout } = await commandRunner('netstat', ['-an'], {
      maxBuffer: 1024 * 1024
    })
    return countEstablishedConnections(stdout)
  }
}

async function collectWindowsConnectionCount(commandRunner) {
  try {
    const { stdout } = await commandRunner(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        '(Get-NetTCPConnection -State Established | Measure-Object).Count'
      ],
      { maxBuffer: 1024 * 1024 }
    )
    return toInt(String(stdout).trim())
  } catch (error) {
    const { stdout } = await commandRunner('netstat', ['-an'], {
      maxBuffer: 1024 * 1024
    })
    return countEstablishedConnections(stdout)
  }
}

async function collectDarwinConnectionCount(commandRunner) {
  const { stdout } = await commandRunner('netstat', ['-an'], {
    maxBuffer: 1024 * 1024
  })
  return countEstablishedConnections(stdout)
}

async function collectConnectionMetrics({ platform, commandRunner }) {
  let established = 0

  if (platform === 'win32') {
    established = await collectWindowsConnectionCount(commandRunner)
  } else if (platform === 'linux') {
    established = await collectLinuxConnectionCount(commandRunner)
  } else if (platform === 'darwin') {
    established = await collectDarwinConnectionCount(commandRunner)
  } else {
    throw new Error(`unsupported platform ${platform}`)
  }

  return {
    available: true,
    established
  }
}

function collectLinuxNetworkTotals(fsModule, networkTotalsPath) {
  const raw = fsModule.readFileSync(networkTotalsPath || NETWORK_TOTALS_PATH, 'utf8')
  let bytesReceived = 0
  let bytesSent = 0

  raw.split('\n').forEach((line) => {
    if (!line.includes(':')) {
      return
    }

    const [namePart, countersPart] = line.split(':')
    const interfaceName = namePart.trim()
    if (!interfaceName || interfaceName === 'lo') {
      return
    }

    const counters = countersPart.trim().split(/\s+/)
    bytesReceived += toInt(counters[0])
    bytesSent += toInt(counters[8])
  })

  return {
    available: true,
    bytesReceived,
    bytesSent,
    totalBytes: bytesReceived + bytesSent
  }
}

async function collectWindowsNetworkTotals(commandRunner) {
  const { stdout } = await commandRunner(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; Get-NetAdapterStatistics | Select-Object Name,ReceivedBytes,SentBytes | ConvertTo-Json -Compress'
    ],
    { maxBuffer: 1024 * 1024 }
  )

  const parsed = JSON.parse(stdout || '[]')
  const adapters = Array.isArray(parsed) ? parsed : [parsed]
  const totals = adapters.reduce(
    (result, adapter) => {
      const name = String(adapter.Name || '')
      if (/loopback/i.test(name)) {
        return result
      }
      result.bytesReceived += toInt(adapter.ReceivedBytes)
      result.bytesSent += toInt(adapter.SentBytes)
      return result
    },
    { bytesReceived: 0, bytesSent: 0 }
  )

  return {
    available: true,
    bytesReceived: totals.bytesReceived,
    bytesSent: totals.bytesSent,
    totalBytes: totals.bytesReceived + totals.bytesSent
  }
}

async function collectDarwinNetworkTotals(commandRunner) {
  const { stdout } = await commandRunner('netstat', ['-ibn'], {
    maxBuffer: 1024 * 1024
  })

  const lines = stdout.split(/\r?\n/).filter(Boolean)
  const headerLine = lines.find((line) => line.includes('Name') && line.includes('Ibytes'))
  if (!headerLine) {
    throw new Error('unexpected netstat output')
  }

  const headerColumns = headerLine.trim().split(/\s+/)
  const nameIndex = headerColumns.indexOf('Name')
  const inboundIndex = headerColumns.indexOf('Ibytes')
  const outboundIndex = headerColumns.indexOf('Obytes')
  if (nameIndex < 0 || inboundIndex < 0 || outboundIndex < 0) {
    throw new Error('missing network byte columns')
  }

  const totalsByInterface = new Map()
  lines.slice(lines.indexOf(headerLine) + 1).forEach((line) => {
    const columns = line.trim().split(/\s+/)
    if (columns.length <= outboundIndex) {
      return
    }

    const name = columns[nameIndex]
    if (!name || name === 'lo0') {
      return
    }

    const received = toInt(columns[inboundIndex])
    const sent = toInt(columns[outboundIndex])
    const current = totalsByInterface.get(name) || { received: 0, sent: 0 }
    current.received = Math.max(current.received, received)
    current.sent = Math.max(current.sent, sent)
    totalsByInterface.set(name, current)
  })

  let bytesReceived = 0
  let bytesSent = 0
  totalsByInterface.forEach((item) => {
    bytesReceived += item.received
    bytesSent += item.sent
  })

  return {
    available: true,
    bytesReceived,
    bytesSent,
    totalBytes: bytesReceived + bytesSent
  }
}

async function collectNetworkTotals({ platform, commandRunner, fsModule, networkTotalsPath }) {
  if (platform === 'linux') {
    return collectLinuxNetworkTotals(fsModule, networkTotalsPath)
  }
  if (platform === 'win32') {
    return collectWindowsNetworkTotals(commandRunner)
  }
  if (platform === 'darwin') {
    return collectDarwinNetworkTotals(commandRunner)
  }
  throw new Error(`unsupported platform ${platform}`)
}

module.exports = {
  collectConnectionMetrics,
  collectNetworkTotals
}
