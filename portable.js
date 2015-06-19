
function wrap_portable(file) {
    // Because `portable.js` evaluates to nothing is wrapped in lambda function, so we wrap it here instead.
    if(file.filepath.match('portable\.js')) {
        file.raw = "(function(process){" + file.raw + "})";
    }
}

module.exports = {
    dest: './build',
    layer: {
        lib: {
            src: './lib',
            glob: '*.js',
            transform: [
                ['.+\.js$', 'uglify'],
                ['.+\.js$', wrap_portable]
            ]
        }
    }
};
