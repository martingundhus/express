'use strict';

/**
 * Module dependencies.
 * @private
 */

var pathToRegexp = require('path-to-regexp').pathToRegexp;

/**
 * Module exports.
 * @public
 */

module.exports = pathRegexp;

/**
 * Match matching groups in a regular expression.
 * @private
 */

var MATCHING_GROUP_REGEXP = /\((?!\?)/g;

/**
 * Compile layer path to regexp and hydrate keys array.
 *
 * Uses path-to-regexp v8 when possible, while preserving
 * Express 4 path semantics through a legacy fallback.
 *
 * @param {string|RegExp|Array} path
 * @param {Array} keys
 * @param {object} options
 * @return {RegExp}
 * @private
 */

function pathRegexp(path, keys, options) {
  options = options || {};
  keys = keys || [];

  if (path instanceof RegExp || Array.isArray(path) || !canUseV8(path)) {
    return legacyPathRegexp(path, keys, options);
  }

  try {
    var result = pathToRegexp(path, {
      sensitive: options.sensitive,
      end: options.end,
      trailing: options.strict !== true
    });

    for (var i = 0; i < result.keys.length; i++) {
      keys.push({
        name: result.keys[i].name,
        optional: false
      });
    }

    return result.regexp;
  } catch (err) {
    return legacyPathRegexp(path, keys, options);
  }
}

/**
 * Check if path syntax is safe for v8 semantics.
 *
 * Express 4 treats characters like ?, +, * and () as
 * pattern operators. In v8 these either changed meaning
 * or are rejected, so we keep those on the legacy path.
 *
 * @param {*} path
 * @return {boolean}
 * @private
 */

function canUseV8(path) {
  return typeof path === 'string'
    && path.indexOf('\\') === -1
    && !/[?+*()[\]{}!]/.test(path);
}

/**
 * Legacy path-to-regexp 0.1.x path compilation.
 *
 * @param {string|RegExp|Array} path
 * @param {Array} keys
 * @param {object} options
 * @return {RegExp}
 * @private
 */

function legacyPathRegexp(path, keys, options) {
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

  path = ('^' + path + (strict
    ? ''
    : path[path.length - 1] === '/'
      ? '?'
      : '/?'))
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

  path += end
    ? '$'
    : path[path.length - 1] === '/'
      ? ''
      : '(?=\\/|$)';

  return new RegExp(path, flags);
}
