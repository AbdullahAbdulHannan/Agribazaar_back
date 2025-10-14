const winston = require('winston');
const { combine, timestamp, printf, colorize, align } = winston.format;

// Define log format
const logFormat = printf(({ level, message, timestamp, stack }) => {
    const log = `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
    return log;
});

// Create logger instance
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: combine(
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        colorize({ all: true }),
        align(),
        logFormat
    ),
    transports: [
        // Write all logs with level `error` and below to `error.log`
        ...(process.env.VERCEL === '1' ? [] : [
            new winston.transports.File({ 
                filename: 'logs/error.log', 
                level: 'error',
                maxsize: 5 * 1024 * 1024, // 5MB
                maxFiles: 5,
                tailable: true
            }),
        ]),
        // Write all logs with level `info` and below to `combined.log`
        ...(process.env.VERCEL === '1' ? [] : [
            new winston.transports.File({ 
                filename: 'logs/combined.log',
                maxsize: 10 * 1024 * 1024, // 10MB
                maxFiles: 5,
                tailable: true
            })
        ])
    ]
});

// If we're not in production, log to the console as well
if (process.env.NODE_ENV !== 'production') {
    logger.add(new winston.transports.Console({
        format: combine(
            timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
            colorize({ all: true }),
            align(),
            logFormat
        )
    }));
}

module.exports = logger;
