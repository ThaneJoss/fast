import { register } from 'node:module';

register('./worker-loader.js', import.meta.url);
