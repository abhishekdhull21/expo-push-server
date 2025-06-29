require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const { Expo } = require('expo-server-sdk');

const app = express();
const expo = new Expo();

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Enhanced storage with metadata
const tokensStorage = new Map(); // Now using Map to store token objects

// Endpoint to store token with additional info
app.post('/api/store-token', (req, res) => {
  const { token, deviceInfo = {} } = req.body;
  
  if (!token || !Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: 'Invalid Expo push token' });
  }

  // Store token with metadata
  tokensStorage.set(token, {
    storedAt: new Date().toISOString(),
    lastUsed: null,
    deviceInfo: {
      platform: deviceInfo.platform || 'unknown',
      osVersion: deviceInfo.osVersion || 'unknown',
      appVersion: deviceInfo.appVersion || 'unknown',
      // Add more device info as needed
    }
  });

  console.log('Token stored:', token);
  res.json({ 
    success: true, 
    tokenInfo: tokensStorage.get(token) 
  });
});

// Endpoint to get all tokens with info
app.get('/api/tokens', (req, res) => {
  const tokensArray = Array.from(tokensStorage.entries()).map(([token, info]) => ({
    token,
    ...info
  }));
  
  res.json({
    count: tokensArray.length,
    tokens: tokensArray
  });
});

// Endpoint to send notification (complete version)
app.post('/api/send-notification', async (req, res) => {
  const { 
    title = 'Test', 
    body = 'Hello from server!', 
    data = {},
    targetToken = null // Optional: send to specific token
  } = req.body;

  // Validate tokens storage
  if (tokensStorage.size === 0) {
    return res.status(400).json({ 
      success: false,
      error: 'No tokens available in storage' 
    });
  }

  // Validate target token if specified
  if (targetToken && !tokensStorage.has(targetToken)) {
    return res.status(400).json({
      success: false,
      error: 'Specified token not found in storage'
    });
  }

  try {
    // Prepare messages
    const messages = targetToken
      ? [{
          to: targetToken,
          sound: 'default',
          title,
          body,
          data,
          _trackingId: `notif-${Date.now()}` // For tracking
        }]
      : Array.from(tokensStorage.keys()).map(token => ({
          to: token,
          sound: 'default',
          title,
          body,
          data,
          _trackingId: `notif-${Date.now()}-${token.slice(-4)}`
        }));

    // Chunk and send notifications
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];
    const receipts = [];

    // Send all chunks
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending chunk:', error);
        // Continue with remaining chunks
      }
    }

    // Check receipts after a short delay (Expo recommends waiting)
    if (tickets.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      const receiptChunks = expo.chunkPushNotificationReceipts(
        tickets.map(t => t.id)
      );

      for (const chunk of receiptChunks) {
        try {
          const receiptChunk = await expo.getPushNotificationReceiptsAsync(chunk);
          receipts.push(...Object.values(receiptChunk));
        } catch (error) {
          console.error('Error checking receipts:', error);
        }
      }
    }

    // Update last used time for tokens
    const usedTokens = targetToken ? [targetToken] : [...tokensStorage.keys()];
    usedTokens.forEach(token => {
      if (tokensStorage.has(token)) {
        tokensStorage.get(token).lastUsed = new Date().toISOString();
      }
    });

    // Format response
    const result = {
      success: true,
      stats: {
        attempted: messages.length,
        sent: tickets.length,
        failed: messages.length - tickets.length
      },
      receipts: receipts.map(r => ({
        status: r?.status || 'unknown',
        message: r?.message || '',
        details: r?.details || null
      })),
      firstTicketId: tickets[0]?.id || null,
      lastUsedTokens: usedTokens.slice(0, 3) // Show first 3 for reference
    };

    res.json(result);

  } catch (error) {
    console.error('Notification processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to process notifications',
      details: error.message
    });
  }
});

// Endpoint to store token
app.post('/api/store-token', (req, res) => {
  const { token } = req.body;
  
  if (!token || !Expo.isExpoPushToken(token)) {
    return res.status(400).json({ error: 'Invalid Expo push token' });
  }

  tokensStorage.add(token);
  console.log('Token stored:', token);
  res.json({ success: true, tokens: Array.from(tokensStorage) });
});

// Endpoint to send notification
app.post('/api/send-notification', async (req, res) => {
  const { title = 'Test', body = 'Hello from server!', data = {} } = req.body;

  if (tokensStorage.size === 0) {
    return res.status(400).json({ error: 'No tokens available' });
  }

  const messages = Array.from(tokensStorage).map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data
  }));

  try {
    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];
    
    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
      } catch (error) {
        console.error('Error sending chunk:', error);
      }
    }

    res.json({ success: true, tickets });
  } catch (error) {
    console.error('Notification error:', error);
    res.status(500).json({ error: 'Failed to send notifications' });
  }
});

// Endpoint to list stored tokens (for testing)
app.get('/api/tokens', (req, res) => {
  res.json({ tokens: Array.from(tokensStorage) });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});