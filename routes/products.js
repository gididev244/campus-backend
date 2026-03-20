const express = require('express');
const { body } = require('express-validator');
const {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  relistProduct,
  toggleLike,
  getSellerProducts,
  getRelatedProducts,
  getSoldProducts,
  revertProductStatus,
  bulkRevertProductStatus,
  getPlatformStats
} = require('../controllers/product');
const { protect, authorize, optionalAuth } = require('../middleware/auth');
const { handleUploadError, uploadMultiple } = require('../middleware/upload');
const { handleValidationErrors } = require('../middleware/validation');

const router = express.Router();

// Validation rules
const createProductValidation = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('description').trim().notEmpty().withMessage('Description is required'),
  body('price').isNumeric().withMessage('Price must be a number'),
  body('category').notEmpty().withMessage('Category is required'),
  body('location').trim().notEmpty().withMessage('Location is required'),
  handleValidationErrors
];

// Public routes
router.get('/stats/platform', getPlatformStats);
router.get('/', optionalAuth, getProducts);
router.get('/seller/:sellerId', getSellerProducts);
router.get('/:id/related', getRelatedProducts);
router.get('/:id', getProduct);
router.post('/:id/relist', protect, authorize('seller', 'admin'), relistProduct);

// Protected routes (require authentication)
router.post('/',
  protect,
  authorize('seller', 'admin'),
  uploadMultiple,
  handleUploadError,
  createProductValidation,
  createProduct
);

router.put('/:id',
  protect,
  authorize('seller', 'admin'),
  uploadMultiple,
  handleUploadError,
  updateProduct
);

router.delete('/:id',
  protect,
  authorize('seller', 'admin'),
  deleteProduct
);

router.post('/:id/like', protect, toggleLike);

// Product status management
router.put('/:id/revert-status',
  protect,
  authorize('seller', 'admin'),
  revertProductStatus
);

router.put('/admin/bulk-revert',
  protect,
  authorize('admin'),
  bulkRevertProductStatus
);

// Sold products history
router.get('/sold/history',
  protect,
  authorize('seller', 'admin'),
  getSoldProducts
);

module.exports = router;
