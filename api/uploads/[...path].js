import { createReadStream } from 'fs';
import { join } from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream';
import { fileTypeFromFile } from 'file-type';
import fs from 'fs/promises';
import path from 'path';

const pipelineAsync = promisify(pipeline);
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Base uploads directory
const BASE_UPLOAD_DIR = process.env.VERCEL === '1'
  ? '/tmp/uploads'
  : join(process.cwd(), 'uploads');

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
    
    if (!filePath || !Array.isArray(filePath) || filePath.length === 0) {
      return res.status(400).json({ success: false, message: 'Invalid file path' });
    }

    const fullPath = join(BASE_UPLOAD_DIR, ...filePath);
    
    try {
      // Check if file exists
      await fs.access(fullPath);
      const stats = await fs.stat(fullPath);
      
      if (!stats.isFile()) {
        return res.status(404).json({ success: false, message: 'File not found' });
      }
      
      // Get file extension
      const ext = path.extname(fullPath).toLowerCase().slice(1);
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      
      // Set headers
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', stats.size);
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      
      // Stream the file
      const stream = createReadStream(fullPath);
      return await pipelineAsync(stream, res);
      
    } catch (err) {
      console.error('Error serving file:', err);
      return res.status(404).json({ success: false, message: 'File not found' });
    }
  } catch (err) {
    console.error('Error in file server:', err);
    return res.status(500).json({ success: false, message: 'Internal server error' });
  }
}

export const config = {
  api: {
    responseLimit: false,
    bodyParser: false,
  },
};