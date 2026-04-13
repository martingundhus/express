/*!
 * express
 * MIT Licensed
 */

'use strict';

/**
 * Module dependencies.
 * @private
 */

var pathToRegexp = require('path-to-regexp').pathToRegexp;

/**
 * Match matching groups in a regular expression.
 *
 * This is used by the legacy fallback compiler to preserve
 * Express 4 route syntax behavior.
 * @private
 */

var MATCHING_GROUP_REGEXP = /\((?!\?)/g;

/**
 * Normalize path input into a RegExp and key array.
 *
 * Uses path-to-regexp 8 when possible, then falls back to the
 * legacy 0.1.x compiler for legacy route pattern syntax that v8
 * intentionally rejects.
 *
 * @param {String|RegExp|Array} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

module.exports = function pathRegexp(path, keys, options) {
  var opts = options || {};
  var list = keys || [];

  // Keep wildcard-only routes on the historical fast-path and avoid
  // v8 parse errors for unnamed wildcards.
  if (path === '*' || shouldUseLegacy(path)) {
    return legacyPathRegexp(path, list, opts);
  }

  try {
    return compileWithV8(path, list, opts);
  } catch (err) {
    return legacyPathRegexp(path, list, opts);
  }
};

function shouldUseLegacy(path) {
  if (Array.isArray(path)) {
    for (var i = 0; i < path.length; i++) {
      if (shouldUseLegacy(path[i])) {
        return true;
      }
    }

    return false;
  }

  if (path instanceof RegExp || typeof path !== 'string') {
    return true;
  }

  // Express 4 historically supports regexp-like string tokens.
  return /[\*\?\+\(\)]/.test(path);
}

function compileWithV8(path, keys, options) {
  var result = pathToRegexp(path, {
    end: options.end !== false,
    sensitive: Boolean(options.sensitive),
    trailing: options.strict !== true
  });

  for (var i = 0; i < result.keys.length; i++) {
    keys.push({
      name: result.keys[i].name,
      optional: false,
      offset: 0
    });
  }

  return result.regexp;
}

function legacyPathRegexp(path, keys, options) {
  options = options || {};
  keys = keys || [];

  var strict = options.strict;
  var end = options.end !== false;
  var flags = options.sensitive ? '' : 'i';
  var extraOffset = 0;
  var keysOffset = keys.length;
  var i = 0;
  var name = 0;
  var m;

  if (path instanceof RegExp) {
    while (m = MATCHING_GROUP_REGEXP.exec(path.source)) {
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

  path = ('^' + path + (strict ? '' : path[path.length - 1] === '/' ? '?' : '/?'))
    .replace(/\/\(/g, '/(?:')
    .replace(/([\/\.])/g, '\\$1')
    .replace(/(\\\/)?(\\\.)?:(\w+)(\(.*?\))?(\*)?(\?)?/g, function (match, slash, format, key, capture, star, optional, offset) {
      slash = slash || '';
      format = format || '';
      capture = capture || '([^\\/' + format + ']+?)';
      optional = optional || '';

      keys.push({
        name: key,
        optional: !!optional,
        offset: offset + extraOffset
      });

      var result = ''
        + (optional ? '' : slash)
        + '(?:'
        + format + (optional ? slash : '') + capture
        + (star ? '((?:[\\/' + format + '].+?)?)' : '')
        + ')'
        + optional;

      extraOffset += result.length - match.length;

      return result;
    })
    .replace(/\*/g, function (star, index) {
      var len = keys.length;

      while (len-- > keysOffset && keys[len].offset > index) {
        keys[len].offset += 3;
      }

      return '(.*)';
    });

  while (m = MATCHING_GROUP_REGEXP.exec(path)) {
    var escapeCount = 0;
    var index = m.index;

    while (path.charAt(--index) === '\\') {
      escapeCount++;
    }

    if (escapeCount % 2 === 1) {
      continue;
    }

    if (keysOffset + i === keys.length || keys[keysOffset + i].offset > m.index) {
      keys.splice(keysOffset + i, 0, {
        name: name++,
        optional: false,
        offset: m.index
      });
    }

    i++;
  }

  path += (end ? '$' : (path[path.length - 1] === '/' ? '' : '(?=\\/|$)'));

  return new RegExp(path, flags);
}
