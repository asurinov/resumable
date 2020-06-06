export class Resumable {
  private defaults: any;
  opts: any;
  private events: any[] = [];

  files: ResumableFile[] = [];

  constructor(opts: any) {
    // PROPERTIES
    this.files = [];
    this.defaults = {
      chunkSize: 1 * 1024 * 1024,
      forceChunkSize: false,
      simultaneousUploads: 3,
      fileParameterName: 'file',
      chunkNumberParameterName: 'resumableChunkNumber',
      chunkSizeParameterName: 'resumableChunkSize',
      currentChunkSizeParameterName: 'resumableCurrentChunkSize',
      totalSizeParameterName: 'resumableTotalSize',
      typeParameterName: 'resumableType',
      identifierParameterName: 'resumableIdentifier',
      fileNameParameterName: 'resumableFilename',
      relativePathParameterName: 'resumableRelativePath',
      totalChunksParameterName: 'resumableTotalChunks',
      throttleProgressCallbacks: 0.5,
      query: {},
      headers: {},
      preprocess: null,
      method: 'multipart',
      uploadMethod: 'POST',
      testMethod: 'GET',
      prioritizeFirstAndLastChunk: false,
      target: '/',
      testTarget: null,
      parameterNamespace: '',
      testChunks: true,
      generateUniqueIdentifier: null,
      getTarget: null,
      maxChunkRetries: 100,
      chunkRetryInterval: undefined,
      permanentErrors: [400, 404, 415, 500, 501],
      maxFiles: undefined,
      withCredentials: false,
      xhrTimeout: 0,
      clearInput: true,
      chunkFormat: 'blob',
      setChunkTypeFromFile: false,
      minFileSize: 1,
      maxFileSize: undefined,
      fileType: []
    };

    this.opts = opts || {};

    // EVENTS
    // catchAll(event, ...)
    // fileSuccess(file), fileProgress(file), fileAdded(file, event), filesAdded(files, filesSkipped), fileRetry(file),
    // fileError(file, message), complete(), progress(), error(message, file), pause()
    this.events = [];
  }

  getOpt(o) {
    let $opt = this;
    // Get multiple option if passed an array
    if (o instanceof Array) {
      const options = {};
      Helper.each(o, option => {
        options[option] = $opt.getOpt(option);
      });
      return options;
    }
    // Otherwise, just return a simple option
    if ($opt instanceof ResumableChunk) {
      if (typeof $opt.opts[o] !== 'undefined') {
        return $opt.opts[o];
      } else {
        $opt = $opt.fileObj;
      }
    }
    if ($opt instanceof ResumableFile) {
      if (typeof $opt.opts[o] !== 'undefined') {
        return $opt.opts[o];
      } else {
        $opt = $opt.resumableObj;
      }
    }
    if ($opt instanceof Resumable) {
      if (typeof $opt.opts[o] !== 'undefined') {
        return $opt.opts[o];
      } else {
        return $opt.defaults[o];
      }
    }
  }

  on(event, callback) {
    this.events.push(event.toLowerCase(), callback);
  }

  private fire(...args: any[]) {
    // Find event listeners, and support pseudo-event `catchAll`
    const event = args[0].toLowerCase();
    for (let i = 0; i <= this.events.length; i += 2) {
      if (this.events[i] === event) this.events[i + 1].apply(this, args.slice(1));
      if (this.events[i] === 'catchall') this.events[i + 1].apply(null, args);
    }
    if (event === 'fileerror') this.fire('error', args[2], args[1]);
    if (event === 'fileprogress') this.fire('progress');
  }

  private onDrop(event) {
    Helper.stopEvent(event);

    // handle dropped things as items if we can (this lets us deal with folders nicer in some cases)
    if (event.dataTransfer && event.dataTransfer.items) {
      this.loadFiles(event.dataTransfer.items, event);
    }
    // else handle them as files
    else if (event.dataTransfer && event.dataTransfer.files) {
      this.loadFiles(event.dataTransfer.files, event);
    }
  }

  private preventDefault(e) {
    e.preventDefault();
  }

  /**
   * processes a single upload item (file or directory)
   * @param {Object} item item to upload, may be file or directory entry
   * @param {string} path current file path
   * @param {File[]} items list of files to append new items to
   * @param {Function} cb callback invoked when item is processed
   */
  private processItem(item, path, items, cb) {
    let entry;
    if (item.isFile) {
      // file provided
      return item.file(function(file) {
        file.relativePath = path + file.name;
        items.push(file);
        cb();
      });
    } else if (item.isDirectory) {
      // item is already a directory entry, just assign
      entry = item;
    } else if (item instanceof File) {
      items.push(item);
    }
    if ('function' === typeof item.webkitGetAsEntry) {
      // get entry from file object
      entry = item.webkitGetAsEntry();
    }
    if (entry && entry.isDirectory) {
      // directory provided, process it
      return this.processDirectory(entry, path + entry.name + '/', items, cb);
    }
    if ('function' === typeof item.getAsFile) {
      // item represents a File object, convert it
      item = item.getAsFile();
      if (item instanceof File) {
        item.relativePath = path + item.name;
        items.push(item);
      }
    }
    cb(); // indicate processing is done
  }

  /**
   * cps-style list iteration.
   * invokes all functions in list and waits for their callback to be
   * triggered.
   * @param  {Function[]}   items list of functions expecting callback parameter
   * @param  {Function} cb    callback to trigger after the last callback has been invoked
   */
  private processCallbacks(items, cb) {
    if (!items || items.length === 0) {
      // empty or no list, invoke callback
      return cb();
    }
    // invoke current function, pass the next part as continuation
    items[0](() => {
      this.processCallbacks(items.slice(1), cb);
    });
  }

  /**
   * recursively traverse directory and collect files to upload
   * @param  {Object}   directory directory to process
   * @param  {string}   path      current path
   * @param  {File[]}   items     target list of items
   * @param  {Function} cb        callback invoked after traversing directory
   */
  private processDirectory(directory, path, items, cb) {
    const dirReader = directory.createReader();
    dirReader.readEntries(entries => {
      if (!entries.length) {
        // empty directory, skip
        return cb();
      }
      // process all conversion callbacks, finally invoke own one
      this.processCallbacks(
        entries.map(entry => {
          // bind all properties except for callback
          return this.processItem.bind(null, entry, path, items);
        }),
        cb
      );
    });
  }

  /**
   * process items to extract files to be uploaded
   * @param  {File[]} items items to process
   * @param  {Event} event event that led to upload
   */
  private loadFiles(items, event) {
    if (!items.length) {
      return; // nothing to do
    }
    this.fire('beforeAdd');
    let files = [];
    this.processCallbacks(
      Array.prototype.map.call(items, item => {
        // bind all properties except for callback
        return this.processItem.bind(null, item, '', files);
      }),
      () => {
        if (files.length) {
          // at least one file found
          this.appendFilesFromFileList(files, event);
        }
      }
    );
  }

  private appendFilesFromFileList(fileList, event) {
    // check for uploading too many files
    let errorCount = 0;
    const o = this.getOpt([
      'maxFiles',
      'minFileSize',
      'maxFileSize',
      'maxFilesErrorCallback',
      'minFileSizeErrorCallback',
      'maxFileSizeErrorCallback',
      'fileType',
      'fileTypeErrorCallback'
    ]);
    if (typeof o.maxFiles !== 'undefined' && o.maxFiles < fileList.length + this.files.length) {
      // if single-file upload, file is already added, and trying to add 1 new file, simply replace the already-added file
      if (o.maxFiles === 1 && this.files.length === 1 && fileList.length === 1) {
        this.removeFile(this.files[0]);
      } else {
        o.maxFilesErrorCallback(fileList, errorCount++);
        return false;
      }
    }
    let files: ResumableFile[] = [];
    let filesSkipped: ResumableFile[] = [];
    let remaining = fileList.length;
    const decreaseReamining = () => {
      if (!--remaining) {
        // all files processed, trigger event
        if (!files.length && !filesSkipped.length) {
          // no succeeded files, just skip
          return;
        }
        window.setTimeout(() => {
          this.fire('filesAdded', files, filesSkipped);
        }, 0);
      }
    };

    Helper.each(fileList, file => {
      const fileName = file.name;
      if (o.fileType.length > 0) {
        let fileTypeFound = false;
        for (let index in o.fileType) {
          const extension = '.' + o.fileType[index];
          if (
            fileName
              .toLowerCase()
              .indexOf(extension.toLowerCase(), fileName.length - extension.length) !== -1
          ) {
            fileTypeFound = true;
            break;
          }
        }
        if (!fileTypeFound) {
          o.fileTypeErrorCallback(file, errorCount++);
          return false;
        }
      }

      if (typeof o.minFileSize !== 'undefined' && file.size < o.minFileSize) {
        o.minFileSizeErrorCallback(file, errorCount++);
        return false;
      }
      if (typeof o.maxFileSize !== 'undefined' && file.size > o.maxFileSize) {
        o.maxFileSizeErrorCallback(file, errorCount++);
        return false;
      }

      const addFile = uniqueIdentifier => {
        if (!this.getFromUniqueIdentifier(uniqueIdentifier)) {
          (() => {
            file.uniqueIdentifier = uniqueIdentifier;
            const f = new ResumableFile(this, file, uniqueIdentifier);
            this.files.push(f);
            files.push(f);
            f.container = typeof event !== 'undefined' ? event.srcElement : null;
            window.setTimeout(() => {
              this.fire('fileAdded', f, event);
            }, 0);
          })();
        } else {
          filesSkipped.push(file);
        }
        decreaseReamining();
      };
      // directories have size == 0
      const customUniqueIdentifierFn = this.getOpt('generateUniqueIdentifier');

      const uniqueIdentifier = Helper.generateUniqueIdentifier(
        file,
        event,
        customUniqueIdentifierFn
      );
      if (uniqueIdentifier && typeof uniqueIdentifier.then === 'function') {
        // Promise or Promise-like object provided as unique identifier
        uniqueIdentifier.then(
          uniqueIdentifier => {
            // unique identifier generation succeeded
            addFile(uniqueIdentifier);
          },
          () => {
            // unique identifier generation failed
            // skip further processing, only decrease file count
            decreaseReamining();
          }
        );
      } else {
        // non-Promise provided as unique identifier, process synchronously
        addFile(uniqueIdentifier);
      }
    });
  }

  // QUEUE
  private uploadNextChunk() {
    let found = false;

    // In some cases (such as videos) it's really handy to upload the first
    // and last chunk of a file quickly; this let's the server check the file's
    // metadata and determine if there's even a point in continuing.
    if (this.getOpt('prioritizeFirstAndLastChunk')) {
      Helper.each(this.files, file => {
        if (
          file.chunks.length &&
          file.chunks[0].status() === 'pending' &&
          file.chunks[0].preprocessState === 0
        ) {
          file.chunks[0].send();
          found = true;
          return false;
        }
        if (
          file.chunks.length > 1 &&
          file.chunks[file.chunks.length - 1].status() === 'pending' &&
          file.chunks[file.chunks.length - 1].preprocessState === 0
        ) {
          file.chunks[file.chunks.length - 1].send();
          found = true;
          return false;
        }
      });
      if (found) return true;
    }

    // Now, simply look for the next, best thing to upload
    Helper.each(this.files, file => {
      if (file.isPaused() === false) {
        Helper.each(file.chunks, chunk => {
          if (chunk.status() === 'pending' && chunk.preprocessState === 0) {
            chunk.send();
            found = true;
            return false;
          }
        });
      }
      if (found) return false;
    });
    if (found) return true;

    // The are no more outstanding chunks to upload, check is everything is done
    let outstanding = false;
    Helper.each(this.files, file => {
      if (!file.isComplete()) {
        outstanding = true;
        return false;
      }
    });
    if (!outstanding) {
      // All chunks have been uploaded, complete
      this.fire('complete');
    }
    return false;
  }

  // PUBLIC METHODS FOR RESUMABLE.JS
  assignBrowse(domNodes, isDirectory) {
    if (typeof domNodes.length === 'undefined') domNodes = [domNodes];

    Helper.each(domNodes, domNode => {
      let input;
      if (domNode.tagName === 'INPUT' && domNode.type === 'file') {
        input = domNode;
      } else {
        input = document.createElement('input');
        input.setAttribute('type', 'file');
        input.style.display = 'none';
        domNode.addEventListener(
          'click',
          () => {
            input.style.opacity = 0;
            input.style.display = 'block';
            input.focus();
            input.click();
            input.style.display = 'none';
          },
          false
        );
        domNode.appendChild(input);
      }
      const maxFiles = this.getOpt('maxFiles');
      if (typeof maxFiles === 'undefined' || maxFiles !== 1) {
        input.setAttribute('multiple', 'multiple');
      } else {
        input.removeAttribute('multiple');
      }
      if (isDirectory) {
        input.setAttribute('webkitdirectory', 'webkitdirectory');
      } else {
        input.removeAttribute('webkitdirectory');
      }
      const fileTypes = this.getOpt('fileType');
      if (typeof fileTypes !== 'undefined' && fileTypes.length >= 1) {
        input.setAttribute(
          'accept',
          fileTypes
            .map(e => {
              return '.' + e;
            })
            .join(',')
        );
      } else {
        input.removeAttribute('accept');
      }
      // When new files are added, simply append them to the overall list
      input.addEventListener(
        'change',
        e => {
          this.appendFilesFromFileList(e.target.files, e);
          const clearInput = this.getOpt('clearInput');
          if (clearInput) {
            e.target.value = '';
          }
        },
        false
      );
    });
  }

  assignDrop(domNodes) {
    if (typeof domNodes.length === 'undefined') domNodes = [domNodes];

    Helper.each(domNodes, domNode => {
      domNode.addEventListener('dragover', this.preventDefault, false);
      domNode.addEventListener('dragenter', this.preventDefault, false);
      domNode.addEventListener('drop', this.onDrop, false);
    });
  }

  unAssignDrop(domNodes) {
    if (typeof domNodes.length === 'undefined') domNodes = [domNodes];

    Helper.each(domNodes, domNode => {
      domNode.removeEventListener('dragover', this.preventDefault);
      domNode.removeEventListener('dragenter', this.preventDefault);
      domNode.removeEventListener('drop', this.onDrop);
    });
  }

  isUploading() {
    let uploading = false;
    Helper.each(this.files, (file: ResumableFile) => {
      if (file.isUploading()) {
        uploading = true;
        return false;
      }
    });
    return uploading;
  }

  upload() {
    // Make sure we don't start too many uploads at once
    if (this.isUploading()) return;
    // Kick off the queue
    this.fire('uploadStart');
    for (let num = 1; num <= this.getOpt('simultaneousUploads'); num++) {
      this.uploadNextChunk();
    }
  }

  pause() {
    // Resume all chunks currently being uploaded
    Helper.each(this.files, file => {
      file.abort();
    });
    this.fire('pause');
  }

  cancel() {
    this.fire('beforeCancel');
    for (let i = this.files.length - 1; i >= 0; i--) {
      this.files[i].cancel();
    }
    this.fire('cancel');
  }

  progress() {
    let totalDone = 0;
    let totalSize = 0;
    // Resume all chunks currently being uploaded
    Helper.each(this.files, file => {
      totalDone += file.progress() * file.size;
      totalSize += file.size;
    });
    return totalSize > 0 ? totalDone / totalSize : 0;
  }

  addFile(file, event) {
    this.appendFilesFromFileList([file], event);
  }

  addFiles(files, event) {
    this.appendFilesFromFileList(files, event);
  }

  removeFile(file) {
    for (let i = this.files.length - 1; i >= 0; i--) {
      if (this.files[i] === file) {
        this.files.splice(i, 1);
      }
    }
  }

  reset() {
    if (this.isUploading()) {
      return;
    }

    this.files = [];
  }

  getFromUniqueIdentifier(uniqueIdentifier) {
    let ret = false;
    Helper.each(this.files, f => {
      if (f.uniqueIdentifier === uniqueIdentifier) ret = f;
    });
    return ret;
  }

  getSize() {
    let totalSize = 0;
    Helper.each(this.files, file => {
      totalSize += file.size;
    });
    return totalSize;
  }

  handleDropEvent(e) {
    this.onDrop(e);
  }

  handleChangeEvent(e) {
    this.appendFilesFromFileList(e.target.files, e);
    e.target.value = '';
  }

  updateQuery(query) {
    this.opts.query = query;
  }

  maxFilesErrorCallback(files, errorCount) {
    const maxFiles = this.getOpt('maxFiles');
    alert(
      'Please upload no more than ' +
        maxFiles +
        ' file' +
        (maxFiles === 1 ? '' : 's') +
        ' at a time.'
    );
  }

  minFileSizeErrorCallback(file, errorCount) {
    alert(
      file.fileName ||
        file.name +
          ' is too small, please upload files larger than ' +
          Helper.formatSize(this.getOpt('minFileSize')) +
          '.'
    );
  }

  maxFileSizeErrorCallback(file, errorCount) {
    alert(
      file.fileName ||
        file.name +
          ' is too large, please upload files less than ' +
          Helper.formatSize(this.getOpt('maxFileSize')) +
          '.'
    );
  }

  fileTypeErrorCallback(file, errorCount) {
    alert(
      file.fileName ||
        file.name +
          ' has type not allowed, please upload files of type ' +
          this.getOpt('fileType') +
          '.'
    );
  }
}

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

