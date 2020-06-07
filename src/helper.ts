export class Helper {
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
