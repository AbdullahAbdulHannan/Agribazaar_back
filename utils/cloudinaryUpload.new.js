const cloudinary = require('cloudinary').v2;
const { Readable } = require('stream');

/**
 * Upload a file to Cloudinary
 * @param {Buffer} fileBuffer - The file buffer to upload
 * @param {string} folder - The folder to upload to (e.g., 'agribazaar/auction-images')
 * @param {string} mimeType - The MIME type of the file
 * @returns {Promise<Object>} - Upload result with URL and metadata
 */
const uploadToCloudinary = (fileBuffer, folder = 'agribazaar', mimeType = 'image/jpeg') => {
  return new Promise((resolve, reject) => {
    if (!fileBuffer || !Buffer.isBuffer(fileBuffer)) {
      return reject(new Error('Invalid file buffer provided'));
    }

    const isImage = mimeType.startsWith('image/');
    const resourceType = isImage ? 'image' : 'raw';
    
    const options = {
      folder: folder,
      resource_type: resourceType,
      type: 'upload',
      overwrite: true,
      invalidate: true
    };

    // For images, add optimization options
    if (isImage) {
      Object.assign(options, {
        quality: 'auto',
        fetch_format: 'auto',
        transformation: [
          { width: 1200, crop: 'limit', quality: 'auto' },
          { fetch_format: 'auto' }
        ]
      });
    }

    console.log(`Uploading to Cloudinary - Folder: ${folder}, Type: ${resourceType}`);
    
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          console.error('Cloudinary upload error:', {
            error: error.message,
            folder,
            resourceType,
            size: fileBuffer.length
          });
          return reject(error);
        }
        
        if (!result || !result.secure_url) {
          const err = new Error('Invalid response from Cloudinary');
          console.error('Cloudinary upload failed:', { result });
          return reject(err);
        }

        console.log(`Upload successful: ${result.secure_url}`);
        
        resolve({
          url: result.secure_url,
          public_id: result.public_id,
          format: result.format,
          bytes: result.bytes,
          width: result.width,
          height: result.height,
          resource_type: result.resource_type
        });
      }
    );

    // Handle stream errors
    uploadStream.on('error', (error) => {
      console.error('Upload stream error:', error);
      reject(error);
    });

    // Create and pipe the buffer stream
    const bufferStream = new Readable();
    bufferStream.push(fileBuffer);
    bufferStream.push(null); // Signal end of stream
    
    // Start the upload
    bufferStream.pipe(uploadStream);
  });
};

/**
 * Delete a file from Cloudinary
 * @param {string} publicId - The public ID of the file to delete
 * @param {Object} options - Additional options for deletion
 * @returns {Promise<boolean>} - True if deletion was successful
 */
const deleteFromCloudinary = async (publicId, options = {}) => {
  if (!publicId) {
    console.error('No public ID provided for deletion');
    return false;
  }

  try {
    const result = await cloudinary.uploader.destroy(publicId, {
      invalidate: true,
      ...options
    });
    
    if (result.result !== 'ok') {
      console.error('Failed to delete from Cloudinary:', result);
      return false;
    }
    
    console.log(`Deleted from Cloudinary: ${publicId}`);
    return true;
  } catch (error) {
    console.error('Error deleting from Cloudinary:', {
      error: error.message,
      publicId,
      stack: error.stack
    });
    return false;
  }
};

/**
 * Extract public ID from Cloudinary URL
 * @param {string} url - Cloudinary URL
 * @returns {string|null} - Public ID or null if invalid
 */
const getPublicIdFromUrl = (url) => {
  if (!url || typeof url !== 'string') return null;
  
  try {
    const matches = url.match(/upload\/(?:v\d+\/)?([^\/]+)/);
    return matches ? matches[1].split('.')[0] : null;
  } catch (error) {
    console.error('Error extracting public ID:', error);
    return null;
  }
};

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  getPublicIdFromUrl
};
