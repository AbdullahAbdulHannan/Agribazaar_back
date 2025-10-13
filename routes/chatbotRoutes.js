const chatbotController = require('../controllers/chatbotController');
const express = require('express');
const router = express.Router();

router.post('/ask', chatbotController.askQuestion);
router.get('/test', chatbotController.testGeminiConnection);

module.exports = router;
