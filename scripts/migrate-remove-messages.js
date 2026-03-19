/**
 * Migration Script: Remove Messages
 * 
 * This script removes all messages from the database
 * since messaging has been replaced with WhatsApp.
 * 
 * Run with: node scripts/migrate-remove-messages.js
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

async function removeMessages() {
  try {
    // Connect to database
    require('dotenv').config();
    await mongoose.connect(process.env.MONGODB_URI);
    
    console.log('Connected to MongoDB');
    
    // Drop Message collection
    const result = await mongoose.connection.db.dropCollection('messages');
    console.log('Dropped messages collection');
    
    // Remove message-related indexes from other collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    
    for (const collection of collections) {
      const coll = mongoose.connection.db.collection(collection.name);
      const indexes = await coll.indexes();
      
      for (const indexName of Object.keys(indexes)) {
        if (indexName.includes('message') || indexName.includes('conversation')) {
          try {
            await coll.dropIndex(indexName);
            console.log(`Dropped index: ${indexName} from ${collection.name}`);
          } catch (error) {
            console.log(`Index ${indexName} not found in ${collection.name}`);
          }
        }
      }
    }
    
    console.log('Migration completed successfully!');
    
    // Update any references in other models if needed
    // For example, remove 'unreadMessages' field from User dashboard stats
    
    const User = mongoose.models.User;
    if (User) {
      const users = await User.find({});
      for (const user of users) {
        // Reset any message-related fields if they exist
        user.unreadMessages = 0;
        await user.save();
      }
      console.log('Updated user documents');
    }
    
    logger.info('Message removal migration completed');
    console.log('All messages have been removed successfully');
  } catch (error) {
    console.error('Migration error:', error);
    logger.error('Migration failed', { error: error.message });
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

removeMessages();
