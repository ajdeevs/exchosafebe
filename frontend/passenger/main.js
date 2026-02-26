(() => {
  const rideInput = document.getElementById('ride-id');
  const passengerInput = document.getElementById('passenger-id');
  const btnConnect = document.getElementById('btn-connect');
  const btnDisconnect = document.getElementById('btn-disconnect');
  const btnSendLocation = document.getElementById('btn-send-location');
  const btnSos = document.getElementById('btn-sos');
  const wsStatusEl = document.getElementById('ws-status');
  const geoStatusEl = document.getElementById('geo-status');
  const geoLabelEl = document.getElementById('geo-label');
  const metaHeartbeatEl = document.getElementById('meta-heartbeat');
  const metaLocationEl = document.getElementById('meta-location');
  const logEl = document.getElementById('log');

  let ws = null;
  let lastLocation = null;
  let heartbeatTimer = null;
  let liveLocationTimer = null;
  let geoWatchId = null;

  function logLine(text) {
    const line = document.createElement('div');
    line.className = 'log-line';
    const t = new Date().toLocaleTimeString(undefined, { hour12: false });
    line.innerHTML = `<time>[${t}]</time> ${text}`;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function setWsStatus(kind, text) {
    wsStatusEl.className = `badge ${kind}`;
    wsStatusEl.textContent = text;
  }

  async function getPassengerToken(passengerId) {
    const res = await fetch('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: passengerId,
        role: 'PASSENGER'
      })
    });
    if (!res.ok) {
      throw new Error(`Token error ${res.status}`);
    }
    const data = await res.json();
    if (!data.token) {
      throw new Error('No token in response');
    }
    return data.token;
  }

  function startHeartbeat() {
    stopHeartbeat();
    metaHeartbeatEl.textContent = 'Heartbeat: sending every 5s';
    heartbeatTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'HEARTBEAT' }));
    }, 5000);
  }

  function stopHeartbeat() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    metaHeartbeatEl.textContent = 'Heartbeat: idle';
  }

  function startLiveLocation() {
    if (liveLocationTimer) return;
    liveLocationTimer = setInterval(() => {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!lastLocation) return;
      const payload = { lat: lastLocation.lat, lng: lastLocation.lng };
      ws.send(JSON.stringify({ type: 'LOCATION_UPDATE', payload }));
      metaLocationEl.textContent = `Live location: ${payload.lat.toFixed(4)}, ${payload.lng.toFixed(4)}`;
    }, 3000);
    logLine('Started live location streaming after SOS');
  }

  function stopLiveLocation() {
    if (liveLocationTimer) {
      clearInterval(liveLocationTimer);
      liveLocationTimer = null;
    }
  }

  function sendLocationOnce() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!lastLocation) {
      logLine('No GPS fix yet');
      return;
    }
    const payload = { lat: lastLocation.lat, lng: lastLocation.lng };
    ws.send(JSON.stringify({ type: 'LOCATION_UPDATE', payload }));
    logLine(`Sent LOCATION_UPDATE ${payload.lat.toFixed(4)}, ${payload.lng.toFixed(4)}`);
    metaLocationEl.textContent = `Last location: ${payload.lat.toFixed(4)}, ${payload.lng.toFixed(4)}`;
  }

  function startGeolocation() {
    if (!('geolocation' in navigator)) {
      geoLabelEl.textContent = 'Geolocation not supported, using dummy coords';
      lastLocation = { lat: 12.9716, lng: 77.5946 };
      return;
    }
    geoLabelEl.textContent = 'Waiting for GPS fix…';
    geoWatchId = navigator.geolocation.watchPosition(
      (pos) => {
        lastLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };
        geoLabelEl.textContent = `GPS ready (${lastLocation.lat.toFixed(4)}, ${lastLocation.lng.toFixed(4)})`;
      },
      () => {
        geoLabelEl.textContent = 'GPS error, using last known or dummy position';
        if (!lastLocation) {
          lastLocation = { lat: 12.9716, lng: 77.5946 };
        }
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 8000 }
    );
  }

  function stopGeolocation() {
    if (geoWatchId != null && navigator.geolocation && navigator.geolocation.clearWatch) {
      navigator.geolocation.clearWatch(geoWatchId);
    }
    geoWatchId = null;
  }

  async function connectRide() {
    const rideId = rideInput.value.trim();
    const passengerId = passengerInput.value.trim() || 'passenger-web';
    if (!rideId) {
      alert('Please enter a Ride ID');
      return;
    }
    btnConnect.disabled = true;
    btnDisconnect.disabled = true;
    btnSendLocation.disabled = true;
    btnSos.disabled = true;
    setWsStatus('idle', 'Connecting…');
    logLine(`Connecting for ride ${rideId} as ${passengerId}`);

    try {
      const token = await getPassengerToken(passengerId);
      const wsUrl = window.location.origin.replace(/^http/, 'ws');
      ws = new WebSocket(wsUrl);

      ws.addEventListener('open', () => {
        setWsStatus('ok', 'Connected');
        logLine('WebSocket open, sending REGISTER');
        ws.send(
          JSON.stringify({
            type: 'REGISTER',
            payload: {
              role: 'PASSENGER',
              rideId,
              token
            }
          })
        );
        startHeartbeat();
        startGeolocation();
      });

      ws.addEventListener('close', () => {
        setWsStatus('err', 'Disconnected');
        logLine('WebSocket closed');
        stopHeartbeat();
        stopLiveLocation();
        stopGeolocation();
        btnConnect.disabled = false;
        btnDisconnect.disabled = true;
        btnSendLocation.disabled = true;
        btnSos.disabled = true;
      });

      ws.addEventListener('error', () => {
        setWsStatus('err', 'Error');
        logLine('WebSocket error');
      });

      ws.addEventListener('message', (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'REGISTERED') {
            logLine('REGISTERED by backend');
            btnDisconnect.disabled = false;
            btnSendLocation.disabled = false;
            btnSos.disabled = false;
          } else if (msg.type === 'ERROR') {
            logLine(`SERVER ERROR: ${msg.payload.message || 'Unknown'}`);
          } else {
            logLine(`SERVER: ${msg.type}`);
          }
        } catch (err) {
          logLine('Failed to parse server message');
        }
      });
    } catch (err) {
      console.error(err);
      setWsStatus('err', 'Failed');
      logLine(`Failed to connect: ${err.message}`);
      btnConnect.disabled = false;
    }
  }

  function disconnectRide() {
    if (ws) {
      ws.close();
      ws = null;
    }
  }

  function triggerSos() {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'SOS_RAISED' }));
    logLine('SOS_RAISED sent, starting live location');
    startLiveLocation();
  }

  btnConnect.addEventListener('click', connectRide);
  btnDisconnect.addEventListener('click', disconnectRide);
  btnSendLocation.addEventListener('click', sendLocationOnce);
  btnSos.addEventListener('click', triggerSos);
})();

