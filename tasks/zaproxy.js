/*
 * grunt-zaproxy
 * https://github.com/TeamPraxis/grunt-zaproxy
 *
 * Copyright (c) 2014 Keith Hamasaki
 * Licensed under the MIT license.
 */
'use strict';

var path = require('path'),
    ZapClient = require('zaproxy'),
    spawn = require('child_process').spawn,
    _ = require('lodash');

module.exports = function (grunt) {

  // Please see the Grunt documentation for more information regarding task
  // creation: http://gruntjs.com/creating-tasks

  /**
   * Start ZAProxy and wait for it to finish initializing.
   **/
  grunt.registerTask('zap_start', 'Start ZAProxy.', function () {
    // Set up command line options.
    var options = this.options({
      host: 'localhost',
      port: '8080',
      daemon: true
    });

    var args = [];
    if (options.daemon) {
      args.push('-daemon');
    }
    if (options.config) {
      for (var k in options.config) {
        args.push('-config');
        args.push(k + '=' + options.config[k]);
      }
    }

    // Spawn ZAProxy 
    // var zapPath = path.join(__dirname, '../vendor/zap');
    // var cmd = path.join(options.path, 'zap.sh');
    grunt.log.write('Starting ZAProxy: ');
    var child = spawn('zap.sh', args);
    child.on('close', function (code) {
      if (code) {
        grunt.fail.warn('Error launching ZAProxy: ' + code);
      }
    });

    // Wait until the proxy is responding
    var done = this.async();
    var retryCount = 0;
    var zaproxy = new ZapClient({ proxy: 'http://' + options.host + ':' + options.port });
    var wait = function (callback) {
      zaproxy.core.version(function (err) {
        if (err) {
          grunt.log.write('.');
          retryCount += 1;
          if (retryCount > 30) {
            grunt.log.writeln('ZAProxy is taking too long, killing.');
            child.kill('SIGKILL');
            done();
          } else {
            setTimeout(function () {
              wait(callback);
            }, 1000);
          }
        } else {
          grunt.log.ok();
          done();
        }
      });
    };
    wait();
  });

  /**
   * Stop a running ZAProxy.
   **/
  grunt.registerTask('zap_stop', 'Stop ZAProxy.', function () {
    // Set up options.
    var options = this.options({
      host: 'localhost',
      port: '8080'
    });

    var asyncDone = this.async();

    // fail the build if zap_alert found errors
    var done = function () {
      if (grunt.config.get('zap_alert.failed')) {
        asyncDone(false);
      } else {
        asyncDone(true);
      }
    };

    var zaproxy = new ZapClient({ proxy: 'http://' + options.host + ':' + options.port });
    grunt.log.write('Stopping ZAProxy: ');
    zaproxy.core.shutdown(function (err) {
      if (err) {
        grunt.log.writeln('ZAProxy does not appear to be running.');
        done();
        return;
      }

      var retryCount = 0;
      var wait = function (callback) {
        zaproxy.core.version(function (err) {
          if (err) {
            grunt.log.ok();
            done();
          } else {
            grunt.log.write('.');
            retryCount += 1;
            if (retryCount > 30) {
              grunt.log.writeln('ZAProxy is taking too long, exiting.');
              done();
            } else {
              setTimeout(function () {
                wait(callback);
              }, 1000);
            }
          }
        });
      };
      wait();
    });
  });

  /**
   * Wait for a scan to finish.
   **/
  var waitForScan = function (zaproxy, statusFn, callback) {
    var wait = function () {
      statusFn(function (err, body) {
        if (err) {
          callback(err);
          return;
        }
        if (body.status < 100) {
          grunt.log.write('.');
          setTimeout(function () {
            wait(callback);
          }, 1000);
        } else {
          callback(null, body);
        }
      });
    };
    wait();
  };

  /**
   * Wait for passive scanning to finish.
   **/
  var waitForPassive = function (zaproxy, callback) {
    var wait = function () {
      zaproxy.pscan.recordsToScan(function (err, body) {
        if (err) {
          callback(err);
          return;
        }
        if (body.recordsToScan > 0) {
          grunt.log.write('.');
          setTimeout(function () {
            wait(callback);
          }, 1000);
        } else {
          callback(null, body);
        }
      });
    };
    wait();
  };

  /**
   * Initiate a spider scan and wait for it to finish.
   **/
  grunt.registerMultiTask('zap_spider', 'Execute a ZAProxy spider.', function () {
    // Set up options.
    var options = this.options({
      host: 'localhost',
      port: '8080'
    });

    // check for required options
    if (!options.url) {
      grunt.fail.warn('url must be defined.');
      return;
    }

    grunt.log.write('Spidering: ');
    var done = this.async();
    var zaproxy = new ZapClient({ proxy: 'http://' + options.host + ':' + options.port });
    _.bindAll(zaproxy.spider, _.functions(zaproxy.spider));

    zaproxy.spider.scan(options.url, function (err) {
      if (err) {
        grunt.fail.warn('Spider Error: ' + JSON.stringify(err, null, 2));
        done();
        return;
      }

      waitForScan(zaproxy, zaproxy.spider.status, function () {
        grunt.log.ok();
        done();
      });
    });
  });

  /**
   * Initiate an active scan and wait for it to finish.
   **/
  grunt.registerMultiTask('zap_scan', 'Execute a ZAProxy scan.', function () {
    // Set up options.
    var options = this.options({
      host: 'localhost',
      port: '8080'
    });

    // check for required options
    if (!options.url) {
      grunt.fail.warn('url must be defined.');
      return;
    }

    grunt.log.write('Scanning: ');
    var done = this.async();
    var zaproxy = new ZapClient({ proxy: 'http://' + options.host + ':' + options.port });
    _.bindAll(zaproxy.ascan, _.functions(zaproxy.ascan));

    zaproxy.ascan.scan(options.url, '', '', function (err) {
      if (err) {
        grunt.fail.warn('Scan Error: ' + JSON.stringify(err, null, 2));
        done();
        return;
      }

      waitForScan(zaproxy, zaproxy.ascan.status, function () {
        grunt.log.ok();
        done();
      });
    });
  });

  /**
   * Check alerts from a running ZAProxy.
   **/
  grunt.registerTask('zap_alert', 'Check alerts from ZAProxy.', function () {
    // Set up options.
    var options = this.options({
      host: 'localhost',
      port: '8080',
      ignore: []
    });

    var done = this.async();
    var zaproxy = new ZapClient({ proxy: 'http://' + options.host + ':' + options.port });

    grunt.log.write('Waiting for scanning to finish: ');
    waitForPassive(zaproxy, function (err) {
      if (err) {
        grunt.fail.warn('ZAProxy does not appear to be running.');
        done();
        return;
      }

      grunt.log.ok();
      grunt.log.write('Checking for alerts: ');
      zaproxy.core.alerts('', '', '', function (err, res) {
        if (err) {
          grunt.fail.warn('ZAProxy does not appear to be running.');
          done();
          return;
        }

        var alerts = _.chain(res.alerts)
              .filter(function (alert) {
                return !_.contains(options.ignore, alert.alert);
              })
              .value();

        if (alerts.length > 0) {
          grunt.log.error('Alerts found: ' + JSON.stringify(alerts, null, 2));

          // set a flag so that the cleanup task can fail the build
          grunt.config.set('zap_alert.failed', true);
        } else {
          grunt.config.set('zap_alert.failed', false);
          grunt.log.ok();
        }
        done();
      });
    });
  });
};