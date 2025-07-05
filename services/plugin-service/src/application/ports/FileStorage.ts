/**
 * File Storage Port
 * 
 * Defines the interface for file storage operations.
 * Implementations can use local file system, AWS S3, or other storage backends.
 */

export interface FileMetadata {
  size: number;
  mimeType?: string;
  lastModified: Date;
  etag?: string;
  metadata?: Record<string, string>;
}

export interface FileStorage {
  /**
   * Store a file
   */
  store(path: string, content: Buffer, metadata?: Record<string, string>): Promise<void>;

  /**
   * Get a file
   */
  get(path: string): Promise<Buffer | null>;

  /**
   * Get file metadata
   */
  getMetadata(path: string): Promise<FileMetadata | null>;

  /**
   * Check if file exists
   */
  exists(path: string): Promise<boolean>;

  /**
   * Delete a file
   */
  delete(path: string): Promise<void>;

  /**
   * List files in a directory
   */
  list(prefix: string): Promise<string[]>;

  /**
   * Copy a file
   */
  copy(sourcePath: string, destinationPath: string): Promise<void>;

  /**
   * Move a file
   */
  move(sourcePath: string, destinationPath: string): Promise<void>;

  /**
   * Get a signed URL for file access
   */
  getSignedUrl(path: string, expiresIn?: number): Promise<string>;

  /**
   * Get file stream for large files
   */
  getStream(path: string): Promise<NodeJS.ReadableStream>;

  /**
   * Store file from stream
   */
  storeStream(path: string, stream: NodeJS.ReadableStream, metadata?: Record<string, string>): Promise<void>;
}
