require('dotenv').config();

const express = require('express');
const http = require('http');
const path = require('path');
const swaggerUi = require('swagger-ui-express');
const fs = require('fs');
const YAML = require('yaml');
const cors = require('cors');

const uploadRoutes = require('./routes/uploadRoutes');
const authRoutes = require('./routes/authRoutes');
const initWebSocketServer = require('./ws/websocketServer');
const prisma = require('./prismaClient');

const app = express();
const port = process.env.PORT || 4000;

// Request logger
const morgan = require('morgan');
app.use(morgan('dev'));

app.use(express.json());
app.use(cors());

const uploadDir = process.env.UPLOAD_DIR || 'uploads';
app.use(`/${uploadDir}`, express.static(path.join(process.cwd(), uploadDir)));

// Serve police dashboard frontend
app.use(
  '/police',
  express.static(path.join(process.cwd(), 'frontend', 'police'), {
    index: 'index.html'
  })
);

// Serve passenger frontend
app.use(
  '/passenger',
  express.static(path.join(process.cwd(), 'frontend', 'passenger'), {
    index: 'index.html'
  })
);

// Serve driver SAFE frontend
app.use(
  '/driver',
  express.static(path.join(process.cwd(), 'frontend', 'driver'), {
    index: 'index.html'
  })
);

const file = fs.readFileSync(path.join(process.cwd(), 'openapi.yaml'), 'utf8');
const swaggerDocument = YAML.parse(file);
// Serve the Swagger UI
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Issue JWTs for testing / internal tools
app.use('/auth', authRoutes);

app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', db: 'up' });
  } catch (err) {
    console.error('Healthcheck DB error:', err);
    res.status(500).json({ status: 'error', db: 'down' });
  }
});

app.use('/upload', uploadRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const server = http.createServer(app);

initWebSocketServer(server);

server.listen(port, () => {
  console.log(`EchoSafe backend listening on port ${port}`);
});
