const express = require('express');
const { body } = require('express-validator');
const {
  createOrder,
  initiatePayment,
  getOrder,
  getOrders,
  updateOrderStatus,
  cancelOrder,
  mpesaCallback,
  getPayoutLedger,
  markSellerPaid,
  markSellerPaidBatch,
  checkoutCart,
  getPaymentStatus,
  confirmReceived
} = require('../controllers/order');
const { protect, authorize } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Validation rules
const createOrderValidation = [
  body('productId').notEmpty().withMessage('Product ID is required'),
  body('shippingAddress.street').notEmpty().withMessage('Street address is required'),
  body('shippingAddress.building').notEmpty().withMessage('Building is required'),
  body('shippingAddress.room').notEmpty().withMessage('Room is required'),
  handleValidationErrors
];

const paymentValidation = [
  body('phoneNumber').notEmpty().withMessage('Phone number is required'),
  handleValidationErrors
];

const updateStatusValidation = [
  body('status').isIn(['confirmed', 'shipped', 'delivered', 'cancelled']).withMessage('Invalid status'),
  handleValidationErrors
];

const checkoutCartValidation = [
  body('shippingAddress.street').notEmpty().withMessage('Street is required'),
  body('shippingAddress.building').notEmpty().withMessage('Building is required'),
  body('shippingAddress.room').notEmpty().withMessage('Room is required'),
  body('phoneNumber').notEmpty().withMessage('Phone number is required'),
  handleValidationErrors
];

// Public routes (M-Pesa callback)
router.post('/payment/mpesa/callback', mpesaCallback);

// Protected routes
router.post('/', protect, createOrderValidation, createOrder);
router.post('/checkout-cart', protect, checkoutCartValidation, checkoutCart);
router.post('/:id/pay', protect, paymentValidation, initiatePayment);
router.get('/', protect, getOrders);
router.get('/:id', protect, getOrder);
router.get('/:id/payment-status', protect, getPaymentStatus);

// Seller/Admin routes
router.put('/:id/status', protect, authorize('seller', 'admin'), updateStatusValidation, updateOrderStatus);

// Buyer routes
router.put('/:id/cancel', protect, cancelOrder);
router.put('/:id/confirm-received', protect, confirmReceived);

// Admin payout routes
router.get('/admin/payouts/ledger', protect, authorize('admin'), getPayoutLedger);
router.put('/admin/payouts/:orderId/pay', protect, authorize('admin'), markSellerPaid);
router.put('/admin/payouts/seller/:sellerId/pay', protect, authorize('admin'), markSellerPaidBatch);

module.exports = router;
