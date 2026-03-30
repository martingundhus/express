'use strict'

/**
 * Module dependencies.
 */

var express = require('../../..');
var fs = require('fs');
var path = require('path');

module.exports = function(parent, options){
  var dir = path.join(__dirname, '..', 'controllers');
  var verbose = options.verbose;
  fs.readdirSync(dir).forEach(function(controllerDirName){
    var file = path.join(dir, controllerDirName)
    if (!fs.statSync(file).isDirectory()) return;
    verbose && console.log('\n   %s:', controllerDirName);
    var obj = require(file);
    var name = obj.name || controllerDirName;
    var prefix = obj.prefix || '';
    var app = express();
    var handler;
    var method;
    var url;

    // allow specifying the view engine
    if (obj.engine) app.set('view engine', obj.engine);
    app.set('views', path.join(__dirname, '..', 'controllers', name, 'views'));

    // generate routes based
    // on the exported methods
    var keys = Object.keys(obj);

    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      // "reserved" exports
      if (~['name', 'prefix', 'engine', 'before'].indexOf(key)) continue;
      // route exports
      switch (key) {
        case 'show':
          method = 'get';
          url = '/' + name + '/:' + name + '_id';
          break;
        case 'list':
          method = 'get';
          url = '/' + name + 's';
          break;
        case 'edit':
          method = 'get';
          url = '/' + name + '/:' + name + '_id/edit';
          break;
        case 'update':
          method = 'put';
          url = '/' + name + '/:' + name + '_id';
          break;
        case 'create':
          method = 'post';
          url = '/' + name;
          break;
        case 'index':
          method = 'get';
          url = '/';
          break;
        default:
          /* istanbul ignore next */
          throw new Error('unrecognized route: ' + name + '.' + key);
      }

      // setup
      handler = obj[key];
      url = prefix + url;

      // before middleware support
      if (obj.before) {
        app[method](url, obj.before, handler);
        verbose && console.log('     %s %s -> before -> %s', method.toUpperCase(), url, key);
      } else {
        app[method](url, handler);
        verbose && console.log('     %s %s -> %s', method.toUpperCase(), url, key);
      }
    }

    // mount the app
    parent.use(app);
  });
};
