const { 
  deleteFromLocal, 
  getFileInfo, 
  getStorageStats, 
  cleanupTempFiles,
  validateFileType 
} = require('../utils/localUpload');

// Get storage statistics
const getStorageInfo = async (req, res) => {
  try {
    const stats = await getStorageStats();
    
    res.status(200).json({
      success: true,
      data: stats
    });
  } catch (error) {
    console.error('Error getting storage info:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get storage information'
    });
  }
};

// Delete a file
const deleteFile = async (req, res) => {
  try {
    const { filePath } = req.params;
    
    // Validate file path to prevent directory traversal
    if (filePath.includes('..') || !filePath.startsWith('uploads/')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file path'
      });
    }
    
    const fileInfo = await getFileInfo(filePath);
    if (!fileInfo.exists) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    await deleteFromLocal(filePath);
    
    res.status(200).json({
      success: true,
      message: 'File deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete file'
    });
  }
};

// Get file information
const getFileDetails = async (req, res) => {
  try {
    const { filePath } = req.params;
    
    // Validate file path
    if (filePath.includes('..') || !filePath.startsWith('uploads/')) {
      return res.status(400).json({
        success: false,
        message: 'Invalid file path'
      });
    }
    
    const fileInfo = await getFileInfo(filePath);
    if (!fileInfo.exists) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }
    
    res.status(200).json({
      success: true,
      data: fileInfo
    });
  } catch (error) {
    console.error('Error getting file details:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get file details'
    });
  }
};

// Clean up temporary files
const cleanupFiles = async (req, res) => {
  try {
    await cleanupTempFiles();
    
    res.status(200).json({
      success: true,
      message: 'Cleanup completed successfully'
    });
  } catch (error) {
    console.error('Error during cleanup:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup files'
    });
  }
};

// Validate file type
const validateFile = async (req, res) => {
  try {
    const { fileName } = req.params;
    
    const isValid = validateFileType(fileName);
    
    res.status(200).json({
      success: true,
      data: {
        fileName,
        isValid,
        allowedTypes: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx']
      }
    });
  } catch (error) {
    console.error('Error validating file:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to validate file'
    });
  }
};

module.exports = {
  getStorageInfo,
  deleteFile,
  getFileDetails,
  cleanupFiles,
  validateFile
}; 