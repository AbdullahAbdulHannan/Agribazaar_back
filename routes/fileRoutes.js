const express = require('express');
const router = express.Router();
const {
  getStorageInfo,
  deleteFile,
  getFileDetails,
  cleanupFiles,
  validateFile
} = require('../controllers/fileController');
const { authenticate } = require('../middleware/authMiddleware');
const path = require('path');

// Public routes
router.get('/storage/stats', getStorageInfo); // Get storage statistics
router.get('/validate/:fileName', validateFile); // Validate file type

// Protected routes (admin only)
router.use(authenticate);

router.delete('/:filePath', deleteFile); // Delete a file
router.get('/info/:filePath', getFileDetails); // Get file information
router.post('/cleanup', cleanupFiles); // Clean up temporary files

// Test file serving
router.get('/test/:filename', (req, res) => {
  const { filename } = req.params;
  const filePath = path.join(__dirname, '..', 'uploads', 'auction-images', filename);
  
  res.json({
    filename,
    filePath,
    exists: require('fs').existsSync(filePath),
    fullUrl: `https://agribazaar-backend.vercel.app/uploads/auction-images/${filename}`
  });
});

module.exports = router; 