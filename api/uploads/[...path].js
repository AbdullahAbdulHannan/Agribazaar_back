import { createReadStream } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { fileTypeFromFile } from 'file-type';

const pipelineAsync = promisify(pipeline);

// Base uploads directory (matches localUpload.js)
const BASE_UPLOAD_DIR = process.env.VERCEL === '1'
  ? join('/tmp', 'uploads')
  : join(process.cwd(), 'uploads');

// MIME type mapping
const MIME_TYPES = {
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'png': 'image/png',
  'gif': 'image/gif',
  'webp': 'image/webp',
  'pdf': 'application/pdf',
  'doc': 'application/msword',
  'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export default async function handler(req, res) {
  try {
    const { path: filePath } = req.query;
    
    if (!filePath) {
      return res.status(400).json({ success: false, message: 'File path is required' });
    }

    // Resolve the full file path
    const fullPath = join(BASE_UPLOAD_DIR, ...filePath.split('/'));
    
    try {
      // Get file stats to check if it exists
      const stats = await require('fs').promises.stat(fullPath);
      
      if (!stats.isFile()) {
        return res.status(404).json({ success: false, message: 'File not found' });
      }
      
      // Get file extension
      const ext = fullPath.split('.').pop().toLowerCase();
      
      // Set appropriate content type
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      res.setHeader('Content-Type', contentType);
      
      // Set cache headers (1 day)
      res.setHeader('Cache-Control', 'public, max-age=86400');
      
      // Stream the file
      const stream = createReadStream(fullPath);
      await pipelineAsync(stream, res);
      
    } catch (err) {
      console.error('Error serving file:', err);
      return res.status(404).json({ success: false, message: 'File not found' });
    }
  } catch (err) {
    console.error('Error in file server:', err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
  },
};
