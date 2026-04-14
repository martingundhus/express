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

var pathToRegexp = require('path-to-regexp').pathToRegexp;
var debug = require('debug')('express:router:layer');

/**
 * Module variables.
 * @private
 */

var hasOwnProperty = Object.prototype.hasOwnProperty;
var TRAILING_SLASH_REGEXP = /\/$/
var MATCHING_GROUP_REGEXP = /\((?!\?)/g;

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
  this.regexp = pathRegexp(path, this.keys = [], opts);

  // set fast path flags
  this.regexp.fast_star = path === '*'
  this.regexp.fast_slash = path === '/' && opts.end === false
}

/**
 * Compile path to a regular expression with the v8 API.
 * Falls back to legacy syntax support to preserve Express 4 behavior.
 *
 * @param {string|RegExp|Array} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

function pathRegexp(path, keys, options) {
  var opts = options || {};

  if (path instanceof RegExp || Array.isArray(path)) {
    return legacyPathRegexp(path, keys, opts);
  }

  try {
    var result = pathToRegexp(path, {
      sensitive: opts.sensitive,
      end: opts.end,
      trailing: !opts.strict
    });

    for (var i = 0; i < result.keys.length; i++) {
      keys.push({
        name: result.keys[i].name,
        optional: false
      });
    }

    return result.regexp;
  } catch (err) {
    return legacyPathRegexp(path, keys, opts);
  }
}

/**
 * Legacy path-to-regexp 0.1.x compiler.
 *
 * @param {string|RegExp|Array} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

function legacyPathRegexp(path, keys, options) {
  var opts = options || {};
  var strict = opts.strict;
  var end = opts.end !== false;
  var flags = opts.sensitive ? '' : 'i';
  var extraOffset = 0;
  var name = 0;
  var m;

  if (path instanceof RegExp) {
    while ((m = MATCHING_GROUP_REGEXP.exec(path.source))) {
      if (path.source[m.index - 1] === '\\') {
        continue;
      }

      keys.push({
        name: name++,
        optional: false,
        offset: m.index
      });
    }

    return path;
  }

  if (Array.isArray(path)) {
    path = path.map(function (value) {
      return legacyPathRegexp(value, keys, options).source;
    });

    return new RegExp('(?:' + path.join('|') + ')', flags);
  }

  path = '^' + path + (strict ? '' : path[path.length - 1] === '/' ? '?' : '/?');

  path = path
    .replace(/\/(\()/g, '/(?:')
    .replace(/([\/.])/g, '\\$1')
    .replace(/(\\\/)?(\\\.)?:(\w+)(\(((?:\\.|[^\\()])+)\))?(\*)?(\?)?/g, function (_, slash, format, key, capture, group, star, optional, offset) {
      slash = slash || '';
      format = format || '';
      capture = capture || (group ? group.replace(/\\\./g, '.') : '[^\\/' + format + ']+?');
      optional = optional || '';

      keys.push({
        name: key,
        optional: !!optional,
        offset: offset + extraOffset
      });

      var result = ''
        + (optional ? '' : slash)
        + '(?:'
        + format
        + (optional ? slash : '')
        + '(' + capture + ')'
        + (star ? '((?:[\\/' + format + '].+?)?)' : '')
        + ')'
        + optional;

      extraOffset += result.length - _.length;
      return result;
    })
    .replace(/\*/g, '(.*)');

  if (end) {
    path += '$';
  } else {
    path += strict && TRAILING_SLASH_REGEXP.test(path)
      ? ''
      : '(?=\\/|$)';
  }

  return new RegExp(path, flags);
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
    var prop = key.name;
    var val = decode_param(match[i])

    if (val !== undefined || !(hasOwnProperty.call(params, prop))) {
      params[prop] = val;
    }
  }

  return true;
};

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
