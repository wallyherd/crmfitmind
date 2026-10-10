import { criarApp } from "./app.js";

// Monta o app com o Supabase do ambiente. Quem escuta porta é o server/local.ts;
// na Vercel o api/index.ts exporta este app como função.
const app = criarApp();

export default app;
export { app };
