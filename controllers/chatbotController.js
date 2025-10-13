const axios = require('axios');
const dotenv = require('dotenv');
dotenv.config();
// AgriBazaar platform knowledge base
const AGRIBAZAAR_KNOWLEDGE = `
AgriBazaar is a comprehensive agricultural marketplace platform with the following features:

1. MARKETPLACE:
- Users can buy and sell agricultural products
- Fixed pricing system
- Product categories include grains, vegetables, fruits, dairy, etc.
- Search and filter functionality
- Product ratings and reviews

2. E-MANDI:
- Digital mandi (marketplace) for wholesale trading
- Connect farmers directly with traders and wholesalers
- Bulk trading opportunities
- Price discovery and market information
- Trading history and analytics

3. AUCTIONS:
- Competitive bidding system for agricultural products
- Time-limited auctions
- Real-time bidding
- Auction history and results
- Reserve price setting

4. USER ROLES:
- Buyers: Can purchase products, participate in auctions
- Sellers: Can list products, create auctions, manage inventory

5. FEATURES:
- User authentication (Google OAuth and email/password)
- Profile management
- Cart functionality for buyers
- Post Ad system for sellers
- Search and filtering
- Notifications system

6. POSTING PRODUCTS:
- Click "Post Ad" button in header
- Choose between Marketplace, E-Mandi, or Auction
- Fill product details, pricing, images
- Submit for listing

7. FEES:
- Platform may charge commission on sales
- Auction fees may apply
- Payment processing fees

8. SECURITY:
- Secure authentication
- Data protection
- Transaction security
`;

const SYSTEM_PROMPT = `You are AgriBazaar Assistant, a helpful AI assistant for the AgriBazaar agricultural marketplace platform. 

Your role is to help users understand and navigate the AgriBazaar platform. You should:

1. Only answer questions related to AgriBazaar platform features, functionality, and usage
2. Be friendly, helpful, and professional in your tone
3. Provide clear, concise, and actionable answers
4. If asked about topics unrelated to AgriBazaar, politely redirect to platform-related questions
5. Use the knowledge base provided to give accurate information
6. Always maintain a helpful and supportive attitude
7. Provide step-by-step guidance when explaining processes
8. Include relevant details about features and benefits

Knowledge Base:
${AGRIBAZAAR_KNOWLEDGE}

Important Guidelines:
- Always focus on AgriBazaar platform features and functionality
- Provide practical, actionable advice
- Be encouraging and supportive to users
- If you don't know something specific, suggest contacting support
- Keep responses concise but informative
- Use a warm, professional tone

Remember: Only answer questions about AgriBazaar platform. For other topics, politely redirect users to ask about AgriBazaar features.`;

exports.testGeminiConnection = async (req, res) => {
  try {
    if (!GEMINI_API_KEY) {
      return res.status(400).json({ 
        status: 'error', 
        message: 'Gemini API key not configured' 
      });
    }

    const testResponse = await callGeminiAPI('Hello, this is a test message.');
    
    res.status(200).json({ 
      status: 'success', 
      message: 'Gemini API connection successful',
      testResponse: testResponse.substring(0, 100) + '...'
    });
  } catch (error) {
    console.error('Gemini connection test failed:', error);
    res.status(500).json({ 
      status: 'error', 
      message: 'Gemini API connection failed',
      error: error.message 
    });
  }
};

exports.askQuestion = async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ 
        response: "Please provide a question about AgriBazaar platform." 
      });
    }

    // Log the request for monitoring
    console.log('Chatbot request:', {
      userMessage: message,
      timestamp: new Date().toISOString(),
      apiUsed: GEMINI_API_KEY ? 'Gemini' : 'Local'
    });

    // Check if the question is related to AgriBazaar
    const agribazaarKeywords = [
      'agribazaar', 'agri bazaar', 'marketplace', 'emandi', 'auction', 
      'post ad', 'sell', 'buy', 'product', 'farmer', 'trader', 'wholesale',
      'agriculture', 'agricultural', 'crop', 'grain', 'vegetable', 'fruit',
      'dairy', 'platform', 'website', 'app', 'login', 'signup', 'register',
      'profile', 'cart', 'order', 'payment', 'fee', 'commission', 'price',
      'delivery', 'shipping', 'escrow', 'stripe', 'orders', 'bidding'
    ];

    const userMessage = message.toLowerCase();
    const isAgriBazaarRelated = agribazaarKeywords.some(keyword => 
      userMessage.includes(keyword)
    );

    if (!isAgriBazaarRelated) {
      return res.status(200).json({
        response: "I'm AgriBazaar Assistant and I can help you with questions about our agricultural marketplace platform. Please ask me about AgriBazaar features like marketplace, E-Mandi, auctions, posting products, user roles, or platform functionality."
      });
    }

    // Use Gemini API for production
    const response = await callGeminiAPI(message);
    
    // Safety: trim runaway responses
    const trimmed = typeof response === 'string' && response.length > 1800 ? `${response.slice(0, 1800)}…` : response;
    
    res.status(200).json({ response: trimmed });
  } catch (error) {
    console.error('Chatbot error:', error);
    res.status(500).json({ 
      response: "I'm sorry, I'm having trouble processing your request right now. Please try again later." 
    });
  }
};

