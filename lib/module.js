var NM = require('nm');
var util = require('util');
var fs = require('fs');
var path = require('path');


var assert = function ok(value, message) {
    if(!value) throw Error('Assert: ' + message);
};


// `var runInThisContext = require('vm').runInThisContext;`
// For now we do it like this, since the `vm` implements it with `eval` anyways. The benefit is that
// this makes `vm` module no required for our minimal build.
var runInThisContext = eval;

// Folder where `node_modules` are stored.
var node_modules_folder = 'node_modules';

// If obj.hasOwnProperty has been overridden, then calling
// obj.hasOwnProperty(prop) will break.
// See: https://github.com/joyent/node/issues/1707
function hasOwnProperty(obj, prop) {
    return Object.prototype.hasOwnProperty.call(obj, prop);
}


function Module(id, parent) {
    this.id = id;
    this.exports = {};
    this.parent = parent;
    if(parent && parent.children) {
        parent.children.push(this);
    }
    this.filename = null;
    this.loaded = false;
    this.children = [];
}
module.exports = Module;

Module._cache = {};
Module._pathCache = {};
Module._extensions = {};
var modulePaths = [];
Module.globalPaths = [];

Module.wrapper = NM.wrapper;
Module.wrap = NM.wrap;


// given a module name, and a list of paths to test, returns the first
// matching file in the following precedence.
//
// require("a.<ext>")
//   -> a.<ext>
//
// require("a")
//   -> a
//   -> a.<ext>
//   -> a/index.<ext>
function statPath(path) {
    try {
        return fs.statSync(path);
    } catch (ex) {}
    return false;
}

// check if the directory is a package.json dir
var packageMainCache = {};

function readPackage(requestPath) {
    if (hasOwnProperty(packageMainCache, requestPath)) {
        return packageMainCache[requestPath];
    }

    try {
        var jsonPath = path.resolve(requestPath, 'package.json');
        var json = fs.readFileSync(jsonPath, 'utf8');
    } catch (e) {
        return false;
    }

    try {
        var pkg = packageMainCache[requestPath] = JSON.parse(json).main;
    } catch (e) {
        e.path = jsonPath;
        e.message = 'Error parsing ' + jsonPath + ': ' + e.message;
        throw e;
    }
    return pkg;
}

function tryPackage(requestPath, exts) {
    // TODO: Shall we just assume `index.js`, if no package.json available, so that we don't have to include those.
    var pkg = readPackage(requestPath);

    if (!pkg) return false;

    var filename = path.resolve(requestPath, pkg);
    return tryFile(filename) || tryExtensions(filename, exts) ||
        tryExtensions(path.resolve(filename, 'index'), exts);
}

// In order to minimize unnecessary lstat() calls,
// this cache is a list of known-real paths.
// Set to an empty object to reset.
// TODO: Don't need that since our `fs` is in-memory anyways.
//Module._realpathCache = {};

// check if the file exists and is not a directory
function tryFile(requestPath) {
    var stats = statPath(requestPath);
    if (stats && !stats.isDirectory()) {
        //return fs.realpathSync(requestPath, Module._realpathCache);
        return fs.realpathSync(requestPath);
    }
    return false;
}

// given a path check a the file exists with any of the set extensions
function tryExtensions(p, exts) {
    for (var i = 0, EL = exts.length; i < EL; i++) {
        var filename = tryFile(p + exts[i]);

        if (filename) {
            return filename;
        }
    }
    return false;
}


Module._findPath = function(request, paths) {
    var exts = Object.keys(Module._extensions);

    if (request.charAt(0) === '/') {
        paths = [''];
    }

    var trailingSlash = (request.slice(-1) === '/');

    var cacheKey = JSON.stringify({request: request, paths: paths});
    if (Module._pathCache[cacheKey]) {
        return Module._pathCache[cacheKey];
    }

    // For each path
    for (var i = 0, PL = paths.length; i < PL; i++) {
        var basePath = path.resolve(paths[i], request);

        var filename;

        if (!trailingSlash) {
            // try to join the request to the path
            filename = tryFile(basePath);

            if (!filename && !trailingSlash) {
                // try it with each of the extensions
                filename = tryExtensions(basePath, exts);
            }
        }

        if (!filename) {
            filename = tryPackage(basePath, exts);
        }

        if (!filename) {
            // try it with each of the extensions at "index"
            filename = tryExtensions(path.resolve(basePath, 'index'), exts);
        }

        if (filename) {
            Module._pathCache[cacheKey] = filename;
            return filename;
        }
    }
    return false;
};

// 'from' is the __dirname of the module.
Module._nodeModulePaths = function(from) {
    // guarantee that 'from' is absolute.
    from = path.resolve(from);

    // note: this approach *only* works when the path is guaranteed
    // to be absolute.  Doing a fully-edge-case-correct path.split
    // that works on both Windows and Posix is non-trivial.
    // TODO: process.platform = 'browser'
    //var splitRe = process.platform === 'win32' ? /[\/\\]/ : /\//;
    var splitRe = /\//;
    var paths = [];
    var parts = from.split(splitRe);

    for (var tip = parts.length - 1; tip >= 0; tip--) {
        // don't search in .../node_modules/node_modules
        if (parts[tip] === node_modules_folder) continue;
        var dir = parts.slice(0, tip + 1).concat(node_modules_folder).join(path.sep);
        paths.push(dir);
    }

    return paths;
};


