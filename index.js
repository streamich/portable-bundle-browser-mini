/// <reference path="../typing.d.ts" />
var fs = require('fs');
var extend = require('./extend');


var volpath = __dirname + '/build/lib.json';
try {
    var lib_json = fs.readFileSync(volpath).toString();
    var lib = JSON.parse(lib_json);
} catch(e) {
    throw Error('Could not find library volume: ' + volpath);
}


function bundle_browser_micro(bundle, props) {

    var volumes = {
        '/lib': lib
    };

    bundle.conf.volumes.forEach(function(volume) {
        volumes[volume[0]] = bundle.layers.getLayer(volume[1]).toJson();
    });

    var env = {};
    if(props.env) {
        env = extend(env, props.env);
    }

    var process = {
        platform: 'browser',
        env: env,
        argv: props.argv ? props.argv : ['/usr/index.js'],
        drives: volumes
    };

    var out = '';
    if(props.minify) {
        out = '(function(p){eval(p.drives["/lib"]["portable.js"])(p)})(' + JSON.stringify(process) + ');\n';
    } else {
        out = '(function(process) { eval(process.drives["/lib"]["portable.js"])(process); })(' + JSON.stringify(process, null, 4) + ');\n';
    }

    return out;
}

module.exports = bundle_browser_micro;