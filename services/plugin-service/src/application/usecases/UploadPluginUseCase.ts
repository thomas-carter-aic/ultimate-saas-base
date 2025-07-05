/**
 * Upload Plugin Use Case
 * 
 * Handles the upload and initial processing of plugin packages.
 * Validates plugin structure, extracts metadata, and initiates
 * the plugin validation workflow.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as unzipper from 'unzipper';
import * as tar from 'tar';
import { Plugin, PluginManifest } from '../../domain/entities/Plugin';
import { PluginRepository } from '../../domain/repositories/PluginRepository';
import { EventPublisher } from '../ports/EventPublisher';
import { Logger } from '../ports/Logger';
import { FileStorage } from '../ports/FileStorage';
import { PluginEventFactory } from '../../domain/events/PluginEvents';

export interface UploadPluginRequest {
  tenantId: string;
  userId: string;
  fileName: string;
  fileBuffer: Buffer;
  fileSize: number;
  mimeType: string;
}

export interface UploadPluginResponse {
  success: boolean;
  plugin?: Plugin;
  error?: string;
  validationErrors?: string[];
}

export class UploadPluginUseCase {
  constructor(
    private pluginRepository: PluginRepository,
    private eventPublisher: EventPublisher,
    private fileStorage: FileStorage,
    private logger: Logger
  ) {}

  async execute(request: UploadPluginRequest): Promise<UploadPluginResponse> {
    try {
      this.logger.info('Starting plugin upload', {
        tenantId: request.tenantId,
        userId: request.userId,
        fileName: request.fileName,
        fileSize: request.fileSize
      });

      // Validate input
      const inputValidation = this.validateInput(request);
      if (!inputValidation.isValid) {
        return {
          success: false,
          error: 'Invalid input',
          validationErrors: inputValidation.errors
        };
      }

      // Extract and validate plugin package
      const extractionResult = await this.extractPluginPackage(request);
      if (!extractionResult.success) {
        return {
          success: false,
          error: extractionResult.error,
          validationErrors: extractionResult.validationErrors
        };
      }

      const { manifest, files, tempDir } = extractionResult;

      // Check if plugin already exists
      const existingPlugin = await this.pluginRepository.findByNameAndVersion(
        manifest.metadata.name,
        manifest.metadata.version,
        request.tenantId
      );

      if (existingPlugin) {
        // Cleanup temp files
        await this.cleanupTempFiles(tempDir);
        
        return {
          success: false,
          error: `Plugin ${manifest.metadata.name}@${manifest.metadata.version} already exists`
        };
      }

      // Calculate checksum
      const checksum = this.calculateChecksum(request.fileBuffer);

      // Store plugin files
      const storageResult = await this.storePluginFiles(
        request.tenantId,
        manifest.metadata.name,
        manifest.metadata.version,
        request.fileBuffer,
        files,
        tempDir
      );

      if (!storageResult.success) {
        await this.cleanupTempFiles(tempDir);
        return {
          success: false,
          error: storageResult.error
        };
      }

      // Create plugin entity
      const plugin = Plugin.create(
        manifest,
        request.tenantId,
        request.userId
      );

      // Validate plugin
      const validation = plugin.validate();
      if (!validation.isValid) {
        await this.cleanupStoredFiles(storageResult.storagePath);
        await this.cleanupTempFiles(tempDir);
        
        return {
          success: false,
          error: 'Plugin validation failed',
          validationErrors: validation.errors
        };
      }

      // Save plugin to repository
      const savedPlugin = await this.pluginRepository.save(plugin);

      // Publish plugin uploaded event
      const uploadedEvent = PluginEventFactory.createPluginUploadedEvent(
        savedPlugin,
        request.fileSize,
        checksum
      );
      await this.eventPublisher.publish(uploadedEvent);

      // Cleanup temp files
      await this.cleanupTempFiles(tempDir);

      this.logger.info('Plugin uploaded successfully', {
        pluginId: savedPlugin.id,
        pluginName: savedPlugin.manifest.metadata.name,
        version: savedPlugin.manifest.metadata.version,
        tenantId: request.tenantId
      });

      return {
        success: true,
        plugin: savedPlugin
      };

    } catch (error) {
      this.logger.error('Error uploading plugin', error as Error, {
        tenantId: request.tenantId,
        userId: request.userId,
        fileName: request.fileName
      });

      return {
        success: false,
        error: 'Failed to upload plugin'
      };
    }
  }

  private validateInput(request: UploadPluginRequest): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.tenantId) {
      errors.push('Tenant ID is required');
    }

    if (!request.userId) {
      errors.push('User ID is required');
    }

    if (!request.fileName) {
      errors.push('File name is required');
    }

    if (!request.fileBuffer || request.fileBuffer.length === 0) {
      errors.push('File content is required');
    }

    if (request.fileSize > 50 * 1024 * 1024) { // 50MB limit
      errors.push('File size exceeds maximum limit of 50MB');
    }

    if (request.fileSize !== request.fileBuffer.length) {
      errors.push('File size mismatch');
    }

    const allowedMimeTypes = [
      'application/zip',
      'application/x-zip-compressed',
      'application/gzip',
      'application/x-gzip',
      'application/x-tar',
      'application/x-compressed-tar'
    ];

    if (!allowedMimeTypes.includes(request.mimeType)) {
      errors.push('Invalid file type. Only ZIP and TAR.GZ files are supported');
    }

    const allowedExtensions = ['.zip', '.tar.gz', '.tgz'];
    const hasValidExtension = allowedExtensions.some(ext => 
      request.fileName.toLowerCase().endsWith(ext)
    );

    if (!hasValidExtension) {
      errors.push('Invalid file extension. Only .zip, .tar.gz, and .tgz files are supported');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private async extractPluginPackage(request: UploadPluginRequest): Promise<{
    success: boolean;
    manifest?: PluginManifest;
    files?: string[];
    tempDir?: string;
    error?: string;
    validationErrors?: string[];
  }> {
    const tempDir = path.join('/tmp', `plugin-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`);
    
    try {
      // Create temp directory
      await fs.promises.mkdir(tempDir, { recursive: true });

      // Extract based on file type
      if (request.fileName.toLowerCase().endsWith('.zip')) {
        await this.extractZip(request.fileBuffer, tempDir);
      } else if (request.fileName.toLowerCase().endsWith('.tar.gz') || request.fileName.toLowerCase().endsWith('.tgz')) {
        await this.extractTarGz(request.fileBuffer, tempDir);
      } else {
        return {
          success: false,
          error: 'Unsupported archive format'
        };
      }

      // Find and validate manifest
      const manifestPath = path.join(tempDir, 'plugin.json');
      if (!fs.existsSync(manifestPath)) {
        return {
          success: false,
          error: 'Plugin manifest (plugin.json) not found in package root'
        };
      }

      // Read and parse manifest
      const manifestContent = await fs.promises.readFile(manifestPath, 'utf-8');
      let manifest: PluginManifest;
      
      try {
        manifest = JSON.parse(manifestContent);
      } catch (parseError) {
        return {
          success: false,
          error: 'Invalid plugin manifest JSON format'
        };
      }

      // Validate manifest structure
      const manifestValidation = this.validateManifest(manifest);
      if (!manifestValidation.isValid) {
        return {
          success: false,
          error: 'Invalid plugin manifest',
          validationErrors: manifestValidation.errors
        };
      }

      // Get list of files
      const files = await this.getFileList(tempDir);

      // Validate entry point exists
      const entryPointPath = path.join(tempDir, manifest.entryPoint);
      if (!fs.existsSync(entryPointPath)) {
        return {
          success: false,
          error: `Entry point file not found: ${manifest.entryPoint}`
        };
      }

      // Validate all declared files exist
      for (const file of manifest.files) {
        const filePath = path.join(tempDir, file);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: `Declared file not found: ${file}`
          };
        }
      }

      return {
        success: true,
        manifest,
        files,
        tempDir
      };

    } catch (error) {
      this.logger.error('Error extracting plugin package', error as Error);
      
      // Cleanup on error
      try {
        await this.cleanupTempFiles(tempDir);
      } catch (cleanupError) {
        this.logger.error('Error cleaning up temp files', cleanupError as Error);
      }

      return {
        success: false,
        error: 'Failed to extract plugin package'
      };
    }
  }

  private async extractZip(buffer: Buffer, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = require('stream');
      const bufferStream = new stream.PassThrough();
      bufferStream.end(buffer);

      bufferStream
        .pipe(unzipper.Extract({ path: targetDir }))
        .on('close', resolve)
        .on('error', reject);
    });
  }

  private async extractTarGz(buffer: Buffer, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = require('stream');
      const bufferStream = new stream.PassThrough();
      bufferStream.end(buffer);

      bufferStream
        .pipe(tar.extract({ cwd: targetDir, gzip: true }))
        .on('end', resolve)
        .on('error', reject);
    });
  }

  private validateManifest(manifest: any): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Required fields
    if (!manifest.metadata) {
      errors.push('Manifest must contain metadata section');
    } else {
      if (!manifest.metadata.name) errors.push('Plugin name is required');
      if (!manifest.metadata.version) errors.push('Plugin version is required');
      if (!manifest.metadata.description) errors.push('Plugin description is required');
      if (!manifest.metadata.author) errors.push('Plugin author is required');
      if (!manifest.metadata.category) errors.push('Plugin category is required');
    }

    if (!manifest.dependencies) {
      errors.push('Manifest must contain dependencies section');
    } else {
      if (!manifest.dependencies.platform) errors.push('Platform version requirement is required');
      if (!manifest.dependencies.node) errors.push('Node.js version requirement is required');
    }

    if (!manifest.security) {
      errors.push('Manifest must contain security section');
    } else {
      if (!manifest.security.resourceLimits) errors.push('Resource limits are required');
      if (typeof manifest.security.sandbox !== 'boolean') errors.push('Sandbox setting is required');
    }

    if (!manifest.entryPoint) {
      errors.push('Entry point is required');
    }

    if (!manifest.files || !Array.isArray(manifest.files)) {
      errors.push('Files list is required');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  private async getFileList(dir: string): Promise<string[]> {
    const files: string[] = [];
    
    const walk = async (currentDir: string, relativePath: string = '') => {
      const entries = await fs.promises.readdir(currentDir, { withFileTypes: true });
      
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        const relativeFilePath = path.join(relativePath, entry.name);
        
        if (entry.isDirectory()) {
          await walk(fullPath, relativeFilePath);
        } else {
          files.push(relativeFilePath);
        }
      }
    };

    await walk(dir);
    return files;
  }

  private calculateChecksum(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }

  private async storePluginFiles(
    tenantId: string,
    pluginName: string,
    version: string,
    packageBuffer: Buffer,
    files: string[],
    tempDir: string
  ): Promise<{ success: boolean; storagePath?: string; error?: string }> {
    try {
      const storagePath = `plugins/${tenantId}/${pluginName}/${version}`;
      
      // Store the original package
      await this.fileStorage.store(`${storagePath}/package.zip`, packageBuffer);
      
      // Store individual files
      for (const file of files) {
        const filePath = path.join(tempDir, file);
        const fileBuffer = await fs.promises.readFile(filePath);
        await this.fileStorage.store(`${storagePath}/files/${file}`, fileBuffer);
      }

      return {
        success: true,
        storagePath
      };

    } catch (error) {
      this.logger.error('Error storing plugin files', error as Error);
      return {
        success: false,
        error: 'Failed to store plugin files'
      };
    }
  }

  private async cleanupTempFiles(tempDir: string): Promise<void> {
    try {
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      this.logger.error('Error cleaning up temp files', error as Error, { tempDir });
    }
  }

  private async cleanupStoredFiles(storagePath: string): Promise<void> {
    try {
      await this.fileStorage.delete(storagePath);
    } catch (error) {
      this.logger.error('Error cleaning up stored files', error as Error, { storagePath });
    }
  }
}