class ResumableChunk {
  opts: any;
  resumableObj;
  fileObj;
  fileObjSize;
  fileObjType;
  offset;
  callback;
  lastProgressCallback;
  tested;
  retries;
  pendingRetry;
  preprocessState;

  loaded;
  startByte;
  endByte;
  xhr: XMLHttpRequest;

  private getOpt;

  constructor(resumableObj, fileObj, offset, callback) {
    this.opts = {};
    this.getOpt = resumableObj.getOpt;
    this.resumableObj = resumableObj;
    this.fileObj = fileObj;
    this.fileObjSize = fileObj.size;
    this.fileObjType = fileObj.file.type;
    this.offset = offset;
    this.callback = callback;
    this.lastProgressCallback = new Date();
    this.tested = false;
    this.retries = 0;
    this.pendingRetry = false;
    this.preprocessState = 0; // 0 = unprocessed, 1 = processing, 2 = finished

    // Computed properties
    const chunkSize = this.getOpt('chunkSize');
    this.loaded = 0;
    this.startByte = this.offset * chunkSize;
    this.endByte = Math.min(this.fileObjSize, (this.offset + 1) * chunkSize);
    if (this.fileObjSize - this.endByte < chunkSize && !this.getOpt('forceChunkSize')) {
      // The last chunk will be bigger than the chunk size, but less than 2*chunkSize
      this.endByte = this.fileObjSize;
    }
    this.xhr = null as any;
  }

