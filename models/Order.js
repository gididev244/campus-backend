/**
 * @fileoverview Order model schema for Campus Market
 * @description Defines the structure and behavior of orders between buyers and sellers
 * @module models/Order
 */

const mongoose = require('mongoose');

/**
 * Order Schema
 * @typedef {Object} Order
 * @property {string} orderNumber - Unique order identifier (auto-generated)
 * @property {mongoose.Types.ObjectId} buyer - Reference to User who placed the order (required)
 * @property {mongoose.Types.ObjectId} seller - Reference to User who is selling (required)
 * @property {mongoose.Types.ObjectId} product - Reference to Product being ordered (required)
 * @property {number} quantity - Quantity ordered (default: 1, min: 1)
 * @property {number} totalPrice - Total price in KES (required, non-negative)
 * @property {'pending'|'confirmed'|'shipped'|'delivered'|'cancelled'|'refunded'} status - Order status (default: 'pending')
 * @property {'pending'|'completed'|'failed'|'refunded'} paymentStatus - Payment status (default: 'pending')
 * @property {'mpesa'|'cash'} paymentMethod - Payment method used (default: 'mpesa')
 * @property {string|null} mpesaTransactionId - M-Pesa transaction ID
 * @property {string|null} mpesaPhoneNumber - Phone number used for M-Pesa payment
 * @property {boolean} sellerPaid - Whether seller has been paid out (default: false)
 * @property {Date|null} sellerPaidAt - Timestamp when seller was paid
 * @property {mongoose.Types.ObjectId|null} sellerPaidBy - Reference to admin who processed payout
 * @property {string} sellerPayoutNotes - Notes about seller payout (max 500 chars)
 * @property {string|null} checkoutSessionId - Checkout session ID for multi-seller orders
 * @property {string|null} checkoutRequestID - M-Pesa STK push checkout request ID
 * @property {Object} shippingAddress - Delivery address details
 * @property {string} shippingAddress.street - Street address
 * @property {string} shippingAddress.city - City
 * @property {string} shippingAddress.building - Building name/number
 * @property {string} shippingAddress.room - Room number
 * @property {string} shippingAddress.landmarks - Nearby landmarks
 * @property {string} notes - Order notes (max 500 chars)
 * @property {Date|null} cancelledAt - Timestamp when order was cancelled
 * @property {Date|null} deliveredAt - Timestamp when order was delivered
 * @property {'buyer-request'|'seller-request'|'payment-failed'|'other'|null} cancellationReason - Reason for cancellation
 * @property {Date} createdAt - Timestamp of order creation
 * @property {Date} updatedAt - Timestamp of last update
 */
const orderSchema = new mongoose.Schema({
  orderNumber: {
    type: String,
    unique: true
  },
  buyer: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  quantity: {
    type: Number,
    default: 1,
    min: [1, 'Quantity must be at least 1']
  },
  totalPrice: {
    type: Number,
    required: true,
    min: [0, 'Total price cannot be negative']
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['mpesa', 'cash'],
    default: 'mpesa'
  },
  mpesaTransactionId: {
    type: String,
    default: null
  },
  mpesaPhoneNumber: {
    type: String,
    default: null
  },
  mpesaResultCode: {
    type: String,
    default: null
  },
  mpesaResultDesc: {
    type: String,
    default: null
  },
  // Seller payout tracking
  sellerPaid: {
    type: Boolean,
    default: false
  },
  sellerPaidAt: {
    type: Date,
    default: null
  },
  sellerPaidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sellerPayoutNotes: {
    type: String,
    maxlength: 500
  },
  // Checkout session tracking for multi-seller orders
  checkoutSessionId: {
    type: String,
    default: null
  },
  checkoutRequestID: {
    type: String,
    default: null
  },
  // Seller payout tracking
  sellerPaid: {
    type: Boolean,
    default: false
  },
  sellerPaidAt: {
    type: Date,
    default: null
  },
  sellerPaidBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },
  sellerPayoutNotes: {
    type: String,
    maxlength: 500
  },
  // B2C payout tracking
  b2cTransactionId: {
    type: String,
    default: null
  },
  b2cStatus: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed'],
    default: null
  },
  shippedAt: {
    type: Date,
    default: null
  },
  checkoutRequestID: {
    type: String,
    default: null
  },
  shippingAddress: {
    street: String,
    city: String,
    building: String,
    room: String,
    landmarks: String
  },
  notes: {
    type: String,
    maxlength: [500, 'Notes cannot be more than 500 characters']
  },
  cancelledAt: Date,
  deliveredAt: Date,
  autoConfirmed: {
    type: Boolean,
    default: false
  },
  cancellationReason: {
    type: String,
    enum: ['buyer-request', 'seller-request', 'payment-failed', 'other'],
    default: null
  }
}, {
  timestamps: true
});

/**
 * Pre-save middleware to generate unique order number
 * @async
 * @function
 * @memberof Order
 * @param {Function} next - Express next middleware function
 */
orderSchema.pre('save', async function(next) {
  if (this.isNew) {
    const count = await this.constructor.countDocuments();
    this.orderNumber = `ORD-${Date.now()}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

// Database indexes for performance optimization

/**
 * Compound index: Buyer's orders with date sorting
 * Used in buyer order history
 */
orderSchema.index({ buyer: 1, createdAt: -1 });

/**
 * Compound index: Seller's orders with status filtering and date sorting
 * Used in seller dashboard
 */
orderSchema.index({ seller: 1, status: 1, createdAt: -1 });

/**
 * Compound index: Payment status and seller payout tracking
 * Used in admin payout ledger
 */
orderSchema.index({ paymentStatus: 1, sellerPaid: 1, seller: 1 });

/**
 * Index for M-Pesa callback queries
 * Used to find orders by checkout request ID
 */
orderSchema.index({ checkoutRequestID: 1 });

// Order listing with status filtering and date sorting (used in admin dashboards)
orderSchema.index({ status: 1, createdAt: -1 });

// Note: Order number unique index is already defined in schema above

// Additional useful compound indexes
orderSchema.index({ seller: 1, createdAt: -1 });
orderSchema.index({ buyer: 1, status: 1 });
orderSchema.index({ checkoutSessionId: 1 });
orderSchema.index({ checkoutRequestID: 1 });

module.exports = mongoose.model('Order', orderSchema);
