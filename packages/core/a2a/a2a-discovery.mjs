import { spawnSync } from 'node:child_process';

const DEFAULT_BINS = [
  'C:/Program Files/Tailscale/tailscale.exe',
  'C:/Program Files (x86)/Tailscale/tailscale.exe',
  '/Applications/Tailscale.app/Contents/MacOS/Tailscale',
  '/usr/bin/tailscale',
  '/usr/local/bin/tailscale',
  'tailscale',
];

function normalizePeer(peer) {
  if (typeof peer === 'string') return { ip: peer, online: true, hostname: '' };
  if (!peer || typeof peer !== 'object') return null;
  const ip = peer.ip || peer.address || '';
  if (!ip) return null;
  return {
    ip: String(ip),
    online: peer.online !== false,
    hostname: String(peer.hostname || ''),
    port: peer.port ? Number(peer.port) : undefined,
  };
}

function pickIp(list) {
  if (!Array.isArray(list)) return '';
  return list.find((ip) => String(ip).includes('.')) || list[0] || '';
}

export function normalizePeers(peers) {
  const out = {};
  for (const [role, peer] of Object.entries(peers || {})) {
    const normalized = normalizePeer(peer);
    if (normalized) out[role] = normalized;
  }
  return out;
}

export function discoverPeers(options = {}) {
  const role = options.role || process.env.MMCAS_ROLE || 'modeler';
  if (options.peers && typeof options.peers === 'object' && Object.keys(options.peers).length) {
    return {
      source: 'config',
      self: { role, ip: String(options.selfIp || ''), hostname: '' },
      peers: normalizePeers(options.peers),
      error: null,
    };
  }
  const bins = [options.tailscaleBin, process.env.TAILSCALE_BIN, ...DEFAULT_BINS].filter(Boolean);
  let lastError = '';
  for (const bin of bins) {
    const result = spawnSync(bin, ['status', '--json'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: Number(options.timeoutMs || 5000),
    });
    if (result.error) { lastError = result.error.message; continue; }
    if (result.status !== 0) { lastError = (result.stderr || result.stdout || '').trim().slice(0, 200); continue; }
    try {
      const data = JSON.parse(result.stdout);
      const peers = {};
      for (const peer of Object.values(data.Peer || {})) {
        const hostname = String(peer.HostName || peer.DNSName || '').split('.')[0].toLowerCase();
        if (!hostname.startsWith('mmcas-')) continue;
        const peerRole = hostname.slice('mmcas-'.length);
        if (!peerRole) continue;
        peers[peerRole] = {
          ip: pickIp(peer.TailscaleIPs),
          online: peer.Online === true,
          hostname,
        };
      }
      return {
        source: 'tailscale',
        self: {
          role,
          ip: pickIp(data.Self && data.Self.TailscaleIPs),
          hostname: String((data.Self && data.Self.HostName) || ''),
        },
        peers,
        error: null,
      };
    } catch (err) {
      lastError = err.message;
    }
  }
  return {
    source: 'none',
    self: { role, ip: '', hostname: '' },
    peers: {},
    error: lastError || '未找到可用的 tailscale 命令',
  };
}
