const express = require('express');
const {
  getRevenueAnalytics,
  getUserAnalytics,
  getOrderAnalytics,
  getProductAnalytics,
  getAllReviews,
  deleteReview,
  getWithdrawalRequests,
  processWithdrawalRequest
} = require('../controllers/admin');
const { protect, authorize } = require('../middleware/auth');

const router = express.Router();

// All routes require admin role
router.use(protect);
router.use(authorize('admin'));

// Analytics routes
router.get('/analytics/revenue', getRevenueAnalytics);
router.get('/analytics/users', getUserAnalytics);
router.get('/analytics/orders', getOrderAnalytics);
router.get('/analytics/products', getProductAnalytics);

// Review moderation routes
router.get('/reviews', getAllReviews);
router.delete('/reviews/:id', deleteReview);

// Withdrawal management routes
router.get('/withdrawals', getWithdrawalRequests);
router.put('/withdrawals/:requestId', processWithdrawalRequest);

module.exports = router;
