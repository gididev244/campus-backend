require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const mongoSanitize = require('express-mongo-sanitize');
const morgan = require('morgan');
const fs = require('fs');
const path = require('path');
const rfs = require('rotating-file-stream');
const connectDB = require('./config/db');
const { notFound, errorHandler } = require('./middleware/error');
const { requestLogger, errorLogger, requestId } = require('./middleware/requestLogger');
const jwt = require('jsonwebtoken');
const logger = require('./utils/logger');

// Import routes
const authRoutes = require('./routes/auth');
const productRoutes = require('./routes/products');
const orderRoutes = require('./routes/orders');
const reviewRoutes = require('./routes/reviews');
const userRoutes = require('./routes/users');
const categoryRoutes = require('./routes/categories');
const cartRoutes = require('./routes/cart');
const wishlistRoutes = require('./routes/wishlist');
const notificationRoutes = require('./routes/notifications');
const uploadRoutes = require('./routes/upload');
const adminRoutes = require('./routes/admin');

// Initialize express app and HTTP server
const app = express();
const server = http.createServer(app);

// Initialize Socket.io
const io = new Server(server, {
  cors: {
    origin: function (origin, callback) {
      // Allow requests with no origin
      if (!origin) return callback(null, true);

      // Local development origins
      const localOrigins = [
        'http://localhost:3000',
        'http://127.0.0.1:3000',
        'http://localhost:3001',
        'http://127.0.0.1:3001'
      ];

      // Allow local origins
      if (localOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Allow all Vercel deployments (including preview deployments)
      if (origin.endsWith('.vercel.app')) {
        return callback(null, true);
      }

      // Allow custom frontend URL from env
      const frontendUrl = process.env.FRONTEND_URL;
      if (frontendUrl && origin === frontendUrl) {
        return callback(null, true);
      }

      // Allow in development/test mode
      if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
        return callback(null, true);
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST']
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 60000, // 60 seconds
  pingInterval: 25000, // 25 seconds
  upgradeTimeout: 10000, // 10 seconds
  maxHttpBufferSize: 1e6, // 1 MB
  connectTimeout: 10000, // 10 seconds
  // Allow connections to rise after falling
  allowUpgrades: true,
  // Cleanup empty rooms
  cleanupEmptyChildNamespaces: true
});

// Make io globally available for controllers
global.io = io;

// Socket.io authentication middleware
io.use((socket, next) => {
  const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace('Bearer ', '');

  if (!token) {
    return next(new Error('Authentication error: No token provided'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.user = decoded;
    next();
  } catch (err) {
    next(new Error('Authentication error: Invalid token'));
  }
});

// Socket.io connection handler
io.on('connection', (socket) => {
  logger.socket('connect', {
    socketId: socket.id,
    userId: socket.user.id
  });

  // Send connection success confirmation to client
  socket.emit('connection:success', {
    socketId: socket.id,
    userId: socket.user.id,
    timestamp: new Date().toISOString()
  });

  // Join user's personal room for notifications
  socket.join(`user:${socket.user.id}`);

  // Track online users
  const User = require('./models/User');
  User.findByIdAndUpdate(socket.user.id, { isOnline: true, lastSeen: Date.now() }).exec()
    .catch(err => logger.error('Error updating user online status', { userId: socket.user.id }, err));

  // Broadcast user online status
  socket.broadcast.emit('user:online', { userId: socket.user.id });

  // Handle ping from client and respond with pong
  socket.on('ping', () => {
    socket.emit('pong', { timestamp: Date.now() });
  });

  // Handle pong from client (if we send ping from server)
  socket.on('pong', (data) => {
    // Client received our ping and responded
  });

  // Handle client disconnecting
  socket.on('disconnecting', () => {
    console.log(`Client disconnecting: ${socket.id}`);
  });

  // Handle disconnect
  socket.on('disconnect', async (reason) => {
    logger.socket('disconnect', {
      socketId: socket.id,
      userId: socket.user.id,
      reason
    });

    // Mark user as offline
    try {
      await User.findByIdAndUpdate(socket.user.id, { isOnline: false, lastSeen: Date.now() }).exec();
    } catch (err) {
      logger.error('Error updating user offline status', { userId: socket.user.id }, err);
    }

    // Broadcast user offline status
    socket.broadcast.emit('user:offline', { userId: socket.user.id });

    // Clean up any orphaned socket references
    const rooms = socket.rooms;
    rooms.forEach((room) => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });
  });

  // Handle connection errors
  socket.on('error', (error) => {
    logger.socket('error', {
      socketId: socket.id,
      userId: socket.user.id,
      error: error.message
    });

    // If it's an authentication error, disconnect the socket
    if (error.message.includes('Authentication')) {
      logger.security('socket_auth_failed', {
        socketId: socket.id,
        error: error.message
      });
      socket.disconnect();
    }
  });
});

// Handle Socket.io server-level errors
io.on('error', (error) => {
  logger.error('Socket.io server error', { error: error.message }, error);
});

// Log connection statistics every 5 minutes in development
if (process.env.NODE_ENV === 'development') {
  setInterval(() => {
    const socketCount = io.engine?.clientsCount || 0;
    const namespaceSockets = io._nsps?.get('/')?.sockets?.size || 0;
    logger.debug('Socket.io stats', {
      engineClients: socketCount,
      namespaceSockets: namespaceSockets
    });
  }, 5 * 60 * 1000); // 5 minutes
}

// Connect to database
connectDB();

// Create a custom Morgan token for user ID
morgan.token('user-id', (req) => {
  if (req.user && req.user.id) {
    return `user:${req.user.id}`;
  }
  return 'anonymous';
});

// Create a custom token for request ID (useful for tracing)
morgan.token('request-id', (req) => {
  return req.id || Math.random().toString(36).substr(2, 9);
});

// Setup rotating file stream for production logs
const accessLogStream = process.env.NODE_ENV === 'production'
  ? rfs.createStream('access.log', {
      path: path.join(__dirname, 'logs'),
      interval: '1d', // rotate daily
      size: '10M', // rotate when file reaches 10MB
      compress: 'gzip', // compress rotated files
      maxFiles: 30 // keep last 30 days
    })
  : null;

// Custom log format
const customLogFormat = ':date[iso] :request-id :method :url :status :response-time ms - :res[content-length] - :user-id';

// HTTP request logging with Morgan
if (process.env.NODE_ENV === 'development') {
  // Development: colored, concise output to console
  app.use(morgan('dev'));
} else if (process.env.NODE_ENV === 'production') {
  // Production: detailed logs to file with rotation
  app.use(morgan('combined', { stream: accessLogStream }));
  // Also log to console in production for real-time monitoring (optional)
  app.use(morgan('combined'));
} else {
  // Test environment: minimal logging
  app.use(morgan('tiny'));
}

// Middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, or Postman)
    if (!origin) return callback(null, true);

    // Local development origins
    const localOrigins = [
      'http://localhost:3000',
      'http://127.0.0.1:3000',
      'http://localhost:3001',
      'http://127.0.0.1:3001'
    ];

    // Allow local origins
    if (localOrigins.includes(origin)) {
      return callback(null, true);
    }

    // Allow all Vercel deployments (including preview deployments)
    if (origin.endsWith('.vercel.app')) {
      return callback(null, true);
    }

    // Allow GitHub Codespaces URLs
    if (origin.includes('.app.github.dev')) {
      return callback(null, true);
    }

    // Allow custom frontend URL from env
    const frontendUrl = process.env.FRONTEND_URL;
    if (frontendUrl && origin === frontendUrl) {
      return callback(null, true);
    }

    // Allow in development/test mode
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      return callback(null, true);
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Sanitize data against NoSQL injection
app.use(mongoSanitize({
  replaceWith: '_',
  onSanitize: ({ req, key, value }) => {
    if (process.env.NODE_ENV === 'development') {
      // Log only in development for debugging
      console.warn(`Sanitized ${key} from ${value}`);
    }
  }
}));

// Add request ID to each request for tracing
app.use(requestId);

// Custom request logging middleware
app.use(requestLogger);

// Basic health check endpoint
app.get('/health', (req, res) => {
  const mongoose = require('mongoose');
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    uptime_formatted: formatUptime(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    database: {
      status: dbStatusMap[dbState] || 'unknown',
      ready: dbState === 1
    },
    memory: {
      used: formatBytes(process.memoryUsage().heapUsed),
      total: formatBytes(process.memoryUsage().heapTotal),
      rss: formatBytes(process.memoryUsage().rss)
    }
  });
});

// Detailed health check endpoint
app.get('/health/detailed', async (req, res) => {
  const mongoose = require('mongoose');
  const dbState = mongoose.connection.readyState;
  const dbStatusMap = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting'
  };

  // Get database stats
  let dbStats = null;
  if (dbState === 1) {
    try {
      const db = mongoose.connection.db;
      const collections = await db.listCollections().toArray();
      const stats = await db.stats();

      dbStats = {
        name: db.databaseName,
        collections: collections.length,
        collectionNames: collections.map(c => c.name),
        dataSize: formatBytes(stats.dataSize),
        storageSize: formatBytes(stats.storageSize),
        indexes: stats.indexes,
        indexSize: formatBytes(stats.indexSize),
        avgObjSize: Math.round(stats.avgObjSize),
        objects: stats.objects
      };
    } catch (err) {
      dbStats = {
        error: 'Could not retrieve database stats',
        message: err.message
      };
    }
  }

  // Get socket.io connection count
  const socketStats = {
    activeConnections: io.engine?.clientsCount || 0,
    totalConnections: io._nsps?.get('/')?.sockets?.size || 0
  };

  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    uptime_formatted: formatUptime(process.uptime()),
    environment: process.env.NODE_ENV || 'development',
    node_version: process.version,
    platform: process.platform,
    architecture: process.arch,
    api: {
      version: '1.0.0',
      name: 'Campus Market API',
      description: 'Full-stack campus marketplace with real-time notifications'
    },
    database: {
      status: dbStatusMap[dbState] || 'unknown',
      ready: dbState === 1,
      host: mongoose.connection.host || 'N/A',
      port: mongoose.connection.port || 27017,
      stats: dbStats
    },
    sockets: socketStats,
    memory: {
      heapUsed: formatBytes(process.memoryUsage().heapUsed),
      heapTotal: formatBytes(process.memoryUsage().heapTotal),
      rss: formatBytes(process.memoryUsage().rss),
      external: formatBytes(process.memoryUsage().external),
      arrayBuffers: formatBytes(process.memoryUsage().arrayBuffers)
    },
    cpu: {
      usage: process.cpuUsage(),
      model: process.arch
    },
    process: {
      pid: process.pid,
      title: process.title,
      cwd: process.cwd()
    }
  });
});

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Helper function to format uptime
function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0) parts.push(`${secs}s`);

  return parts.length > 0 ? parts.join(' ') : '0s';
}

// API v1 routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/products', productRoutes);
app.use('/api/v1/orders', orderRoutes);
app.use('/api/v1/reviews', reviewRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/categories', categoryRoutes);
app.use('/api/v1/cart', cartRoutes);
app.use('/api/v1/wishlist', wishlistRoutes);
app.use('/api/v1/notifications', notificationRoutes);
app.use('/api/v1/upload', uploadRoutes);
app.use('/api/v1/admin', adminRoutes);

// Error handling
app.use(notFound);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`
    ╔═══════════════════════════════════════╗
    ║   Campus Market API Server           ║
    ╠═══════════════════════════════════════╣
    ║   Environment: ${process.env.NODE_ENV || 'development'}                      ║
    ║   Port: ${PORT}                           ║
    ║   URL: http://localhost:${PORT}           ║
    ║   Socket.io: Enabled                    ║
    ╚═══════════════════════════════════════╝
    `);
  }
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection', {
    error: err.message,
    stack: err.stack
  }, err);
  // Close server & exit process
  // server.close(() => process.exit(1));
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', {
    error: err.message,
    stack: err.stack
  }, err);
  // Close server & exit process
  process.exit(1);
});

module.exports = app;
