/*!
 * express
 * Copyright(c) 2009-2013 TJ Holowaychuk
 * Copyright(c) 2013 Roman Shtylman
 * Copyright(c) 2014-2015 Douglas Christopher Wilson
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var pathToRegexp = require('path-to-regexp');
var debug = require('debug')('express:router:layer');

/**
 * Module variables.
 * @private
 */

var hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Module exports.
 * @public
 */

module.exports = Layer;

function Layer(path, options, fn) {
  if (!(this instanceof Layer)) {
    return new Layer(path, options, fn);
  }

  debug('new %o', path)
  var opts = options || {};

  this.handle = fn;
  this.name = fn.name || '<anonymous>';
  this.params = undefined;
  this.path = undefined;
  this.keys = [];
  this.regexp = pathRegexp(path, this.keys, opts);

  // set fast path flags
  this.regexp.fast_star = path === '*'
  this.regexp.fast_slash = path === '/' && opts.end === false
}

/**
 * Handle the error for the layer.
 *
 * @param {Error} error
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */

Layer.prototype.handle_error = function handle_error(error, req, res, next) {
  var fn = this.handle;

  if (fn.length !== 4) {
    // not a standard error handler
    return next(error);
  }

  try {
    fn(error, req, res, next);
  } catch (err) {
    next(err);
  }
};

/**
 * Handle the request for the layer.
 *
 * @param {Request} req
 * @param {Response} res
 * @param {function} next
 * @api private
 */

Layer.prototype.handle_request = function handle(req, res, next) {
  var fn = this.handle;

  if (fn.length > 3) {
    // not a standard request handler
    return next();
  }

  try {
    fn(req, res, next);
  } catch (err) {
    next(err);
  }
};

/**
 * Check if this route matches `path`, if so
 * populate `.params`.
 *
 * @param {String} path
 * @return {Boolean}
 * @api private
 */

Layer.prototype.match = function match(path) {
  var match

  if (path != null) {
    // fast path non-ending match for / (any path matches)
    if (this.regexp.fast_slash) {
      this.params = {}
      this.path = ''
      return true
    }

    // fast path for * (everything matched in a param)
    if (this.regexp.fast_star) {
      this.params = {'0': decode_param(path)}
      this.path = path
      return true
    }

    // match the path
    match = this.regexp.exec(path)
  }

  if (!match) {
    this.params = undefined;
    this.path = undefined;
    return false;
  }

  // store values
  this.params = {};
  this.path = match[0]

  var keys = this.keys;
  var params = this.params;

  for (var i = 1; i < match.length; i++) {
    var key = keys[i - 1];
    var prop = key && key.name != null
      ? key.name
      : i - 1;
    var val = decode_param(match[i])

    if (val !== undefined || !(hasOwnProperty.call(params, prop))) {
      params[prop] = val;
    }
  }

  return true;
};

/**
 * Compile path string to a regular expression.
 *
 * @param {(string|RegExp|Array)} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

function pathRegexp(path, keys, options) {
  var opts = options || {};

  // Express special-case: '*' matches any path and populates param 0.
  if (path === '*') {
    return /(?:.*)/;
  }

  if (path instanceof RegExp) {
    return path;
  }

  var normalized = normalizePath(path);
  var pathToRegexpFn = getPathToRegexp();
  var pathOptions = {
    sensitive: opts.sensitive,
    end: opts.end,
    trailing: opts.strict !== true
  };
  var result = pathToRegexpFn(normalized.path, pathOptions);

  appendKeys(keys, result.keys, normalized.keyMap);
  return result.regexp;
}

/**
 * Normalize legacy Express 4 path tokens to path-to-regexp v8 syntax.
 *
 * @param {(string|Array)} path
 * @return {{path: (string|Array), keyMap: Object}}
 * @private
 */

function normalizePath(path) {
  var keyMap = Object.create(null);
  var unnamedStarIndex = 0;

  function normalizeString(str) {
    var normalized = str;

    // Convert :name(*) to *name
    normalized = normalized.replace(/:([A-Za-z0-9_]+)\(\*\)/g, '*$1');

    // Convert optional params like /:id? and .:ext? to group syntax.
    normalized = normalized
      .replace(/(\/:[A-Za-z0-9_]+)\?/g, '{$1}')
      .replace(/([.])(:[A-Za-z0-9_]+)\?/g, '{$1$2}');

    // Convert unnamed wildcard * to named wildcard tokens.
    normalized = normalized.replace(/(^|\/)\*(?![A-Za-z0-9_])/g, function (_, prefix) {
      var name = 'splat' + unnamedStarIndex++;
      keyMap[name] = String(unnamedStarIndex - 1);
      return prefix + '*' + name;
    });

    return normalized;
  }

  if (Array.isArray(path)) {
    return {
      path: path.map(normalizeString),
      keyMap: keyMap
    };
  }

  return {
    path: normalizeString(path),
    keyMap: keyMap
  };
}

/**
 * Get pathToRegexp compiler from CommonJS exports.
 *
 * @return {Function}
 * @private
 */

function getPathToRegexp() {
  return typeof pathToRegexp.pathToRegexp === 'function'
    ? pathToRegexp.pathToRegexp
    : pathToRegexp;
}

/**
 * Append keys from compiler output, applying legacy key-name mapping.
 *
 * @param {Array} target
 * @param {Array} source
 * @param {Object} keyMap
 * @private
 */

function appendKeys(target, source, keyMap) {
  for (var i = 0; i < source.length; i++) {
    var key = source[i];
    var mappedName = keyMap[key.name];

    if (mappedName !== undefined) {
      key = {
        name: mappedName
      };
    }

    target.push(key);
  }
}

/**
 * Decode param value.
 *
 * @param {string} val
 * @return {string}
 * @private
 */

function decode_param(val) {
  if (typeof val !== 'string' || val.length === 0) {
    return val;
  }

  try {
    return decodeURIComponent(val);
  } catch (err) {
    if (err instanceof URIError) {
      err.message = 'Failed to decode param \'' + val + '\'';
      err.status = err.statusCode = 400;
    }

    throw err;
  }
}