  // test() makes a GET request without any data to see if the chunk has already been uploaded in a previous session
  test() {
    // Set up request and listen for event
    this.xhr = new XMLHttpRequest();

    const testHandler = e => {
      this.tested = true;
      const status = this.status();
      if (status === 'success') {
        this.callback(status, this.message());
        this.resumableObj.uploadNextChunk();
      } else {
        this.send();
      }
    };

    this.xhr.addEventListener('load', testHandler, false);
    this.xhr.addEventListener('error', testHandler, false);
    this.xhr.addEventListener('timeout', testHandler, false);

    // Add data from the query options
    let params: string[] = [];
    const parameterNamespace = this.getOpt('parameterNamespace');
    let customQuery = this.getOpt('query');
    if (typeof customQuery === 'function') customQuery = customQuery(this.fileObj, this);
    Helper.each(customQuery, (k, v) => {
      params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join('='));
    });
    // Add extra data to identify chunk
    params = params.concat(
      [
        // define key/value pairs for additional parameters
        ['chunkNumberParameterName', this.offset + 1],
        ['chunkSizeParameterName', this.getOpt('chunkSize')],
        ['currentChunkSizeParameterName', this.endByte - this.startByte],
        ['totalSizeParameterName', this.fileObjSize],
        ['typeParameterName', this.fileObjType],
        ['identifierParameterName', this.fileObj.uniqueIdentifier],
        ['fileNameParameterName', this.fileObj.fileName],
        ['relativePathParameterName', this.fileObj.relativePath],
        ['totalChunksParameterName', this.fileObj.chunks.length]
      ]
        .filter(pair => {
          // include items that resolve to truthy values
          // i.e. exclude false, null, undefined and empty strings
          return this.getOpt(pair[0]);
        })
        .map(pair => {
          // map each key/value pair to its final form
          return [parameterNamespace + this.getOpt(pair[0]), encodeURIComponent(pair[1])].join('=');
        })
    );
    // Append the relevant chunk and send it
    const target = this.getOpt('target');
    const testTarget = this.getOpt('testTarget');

