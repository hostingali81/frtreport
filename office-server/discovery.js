const dgram = require('dgram');
const os = require('os');

const UDP_PORT = 41234;

function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4 and not internal localhost
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function startDiscoveryServer(httpPort = 8080) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  socket.on('error', (err) => {
    console.error('[Discovery] Socket error:', err.message);
  });

  socket.on('message', (msg, rinfo) => {
    const text = msg.toString().trim();
    if (text.startsWith('FRT_DISCOVERY_REQ')) {
      const localIps = getLocalIpAddresses();
      const primaryIp = localIps[0] || '127.0.0.1';
      const response = `FRT_DISCOVERY_ACK:${httpPort}:${primaryIp}:${os.hostname()}`;
      const resBuffer = Buffer.from(response);

      socket.send(resBuffer, 0, resBuffer.length, rinfo.port, rinfo.address, (err) => {
        if (err) {
          console.error(`[Discovery] Failed to send reply to ${rinfo.address}:${rinfo.port}`, err);
        } else {
          console.log(`[Discovery] Handshake answered -> ${rinfo.address}:${rinfo.port} (Server IP: ${primaryIp}:${httpPort})`);
        }
      });
    }
  });

  socket.bind(UDP_PORT, () => {
    try {
      socket.setBroadcast(true);
    } catch (_) {}
    console.log(`[Discovery] UDP Beacon listening on port ${UDP_PORT} (Local IPs: ${getLocalIpAddresses().join(', ')})`);
  });

  return socket;
}

module.exports = {
  startDiscoveryServer,
  getLocalIpAddresses,
  UDP_PORT,
};
