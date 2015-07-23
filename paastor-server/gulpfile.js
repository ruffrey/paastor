var gulp = require('gulp');
var jade = require('gulp-jade');
var notify = require('gulp-notify');
var browserify = require('gulp-browserify');
var uglify = require('gulp-uglify');

gulp.task('js', function () {
    // Single entry point to browserify
    gulp.src('./public/js/app.js')
        .pipe(browserify({
              insertGlobals : true,
              debug: !gulp.env.production
        }))
        .pipe(uglify())
        .pipe(gulp.dest('./public/build/js'))
        .pipe(notify({ message: 'JS recompiled' }));
});

gulp.task('jade-templates', function () {
    return gulp.src('./views/templates/**/*.jade')
        .pipe(jade({
            pretty: true,
        }))
        .pipe(gulp.dest('./public/build/html/'))
        .pipe(notify({ message: 'Jade angular views rebuilt' }));
});

gulp.task('jade-pages', function () {
    return gulp.src(['./views/pages/**/*.jade'])
        .pipe(jade({
            pretty: true,
        }))
        .pipe(gulp.dest('./public/pages/'))
        .pipe(notify({ message: 'Jade pages rebuilt' }));
});

gulp.task('watch', function () {
    gulp.watch('./views/templates/**/*.jade', ['jade-templates']);
    gulp.watch(['./views/pages/**/*.jade', './views/layout.jade'], ['jade-pages']);
    gulp.watch('./public/js/**/*.js', ['js']);
});

gulp.task('default', ['jade-templates', 'jade-pages', 'js', 'watch']);
