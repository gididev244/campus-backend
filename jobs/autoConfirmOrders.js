/**
 * @fileoverview Auto-confirm delivered orders after 7 days
 * @description Cron job to automatically mark shipped orders as delivered after 7 days
 * and trigger auto-payout to sellers
 */

const cron = require('node-cron');
const Order = require('../models/Order');
const { triggerAutoPayout } = require('../controllers/payments');
const logger = require('../utils/logger');

const AUTO_CONFIRM_DAYS = 7;

const autoConfirmOrders = async () => {
  try {
    const sevenDaysAgo = new Date(Date.now() - AUTO_CONFIRM_DAYS * 24 * 60 * 60 * 1000);

    const orders = await Order.find({
      status: 'shipped',
      shippedAt: { $lt: sevenDaysAgo },
      deliveredAt: null,
      autoConfirmed: false
    }).populate('seller', 'name email');

    if (orders.length === 0) {
      console.log('[AutoConfirm] No orders to auto-confirm');
      return;
    }

    console.log(`[AutoConfirm] Found ${orders.length} orders to auto-confirm`);

    for (const order of orders) {
      try {
        order.status = 'delivered';
        order.deliveredAt = Date.now();
        order.autoConfirmed = true;
        await order.save();

        logger.order('order_auto_confirmed', {
          orderId: order._id,
          orderNumber: order.orderNumber,
          sellerId: order.seller._id,
          daysSinceShipped: Math.floor((Date.now() - order.shippedAt) / (1000 * 60 * 60 * 24))
        });

        try {
          await triggerAutoPayout(order._id.toString());
          console.log(`[AutoConfirm] Order ${order.orderNumber} confirmed and payout triggered`);
        } catch (payoutError) {
          console.error(`[AutoConfirm] Payout failed for order ${order.orderNumber}:`, payoutError);
        }

        if (global.io) {
          global.io.to(`user:${order.seller._id}`).emit('order:auto_confirmed', {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            autoConfirmed: true,
            message: 'Order automatically confirmed after 7 days'
          });

          global.io.to(`user:${order.buyer}`).emit('order:auto_confirmed', {
            orderId: order._id.toString(),
            orderNumber: order.orderNumber,
            autoConfirmed: true,
            message: 'Order automatically confirmed after 7 days of delivery'
          });
        }
      } catch (orderError) {
        console.error(`[AutoConfirm] Failed to process order ${order._id}:`, orderError);
      }
    }

    console.log(`[AutoConfirm] Successfully processed ${orders.length} orders`);
  } catch (error) {
    console.error('[AutoConfirm] Cron job failed:', error);
    logger.error('auto_confirm_cron_failed', { error: error.message });
  }
};

const startAutoConfirmJob = () => {
  cron.schedule('0 0 * * *', autoConfirmOrders, {
    scheduled: true,
    timezone: 'Africa/Nairobi'
  });

  console.log('[AutoConfirm] Cron job started - runs daily at midnight');
  
  autoConfirmOrders();
};

module.exports = {
  startAutoConfirmJob,
};
