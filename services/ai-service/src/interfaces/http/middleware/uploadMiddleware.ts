import multer from 'multer';
import { Request } from 'express';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from '../../../../shared/infrastructure/logging/Logger';

const logger = new Logger('UploadMiddleware');

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req: Request, file: Express.Multer.File, cb) => {
    // Use temporary directory for uploads
    const uploadDir = process.env.UPLOAD_DIR || '/tmp/ai-service-uploads';
    cb(null, uploadDir);
  },
  filename: (req: Request, file: Express.Multer.File, cb) => {
    // Generate unique filename
    const uniqueId = uuidv4();
    const extension = path.extname(file.originalname);
    const filename = `${uniqueId}${extension}`;
    cb(null, filename);
  }
});

// File filter for ML model artifacts
const fileFilter = (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
  const allowedExtensions = [
    // TensorFlow formats
    '.pb', '.pbtxt', '.h5', '.json', '.weights',
    // PyTorch formats
    '.pt', '.pth', '.torchscript',
    // Scikit-learn formats
    '.pkl', '.pickle', '.joblib',
    // XGBoost formats
    '.model', '.bst',
    // ONNX formats
    '.onnx',
    // General formats
    '.zip', '.tar', '.tar.gz', '.tgz',
    // Configuration files
    '.yaml', '.yml', '.json', '.txt'
  ];

  const fileExtension = path.extname(file.originalname).toLowerCase();
  
  if (allowedExtensions.includes(fileExtension)) {
    cb(null, true);
  } else {
    logger.warn('File upload rejected - unsupported format', {
      filename: file.originalname,
      extension: fileExtension,
      mimetype: file.mimetype
    });
    
    cb(new Error(`Unsupported file format: ${fileExtension}. Allowed formats: ${allowedExtensions.join(', ')}`));
  }
};

// Configure multer with limits and validation
export const uploadMiddleware = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB max file size
    files: 10, // Maximum 10 files per request
    fields: 20, // Maximum 20 non-file fields
    fieldNameSize: 100, // Maximum field name size
    fieldSize: 1024 * 1024 // Maximum field value size (1MB)
  }
});

// Middleware for single model artifact upload
export const singleModelUpload = uploadMiddleware.single('model');

// Middleware for multiple artifact uploads
export const multipleArtifactUpload = uploadMiddleware.array('artifacts', 10);

// Middleware for dataset uploads
export const datasetUpload = multer({
  storage,
  fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedExtensions = [
      '.csv', '.json', '.jsonl', '.parquet', '.avro',
      '.txt', '.tsv', '.xlsx', '.xls',
      '.zip', '.tar', '.tar.gz', '.tgz'
    ];

    const fileExtension = path.extname(file.originalname).toLowerCase();
    
    if (allowedExtensions.includes(fileExtension)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported dataset format: ${fileExtension}. Allowed formats: ${allowedExtensions.join(', ')}`));
    }
  },
  limits: {
    fileSize: 1024 * 1024 * 1024, // 1GB max for datasets
    files: 5,
    fields: 10,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024
  }
});

// Middleware for image uploads (for computer vision models)
export const imageUpload = multer({
  storage,
  fileFilter: (req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedMimeTypes = [
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif',
      'image/bmp', 'image/webp', 'image/tiff'
    ];

    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported image format: ${file.mimetype}. Allowed formats: ${allowedMimeTypes.join(', ')}`));
    }
  },
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB max for images
    files: 100, // Allow batch image uploads
    fields: 10,
    fieldNameSize: 100,
    fieldSize: 1024 * 1024
  }
});

// Error handling middleware for multer
export const handleUploadError = (error: any, req: Request, res: any, next: any) => {
  if (error instanceof multer.MulterError) {
    logger.error('File upload error', {
      error: error.message,
      code: error.code,
      field: error.field
    });

    let message = 'File upload error';
    let statusCode = 400;

    switch (error.code) {
      case 'LIMIT_FILE_SIZE':
        message = 'File too large';
        break;
      case 'LIMIT_FILE_COUNT':
        message = 'Too many files';
        break;
      case 'LIMIT_FIELD_COUNT':
        message = 'Too many fields';
        break;
      case 'LIMIT_FIELD_KEY':
        message = 'Field name too long';
        break;
      case 'LIMIT_FIELD_VALUE':
        message = 'Field value too long';
        break;
      case 'LIMIT_UNEXPECTED_FILE':
        message = 'Unexpected file field';
        break;
      default:
        message = error.message;
    }

    return res.status(statusCode).json({
      success: false,
      error: message,
      code: error.code
    });
  }

  if (error.message.includes('Unsupported')) {
    return res.status(400).json({
      success: false,
      error: error.message
    });
  }

  next(error);
};

// Middleware to validate uploaded files
export const validateUploadedFiles = (req: Request, res: any, next: any) => {
  try {
    const files = req.files as Express.Multer.File[] || [];
    const file = req.file as Express.Multer.File;

    if (file) {
      files.push(file);
    }

    if (files.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No files uploaded'
      });
    }

    // Log uploaded files
    files.forEach(uploadedFile => {
      logger.info('File uploaded successfully', {
        originalName: uploadedFile.originalname,
        filename: uploadedFile.filename,
        size: uploadedFile.size,
        mimetype: uploadedFile.mimetype,
        destination: uploadedFile.destination
      });
    });

    next();

  } catch (error) {
    logger.error('File validation error', { error: error.message });
    
    res.status(500).json({
      success: false,
      error: 'File validation failed'
    });
  }
};
