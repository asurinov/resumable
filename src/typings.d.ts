interface Blob {
  webkitSlice(start?: number, end?: number, contentType?: string): Blob;
  mozSlice(start?: number, end?: number, contentType?: string): Blob;
}

interface File {
  relativePath: string;
}