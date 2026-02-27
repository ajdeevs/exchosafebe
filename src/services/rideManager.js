const { SERVER_EVENTS } = require('../constants/events');
const { ROLE_PASSENGER, ROLE_CAB_DEVICE, ROLE_POLICE } = require('../constants/roles');
const heartbeatMonitor = require('./heartbeatMonitor');
const sosService = require('./sosService');
const eventBus = require('./eventBus');
const prisma = require('../prismaClient');

class RideManager {
  constructor() {
    this.rides = new Map();
    this.socketIndex = new Map();
    this.policeSockets = new Set();

    eventBus.on(SERVER_EVENTS.SOS_TRIGGERED, (payload) => {
      this.broadcastToPolice(SERVER_EVENTS.SOS_TRIGGERED, payload);
    });

    eventBus.on(SERVER_EVENTS.HARASSMENT_FLAG, (payload) => {
      this.broadcastToPolice(SERVER_EVENTS.HARASSMENT_FLAG, payload);
    });

    eventBus.on(SERVER_EVENTS.MEDIA_AVAILABLE, (payload) => {
      this.broadcastToPolice(SERVER_EVENTS.MEDIA_AVAILABLE, payload);
    });
  }

  createRideSession(rideId, meta) {
    if (!this.rides.has(rideId)) {
      this.rides.set(rideId, {
        rideId,
        passengerId: meta.passengerId,
        driverId: meta.driverId,
        cabDeviceId: meta.cabDeviceId,
        status: meta.status || 'STARTED',
        passengerLocation: null,
        cabLocation: null,
        passengerSocket: null,
        cabSocket: null
      });
    }
    return this.rides.get(rideId);
  }

  attachPassengerSocket(rideId, socket, userId) {
    const ride = this._ensureRide(rideId);
    ride.passengerId = userId;
    ride.passengerSocket = socket;
    this.socketIndex.set(socket, { rideId, role: ROLE_PASSENGER, userId });

    heartbeatMonitor.register(rideId, ROLE_PASSENGER, async (rId) => {
      await sosService.triggerSOS(rId, 'passenger_disconnect');
    });
  }

  attachCabSocket(rideId, socket, cabDeviceId) {
    const ride = this._ensureRide(rideId);
    ride.cabDeviceId = cabDeviceId;
    ride.cabSocket = socket;
    this.socketIndex.set(socket, { rideId, role: ROLE_CAB_DEVICE, userId: cabDeviceId });

    heartbeatMonitor.register(rideId, ROLE_CAB_DEVICE, async (rId) => {
      await sosService.triggerSOS(rId, 'cab_disconnect');
    });
  }

  attachPoliceSocket(socket, userId) {
    this.policeSockets.add(socket);
    this.socketIndex.set(socket, { rideId: null, role: ROLE_POLICE, userId });
  }

  updateLocation(rideId, role, location) {
    const ride = this.rides.get(rideId);
    if (!ride) return;

    if (role === ROLE_PASSENGER) {
      ride.passengerLocation = location;
    } else if (role === ROLE_CAB_DEVICE) {
      ride.cabLocation = location;
    }

    this.broadcastToPolice(SERVER_EVENTS.LIVE_LOCATION_UPDATE, {
      rideId,
      role,
      location
    });
  }

  async handleDisconnect(socket, code, reason) {
    const meta = this.socketIndex.get(socket);
    if (!meta) return;
    const { rideId, role } = meta;

    this.socketIndex.delete(socket);

    if (role === ROLE_POLICE) {
      this.policeSockets.delete(socket);
      return;
    }

    if (!rideId) return;
    const ride = this.rides.get(rideId);
    if (!ride) return;

    if (role === ROLE_PASSENGER && ride.passengerSocket === socket) {
      ride.passengerSocket = null;
      heartbeatMonitor.unregister(rideId, ROLE_PASSENGER);
      this.broadcastToPolice(SERVER_EVENTS.DEVICE_DISCONNECTED, {
        rideId,
        role: ROLE_PASSENGER
      });
      // If code is not 1000, trigger SOS
      if (code !== 1000) {
        await sosService.triggerSOS(rideId, 'passenger_disconnect');
      } else {
        // Normal disconnect, update DB to ended
        try {
          await prisma.ride.update({
            where: { id: rideId },
            data: { status: 'ENDED' }
          });
          // Also automatically resolve any SOS events connected to this ride
          await prisma.sosEvent.updateMany({
            where: { rideId: rideId, status: 'ACTIVE' },
            data: { status: 'RESOLVED' }
          });
          
          // Broadcast to Police that this ride has naturally concluded 
          this.broadcastToPolice('RIDE_ENDED_PEACEFULLY', { rideId });
        } catch (e) {
          console.error('Failed to resolve ride on disconnect:', e);
        }
      }
    }

    if (role === ROLE_CAB_DEVICE && ride.cabSocket === socket) {
      ride.cabSocket = null;
      heartbeatMonitor.unregister(rideId, ROLE_CAB_DEVICE);
      this.broadcastToPolice(SERVER_EVENTS.DEVICE_DISCONNECTED, {
        rideId,
        role: ROLE_CAB_DEVICE
      });
      // If code is not 1000, trigger SOS
      if (code !== 1000) {
        await sosService.triggerSOS(rideId, 'cab_disconnect');
      } else {
        // Normal disconnect, update DB to ended
        try {
          await prisma.ride.update({
            where: { id: rideId },
            data: { status: 'ENDED' }
          });
        } catch (e) {
          console.error('Failed to resolve ride on cab disconnect:', e);
        }
      }
    }
  }

  broadcastToPolice(type, payload) {
    const message = JSON.stringify({ type, payload });
    for (const socket of this.policeSockets) {
      if (socket.readyState === socket.OPEN) {
        try {
          socket.send(message);
        } catch (err) {
          console.error('Error broadcasting to police:', err);
        }
      }
    }
  }

  _ensureRide(rideId) {
    if (!this.rides.has(rideId)) {
      this.rides.set(rideId, {
        rideId,
        passengerId: null,
        driverId: null,
        cabDeviceId: null,
        status: 'STARTED',
        passengerLocation: null,
        cabLocation: null,
        passengerSocket: null,
        cabSocket: null
      });
    }
    return this.rides.get(rideId);
  }
}

const rideManager = new RideManager();

module.exports = rideManager;