    this.xhr.open(this.getOpt('testMethod'), Helper.getTarget('test', params, target, testTarget));
    this.xhr.timeout = this.getOpt('xhrTimeout');
    this.xhr.withCredentials = this.getOpt('withCredentials');
    // Add data from header options
    let customHeaders = this.getOpt('headers');
    if (typeof customHeaders === 'function') {
      customHeaders = customHeaders(this.fileObj, this);
    }
    Helper.each(customHeaders, (k, v) => {
      this.xhr.setRequestHeader(k, v);
    });
    this.xhr.send(null);
  }

  preprocessFinished() {
    this.preprocessState = 2;
    this.send();
  }

  // send() uploads the actual data in a POST call
  send() {
    const preprocess = this.getOpt('preprocess');
    if (typeof preprocess === 'function') {
      switch (this.preprocessState) {
        case 0:
          this.preprocessState = 1;
          preprocess(this);
          return;
        case 1:
          return;
        case 2:
          break;
      }
    }
    if (this.getOpt('testChunks') && !this.tested) {
      this.test();
      return;
    }

    // Set up request and listen for event
    this.xhr = new XMLHttpRequest();

    // Progress
    this.xhr.upload.addEventListener(
      'progress',
      e => {
        if (
          Date.now() - this.lastProgressCallback >
          this.getOpt('throttleProgressCallbacks') * 1000
        ) {
          this.callback('progress');
          this.lastProgressCallback = new Date();
        }
        this.loaded = e.loaded || 0;
      },
      false
    );
    this.loaded = 0;
    this.pendingRetry = false;
    this.callback('progress');

    // Done (either done, failed or retry)
    const doneHandler = e => {
      const status = this.status();
      if (status === 'success' || status === 'error') {
        this.callback(status, this.message());
        this.resumableObj.uploadNextChunk();
      } else {
        this.callback('retry', this.message());
        this.abort();
        this.retries++;
        const retryInterval = this.getOpt('chunkRetryInterval');
        if (retryInterval !== undefined) {
          this.pendingRetry = true;
          setTimeout(this.send, retryInterval);
        } else {
          this.send();
        }
      }
    };

    this.xhr.addEventListener('load', doneHandler, false);
    this.xhr.addEventListener('error', doneHandler, false);
    this.xhr.addEventListener('timeout', doneHandler, false);

    // Set up the basic query data from Resumable
    const query = [
      ['chunkNumberParameterName', this.offset + 1],
      ['chunkSizeParameterName', this.getOpt('chunkSize')],
      ['currentChunkSizeParameterName', this.endByte - this.startByte],
      ['totalSizeParameterName', this.fileObjSize],
      ['typeParameterName', this.fileObjType],
      ['identifierParameterName', this.fileObj.uniqueIdentifier],
      ['fileNameParameterName', this.fileObj.fileName],
      ['relativePathParameterName', this.fileObj.relativePath],
      ['totalChunksParameterName', this.fileObj.chunks.length]
    ]
      .filter(pair => {
        // include items that resolve to truthy values
        // i.e. exclude false, null, undefined and empty strings
        return this.getOpt(pair[0]);
      })
      .reduce((query, pair) => {
        // assign query key/value
        query[this.getOpt(pair[0])] = pair[1];
        return query;
      }, {});
    // Mix in custom data
    let customQuery = this.getOpt('query');
    if (typeof customQuery === 'function') customQuery = customQuery(this.fileObj, this);
    Helper.each(customQuery, (k, v) => {
      query[k] = v;
    });

    const func = this.fileObj.file.slice
      ? 'slice'
      : this.fileObj.file.mozSlice
      ? 'mozSlice'
      : this.fileObj.file.webkitSlice
      ? 'webkitSlice'
      : 'slice';
    const bytes = this.fileObj.file[func](
      this.startByte,
      this.endByte,
      this.getOpt('setChunkTypeFromFile') ? this.fileObj.file.type : ''
    );
    const params: string[] = [];

    let data: Blob = null as any;
    let formData: FormData = null as any;

    const parameterNamespace = this.getOpt('parameterNamespace');
    if (this.getOpt('method') === 'octet') {
      // Add data from the query options
      data = bytes;
      Helper.each(query, (k, v) => {
        params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join('='));
      });
    } else {
      // Add data from the query options
      formData = new FormData();
      Helper.each(query, (k, v) => {
        formData.append(parameterNamespace + k, v);
        params.push([encodeURIComponent(parameterNamespace + k), encodeURIComponent(v)].join('='));
      });
      if (this.getOpt('chunkFormat') === 'blob') {
        formData.append(
          parameterNamespace + this.getOpt('fileParameterName'),
          bytes,
          this.fileObj.fileName
        );
      } else if (this.getOpt('chunkFormat') === 'base64') {
        const fr = new FileReader();
        fr.onload = e => {
          formData.append(
            parameterNamespace + this.getOpt('fileParameterName'),
            fr.result as string
          );
          this.xhr.send(formData);
        };
        fr.readAsDataURL(bytes);
      }
    }

    const targetOpt = this.getOpt('target');
    const testTargetOpt = this.getOpt('testTarget');

    const target = Helper.getTarget('upload', params, targetOpt, testTargetOpt);
    const method = this.getOpt('uploadMethod');

    this.xhr.open(method, target);
    if (this.getOpt('method') === 'octet') {
      this.xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    }
    this.xhr.timeout = this.getOpt('xhrTimeout');
    this.xhr.withCredentials = this.getOpt('withCredentials');
    // Add data from header options
    let customHeaders = this.getOpt('headers');
    if (typeof customHeaders === 'function') {
      customHeaders = customHeaders(this.fileObj, this);
    }

    Helper.each(customHeaders, (k, v) => {
      this.xhr.setRequestHeader(k, v);
    });

    if (this.getOpt('chunkFormat') === 'blob') {
      this.xhr.send(formData || data);
    }
  }

  abort() {
    // Abort and reset
    if (this.xhr) this.xhr.abort();
    this.xhr = null as any;
  }

  status() {
    // Returns: 'pending', 'uploading', 'success', 'error'
    if (this.pendingRetry) {
      // if pending retry then that's effectively the same as actively uploading,
      // there might just be a slight delay before the retry starts
      return 'uploading';
    } else if (!this.xhr) {
      return 'pending';
    } else if (this.xhr.readyState < 4) {
      // Status is really 'OPENED', 'HEADERS_RECEIVED' or 'LOADING' - meaning that stuff is happening
      return 'uploading';
    } else {
      if (this.xhr.status === 200 || this.xhr.status === 201) {
        // HTTP 200, 201 (created)
        return 'success';
      } else if (
        Helper.contains(this.getOpt('permanentErrors'), this.xhr.status) ||
        this.retries >= this.getOpt('maxChunkRetries')
      ) {
        // HTTP 415/500/501, permanent error
        return 'error';
      } else {
        // this should never happen, but we'll reset and queue a retry
        // a likely case for this would be 503 service unavailable
        this.abort();
        return 'pending';
      }
    }
  }

  message() {
    return this.xhr ? this.xhr.responseText : '';
  }

  progress(relative) {
    if (typeof relative === 'undefined') relative = false;
    let factor = relative ? (this.endByte - this.startByte) / this.fileObjSize : 1;
    if (this.pendingRetry) return 0;
    if (!this.xhr || !this.xhr.status) factor *= 0.95;
    const s = this.status();
    switch (s) {
      case 'success':
      case 'error':
        return 1 * factor;
      case 'pending':
        return 0 * factor;
      default:
        return (this.loaded / (this.endByte - this.startByte)) * factor;
    }
  }
}

