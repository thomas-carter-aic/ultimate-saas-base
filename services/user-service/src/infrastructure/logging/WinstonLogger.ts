/**
 * Winston Logger Implementation
 * 
 * Concrete implementation of Logger using Winston library.
 * Provides structured logging with OpenTelemetry integration
 * and support for multiple output formats and destinations.
 */

import winston from 'winston';
import { Logger, LogLevel, LoggingConfig } from '../../application/ports/Logger';
import { trace, context } from '@opentelemetry/api';

export class WinstonLogger implements Logger {
  private logger: winston.Logger;
  private contextData: Record<string, any> = {};

  constructor(config: LoggingConfig) {
    // Create Winston logger with configuration
    this.logger = winston.createLogger({
      level: config.level,
      format: this.createFormat(config),
      transports: this.createTransports(config),
      exitOnError: false,
      silent: false
    });

    // Add error handling
    this.logger.on('error', (error) => {
      console.error('Logger error:', error);
    });
  }

  /**
   * Log debug information
   */
  debug(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.DEBUG, message, meta);
  }

  /**
   * Log informational messages
   */
  info(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.INFO, message, meta);
  }

  /**
   * Log warning messages
   */
  warn(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.WARN, message, meta);
  }

  /**
   * Log error messages
   */
  error(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * Log fatal errors
   */
  fatal(message: string, meta?: Record<string, any>): void {
    this.log(LogLevel.FATAL, message, meta);
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, any>): Logger {
    const childLogger = new WinstonLogger({
      level: this.logger.level as LogLevel,
      format: 'json',
      destination: 'console'
    });
    
    childLogger.contextData = { ...this.contextData, ...context };
    return childLogger;
  }

  /**
   * Internal logging method with OpenTelemetry integration
   */
  private log(level: LogLevel, message: string, meta?: Record<string, any>): void {
    // Get current span for tracing context
    const span = trace.getActiveSpan();
    const traceContext = span ? {
      traceId: span.spanContext().traceId,
      spanId: span.spanContext().spanId
    } : {};

    // Combine all metadata
    const logData = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: 'user-service',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      ...traceContext,
      ...this.contextData,
      ...meta
    };

    // Log with Winston
    this.logger.log(level, message, logData);

    // Add log event to current span if available
    if (span) {
      span.addEvent('log', {
        'log.severity': level,
        'log.message': message,
        ...meta
      });
    }
  }

  /**
   * Create Winston format based on configuration
   */
  private createFormat(config: LoggingConfig): winston.Logform.Format {
    const formats: winston.Logform.Format[] = [
      winston.format.timestamp(),
      winston.format.errors({ stack: true })
    ];

    if (config.format === 'json') {
      formats.push(winston.format.json());
    } else {
      formats.push(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? 
            `\n${JSON.stringify(meta, null, 2)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      );
    }

    return winston.format.combine(...formats);
  }

  /**
   * Create Winston transports based on configuration
   */
  private createTransports(config: LoggingConfig): winston.transport[] {
    const transports: winston.transport[] = [];

    // Console transport
    if (config.destination === 'console' || config.destination === 'both') {
      transports.push(new winston.transports.Console({
        handleExceptions: true,
        handleRejections: true
      }));
    }

    // File transport
    if (config.destination === 'file' || config.destination === 'both') {
      const filename = config.filename || 'application.log';
      
      transports.push(new winston.transports.File({
        filename,
        handleExceptions: true,
        handleRejections: true,
        maxsize: this.parseSize(config.maxFileSize || '10MB'),
        maxFiles: config.maxFiles || 5,
        tailable: true
      }));

      // Separate error log file
      transports.push(new winston.transports.File({
        filename: filename.replace('.log', '.error.log'),
        level: 'error',
        handleExceptions: true,
        handleRejections: true,
        maxsize: this.parseSize(config.maxFileSize || '10MB'),
        maxFiles: config.maxFiles || 5,
        tailable: true
      }));
    }

    return transports;
  }

  /**
   * Parse file size string to bytes
   */
  private parseSize(sizeStr: string): number {
    const units: Record<string, number> = {
      'B': 1,
      'KB': 1024,
      'MB': 1024 * 1024,
      'GB': 1024 * 1024 * 1024
    };

    const match = sizeStr.match(/^(\d+)([A-Z]{1,2})$/i);
    if (!match) {
      return 10 * 1024 * 1024; // Default 10MB
    }

    const [, size, unit] = match;
    return parseInt(size, 10) * (units[unit.toUpperCase()] || 1);
  }
}
