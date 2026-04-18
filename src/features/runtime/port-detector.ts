// ============================================================
// Port Detector
// ============================================================

import * as net from 'node:net';

/**
 * PortDetector
 * Detects port occupancy and finds available ports
 */
export class PortDetector {
    /**
     * Checks if a port is available
     */
    async isPortAvailable(port: number, host: string = '127.0.0.1'): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(port, host);
        });
    }

    /**
     * Finds the next available port
     * Searches upward from startPort
     */
    async findAvailablePort(startPort: number = 3000, maxAttempts: number = 100): Promise<number> {
        for (let port = startPort; port < startPort + maxAttempts; port++) {
            if (await this.isPortAvailable(port)) {
                return port;
            }
        }
        throw new Error(`Could not find an available port in the range ${startPort}-${startPort + maxAttempts}`);
    }

    /**
     * Waits for a port to become occupied (i.e., service has started)
     */
    async waitForPort(
        port: number,
        host: string = '127.0.0.1',
        timeout: number = 30000,
        interval: number = 500,
    ): Promise<boolean> {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const available = await this.isPortAvailable(port, host);
            if (!available) {
                // Port occupied = service started
                return true;
            }
            await this.sleep(interval);
        }
        return false;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}
