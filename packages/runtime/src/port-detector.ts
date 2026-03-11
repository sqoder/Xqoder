// ============================================================
// 端口检测器
// ============================================================

import * as net from 'node:net';

/**
 * PortDetector
 * 检测端口占用状态，查找可用端口
 */
export class PortDetector {
    /**
     * 检测端口是否可用
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
     * 查找下一个可用端口
     * 从 startPort 开始向上搜索
     */
    async findAvailablePort(startPort: number = 3000, maxAttempts: number = 100): Promise<number> {
        for (let port = startPort; port < startPort + maxAttempts; port++) {
            if (await this.isPortAvailable(port)) {
                return port;
            }
        }
        throw new Error(`无法在 ${startPort}-${startPort + maxAttempts} 范围内找到可用端口`);
    }

    /**
     * 等待端口变为占用状态（即服务启动）
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
                // 端口被占用 = 服务已启动
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
