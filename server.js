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

// Endpoint to send notification (updated to track usage)
app.post('/api/send-notification', async (req, res) => {
  const { 
    title = 'Test', 
    body = 'Hello from server!', 
    data = {},
    targetToken = null // Optional: send to specific token
  } = req.body;

  if (tokensStorage.size === 0) {
    return res.status(400).json({ error: 'No tokens available' });
  }

  // Update last used timestamp for targeted token
  if (targetToken && tokensStorage.has(targetToken)) {
    tokensStorage.get(targetToken).lastUsed = new Date().toISOString();
  }

  const messages = targetToken
    ? [{
        to: targetToken,
        sound: 'default',
        title,
        body,
        data
      }]
    : Array.from(tokensStorage.keys()).map(token => ({
        to: token,
        sound: 'default',
        title,
        body,
        data
      }));

  // ... rest of the send notification code ...
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