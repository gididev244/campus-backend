const mongoose = require('mongoose');

const sellerBalanceSchema = new mongoose.Schema({
  seller: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  totalEarnings: {
    type: Number,
    default: 0,
    min: 0
  },
  totalOrders: {
    type: Number,
    default: 0,
    min: 0
  },
  currentBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  pendingWithdrawals: {
    type: Number,
    default: 0,
    min: 0
  },
  withdrawnTotal: {
    type: Number,
    default: 0,
    min: 0
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  withdrawalRequests: [{
    _id: {
      type: mongoose.Schema.Types.ObjectId,
      auto: true
    },
    amount: {
      type: Number,
      required: true
    },
    status: {
      type: String,
      enum: ['pending', 'released', 'processing', 'completed', 'cancelled'],
      default: 'pending'
    },
    orderIds: [{
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Order'
    }],
    requestedAt: {
      type: Date,
      default: Date.now
    },
    releasedAt: {
      type: Date
    },
    processedAt: {
      type: Date
    },
    completedAt: {
      type: Date
    },
    notes: String,
    cancelledAt: {
      type: Date
    },
    cancellationReason: String,
    metadata: mongoose.Schema.Types.Mixed
  }],
  ledger: [{
    type: {
      type: String,
      enum: ['sale', 'withdrawal', 'fee', 'adjustment'],
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    balance: {
      type: Number,
      required: true
    },
    description: String,
    status: {
      type: String,
      enum: ['pending', 'released', 'completed', 'failed'],
      default: 'completed'
    },
    mpesaTransactionId: {
      type: String,
      default: null
    },
    mpesaReceiptNumber: {
      type: String,
      default: null
    },
    withdrawalId: {
      type: mongoose.Schema.Types.ObjectId
    },
    orderId: {
      type: mongoose.Schema.Types.ObjectId
    },
    date: {
      type: Date,
      default: Date.now
    },
    metadata: mongoose.Schema.Types.Mixed
  }]
}, {
  timestamps: true
});

// Index for faster queries
sellerBalanceSchema.index({ seller: 1 });
sellerBalanceSchema.index({ currentBalance: -1 });

// Update lastUpdated timestamp before saving
sellerBalanceSchema.pre('save', function(next) {
  this.lastUpdated = Date.now();
  next();
});

// Method to add earnings when order is completed
sellerBalanceSchema.methods.addEarnings = function(amount) {
  this.totalEarnings += amount;
  this.currentBalance += amount;
  this.totalOrders += 1;
  return this.save();
};

// Method to record withdrawal
sellerBalanceSchema.methods.recordWithdrawal = function(amount, metadata = {}) {
  if (this.currentBalance < amount) {
    throw new Error('Insufficient balance');
  }
  this.currentBalance -= amount;
  this.withdrawnTotal += amount;
  this.pendingWithdrawals += amount;

  const withdrawalId = new mongoose.Types.ObjectId();
  this.withdrawalRequests.push({
    _id: withdrawalId,
    amount: amount,
    status: 'pending',
    orderIds: metadata.orderIds || [],
    requestedAt: new Date(),
    notes: metadata.notes,
    metadata: {
      ...metadata,
      phoneNumber: metadata.phoneNumber
    }
  });

  this.ledger.push({
    type: 'withdrawal',
    amount: amount,
    balance: this.currentBalance,
    withdrawalId: withdrawalId,
    description: 'Withdrawal request - pending buyer confirmation',
    status: 'pending',
    date: new Date(),
    metadata: {
      ...metadata,
      requestedAt: new Date(),
      orderCount: metadata.orderIds ? metadata.orderIds.length : 0
    }
  });

  return this.save();
};

// Method to confirm withdrawal (when admin marks as paid)
sellerBalanceSchema.methods.confirmWithdrawal = async function(withdrawalId, adminId, metadata = {}) {
  const withdrawalRequest = this.withdrawalRequests.id(withdrawalId);

  if (!withdrawalRequest) {
    throw new Error('Withdrawal request not found');
  }

  if (withdrawalRequest.status === 'completed') {
    return this; // Already processed
  }

  // Update withdrawal request
  withdrawalRequest.status = 'completed';
  withdrawalRequest.processedAt = new Date();
  withdrawalRequest.completedAt = new Date();
  withdrawalRequest.metadata = {
    ...withdrawalRequest.metadata,
    ...metadata,
    processedBy: adminId
  };

  // Update pending withdrawals
  this.pendingWithdrawals -= withdrawalRequest.amount;

  // Update linked ledger entry
  const ledgerEntry = this.ledger.find(
    e => e.withdrawalId && e.withdrawalId.toString() === withdrawalId.toString()
  );

  if (ledgerEntry) {
    ledgerEntry.status = 'completed';
    ledgerEntry.description = 'Withdrawal completed';
    ledgerEntry.metadata = {
      ...ledgerEntry.metadata,
      ...metadata,
      confirmedAt: new Date(),
      processedBy: adminId
    };
  }

  return this.save();
};

// Method to release pending withdrawal when buyer confirms delivery
sellerBalanceSchema.methods.releaseWithdrawalForOrder = async function(orderId) {
  const pendingWithdrawals = this.withdrawalRequests.filter(
    wr => wr.status === 'pending' && wr.orderIds.some(oid => oid.toString() === orderId.toString())
  );

  for (const withdrawal of pendingWithdrawals) {
    withdrawal.status = 'released';
    withdrawal.releasedAt = new Date();
    withdrawal.metadata = {
      ...withdrawal.metadata,
      releasedDueToOrder: orderId,
      releasedAt: new Date()
    };

    const ledgerEntry = this.ledger.find(
      e => e.withdrawalId && e.withdrawalId.toString() === withdrawal._id.toString()
    );
    if (ledgerEntry) {
      ledgerEntry.status = 'released';
      ledgerEntry.description = 'Withdrawal released - buyer confirmed delivery';
    }
  }

  if (pendingWithdrawals.length > 0) {
    return this.save();
  }
  return this;
};

// Static to find released withdrawals ready for processing
sellerBalanceSchema.statics.findReleasedWithdrawals = async function(sellerId) {
  const balance = await this.findOne({ seller: sellerId });
  if (!balance) return [];
  
  return balance.withdrawalRequests.filter(wr => wr.status === 'released');
};

// Static to get or create balance for seller
sellerBalanceSchema.statics.getOrCreate = async function(sellerId) {
  let balance = await this.findOne({ seller: sellerId });
  if (!balance) {
    balance = await this.create({ seller: sellerId });
  }
  return balance;
};

module.exports = mongoose.model('SellerBalance', sellerBalanceSchema);
