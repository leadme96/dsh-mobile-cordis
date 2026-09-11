declare module 'qrcode-terminal' {
  interface QRCodeTerminal {
    generate(text: string, options?: { small?: boolean }, callback?: (qrcode: string) => void): void;
    generate(text: string, callback: (qrcode: string) => void): void;
  }
  const qrcodeTerminal: QRCodeTerminal;
  export default qrcodeTerminal;
}