abstract class Helper {
  static stopEvent(e) {
    e.stopPropagation();
    e.preventDefault();
  }

  static each<T>(o: T[] | Object, callback) {
    if (o instanceof FileList || Array.isArray(o)) {
      for (let i = 0; i < o.length; i++) {
        // Array or FileList
        if (callback(o[i]) === false) return;
      }
    } else {
      for (let i in o) {
        // Object
        if (callback(i, o[i]) === false) return;
      }
    }
  }

  static generateUniqueIdentifier(file, event, customFn) {
    if (typeof customFn === 'function') {
      return customFn(file, event);
    }
    const relativePath = file.webkitRelativePath || file.fileName || file.name; // Some confusion in different versions of Firefox
    const size = file.size;
    return size + '-' + relativePath.replace(/[^0-9a-zA-Z_-]/gim, '');
  }

  static contains(array, test) {
    let result = false;

    Helper.each(array, value => {
      if (value === test) {
        result = true;
        return false;
      }
      return true;
    });

    return result;
  }

  static formatSize(size) {
    if (size < 1024) {
      return size + ' bytes';
    } else if (size < 1024 * 1024) {
      return (size / 1024.0).toFixed(0) + ' KB';
    } else if (size < 1024 * 1024 * 1024) {
      return (size / 1024.0 / 1024.0).toFixed(1) + ' MB';
    } else {
      return (size / 1024.0 / 1024.0 / 1024.0).toFixed(1) + ' GB';
    }
  }

  static getTarget(request, params, target, testTarget) {
    if (request === 'test' && testTarget) {
      target = testTarget === '/' ? target : testTarget;
    }

    if (typeof target === 'function') {
      return target(params);
    }

    const separator = target.indexOf('?') < 0 ? '?' : '&';
    const joinedParams = params.join('&');

    return target + separator + joinedParams;
  }
}
