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

// Subscription name mapping (domain -> display name & cancellation URL)
const SUBSCRIPTION_DB = {
  'netflix.com': {
    name: 'Netflix',
    cancelUrl: 'https://www.netflix.com/YourAccount'
  },
  'spotify.com': {
    name: 'Spotify',
    cancelUrl: 'https://www.spotify.com/account/subscription/'
  },
  'amazon.com': {
    name: 'Amazon Prime',
    cancelUrl: 'https://www.amazon.com/gp/subscribe-and-save'
  },
  'disneyplus.com': {
    name: 'Disney+',
    cancelUrl: 'https://www.disneyplus.com/subscription'
  },
  'hbo.com': {
    name: 'HBO Max',
    cancelUrl: 'https://www.hbomax.com/account'
  },
  'apple.com': {
    name: 'Apple',
    cancelUrl: 'https://appleid.apple.com/account/manage'
  },
  'microsoft.com': {
    name: 'Microsoft',
    cancelUrl: 'https://account.microsoft.com/services'
  },
  'google.com': {
    name: 'Google',
    cancelUrl: 'https://myaccount.google.com/subscriptions'
  },
  'youtube.com': {
    name: 'YouTube Premium',
    cancelUrl: 'https://www.youtube.com/paid_memberships'
  },
  'showmax.com': {
    name: 'Showmax',
    cancelUrl: 'https://www.showmax.com/eng/account'
  },
  'multichoice.co.za': {
    name: 'DStv',
    cancelUrl: 'https://selfservice.dstv.com/'
  },
  'takealot.com': {
    name: 'Takealot',
    cancelUrl: 'https://www.takealot.com/account'
  },
  'gym-membership.co.za': {
    name: 'Gym Membership',
    cancelUrl: 'https://example.com/cancel'
  },
  'primevideo.com': {
    name: 'Prime Video',
    cancelUrl: 'https://www.amazon.com/gp/video/settings'
  },
  'hulu.com': {
    name: 'Hulu',
    cancelUrl: 'https://hulu.com/account'
  },
  'paramountplus.com': {
    name: 'Paramount+',
    cancelUrl: 'https://www.paramountplus.com/account/'
  },
  'peacocktv.com': {
    name: 'Peacock',
    cancelUrl: 'https://www.peacocktv.com/account'
  },
  'dropbox.com': {
    name: 'Dropbox',
    cancelUrl: 'https://www.dropbox.com/account/plan'
  },
  'icloud.com': {
    name: 'iCloud',
    cancelUrl: 'https://appleid.apple.com/account/manage'
  },
  'adobe.com': {
    name: 'Adobe Creative Cloud',
    cancelUrl: 'https://account.adobe.com/plans'
  },
  'canva.com': {
    name: 'Canva',
    cancelUrl: 'https://www.canva.com/account/subscription'
  },
  'slack.com': {
    name: 'Slack',
    cancelUrl: 'https://my.slack.com/account/billing'
  },
  'zoom.us': {
    name: 'Zoom',
    cancelUrl: 'https://zoom.us/billing'
  }
};

// Function to get subscription info
function getSubscriptionInfo(domain) {
  // Try exact match first
  if (SUBSCRIPTION_DB[domain]) {
    return SUBSCRIPTION_DB[domain];
  }
  
  // Try partial match
  for (const [key, value] of Object.entries(SUBSCRIPTION_DB)) {
    if (domain.includes(key.split('.')[0])) {
      return value;
    }
  }
  
  // Default fallback
  return {
    name: domain.split('.')[0].charAt(0).toUpperCase() + domain.split('.')[0].slice(1),
    cancelUrl: `https://${domain}/account`
  };
}

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
    
    // Get subscription info
    const subInfo = getSubscriptionInfo(merchant);
    
    // Group by merchant
    if (!subscriptions[merchant]) {
      subscriptions[merchant] = { 
        merchant, 
        name: subInfo.name,
        cancelUrl: subInfo.cancelUrl,
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
  const recurring = Object.values(subscriptions).filter(s => s.count >= 2)
    .map(s => ({
      merchant: s.merchant,
      name: s.name,
      cancelUrl: s.cancelUrl,
      amount: s.amount,
      displayAmount: s.displayAmount,
      originalCurrency: s.originalCurrency,
      count: s.count
    }));
  
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
  console.log('📋 Subscription names and cancel URLs loaded');
});