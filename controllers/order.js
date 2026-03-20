const Order = require('../models/Order');
const Product = require('../models/Product');
const { initiateSTKPush, validatePhoneNumber } = require('../utils/mpesa');
const { formatPaginationResponse, getPagination } = require('../utils/helpers');
const ErrorResponse = require('../middleware/error').ErrorResponse;
const logger = require('../utils/logger');

// @desc    Create new order
// @route   POST /api/orders
// @access  Private
exports.createOrder = async (req, res, next) => {
  try {
    const { productId, quantity, shippingAddress, notes, paymentMethod } = req.body;

    // Get product
    const product = await Product.findById(productId);
    if (!product) {
      return next(new ErrorResponse('Product not found', 404));
    }

    // Check if product is available
    if (product.status !== 'available') {
      return next(new ErrorResponse('Product is not available', 400));
    }

    // Check if buyer is not the seller
    if (product.seller.toString() === req.user.id) {
      return next(new ErrorResponse('You cannot buy your own product', 400));
    }

    const totalPrice = product.price * (quantity || 1);

    // Create order
    const order = await Order.create({
      buyer: req.user.id,
      seller: product.seller,
      product: productId,
      quantity: quantity || 1,
      totalPrice,
      shippingAddress,
      notes,
      paymentMethod: paymentMethod || 'mpesa',
      status: 'pending'
    });

    // Update product status
    product.status = 'pending';
    await product.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('product')
      .populate('buyer', 'name email phone')
      .populate('seller', 'name email phone');

    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      order: populatedOrder
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Initiate M-Pesa payment
// @route   POST /api/orders/:id/pay
// @access  Private (Buyer only)
exports.initiatePayment = async (req, res, next) => {
  try {
    const { phoneNumber } = req.body;

    const order = await Order.findById(req.params.id)
      .populate('product');

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    // Check ownership
    if (order.buyer.toString() !== req.user.id) {
      return next(new ErrorResponse('Not authorized to pay for this order', 403));
    }

    // Check if already paid
    if (order.paymentStatus === 'completed') {
      return next(new ErrorResponse('Order already paid', 400));
    }

    // Validate phone number
    const validatedPhone = validatePhoneNumber(phoneNumber);

    // Initiate STK Push
    const result = await initiateSTKPush(
      validatedPhone,
      order.totalPrice,
      order.orderNumber,
      `${process.env.API_URL}/api/payment/mpesa/callback`
    );

    // Update order with M-Pesa details
    order.mpesaPhoneNumber = validatedPhone;
    await order.save();

    res.json({
      success: true,
      message: 'Payment initiated. Please check your phone for the STK push prompt',
      checkoutRequestID: result.checkoutRequestID
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get order by ID
// @route   GET /api/orders/:id
// @access  Private
exports.getOrder = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('product')
      .populate('buyer', 'name email phone location avatar')
      .populate('seller', 'name email phone location avatar');

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    // Check if user is buyer, seller, or admin
    if (
      order.buyer._id.toString() !== req.user.id &&
      order.seller._id.toString() !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return next(new ErrorResponse('Not authorized to view this order', 403));
    }

    res.json({
      success: true,
      order
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get user's orders (as buyer or seller)
// @route   GET /api/orders
// @access  Private
exports.getOrders = async (req, res, next) => {
  try {
    const { page = 1, limit = 10, status, as } = req.query;
    const { skip, limit: limitNum, page: pageNum } = getPagination(page, limit);

    // Build query based on user role
    const query = {};
    if (as === 'seller' || req.user.role === 'seller') {
      query.seller = req.user.id;
    } else {
      query.buyer = req.user.id;
    }

    // Add status filter if provided
    if (status) {
      query.status = status;
    }

    const orders = await Order.find(query)
      .populate('product', 'title images price')
      .populate('buyer', 'name email phone')
      .populate('seller', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Order.countDocuments(query);

    res.json(formatPaginationResponse(orders, total, pageNum, limitNum));
  } catch (error) {
    next(error);
  }
};

// @desc    Update order status
// @route   PUT /api/orders/:id/status
// @access  Private (Seller or Admin)
exports.updateOrderStatus = async (req, res, next) => {
  try {
    const { status } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    // Check if user is seller or admin
    if (order.seller.toString() !== req.user.id && req.user.role !== 'admin') {
      return next(new ErrorResponse('Not authorized to update this order', 403));
    }

    // Validate status transition
    const validTransitions = {
      pending: ['confirmed', 'cancelled'],
      confirmed: ['shipped', 'cancelled'],
      shipped: ['delivered', 'cancelled'],
      delivered: [],
      cancelled: [],
      refunded: []
    };

    if (!validTransitions[order.status].includes(status)) {
      return next(new ErrorResponse(`Cannot change status from ${order.status} to ${status}`, 400));
    }

    order.status = status;

    if (status === 'confirmed') {
      order.confirmedAt = Date.now();
      
      const product = await Product.findById(order.product);
      if (product && product.status !== 'sold') {
        product.status = 'sold';
        product.soldAt = Date.now();
        await product.save();
      }
    }

    if (status === 'shipped') {
      order.shippedAt = Date.now();
    }

    if (status === 'delivered') {
      order.deliveredAt = Date.now();
    }

    if (status === 'cancelled') {
      order.cancelledAt = Date.now();
      order.cancellationReason = req.body.reason || 'seller-request';

      const product = await Product.findById(order.product);
      if (product) {
        product.status = 'available';
        await product.save();
      }
    }

    await order.save();

    const populatedOrder = await Order.findById(order._id)
      .populate('product')
      .populate('buyer', 'name email')
      .populate('seller', 'name email');

    res.json({
      success: true,
      message: 'Order status updated successfully',
      order: populatedOrder
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Cancel order
// @route   PUT /api/orders/:id/cancel
// @access  Private (Buyer only)
exports.cancelOrder = async (req, res, next) => {
  try {
    const { reason } = req.body;

    const order = await Order.findById(req.params.id);

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    // Check if user is buyer
    if (order.buyer.toString() !== req.user.id) {
      return next(new ErrorResponse('Not authorized to cancel this order', 403));
    }

    // Can only cancel pending orders
    if (order.status !== 'pending') {
      return next(new ErrorResponse('Can only cancel pending orders', 400));
    }

    order.status = 'cancelled';
    order.cancelledAt = Date.now();
    order.cancellationReason = reason || 'buyer-request';

    // Update product status back to available
    const product = await Product.findById(order.product);
    if (product) {
      product.status = 'available';
      await product.save();
    }

    await order.save();

    res.json({
      success: true,
      message: 'Order cancelled successfully',
      order
    });
  } catch (error) {
    next(error);
  }
};

// @desc    M-Pesa callback
// @route   POST /api/payment/mpesa/callback
// @access  Public
exports.mpesaCallback = async (req, res, next) => {
  try {
    const { Body } = req.body;
    const { stkCallback } = Body;
    const { CheckoutRequestID, ResultCode, ResultDesc } = stkCallback;

    // Find order by checkout request ID
    const order = await Order.findOne({
      $or: [
        { checkoutRequestID: CheckoutRequestID },
        // Alternative: search by recent pending orders
      ]
    });

    if (!order) {
      console.log('Order not found for callback:', CheckoutRequestID);
      return res.json({ success: false, message: 'Order not found' });
    }

    if (ResultCode === 0) {
      // Success
      const { MpesaReceiptNumber, PhoneNumber } = stkCallback.CallbackMetadata.Item;
      const mpesaReceipt = MpesaReceiptNumber?.value;
      const mpesaPhone = PhoneNumber?.value;
      
      for (const item of stkCallback.CallbackMetadata.Item) {
        if (item.Name === 'MpesaReceiptNumber') {
          mpesaReceiptNumber = item.Value;
        } else if (item.Name === 'PhoneNumber') {
          mpesaPhone = item.Value;
        }
      }
      
      order.paymentStatus = 'completed';
      order.mpesaTransactionId = MpesaReceiptNumber;
      order.status = 'confirmed';
      
      const product = await Product.findById(order.product);
      if (product) {
        product.status = 'sold';
        product.soldAt = Date.now();
        await product.save();
      }
      
      // Add balance to seller ledger
      const SellerBalance = require('../models/SellerBalance');
      const balance = await SellerBalance.getOrCreate(order.seller.toString());
      if (!balance) {
        balance = await SellerBalance.create({ seller: order.seller.toString() });
      }
      
      // Add sale entry in ledger with M-Pesa code
      balance.ledger.push({
        type: 'sale',
        amount: order.totalPrice,
        balance: balance.currentBalance,
        description: `Sale from order ${order.orderNumber}`,
        status: 'completed',
        orderId: order._id,
        mpesaTransactionId: MpesaReceiptNumber,
        mpesaReceiptNumber: MpesaReceiptNumber,
        date: new Date()
      });
      
      await order.save();

      logger.info('Payment successful for order:', {
        orderNumber: order.orderNumber,
        amount: order.totalPrice,
        sellerId: order.seller._id,
        mpesaTransactionId: MpesaReceiptNumber,
        mpesaReceiptNumber: MpesaReceiptNumber
      });
    } catch (error) {
      console.error('Error updating seller balance:', error);
    }
  } finally {
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};

// @desc    Get admin payout ledger (orders needing seller payout)
// @route   GET /api/admin/payouts/ledger
// @access  Private (Admin only)
exports.getPayoutLedger = async (req, res, next) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const { skip, limit: limitNum, page: pageNum } = getPagination(page, limit);

    // Build query - completed payment, seller not yet paid
    const query = {
      paymentStatus: 'completed',
      sellerPaid: false
    };

    const orders = await Order.find(query)
      .populate('product', 'title price condition images')
      .populate('buyer', 'name email phone')
      .populate('seller', 'name email phone')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    const total = await Order.countDocuments(query);

    // Calculate total pending payout amount
    const pendingPayoutTotal = await Order.aggregate([
      { $match: query },
      { $group: { _id: null, total: { $sum: '$totalPrice' } } }
    ]);

    res.json({
      success: true,
      ...formatPaginationResponse(orders, total, pageNum, limitNum),
      pendingPayoutTotal: pendingPayoutTotal[0]?.total || 0
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark seller as paid for an order
// @route   PUT /api/admin/payouts/:orderId/pay
// @access  Private (Admin only)
exports.markSellerPaid = async (req, res, next) => {
  try {
    const { notes } = req.body;

    const order = await Order.findById(req.params.orderId)
      .populate('seller', 'name email');

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    // Check if payment is completed
    if (order.paymentStatus !== 'completed') {
      return next(new ErrorResponse('Cannot mark unpaid order as seller paid', 400));
    }

    // Check if already paid
    if (order.sellerPaid) {
      return next(new ErrorResponse('Seller already paid for this order', 400));
    }

    // Update order
    order.sellerPaid = true;
    order.sellerPaidAt = Date.now();
    order.sellerPaidBy = req.user.id;
    order.sellerPayoutNotes = notes || '';

    await order.save();

    // Emit Socket event for real-time balance update
    if (global.io) {
      global.io.to(`user:${order.seller._id}`).emit('payout:processed', {
        sellerId: order.seller._id.toString(),
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        amount: order.totalPrice,
        processedBy: req.user.id,
        processedAt: new Date().toISOString(),
        notes: notes || ''
      });

      logger.info('Payout processed - Socket event emitted', {
        sellerId: order.seller._id,
        orderId: order._id,
        amount: order.totalPrice
      });
    }

    res.json({
      success: true,
      message: 'Seller marked as paid successfully',
      order
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Mark all orders for a seller as paid (batch)
// @route   PUT /api/orders/admin/payouts/seller/:sellerId/pay
// @access  Private (Admin only)
exports.markSellerPaidBatch = async (req, res, next) => {
  try {
    const { sellerId } = req.params;
    const { notes } = req.body;

    const result = await Order.updateMany(
      {
        seller: sellerId,
        paymentStatus: 'completed',
        sellerPaid: false
      },
      {
        sellerPaid: true,
        sellerPaidAt: Date.now(),
        sellerPaidBy: req.user.id,
        sellerPayoutNotes: notes || ''
      }
    );

    if (result.modifiedCount === 0) {
      return res.status(400).json({
        success: false,
        message: 'No pending payouts found for this seller'
      });
    }

    if (global.io) {
      const seller = await User.findById(sellerId).select('name email');
      if (seller) {
        global.io.to(`user:${sellerId}`).emit('payout:processed', {
          sellerId,
          ordersUpdated: result.modifiedCount,
          processedBy: req.user.id,
          processedAt: new Date().toISOString(),
          notes: notes || ''
        });
      }
    }

    res.json({
      success: true,
      message: `Marked ${result.modifiedCount} orders as paid`,
      ordersUpdated: result.modifiedCount
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Checkout cart (create multiple orders from cart)
// @route   POST /api/orders/checkout-cart
// @access  Private (Buyer only)
exports.checkoutCart = async (req, res, next) => {
  try {
    const { shippingAddress, phoneNumber } = req.body;

    // Get user's cart
    const Cart = require('../models/Cart');
    const cart = await Cart.getOrCreate(req.user.id);

    if (!cart || cart.items.length === 0) {
      return next(new ErrorResponse('Your cart is empty', 400));
    }

    // Group items by seller
    const itemsBySeller = {};
    for (const item of cart.items) {
      const product = await Product.findById(item.product).populate('seller');
      if (!product || product.status !== 'available') {
        return next(new ErrorResponse(`Product ${item.product.name} is not available`, 400));
      }

      const sellerId = product.seller._id.toString();
      if (!itemsBySeller[sellerId]) {
        itemsBySeller[sellerId] = {
          seller: product.seller,
          items: [],
          total: 0
        };
      }

      itemsBySeller[sellerId].items.push({
        product: product._id,
        name: product.name,
        price: product.price,
        quantity: item.quantity,
        image: product.images[0]
      });
      itemsBySeller[sellerId].total += product.price * item.quantity;
    }

    // Create orders for each seller
    const orders = [];
    for (const [sellerId, sellerData] of Object.entries(itemsBySeller)) {
      const orderNumber = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const order = await Order.create({
        orderNumber,
        buyer: req.user.id,
        seller: sellerId,
        items: sellerData.items,
        totalPrice: sellerData.total,
        shippingAddress,
        mpesaPhoneNumber: phoneNumber,
        paymentStatus: 'pending',
        orderStatus: 'pending'
      });

      orders.push(await order.populate('seller product'));
    }

    // Clear cart
    await cart.clearCart();

    res.status(201).json({
      success: true,
      message: `Created ${orders.length} order(s) from cart`,
      data: orders
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get payment status for an order
// @route   GET /api/orders/:id/payment-status
// @access  Private (Buyer only)
exports.getPaymentStatus = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('buyer', 'name email phone')
      .populate('seller', 'name email phone')
      .populate('product', 'name images');

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    // Check ownership
    if (order.buyer._id.toString() !== req.user.id && order.seller._id.toString() !== req.user.id) {
      return next(new ErrorResponse('Not authorized to view this order', 403));
    }

    res.json({
      success: true,
      data: {
        orderId: order._id,
        orderNumber: order.orderNumber,
        paymentStatus: order.paymentStatus,
        mpesaPhoneNumber: order.mpesaPhoneNumber,
        mpesaReceipt: order.mpesaReceipt,
        mpesaCheckoutRequestID: order.mpesaCheckoutRequestID,
        paymentAmount: order.totalPrice,
        paymentDate: order.paidAt,
        orderStatus: order.status
      }
    });
  } catch (error) {
    next(error);
  }
};

/**
 * @desc    Buyer confirms order received
 * @route   PUT /api/orders/:id/confirm-received
 * @access  Private (Buyer only)
 */
exports.confirmReceived = async (req, res, next) => {
  try {
    const order = await Order.findById(req.params.id)
      .populate('seller', 'name email phone');

    if (!order) {
      return next(new ErrorResponse('Order not found', 404));
    }

    // Check if user is the buyer
    if (order.buyer.toString() !== req.user.id) {
      return next(new ErrorResponse('Only the buyer can confirm receipt', 403));
    }

    // Check if order is shipped
    if (order.status !== 'shipped') {
      return next(new ErrorResponse('Can only confirm receipt after order is shipped', 400));
    }

    // Update order status to delivered
    order.status = 'delivered';
    order.deliveredAt = Date.now();

    await order.save();

    // Notify seller via socket
    if (global.io) {
      global.io.to(`user:${order.seller._id}`).emit('order:delivered', {
        orderId: order._id.toString(),
        orderNumber: order.orderNumber,
        deliveredAt: order.deliveredAt
      });

      logger.order('order_delivered', {
        orderId: order._id,
        buyerId: req.user.id,
        sellerId: order.seller._id
      });
    }

    res.json({
      success: true,
      message: 'Order confirmed as received',
      order
    });
  } catch (error) {
    next(error);
  }
};

module.exports = exports;
