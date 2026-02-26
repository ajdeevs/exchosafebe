const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sosService = require('../services/sosService');
const auth = require('../middleware/auth');
const { ROLE_PASSENGER, ROLE_CAB_DEVICE } = require('../constants/roles');

const router = express.Router();

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    const timestamp = Date.now();
    const ext = path.extname(file.originalname);
    const base = path.basename(file.originalname, ext);
    cb(null, `${base}-${timestamp}${ext}`);
  }
});

const upload = multer({ storage });

function buildFileUrl(req, filePath) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.get('host');
  const relativePath = filePath.replace(/\\/g, '/');
  return `${protocol}://${host}/${relativePath}`;
}

const rideScopedAuth = auth([ROLE_PASSENGER, ROLE_CAB_DEVICE]);

router.post(
  '/passenger-image',
  rideScopedAuth,
  upload.single('image'),
  async (req, res) => {
    try {
      const rideId = req.body.rideId;
      if (!rideId) {
        return res.status(400).json({ error: 'rideId is required' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'image file is required' });
      }

      const filePath = path.join(uploadDir, req.file.filename);
      const url = buildFileUrl(req, filePath);

      await sosService.notifyPoliceMedia(rideId, 'PASSENGER_IMAGE', url);

      return res.status(201).json({ rideId, url });
    } catch (err) {
      console.error('Error uploading passenger image:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/cab-snapshot',
  rideScopedAuth,
  upload.single('image'),
  async (req, res) => {
    try {
      const rideId = req.body.rideId;
      if (!rideId) {
        return res.status(400).json({ error: 'rideId is required' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'image file is required' });
      }

      const filePath = path.join(uploadDir, req.file.filename);
      const url = buildFileUrl(req, filePath);

      await sosService.notifyPoliceMedia(rideId, 'CAB_SNAPSHOT', url);

      return res.status(201).json({ rideId, url });
    } catch (err) {
      console.error('Error uploading cab snapshot:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

router.post(
  '/audio-snippet',
  rideScopedAuth,
  upload.single('audio'),
  async (req, res) => {
    try {
      const rideId = req.body.rideId;
      if (!rideId) {
        return res.status(400).json({ error: 'rideId is required' });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'audio file is required' });
      }

      const filePath = path.join(uploadDir, req.file.filename);
      const url = buildFileUrl(req, filePath);

      await sosService.notifyPoliceMedia(rideId, 'AUDIO_SNIPPET', url);

      return res.status(201).json({ rideId, url });
    } catch (err) {
      console.error('Error uploading audio snippet:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

module.exports = router;
