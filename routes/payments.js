/**
 * @fileoverview Payment routes for M-Pesa B2C
 * @description Routes for B2C callbacks and admin-initiated payouts
 * @module routes/payments
 */

const express = require('express');
const {
  b2cResultCallback,
  b2cTimeoutCallback,
  initiateB2CPayout,
  getB2CPayoutStatus
} = require('../controllers/payments');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// Public routes (M-Pesa callbacks)
router.post('/b2c/result', b2cResultCallback);
router.post('/b2c/timeout', b2cTimeoutCallback);

// Admin routes
router.post('/b2c/payout', protect, authorize('admin'), initiateB2CPayout);
router.get('/b2c/status/:conversationId', protect, authorize('admin'), getB2CPayoutStatus);

module.exports = router;
