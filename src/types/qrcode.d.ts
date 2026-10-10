// Só o pedaço da lib "qrcode" que o front usa (o pacote não traz tipos).
declare module "qrcode" {
  export interface OpcoesQrCode {
    type?: "svg" | "utf8" | "terminal";
    margin?: number;
    width?: number;
    errorCorrectionLevel?: "L" | "M" | "Q" | "H";
    color?: { dark?: string; light?: string };
  }
  export function toString(texto: string, opcoes?: OpcoesQrCode): Promise<string>;
  const QRCode: { toString: typeof toString };
  export default QRCode;
}
