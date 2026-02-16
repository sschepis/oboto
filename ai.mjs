// Simple working AI Assistant Entry Point
import { main } from './src/main.mjs';

// Execute main function
main().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});