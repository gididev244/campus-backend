# AGENTS.md - Campus Market Backend

Guidelines for AI coding agents working in this repository.

## Build/Lint/Test Commands

```bash
# Development
npm run dev              # Start dev server with nodemon
npm start                # Start production server

# Testing
npm test                 # Run all tests
npm test -- tests/controllers/product.test.js  # Run single test file
npm test -- --testNamePattern="should create"  # Run tests matching pattern
npm run test:watch       # Watch mode
npm run test:coverage    # Run with coverage report
npm run test:models      # Run model tests only
npm run test:controllers # Run controller tests only

# Database
npm run seed             # Seed database
npm run db:indexes       # Create database indexes
npm run db:check-indexes # View existing indexes

# Utilities
npm run logs:rotate      # Rotate log files
npm run cleanup:pending-products  # Clean pending products
```

## Project Structure

```
├── config/           # Configuration (db, cloudinary, mpesa)
├── controllers/      # Business logic for routes
├── middleware/       # Express middleware (auth, error, validation, upload)
├── models/           # Mongoose schemas with indexes
├── routes/           # Express route definitions
├── scripts/          # Utility scripts (seed, indexes, tests)
├── tests/            # Jest tests (controllers/, models/, utils/)
├── utils/            # Helper functions (validation, logger, email, mpesa)
└── server.js         # Application entry point
```

## Code Style Guidelines

### Imports Order
1. Node.js built-ins (e.g., `fs`, `path`, `http`)
2. Third-party packages (e.g., `express`, `mongoose`, `jsonwebtoken`)
3. Internal modules - use relative paths or aliases:
   - `../models/User`
   - `../utils/logger`
   - `../middleware/auth`

### Naming Conventions
- **Files**: camelCase (e.g., `productController.js`, `authMiddleware.js`)
- **Models**: PascalCase, singular (e.g., `User`, `Product`, `Order`)
- **Controllers**: camelCase exports (e.g., `exports.getProducts`, `exports.createProduct`)
- **Routes**: kebab-case URLs (e.g., `/api/products`, `/api/seller-products`)
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE for true constants
- **Database fields**: camelCase

### Controller Pattern
```javascript
const Model = require('../models/Model');
const ErrorResponse = require('../middleware/error').ErrorResponse;
const logger = require('../utils/logger');

/**
 * @desc    Brief description
 * @route   METHOD /api/resource
 * @access  Public|Private|Private (role)
 */
exports.actionName = async (req, res, next) => {
  try {
    // 1. Validate input
    // 2. Perform operation
    // 3. Log significant events
    // 4. Return response
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
```

### Response Format
```javascript
// Success
res.status(200).json({ success: true, data: resource });

// Created
res.status(201).json({ success: true, data: newResource });

// Error (handled by middleware)
return next(new ErrorResponse('Error message', statusCode));
```

### Error Handling
- Use `ErrorResponse` class from `middleware/error.js` for API errors
- Always pass errors to `next()` for centralized handling
- Common status codes: 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 500 (server error)

```javascript
const { ErrorResponse } = require('../middleware/error');

if (!resource) {
  return next(new ErrorResponse('Resource not found', 404));
}
```

### Async Error Handling
Use the `catchAsync` wrapper from `utils/catchAsync.js`:
```javascript
const catchAsync = require('../utils/catchAsync');

exports.getResource = catchAsync(async (req, res, next) => {
  const resource = await Model.findById(req.params.id);
  // ...
});
```

### Validation
Use centralized validation utilities from `utils/validation.js`:
```javascript
const { validateExists, validateProductForPurchase } = require('../utils/validation');

// Validate document exists
const product = await validateExists(Product, productId, 'Product not found');

// Validate product for purchase (checks existence, status, ownership)
const product = await validateProductForPurchase(Product, productId, userId);
```

Use `express-validator` for request validation in routes:
```javascript
const { body, validationResult } = require('express-validator');

const createValidation = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('price').isNumeric().withMessage('Price must be a number'),
  handleValidationErrors
];
```

### Models (Mongoose Schemas)
```javascript
const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  field: {
    type: String,
    required: [true, 'Custom error message'],
    trim: true,
    maxlength: [100, 'Max 100 characters']
  }
}, { timestamps: true });

// Define indexes after schema
schema.index({ field: 1 });
schema.index({ field1: 1, field2: -1 }); // Compound index

module.exports = mongoose.model('Model', schema);
```

### Logging
Use the centralized logger from `utils/logger.js`:
```javascript
const logger = require('../utils/logger');

logger.auth('action', { email, success: true });   // Auth events
logger.order('action', { orderId, status });        // Order events
logger.product('action', { productId });            // Product events
logger.error('Error description', metadata, error); // Errors
logger.system('action', { info });                   // System events
```

### Authentication Middleware
```javascript
const { protect, authorize, optionalAuth } = require('../middleware/auth');

// Require authentication
router.get('/protected', protect, controller);

// Require specific role
router.post('/admin', protect, authorize('admin'), controller);

// Optional auth (attach user if token present)
router.get('/public', optionalAuth, controller);
```

### Testing
```javascript
const request = require('supertest');
const { connect, close, clear } = require('../utils/db');
const { generateToken } = require('../utils/helpers');

describe('Controller', () => {
  beforeAll(async () => await connect());
  afterAll(async () => await close());
  beforeEach(async () => await clear());

  it('should do something', async () => {
    const res = await request(app)
      .get('/api/resource')
      .set('Authorization', `Bearer ${token}`);
    
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
```

## Key Files Reference

| Purpose | Location |
|---------|----------|
| Entry point | `server.js` |
| Database connection | `config/db.js` |
| Error handling | `middleware/error.js` |
| Auth middleware | `middleware/auth.js` |
| Validation utilities | `utils/validation.js` |
| Logger | `utils/logger.js` |
| M-Pesa integration | `utils/mpesa.js` |
| Email utilities | `utils/email.js` |
| Validation guide | `utils/VALIDATION-GUIDE.md` |
| Database indexes | `DATABASE-INDEXES.md` |

## Environment Variables

Required in `.env`:
- `MONGODB_URI` - MongoDB connection string
- `JWT_SECRET` - JWT signing secret
- `JWT_EXPIRE` - Token expiration (e.g., `7d`)
- `FRONTEND_URL` - Frontend URL for CORS
- `CLOUDINARY_*` - Cloudinary credentials for image uploads
- `MPESA_*` - M-Pesa API credentials

## Database Notes

- 48 indexes across 10 collections for performance
- Always define indexes in model files
- Use `npm run db:indexes` to create indexes after schema changes
- Text indexes for search: `schema.index({ title: 'text', description: 'text' })`

## Security Notes

- Never log or expose secrets (JWT_SECRET, passwords, tokens)
- Use `express-mongo-sanitize` (already configured)
- Use `helmet` for security headers (already configured)
- Passwords must meet complexity requirements (uppercase, lowercase, number, special char)
- Admin registration is blocked via public API
