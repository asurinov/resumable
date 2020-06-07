import { Helper } from './helper';
import { ResumableFile } from './file';
import { ResumableChunk } from './chunk';

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
