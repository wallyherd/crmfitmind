import "dotenv/config";
import { criarApp } from "./app.js";

const porta = Number(process.env.PORT) || 3000;

criarApp().listen(porta, () => {
  console.log(`API do CRM em http://localhost:${porta}`);
});
