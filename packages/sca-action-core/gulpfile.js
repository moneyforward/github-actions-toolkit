const del = require('del');
const gulp = require('gulp');
const Command = require('@moneyforward/command').default;

exports['transpile:tsc'] = function tsc() {
  return Command.execute('tsc');
}

exports['lint:eslint'] = function eslint() {
  return Command.execute('eslint', ['.', '--ext', '.js,.jsx,.ts,.tsx']);
}

exports['test:mocha'] = function mocha() {
  return Command.execute('mocha', ['-c']);
}

exports['watch:typescript'] = function watchTypeScript() {
  const task = gulp.parallel(exports['transpile:tsc'], exports['lint:eslint']);
  return gulp.watch('./src/**/*.ts{,x}', task);
}

exports.clean = function clean() {
  return del('dist');
};
exports.transpile = gulp.parallel(exports['transpile:tsc']);
exports.lint = gulp.parallel(exports['lint:eslint']);
exports.build = gulp.parallel(exports.lint, exports.transpile);
exports.test = gulp.series(exports['test:mocha']);
exports.watch = gulp.parallel(exports['watch:typescript']);
exports.default = exports.build;
