import * as dotenv from 'dotenv';

dotenv.config({ path: '.env' });

import app from './app';

const PORT = process.env.PORT || 3000;

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

app.listen(PORT, () => {
    console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
    console.log(`Server is listening and ready to handle requests`);
}).on('error', (error) => {
    console.error('Server failed to start:', error);
    process.exit(1);
});
