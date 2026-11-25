// Minimal declarations for the adm-zip surface the services use.
declare module "adm-zip" {
  interface IZipEntry {
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  }
  class AdmZip {
    constructor(input?: string | Buffer);
    getEntries(): IZipEntry[];
    addFile(entryName: string, content: Buffer): void;
    addLocalFile(localPath: string, zipPath?: string, zipName?: string): void;
    writeZip(targetFileName: string): void;
    toBuffer(): Buffer;
  }
  export default AdmZip;
}
