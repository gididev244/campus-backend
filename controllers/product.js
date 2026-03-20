const Product = require('../models/Product');
const Category = require('../models/Category');
const Order = require('../models/Order');
const User = require('../models/User');
const mongoose = require('mongoose');
const { formatPaginationResponse, getPagination, asyncHandler } = require('../utils/helpers');
const { validateCategory } = require('../utils/validation');
const ErrorResponse = require('../middleware/error').ErrorResponse;
const { clearDashboardCache } = require('./user');

/**
 * @desc    Get all products with filtering, search, and pagination
 * @route   GET /api/products
 * @access  Public
 * @param   {Object} req.query - Query parameters
 * @param   {number} [req.query.page=1] - Page number for pagination
 * @param   {number} [req.query.limit=12] - Number of items per page
 * @param   {string} [req.query.search] - Search term for full-text search
 * @param   {string} [req.query.category] - Filter by category ID
 * @param   {string} [req.query.condition] - Filter by product condition
 * @param   {number} [req.query.minPrice] - Minimum price filter
 * @param   {number} [req.query.maxPrice] - Maximum price filter
 * @param   {string} [req.query.location] - Filter by location
 * @param   {string} [req.query.sortBy=createdAt] - Field to sort by
 * @param   {string} [req.query.sortOrder=desc] - Sort order (asc or desc)
 * @returns {Promise<Object>} Paginated response with products array and metadata
 */
exports.getProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 12, search, category, condition, minPrice, maxPrice, location, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    // Build query
    const query = { status: 'available' };

    // Search
    if (search) {
      query.$text = { $search: search };
    }

    // Category filter
    if (category) {
      query.category = category;
    }

    // Condition filter
    if (condition) {
      query.condition = condition;
    }

    // Price range
    if (minPrice || maxPrice) {
      query.price = {};
      if (minPrice) query.price.$gte = parseFloat(minPrice);
      if (maxPrice) query.price.$lte = parseFloat(maxPrice);
    }

    // Location filter
    if (location) {
      query.location = { $regex: location, $options: 'i' };
    }

    // Pagination
    const { skip, limit: limitNum, page: pageNum } = getPagination(page, limit);

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with lean for better performance
    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('seller', 'name email phone location averageRating')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Product.countDocuments(query);

    res.json(formatPaginationResponse(products, total, pageNum, limitNum));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get sold products for seller or all sold products for admin
 * @route   GET /api/products/sold/history
 * @access  Private (Seller/Admin)
 * @param   {Object} req.query - Query parameters
 * @param   {number} [req.query.page=1] - Page number for pagination
 * @param   {number} [req.query.limit=20] - Number of items per page
 * @param   {string} [req.query.sortBy=updatedAt] - Field to sort by
 * @param   {string} [req.query.sortOrder=desc] - Sort order (asc or desc)
 * @returns {Promise<Object>} Paginated response with sold products array and metadata
 */
exports.getSoldProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, sortBy = 'updatedAt', sortOrder = 'desc' } = req.query;

    // Build query - sold products only
    const query = { status: 'sold' };

    // If seller, only show their products
    if (req.user.role === 'seller') {
      query.seller = req.user.id;
    }

    // Pagination
    const { skip, limit: limitNum, page: pageNum } = getPagination(page, limit);

    // Sorting
    const sort = {};
    sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

    // Execute query with lean for better performance
    const products = await Product.find(query)
      .populate('category', 'name slug')
      .populate('seller', 'name email avatar')
      .sort(sort)
      .skip(skip)
      .limit(limitNum)
      .lean();

    const total = await Product.countDocuments(query);

    res.json(formatPaginationResponse(products, total, pageNum, limitNum));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get a single product by ID
 * @route   GET /api/products/:id
 * @access  Public
 * @param   {string} req.params.id - Product ID
 * @returns {Promise<Object>} Response with success status and product data
 */
