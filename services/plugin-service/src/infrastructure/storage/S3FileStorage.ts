/**
 * AWS S3 File Storage Implementation
 * 
 * Provides file storage operations using AWS S3.
 * Implements the FileStorage interface with S3-specific optimizations.
 */

import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Upload } from '@aws-sdk/lib-storage';
import { FileStorage, FileMetadata } from '../../application/ports/FileStorage';
import { Logger } from '../../application/ports/Logger';

export interface S3Config {
  region: string;
  bucket: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  endpoint?: string; // For S3-compatible services
  forcePathStyle?: boolean;
}

export class S3FileStorage implements FileStorage {
  private s3Client: S3Client;
  private bucket: string;

  constructor(
    private config: S3Config,
    private logger: Logger
  ) {
    this.bucket = config.bucket;
    
    this.s3Client = new S3Client({
      region: config.region,
      credentials: config.accessKeyId && config.secretAccessKey ? {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      } : undefined,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle || false
    });
  }

  async store(path: string, content: Buffer, metadata?: Record<string, string>): Promise<void> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: path,
        Body: content,
        Metadata: metadata,
        ContentType: this.getContentType(path),
        ServerSideEncryption: 'AES256'
      });

      await this.s3Client.send(command);

      this.logger.info('File stored successfully', {
        path,
        size: content.length,
        bucket: this.bucket
      });

    } catch (error) {
      this.logger.error('Error storing file', error as Error, {
        path,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async get(path: string): Promise<Buffer | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        return null;
      }

      // Convert stream to buffer
      const chunks: Uint8Array[] = [];
      const stream = response.Body as NodeJS.ReadableStream;
      
      return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
      });

    } catch (error: any) {
      if (error.name === 'NoSuchKey') {
        return null;
      }

      this.logger.error('Error getting file', error as Error, {
        path,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async getMetadata(path: string): Promise<FileMetadata | null> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      const response = await this.s3Client.send(command);

      return {
        size: response.ContentLength || 0,
        mimeType: response.ContentType,
        lastModified: response.LastModified || new Date(),
        etag: response.ETag,
        metadata: response.Metadata
      };

    } catch (error: any) {
      if (error.name === 'NotFound' || error.name === 'NoSuchKey') {
        return null;
      }

      this.logger.error('Error getting file metadata', error as Error, {
        path,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      const metadata = await this.getMetadata(path);
      return metadata !== null;
    } catch (error) {
      return false;
    }
  }

  async delete(path: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      await this.s3Client.send(command);

      this.logger.info('File deleted successfully', {
        path,
        bucket: this.bucket
      });

    } catch (error) {
      this.logger.error('Error deleting file', error as Error, {
        path,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async list(prefix: string): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
        MaxKeys: 1000
      });

      const response = await this.s3Client.send(command);
      
      return response.Contents?.map(obj => obj.Key || '') || [];

    } catch (error) {
      this.logger.error('Error listing files', error as Error, {
        prefix,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async copy(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      const command = new CopyObjectCommand({
        Bucket: this.bucket,
        Key: destinationPath,
        CopySource: `${this.bucket}/${sourcePath}`,
        ServerSideEncryption: 'AES256'
      });

      await this.s3Client.send(command);

      this.logger.info('File copied successfully', {
        sourcePath,
        destinationPath,
        bucket: this.bucket
      });

    } catch (error) {
      this.logger.error('Error copying file', error as Error, {
        sourcePath,
        destinationPath,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async move(sourcePath: string, destinationPath: string): Promise<void> {
    try {
      // Copy file to new location
      await this.copy(sourcePath, destinationPath);
      
      // Delete original file
      await this.delete(sourcePath);

      this.logger.info('File moved successfully', {
        sourcePath,
        destinationPath,
        bucket: this.bucket
      });

    } catch (error) {
      this.logger.error('Error moving file', error as Error, {
        sourcePath,
        destinationPath,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async getSignedUrl(path: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn
      });

      return signedUrl;

    } catch (error) {
      this.logger.error('Error generating signed URL', error as Error, {
        path,
        bucket: this.bucket,
        expiresIn
      });
      throw error;
    }
  }

  async getStream(path: string): Promise<NodeJS.ReadableStream> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: path
      });

      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        throw new Error('File not found');
      }

      return response.Body as NodeJS.ReadableStream;

    } catch (error) {
      this.logger.error('Error getting file stream', error as Error, {
        path,
        bucket: this.bucket
      });
      throw error;
    }
  }

  async storeStream(path: string, stream: NodeJS.ReadableStream, metadata?: Record<string, string>): Promise<void> {
    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucket,
          Key: path,
          Body: stream,
          Metadata: metadata,
          ContentType: this.getContentType(path),
          ServerSideEncryption: 'AES256'
        }
      });

      await upload.done();

      this.logger.info('File stream stored successfully', {
        path,
        bucket: this.bucket
      });

    } catch (error) {
      this.logger.error('Error storing file stream', error as Error, {
        path,
        bucket: this.bucket
      });
      throw error;
    }
  }

  private getContentType(path: string): string {
    const extension = path.split('.').pop()?.toLowerCase();
    
    const contentTypes: Record<string, string> = {
      'js': 'application/javascript',
      'json': 'application/json',
      'zip': 'application/zip',
      'tar': 'application/x-tar',
      'gz': 'application/gzip',
      'txt': 'text/plain',
      'md': 'text/markdown',
      'html': 'text/html',
      'css': 'text/css',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'svg': 'image/svg+xml'
    };

    return contentTypes[extension || ''] || 'application/octet-stream';
  }
}
