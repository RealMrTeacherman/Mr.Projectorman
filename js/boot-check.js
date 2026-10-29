// boot-check.js: a plain (non-module) script. If the app hasn't started within
// a few seconds, show what went wrong on the page instead of a blank screen.
(function () {
  var errors = [];
  window.addEventListener('error', function (e) {
    var where = e.filename ? ' (' + e.filename.split('/').slice(-2).join('/') + (e.lineno ? ':' + e.lineno : '') + ')' : '';
    var t = e.target;
    if (t && t !== window && (t.src || t.href)) {
      errors.push('Could not load ' + (t.src || t.href) + '. Check that this file is in the repo (or that the internet connection allows it).');
      return;
    }
    errors.push((e.message || String(e.error)) + where);
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    errors.push(String((e.reason && e.reason.message) || e.reason));
  });
  window.showStartupProblem = function (msg) {
    var box = document.getElementById('bootError');
    if (!box) return;
    box.querySelector('pre').textContent = msg;
    box.hidden = false;
  };
  setTimeout(function () {
    if (window.__appStarted) return;
    window.showStartupProblem(errors.length ? errors.join('\n') : 'No error was reported. A file may be missing from the repo, or GitHub Pages may still be updating (wait a minute and reload).');
  }, 6000);
})();
