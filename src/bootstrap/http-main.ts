import {
    createXQoderEntrypoints,
} from './compose.js';
import type {
    HttpInterfaceServerOptions,
} from '../interfaces/http/index.js';

export function createHttpMain(options: HttpInterfaceServerOptions = {}) {
    const entrypoints = createXQoderEntrypoints();
    return entrypoints.createHttpServer(options);
}
