require('dotenv').config();
const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');

const app = express();
app.use(express.static('.'));
app.use(express.json());

// Store tokens in memory
let userTokens = null;
const SUBS_FILE = 'subscriptions.json';

// Exchange rates (hardcoded for hackathon - use live API later)
const EXCHANGE_RATES = {
  'USD': 18.50,  // 1 USD = 18.50 ZAR
  'EUR': 20.00,  // 1 EUR = 20.00 ZAR
  'GBP': 23.50,  // 1 GBP = 23.50 ZAR
  'YER': 0.074,  // 1 YER = 0.074 ZAR (Yemen Riyal)
};

// Detect currency from symbol
function detectCurrency(amountStr) {
  if (amountStr.startsWith('$')) return { currency: 'USD', symbol: '$' };
  if (amountStr.startsWith('€')) return { currency: 'EUR', symbol: '€' };
  if (amountStr.startsWith('£')) return { currency: 'GBP', symbol: '£' };
  if (amountStr.toLowerCase().includes('yer') || amountStr.includes('﷼')) return { currency: 'YER', symbol: '﷼' };
  if (amountStr.match(/[Rr]\s*\d+/) || amountStr.includes('ZAR')) return { currency: 'ZAR', symbol: 'R' };
  return { currency: 'ZAR', symbol: 'R' }; // Default to ZAR
}

// Convert to ZAR
function convertToZAR(amount, currency) {
  if (currency === 'ZAR') return amount;
  const rate = EXCHANGE_RATES[currency];
  if (!rate) return amount; // If no rate, assume it's ZAR
  return amount * rate;
}

// Extract amount from email body
function extractAmount(body) {
  // Pattern for Rands: R159.99, R 159.99, R159,99
  const zarMatch = body.match(/[Rr]\s*(\d+(?:[.,]\d{1,2})?)/);
  if (zarMatch) {
    const amount = parseFloat(zarMatch[1].replace(',', '.'));
    return { amount, currency: 'ZAR', originalAmount: `R${zarMatch[1]}` };
  }
  
  // Pattern for Dollars: $15.99, $ 15.99
  const usdMatch = body.match(/\$\s*(\d+(?:[.,]\d{1,2})?)/);
  if (usdMatch) {
    const amount = parseFloat(usdMatch[1].replace(',', '.'));
    return { amount, currency: 'USD', originalAmount: `$${usdMatch[1]}` };
  }
  
  // Pattern for Euros: €15.99, € 15.99
  const eurMatch = body.match(/€\s*(\d+(?:[.,]\d{1,2})?)/);
  if (eurMatch) {
    const amount = parseFloat(eurMatch[1].replace(',', '.'));
    return { amount, currency: 'EUR', originalAmount: `€${eurMatch[1]}` };
  }
  
  // Pattern for Pounds: £15.99, £ 15.99
  const gbpMatch = body.match(/£\s*(\d+(?:[.,]\d{1,2})?)/);
  if (gbpMatch) {
    const amount = parseFloat(gbpMatch[1].replace(',', '.'));
    return { amount, currency: 'GBP', originalAmount: `£${gbpMatch[1]}` };
  }
  
  // Pattern for Yemen Riyal
  const yerMatch = body.match(/(?:YER|﷼)\s*(\d+(?:[.,]\d{1,2})?)/i);
  if (yerMatch) {
    const amount = parseFloat(yerMatch[1].replace(',', '.'));
    return { amount, currency: 'YER', originalAmount: `${yerMatch[1]} YER` };
  }
  
  return null;
}

// Google OAuth setup
const oauth2Client = new google.auth.OAuth2(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Step 1: Login route
app.get('/auth', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/gmail.readonly'],
  });
  res.redirect(url);
});

// Step 2: OAuth callback
app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  const { tokens } = await oauth2Client.getToken(code);
  userTokens = tokens;
  
  // Auto-scan after login
  await scanEmails();
  res.redirect('/?success=1');
});

// Step 3: Scan emails and find subscriptions
async function scanEmails() {
  if (!userTokens) return [];
  
  oauth2Client.setCredentials(userTokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  
  // Search for receipt-like emails
  const response = await gmail.users.messages.list({
    userId: 'me',
    maxResults: 50,
    q: 'receipt OR invoice OR "monthly" OR subscription OR "payment"'
  });
  
  const messages = response.data.messages || [];
  const subscriptions = {};
  
  for (const msg of messages) {
    const email = await gmail.users.messages.get({
      userId: 'me',
      id: msg.id,
    });
    
    // Get email body
    const data = email.data.payload.parts?.[0]?.body?.data || email.data.payload.body?.data;
    if (!data) continue;
    
    const body = Buffer.from(data, 'base64').toString('utf-8');
    
    // Extract amount with currency detection
    const extracted = extractAmount(body);
    if (!extracted) continue;
    
    let { amount, currency, originalAmount } = extracted;
    
    // Convert to ZAR if not already
    let zarAmount = amount;
    let displayAmount = originalAmount;
    
    if (currency !== 'ZAR') {
      zarAmount = convertToZAR(amount, currency);
      displayAmount = `${originalAmount} (≈ R${zarAmount.toFixed(2)})`;
    } else {
      displayAmount = `R${amount.toFixed(2)}`;
    }
    
    if (zarAmount > 5000) continue; // Skip large one-time purchases (over R5000)
    
    // Get sender domain
    const fromHeader = email.data.payload.headers.find(h => h.name === 'From');
    const domainMatch = fromHeader?.value?.match(/@([a-zA-Z0-9\-]+\.[a-zA-Z]{2,})/);
    const merchant = domainMatch ? domainMatch[1] : 'Unknown';
    
    // Group by merchant
    if (!subscriptions[merchant]) {
      subscriptions[merchant] = { 
        merchant, 
        amount: zarAmount, 
        displayAmount,
        originalCurrency: currency,
        count: 0 
      };
    }
    subscriptions[merchant].count++;
    subscriptions[merchant].amount = zarAmount; // Use most recent amount in ZAR
    subscriptions[merchant].displayAmount = displayAmount;
  }
  
  // Filter to merchants with 2+ occurrences (recurring)
  const recurring = Object.values(subscriptions).filter(s => s.count >= 2);
  
  // Save to JSON file
  fs.writeFileSync(SUBS_FILE, JSON.stringify(recurring, null, 2));
  return recurring;
}

// API endpoint to get subscriptions
app.get('/api/subscriptions', (req, res) => {
  if (!fs.existsSync(SUBS_FILE)) {
    return res.json([]);
  }
  const subs = JSON.parse(fs.readFileSync(SUBS_FILE));
  res.json(subs);
});

// API endpoint to refresh scan
app.post('/api/scan', async (req, res) => {
  const subs = await scanEmails();
  res.json(subs);
});

app.listen(3000, () => {
  console.log('🔥 Monthly Money Menace running at http://localhost:3000');
  console.log('👉 Visit http://localhost:3000');
  console.log('💰 Currency: All amounts converted to ZAR (Rands)');
});