Module._resolveLookupPaths = function(request, parent) {
    if (NM.exists(request)) {
        return [request, []];
    }

    var start = request.substring(0, 2);
    if (start !== './' && start !== '..') {
        var paths = modulePaths;
        if (parent) {
            if (!parent.paths) parent.paths = [];
            paths = parent.paths.concat(paths);
        }
        return [request, paths];
    }

    // with --eval, parent.id is not set and parent.filename is null
    if (!parent || !parent.id || !parent.filename) {
        // make require('./path/to/foo') work - normally the path is taken
        // from realpath(__filename) but with eval there is no filename
        var mainPaths = ['.'].concat(modulePaths);
        mainPaths = Module._nodeModulePaths('.').concat(mainPaths);
        return [request, mainPaths];
    }

    // Is the parent an index module?
    // We can assume the parent has a valid extension,
    // as it already has been accepted as a module.
    var isIndex = /^index\.\w+?$/.test(path.basename(parent.filename));
    var parentIdPath = isIndex ? parent.id : path.dirname(parent.id);
    var id = path.resolve(parentIdPath, request);

    // make sure require('./path') and require('path') get distinct ids, even
    // when called from the toplevel js file
    if (parentIdPath === '.' && id.indexOf('/') === -1) {
        id = './' + id;
    }


    return [id, [path.dirname(parent.filename)]];
};


// Check the cache for the requested file.
// 1. If a module already exists in the cache: return its exports object.
// 2. If the module is native: call `NM.require()` with the
//    filename and return the result.
// 3. Otherwise, create a new module for the file and save it to the cache.
//    Then have it load  the file contents before returning its exports
//    object.
Module._load = function(request, parent, isMain) {
    var filename = Module._resolveFilename(request, parent);

    var cachedModule = Module._cache[filename];
    if(cachedModule) {
        return cachedModule.exports;
    }

    if (NM.exists(filename)) {
        return NM.require(filename);
    }

    var module = new Module(filename, parent);

    if (isMain) {
        process.mainModule = module;
        module.id = '.';
    }

    Module._cache[filename] = module;

    var hadException = true;

    try {
        module.load(filename);
        hadException = false;
    } finally {
        if (hadException) {
            delete Module._cache[filename];
        }
    }

    return module.exports;
};

Module._resolveFilename = function(request, parent) {
    if(NM.exists(request)) {
        return request;
    }

    var resolvedModule = Module._resolveLookupPaths(request, parent);
    var id = resolvedModule[0];
    var paths = resolvedModule[1];

    var filename = Module._findPath(request, paths);

    if (!filename) {
        var err = new Error("Cannot find module '" + request + "'");
        err.code = 'MODULE_NOT_FOUND';
        throw err;
    }
    return filename;
};


// Given a file name, pass it to the proper extension handler.
Module.prototype.load = function(filename) {

    assert(!this.loaded);
    this.filename = filename;
    this.paths = Module._nodeModulePaths(path.dirname(filename));

    var extension = path.extname(filename) || '.js';
    if (!Module._extensions[extension]) extension = '.js';
    Module._extensions[extension](this, filename);
    this.loaded = true;
};


// Loads a module at the given file path. Returns that module's
// `exports` property.
Module.prototype.require = function(path) {
    assert(path, 'missing path');
    assert(util.isString(path), 'path must be a string');
    return Module._load(path, this);
};


// Run the file contents in the correct scope or sandbox. Expose
// the correct helper variables (require, module, exports) to
// the file.
// Returns exception, if any.
Module.prototype._compile = function(content, filename) {
    var self = this;
    // remove shebang
    content = content.replace(/^\#\!.*/, '');

    function require(path) {
        return self.require(path);
    }

    require.resolve = function(request) {
        return Module._resolveFilename(request, self);
    };

    Object.defineProperty(require, 'paths', { get: function() {
        throw new Error('require.paths is removed. Use ' +
            'node_modules folders, or the NODE_PATH ' +
            'environment variable instead.');
    }});

    require.main = process.mainModule;

    // Enable support to add extra extension types
    require.extensions = Module._extensions;
    require.registerExtension = function() {
        throw new Error('require.registerExtension() removed. Use ' +
            'require.extensions instead.');
    };

    require.cache = Module._cache;

    var dirname = path.dirname(filename);

    // create wrapper function
    var wrapper = Module.wrap(content);

    var compiledWrapper = runInThisContext(wrapper);
    var args = [self.exports, require, self, filename, dirname, process];
    return compiledWrapper.apply(self.exports, args);
};


function stripBOM(content) {
    if (content.charCodeAt(0) === 0xFEFF) {
        content = content.slice(1);
    }
    return content;
}


// Native extension for .js
Module._extensions['.js'] = function(module, filename) {
    var content = fs.readFileSync(filename, 'utf8');
    module._compile(stripBOM(content), filename);
};


// Native extension for .json
Module._extensions['.json'] = function(module, filename) {
    var content = fs.readFileSync(filename, 'utf8');
    try {
        module.exports = JSON.parse(stripBOM(content));
    } catch (err) {
        err.message = filename + ': ' + err.message;
        throw err;
    }
};

// bootstrap main module.
Module.runMain = function() {
    Module._load(process.argv[0], null, true);
};

Module._initPaths = function() {
    var paths = [path.resolve('..', '..', 'lib', 'portable')];
    modulePaths = paths;

    // clone as a read-only copy, for introspection.
    Module.globalPaths = modulePaths.slice(0);
};

Module._initPaths();

// backwards compatibility
// TODO: Do we need this? Will be removed, if not.
Module.Module = Module;