exports.getProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id)
      .populate('category', 'name slug description')
      .populate('seller', 'name email phone location averageRating totalReviews avatar');

    if (!product) {
      return next(new ErrorResponse('Product not found', 404));
    }

    // Increment view count
    product.views += 1;
    await product.save();

    res.json({
      success: true,
      product
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Create a new product listing (seller only)
 * @route   POST /api/products
 * @access  Private (Seller only)
 * @param   {Object} req.body - Request body
 * @param   {string} req.body.title - Product title
 * @param   {string} req.body.description - Product description
 * @param   {number} req.body.price - Product price
 * @param   {string} req.body.category - Category ID
 * @param   {string} req.body.condition - Product condition (new, used, refurbished)
 * @param   {string} req.body.location - Product location
 * @param   {Array<string>} req.body.images - Array of image URLs
 * @param   {Array<string>} [req.body.tags] - Product tags
 * @param   {boolean} [req.body.isNegotiable] - Whether price is negotiable
 * @returns {Promise<Object>} Response with success status and created product data
 */
exports.createProduct = async (req, res, next) => {
  try {
    // Add seller to request body
    req.body.seller = req.user.id;

    // Validate category exists
    await validateCategory(Category, req.body.category);

    const product = await Product.create(req.body);

    // Clear dashboard cache for the seller
    clearDashboardCache(req.user.id);

    // Use populate with lean to avoid second query overhead
    const populatedProduct = await Product.findById(product._id)
      .populate('category', 'name slug')
      .populate('seller', 'name email')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Product created successfully',
      product: populatedProduct
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Update an existing product (seller owner or admin only)
 * @route   PUT /api/products/:id
 * @access  Private (Seller only, owner or admin)
 * @param   {string} req.params.id - Product ID
 * @param   {Object} req.body - Request body with fields to update
 * @returns {Promise<Object>} Response with success status and updated product data
 */
exports.updateProduct = async (req, res, next) => {
  try {
    let product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse('Product not found', 404));
    }

    // Check ownership
    if (product.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new ErrorResponse('Not authorized to update this product', 403));
    }

    // Validate category if provided
    if (req.body.category) {
      await validateCategory(Category, req.body.category);
    }

    product = await Product.findByIdAndUpdate(req.params.id, req.body, {
      new: true,
      runValidators: true
    }).populate('category', 'name slug').lean();

    // Clear dashboard cache for the seller
    clearDashboardCache(product.seller.toString());

    res.json({
      success: true,
      message: 'Product updated successfully',
      product
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Delete a product (seller owner or admin only)
 * @route   DELETE /api/products/:id
 * @access  Private (Seller only, owner or admin)
 * @param   {string} req.params.id - Product ID
 * @returns {Promise<Object>} Response with success status and message
 */
exports.deleteProduct = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse('Product not found', 404));
    }

    // Check ownership
    if (product.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new ErrorResponse('Not authorized to delete this product', 403));
    }

    const sellerId = product.seller.toString();
    await product.deleteOne();

    // Clear dashboard cache for the seller
    clearDashboardCache(sellerId);

    res.json({
      success: true,
      message: 'Product deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Re-list a sold product as a new available product
 * @route   POST /api/products/:id/relist
 * @access  Private (Seller only, owner or admin)
 * @param   {string} req.params.id - Original sold product ID
 * @param   {Object} req.body - Request body with optional overrides
 * @param   {string} [req.body.title] - New product title
 * @param   {string} [req.body.description] - New product description
 * @param   {number} [req.body.price] - New product price
 * @param   {string} [req.body.category] - New category ID
 * @param   {string} [req.body.condition] - New product condition
 * @param   {string} [req.body.location] - New product location
 * @param   {Array<string>} [req.body.images] - New product images
 * @param   {Array<string>} [req.body.tags] - New product tags
 * @param   {boolean} [req.body.isNegotiable] - Whether price is negotiable
 * @returns {Promise<Object>} Response with success status and new re-listed product data
 */
exports.relistProduct = async (req, res, next) => {
  try {
    const originalProduct = await Product.findById(req.params.id);

    if (!originalProduct) {
      return next(new ErrorResponse('Product not found', 404));
    }

    // Check ownership
    if (originalProduct.seller && originalProduct.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new ErrorResponse('Not authorized to re-list this product', 403));
    }

    // Create new product from sold one
    const newProduct = new Product({
      seller: req.user.id || originalProduct.seller,
      title: req.body.title || originalProduct.title,
      description: req.body.description || originalProduct.description,
      price: req.body.price || originalProduct.price,
      category: req.body.category || originalProduct.category,
      condition: req.body.condition || originalProduct.condition,
      location: req.body.location || originalProduct.location,
      images: req.body.images || originalProduct.images,
      tags: req.body.tags || originalProduct.tags,
      isNegotiable: req.body.isNegotiable !== undefined ? req.body.isNegotiable : originalProduct.isNegotiable,
      status: 'available'
    });

    await newProduct.save();

    const populatedProduct = await Product.findById(newProduct._id)
      .populate('category', 'name slug')
      .populate('seller', 'name email')
      .lean();

    res.status(201).json({
      success: true,
      message: 'Product re-listed successfully',
      product: populatedProduct
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Toggle like/unlike on a product
 * @route   POST /api/products/:id/like
 * @access  Private
 * @param   {string} req.params.id - Product ID
 * @returns {Promise<Object>} Response with success status, like state, and likes count
 */
exports.toggleLike = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse('Product not found', 404));
    }

    const alreadyLiked = product.likes.includes(req.user.id);

    if (alreadyLiked) {
      product.likes = product.likes.filter(id => id.toString() !== req.user.id);
    } else {
      product.likes.push(req.user.id);
    }

    await product.save();

    res.json({
      success: true,
      message: alreadyLiked ? 'Product unliked' : 'Product liked',
      liked: !alreadyLiked,
      likesCount: product.likes.length
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get all products for a specific seller
 * @route   GET /api/products/seller/:sellerId
 * @access  Public
 * @param   {string} req.params.sellerId - Seller's user ID
 * @param   {Object} req.query - Query parameters
 * @param   {number} [req.query.page=1] - Page number for pagination
 * @param   {number} [req.query.limit=12] - Number of items per page
 * @returns {Promise<Object>} Paginated response with seller's products array and metadata
 */
exports.getSellerProducts = async (req, res, next) => {
  try {
    const { page = 1, limit = 12 } = req.query;
    const { skip, limit: limitNum, page: pageNum } = getPagination(page, limit);

    // Use aggregation to get products and count in one query
    const aggregationPipeline = [
      { $match: { seller: new mongoose.Types.ObjectId(req.params.sellerId) } },
      {
        $lookup: {
          from: 'categories',
          localField: 'category',
          foreignField: '_id',
          as: 'category'
        }
      },
      { $unwind: '$category' },
      {
        $project: {
          title: 1,
          description: 1,
          price: 1,
          condition: 1,
          images: 1,
          location: 1,
          status: 1,
          isNegotiable: 1,
          views: 1,
          likes: 1,
          averageRating: 1,
          totalReviews: 1,
          tags: 1,
          createdAt: 1,
          updatedAt: 1,
          'category.name': 1,
          'category.slug': 1,
          seller: 1
        }
      },
      { $sort: { createdAt: -1 } },
      { $facet: {
        data: [{ $skip: skip }, { $limit: limitNum }],
        totalCount: [{ $count: 'count' }]
      }}
    ];

    const [result] = await Product.aggregate(aggregationPipeline);
    const products = result.data;
    const total = result.totalCount[0]?.count || 0;

    res.json(formatPaginationResponse(products, total, pageNum, limitNum));
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Get related products based on category (max 8)
 * @route   GET /api/products/:id/related
 * @access  Public
 * @param   {string} req.params.id - Product ID to find related products for
 * @returns {Promise<Object>} Response with success status and array of related products
 */
exports.getRelatedProducts = async (req, res, next) => {
  try {
    // Use aggregation to get product and related products efficiently
    const aggregationPipeline = [
      { $match: { _id: new mongoose.Types.ObjectId(req.params.id) } },
      {
        $lookup: {
          from: 'products',
          let: { categoryId: '$category', productId: '$_id' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [
                    { $ne: ['$_id', '$$productId'] },
                    { $eq: ['$category', '$$categoryId'] },
                    { $eq: ['$status', 'available'] }
                  ]
                }
              }
            },
            { $limit: 8 },
            {
              $lookup: {
                from: 'categories',
                localField: 'category',
                foreignField: '_id',
                as: 'category'
              }
            },
            { $unwind: '$category' },
            {
              $lookup: {
                from: 'users',
                localField: 'seller',
                foreignField: '_id',
                as: 'seller'
              }
            },
            { $unwind: '$seller' },
            {
              $project: {
                title: 1,
                price: 1,
                images: 1,
                condition: 1,
                location: 1,
                'category.name': 1,
                'category.slug': 1,
                'seller.name': 1,
                'seller.location': 1
              }
            }
          ],
          as: 'relatedProducts'
        }
      },
      { $project: { relatedProducts: 1, _id: 0 } }
    ];

    const [result] = await Product.aggregate(aggregationPipeline);

    if (!result) {
      return next(new ErrorResponse('Product not found', 404));
    }

    res.json({
      success: true,
      products: result.relatedProducts
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Revert a product from 'pending' back to 'available' status
 * @route   PUT /api/products/:id/revert-status
 * @access  Private (Seller only, owner or admin)
 * @param   {string} req.params.id - Product ID
 * @returns {Promise<Object>} Response with success status and updated product data
 */
exports.revertProductStatus = async (req, res, next) => {
  try {
    const product = await Product.findById(req.params.id);

    if (!product) {
      return next(new ErrorResponse('Product not found', 404));
    }

    // Check ownership
    if (product.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new ErrorResponse('Not authorized to revert this product status', 403));
    }

    // Only revert pending products
    if (product.status !== 'pending') {
      return next(new ErrorResponse('Only pending products can be reverted to available', 400));
    }

    product.status = 'available';
    await product.save();

    // Clear dashboard cache for the seller
    clearDashboardCache(product.seller.toString());

    res.json({
      success: true,
      message: 'Product status reverted to available',
      product
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Bulk revert products from 'pending' back to 'available' status
 *          For cleanup scripts and admin tools
 * @access  Private (Admin only)
 * @param   {Object} req.body - Request body
 * @param   {Array<string>} req.body.productIds - Array of product IDs to revert
 * @returns {Promise<Object>} Response with success status and count of products reverted
 */
exports.bulkRevertProductStatus = async (req, res, next) => {
  try {
    const { productIds } = req.body;

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return next(new ErrorResponse('Product IDs array is required', 400));
    }

    const result = await Product.updateMany(
      { _id: { $in: productIds }, status: 'pending' },
      { status: 'available' }
    );

    res.json({
      success: true,
      message: `Reverted ${result.modifiedCount} product(s) to available`,
      count: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
};

exports.getPlatformStats = async (req, res, next) => {
  try {
    const [productCount, userCount, orderStats] = await Promise.all([
      Product.countDocuments({ status: 'available' }),
      User.countDocuments({ isActive: { $ne: false } }),
      Order.aggregate([
        { $match: { paymentStatus: 'completed' } },
        { $count: 'total' }
      ])
    ]);

    res.json({
      success: true,
      stats: {
        products: productCount,
        users: userCount,
        transactions: orderStats[0]?.total || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
