const prisma = require('../prismaClient');
const eventBus = require('./eventBus');
const { SERVER_EVENTS } = require('../constants/events');

class SosService {
  async triggerSOS(rideId, reason, imageUrl = null) {
    if (!rideId) {
      console.warn('Attempted to trigger SOS without rideId');
      return;
    }

    try {
      const ride = await prisma.ride.upsert({
        where: { id: rideId },
        update: { status: 'IN_PROGRESS' },
        create: {
          id: rideId,
          passengerId: 'unknown',
          driverId: 'unknown',
          cabDeviceId: 'unknown',
          status: 'STARTED'
        }
      });

      const sos = await prisma.sosEvent.create({
        data: {
          rideId: ride.id,
          reason,
          imageUrl,
          status: 'ACTIVE'
        }
      });

      this.notifyPolice(rideId, reason, sos.id, imageUrl);
    } catch (err) {
      console.error('Failed to trigger SOS:', err);
    }
  }

  notifyPolice(rideId, reason, sosId, imageUrl = null) {
    eventBus.emit(SERVER_EVENTS.SOS_TRIGGERED, {
      rideId,
      reason,
      sosId,
      imageUrl
    });
  }

  notifyPoliceHarassment(rideId, confidence) {
    eventBus.emit(SERVER_EVENTS.HARASSMENT_FLAG, {
      rideId,
      confidence
    });
  }

  notifyPoliceMedia(rideId, mediaType, url) {
    eventBus.emit(SERVER_EVENTS.MEDIA_AVAILABLE, {
      rideId,
      mediaType,
      url
    });
  }
}

module.exports = new SosService();
