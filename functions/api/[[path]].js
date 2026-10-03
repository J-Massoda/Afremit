import { handleApi } from '../../src/api.mjs';
export const onRequest = ({ request, env }) => handleApi(request, env);