function generateResponse(message) {
  const userMessage = message.toLowerCase();
  
  // Marketplace related questions
  if (userMessage.includes('marketplace') || userMessage.includes('buy') || userMessage.includes('sell')) {
    return "The AgriBazaar marketplace allows users to buy and sell agricultural products with fixed pricing. Sellers can post products using the 'Post Ad' button, and buyers can browse, search, and purchase items. The marketplace includes product categories, ratings, and secure payment processing.";
  }
  
  // E-Mandi related questions
  if (userMessage.includes('emandi') || userMessage.includes('mandi') || userMessage.includes('wholesale')) {
    return "E-Mandi is our digital wholesale marketplace that connects farmers directly with traders and wholesalers. It features bulk trading opportunities, price discovery, and market analytics. Users can participate in wholesale trading with real-time market information.";
  }
  
  // Auction related questions
  if (userMessage.includes('auction') || userMessage.includes('bid')) {
    return "AgriBazaar auctions allow competitive bidding on agricultural products. Sellers can create time-limited auctions with reserve prices, while buyers can place real-time bids. The system tracks auction history and provides detailed results.";
  }
  
  // Posting products
  if (userMessage.includes('post') || userMessage.includes('ad') || userMessage.includes('list')) {
    return "To post a product, click the 'Post Ad' button in the header. You'll be asked to choose between Marketplace, E-Mandi, or Auction. Fill in your product details, pricing, and images, then submit for listing.";
  }
  
  // User roles
  if (userMessage.includes('role') || userMessage.includes('buyer') || userMessage.includes('seller')) {
    return "AgriBazaar has two main user roles: Buyers can purchase products, participate in auctions, and use the cart functionality. Sellers can list products, create auctions, and manage their inventory through the platform.";
  }
  
  // Fees
  if (userMessage.includes('fee') || userMessage.includes('cost') || userMessage.includes('commission')) {
    return "AgriBazaar may charge platform commissions on sales, auction fees, and payment processing fees. Specific fee structures are available in our terms of service and vary by transaction type.";
  }
  
  // General platform info
  if (userMessage.includes('feature') || userMessage.includes('what') || userMessage.includes('how')) {
    return "AgriBazaar is a comprehensive agricultural marketplace with three main features: Marketplace (fixed-price buying/selling), E-Mandi (wholesale trading), and Auctions (competitive bidding). The platform includes user authentication, profile management, search functionality, and secure transactions.";
  }
  
  // Default response
  return "I'm here to help you with AgriBazaar platform questions! You can ask me about marketplace features, E-Mandi trading, auctions, posting products, user roles, fees, or any other platform functionality.";
}

// Gemini API Integration for Production
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1/models/gemini-1.5-pro:generateContent';

async function callGeminiAPI(userMessage) {
  try {
    if (!GEMINI_API_KEY) {
      console.error('Gemini API key not found in environment variables');
      return generateResponse(userMessage); // Fallback to local responses
    }

    const response = await axios.post(`${GEMINI_API_URL}?key=${GEMINI_API_KEY}`, {
      contents: [{
        parts: [{
          text: `${SYSTEM_PROMPT}\n\nUser: ${userMessage}\n\nAssistant:`
        }]
      }],
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 1024,
      }
    });
    
    if (response.data.candidates && response.data.candidates[0] && response.data.candidates[0].content) {
      return response.data.candidates[0].content.parts[0].text;
    } else {
      console.error('Unexpected Gemini API response structure:', response.data);
      return generateResponse(userMessage); // Fallback to local responses
    }
  } catch (error) {
    console.error('Gemini API error:', error.response?.data || error.message);
    return generateResponse(userMessage); // Fallback to local responses
  }
}