'use strict';

/**
 * Module dependencies.
 * @private
 */

var pathToRegexpV8 = require('path-to-regexp').pathToRegexp;

/**
 * Module variables.
 * @private
 */

var MATCHING_GROUP_REGEXP = /\((?!\?)/g;

/**
 * Generate a path regexp with Express 4 compatibility.
 *
 * Uses path-to-regexp v8 for compatible path strings and falls back to the
 * legacy 0.1.x compiler for Express 4 style patterns that v8 intentionally
 * no longer supports (e.g. unnamed "*" and inline regexp captures).
 *
 * @param {string|RegExp|Array} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

module.exports = function pathRegexp(path, keys, options) {
  options = options || {};
  keys = keys || [];

  if (path instanceof RegExp) {
    return regexpToRegexp(path, keys);
  }

  if (Array.isArray(path)) {
    return arrayToRegexp(path, keys, options);
  }

  if (typeof path !== 'string') {
    return regexpToRegexp(new RegExp(path), keys);
  }

  if (shouldUseLegacyCompiler(path)) {
    return stringToRegexpLegacy(path, keys, options);
  }

  return stringToRegexpV8(path, keys, options);
};

/**
 * Convert a regular expression to a path regexp.
 *
 * @param {RegExp} path
 * @param {Array} keys
 * @return {RegExp}
 * @private
 */

function regexpToRegexp(path, keys) {
  var i = 0;
  var m;

  while (m = MATCHING_GROUP_REGEXP.exec(path.source)) {
    keys.push({
      name: i++,
      optional: false,
      offset: m.index
    });
  }

  return path;
}

/**
 * Convert an array of paths to a single regexp.
 *
 * @param {Array} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

function arrayToRegexp(path, keys, options) {
  var flags = options.sensitive ? '' : 'i';

  path = path.map(function (value) {
    return module.exports(value, keys, options).source;
  });

  return new RegExp('(?:' + path.join('|') + ')', flags);
}

/**
 * Convert a path string with path-to-regexp v8.
 *
 * @param {string} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

function stringToRegexpV8(path, keys, options) {
  var result = pathToRegexpV8(path, {
    sensitive: options.sensitive,
    end: options.end !== false,
    trailing: !options.strict
  });
  var v8Keys = result.keys;

  for (var i = 0; i < v8Keys.length; i++) {
    keys.push({
      name: v8Keys[i].name,
      optional: false,
      offset: undefined
    });
  }

  return result.regexp;
}

/**
 * Determine if a route path should use the legacy compiler.
 *
 * @param {string} path
 * @return {boolean}
 * @private
 */

function shouldUseLegacyCompiler(path) {
  if (path === '*') {
    return true;
  }

  // Express 4 style path syntax that path-to-regexp v8 rejects.
  return /(^|[^\\])[?+*()[\]]/.test(path);
}

/**
 * Legacy path-to-regexp 0.1.x string compiler.
 *
 * @param {string} path
 * @param {Array} keys
 * @param {Object} options
 * @return {RegExp}
 * @private
 */

function stringToRegexpLegacy(path, keys, options) {
  var strict = options.strict;
  var end = options.end !== false;
  var flags = options.sensitive ? '' : 'i';
  var extraOffset = 0;
  var keysOffset = keys.length;
  var i = 0;
  var name = 0;
  var m;

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
