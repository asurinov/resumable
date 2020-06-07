import { ResumableChunk } from './chunk';
import { Resumable } from './resumable';
import { Helper } from './helper';

export class ResumableFile {
  opts: any;
  _prevProgress = 0;
  resumableObj;
  file;
  fileName;
  size;
  relativePath;
  uniqueIdentifier;
  _pause;
  container = '';

  chunks: ResumableChunk[];

  _error;

  private getOpt;

  constructor(resumableObj: Resumable, file, uniqueIdentifier) {
    this.opts = {};
    this._prevProgress = 0;
    this.resumableObj = resumableObj;
    this.file = file;
    this.fileName = file.fileName || file.name; // Some confusion in different versions of Firefox
    this.size = file.size;
    this.relativePath = file.relativePath || file.webkitRelativePath || this.fileName;
    this.uniqueIdentifier = uniqueIdentifier;
    this._pause = false;
    this.container = '';
    this._error = uniqueIdentifier !== undefined;
    this.getOpt = resumableObj.getOpt;

    // Main code to set up a file object with chunks,
    // packaged to be able to handle retries if needed.
    this.chunks = [];

    // Bootstrap and return
    this.resumableObj.fire('chunkingStart', this);
    this.bootstrap();
  }

  // Callback when something happens within the chunk
  chunkEvent(event, message) {
    // event can be 'progress', 'success', 'error' or 'retry'
    switch (event) {
      case 'progress':
        this.resumableObj.fire('fileProgress', this, message);
        break;
      case 'error':
        this.abort();
        this._error = true;
        this.chunks = [];
        this.resumableObj.fire('fileError', this, message);
        break;
      case 'success':
        if (this._error) return;
        this.resumableObj.fire('fileProgress', this); // it's at least progress
        if (this.isComplete()) {
          this.resumableObj.fire('fileSuccess', this, message);
        }
        break;
      case 'retry':
        this.resumableObj.fire('fileRetry', this);
        break;
    }
  }

  abort() {
    // Stop current uploads
    let abortCount = 0;
    Helper.each(this.chunks, c => {
      if (c.status() === 'uploading') {
        c.abort();
        abortCount++;
      }
    });
    if (abortCount > 0) this.resumableObj.fire('fileProgress', this);
  }

  cancel() {
    // Reset this file to be void
    let _chunks = this.chunks;
    this.chunks = [];
    // Stop current uploads
    Helper.each(_chunks, c => {
      if (c.status() === 'uploading') {
        c.abort();
        this.resumableObj.uploadNextChunk();
      }
    });
    this.resumableObj.removeFile(this);
    this.resumableObj.fire('fileProgress', this);
  }

  retry() {
    this.bootstrap();
    let firedRetry = false;
    this.resumableObj.on('chunkingComplete', () => {
      if (!firedRetry) this.resumableObj.upload();
      firedRetry = true;
    });
  }

  bootstrap() {
    this.abort();
    this._error = false;
    // Rebuild stack of chunks from file
    this.chunks = [];
    this._prevProgress = 0;
    const round = this.getOpt('forceChunkSize') ? Math.ceil : Math.floor;
    const maxOffset = Math.max(round(this.file.size / this.getOpt('chunkSize')), 1);

    for (let offset = 0; offset < maxOffset; offset++) {
      window.setTimeout(() => {
        this.chunks.push(
          new ResumableChunk(this.resumableObj, this, offset, this.chunkEvent.bind(this))
        );
        this.resumableObj.fire('chunkingProgress', this, offset / maxOffset);
      }, 0);
    }
    window.setTimeout(() => {
      this.resumableObj.fire('chunkingComplete', this);
    }, 0);
  }

  progress() {
    if (this._error) return 1;
    // Sum up progress across everything
    let ret = 0;
    let error = false;
    Helper.each(this.chunks, c => {
      if (c.status() === 'error') error = true;
      ret += c.progress(true); // get chunk progress relative to entire file
    });
    ret = error ? 1 : ret > 0.99999 ? 1 : ret;
    ret = Math.max(this._prevProgress, ret); // We don't want to lose percentages when an upload is paused
    this._prevProgress = ret;
    return ret;
  }

  isUploading() {
    let uploading = false;
    Helper.each(this.chunks, (chunk: ResumableChunk) => {
      if (chunk.status() === 'uploading') {
        uploading = true;
        return false;
      }
    });
    return uploading;
  }

  isComplete() {
    let outstanding = false;
    Helper.each(this.chunks, chunk => {
      const status = chunk.status();
      if (status === 'pending' || status === 'uploading' || chunk.preprocessState === 1) {
        outstanding = true;
        return false;
      }
    });
    return !outstanding;
  }

  pause(pause) {
    if (typeof pause === 'undefined') {
      this._pause = this._pause ? false : true;
    } else {
      this._pause = pause;
    }
  }

  isPaused() {
    return this._pause;
  }
}
