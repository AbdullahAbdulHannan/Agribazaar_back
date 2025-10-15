const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Base uploads directory (use /tmp on Vercel)
const BASE_UPLOAD_DIR = process.env.VERCEL === '1'
  ? path.join('/tmp', 'uploads')
  : path.join(process.cwd(), 'uploads');

// Create upload directories if they don't exist
const createUploadDirs = async () => {
  const dirs = [
    'auction-images',
    'auction-documents',
    'temp'
  ];
  
  for (const sub of dirs) {
    const dirPath = path.join(BASE_UPLOAD_DIR, sub);
    try {
      await fs.mkdir(dirPath, { recursive: true });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
};

// Initialize directories
createUploadDirs().catch(console.error);

// Upload file to local storage
const uploadToLocal = async (fileBuffer, folder = 'uploads', fileName = null) => {
  try {
    const fileExtension = fileName ? path.extname(fileName) : '.jpg';
    const uniqueFileName = `${uuidv4()}${fileExtension}`;
    
    // Determine target directory under base uploads
    const subFolder = folder.replace(/^uploads[\\/]?/, '');
    const targetDir = path.join(BASE_UPLOAD_DIR, subFolder);
    const fullPath = path.join(targetDir, uniqueFileName);
    
    // Ensure the directory exists
    await fs.mkdir(targetDir, { recursive: true });
    
    // Write file to disk
    await fs.writeFile(fullPath, fileBuffer);
    
    // Return file information with correct URL path
    return {
      fileName: uniqueFileName,
      filePath: fullPath,
      url: `/uploads/${subFolder}/${uniqueFileName}`,
      size: fileBuffer.length
    };
  } catch (error) {
    console.error('Error uploading file:', error);
    throw new Error('Failed to upload file');
  }
};

// [Rest of the file remains the same...]

// Delete file from local storage
const deleteFromLocal = async (filePath) => {
  try {
    const relative = filePath.replace(/^uploads[\\/]?/, '');
    const fullPath = path.join(BASE_UPLOAD_DIR, relative);
    await fs.unlink(fullPath);
    return { success: true };
  } catch (error) {
    console.error('Local delete error:', error);
    throw new Error('Failed to delete file from local storage');
  }
};

// Get file info
const getFileInfo = async (filePath) => {
  try {
    const relative = filePath.replace(/^uploads[\\/]?/, '');
    const fullPath = path.join(BASE_UPLOAD_DIR, relative);
    const stats = await fs.stat(fullPath);
    return {
      exists: true,
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime
    };
  } catch (error) {
    return { exists: false };
  }
};

// Clean up old temporary files
const cleanupTempFiles = async (maxAge = 24 * 60 * 60 * 1000) => { // 24 hours
  try {
    const tempDir = path.join(BASE_UPLOAD_DIR, 'temp');
    const files = await fs.readdir(tempDir);
    const now = Date.now();
    
    for (const file of files) {
      const filePath = path.join(tempDir, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtime.getTime() > maxAge) {
        await fs.unlink(filePath);
        console.log(`Cleaned up temp file: ${file}`);
      }
    }
  } catch (error) {
    console.error('Cleanup error:', error);
  }
};

// Schedule cleanup every hour
if (process.env.VERCEL !== '1') {
  setInterval(cleanupTempFiles, 60 * 60 * 1000);
}

// Get content type based on file extension
const getContentType = (extension) => {
  const contentTypes = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  };
  
  return contentTypes[extension.toLowerCase()] || 'application/octet-stream';
};

// Validate file type
const validateFileType = (fileName) => {
  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.pdf', '.doc', '.docx'];
  const extension = path.extname(fileName).toLowerCase();
  return allowedExtensions.includes(extension);
};

// Get storage statistics
const getStorageStats = async () => {
  try {
    const uploadsDir = path.join(process.cwd(), 'uploads');
    const stats = await fs.stat(uploadsDir);
    
    // Count files in subdirectories
    const subdirs = ['auction-images', 'auction-documents'];
    let totalFiles = 0;
    let totalSize = 0;
    
    for (const subdir of subdirs) {
      try {
        const subdirPath = path.join(uploadsDir, subdir);
        const files = await fs.readdir(subdirPath);
        totalFiles += files.length;
        
        for (const file of files) {
          const filePath = path.join(subdirPath, file);
          const fileStats = await fs.stat(filePath);
          totalSize += fileStats.size;
        }
      } catch (error) {
        // Subdirectory doesn't exist
      }
    }
    
    return {
      totalFiles,
      totalSize,
      totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
      lastModified: stats.mtime
    };
  } catch (error) {
    console.error('Storage stats error:', error);
    return { totalFiles: 0, totalSize: 0, totalSizeMB: '0.00' };
  }
};

module.exports = {
  uploadToLocal,
  deleteFromLocal,
  getFileInfo,
  cleanupTempFiles,
  getContentType,
  validateFileType,
  getStorageStats
}; 