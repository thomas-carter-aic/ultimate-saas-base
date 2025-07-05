/**
 * Logger Port
 * 
 * Interface for structured logging throughout the application.
 * This port allows the application to remain independent of the
 * specific logging implementation (Winston, Bunyan, etc.).
 */

export interface Logger {
  /**
   * Log debug information
   * 
   * @param message - Log message
   * @param meta - Additional metadata
   */
  debug(message: string, meta?: Record<string, any>): void;

  /**
   * Log informational messages
   * 
   * @param message - Log message
   * @param meta - Additional metadata
   */
  info(message: string, meta?: Record<string, any>): void;

  /**
   * Log warning messages
   * 
   * @param message - Log message
   * @param meta - Additional metadata
   */
  warn(message: string, meta?: Record<string, any>): void;

  /**
   * Log error messages
   * 
   * @param message - Log message
   * @param meta - Additional metadata including error details
   */
  error(message: string, meta?: Record<string, any>): void;

  /**
   * Log fatal errors
   * 
   * @param message - Log message
   * @param meta - Additional metadata including error details
   */
  fatal(message: string, meta?: Record<string, any>): void;

  /**
   * Create a child logger with additional context
   * 
   * @param context - Additional context to include in all log messages
   * @returns New logger instance with context
   */
  child(context: Record<string, any>): Logger;
}

/**
 * Log levels enumeration
 */
export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error',
  FATAL = 'fatal'
}

/**
 * Logging configuration
 */
export interface LoggingConfig {
  level: LogLevel;
  format: 'json' | 'text';
  destination: 'console' | 'file' | 'both';
  filename?: string;
  maxFileSize?: string;
  maxFiles?: number;
  enableTracing?: boolean;
  enableMetrics?: boolean;
}
