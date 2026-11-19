// Loaded from index.html (kept out of an inline <script> so the Content-Security-Policy can forbid inline scripts).
// Installed iPhone app (home screen, black-translucent status bar): the page runs under the
// status bar. Some iOS versions report env(safe-area-inset-top) = 0 there, which puts the
// header (and the menu button) under the clock, where taps go to the system. When that
// happens, push the header down by the status-bar height for this screen size.
(function () {
  var standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var ios = /iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1 && /Mobile/.test(navigator.userAgent));
  if (!standalone || !ios) return;
  var probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;top:0;left:0;width:1px;visibility:hidden;pointer-events:none;height:env(safe-area-inset-top,0px)';
  document.body.appendChild(probe);
  function guess() {
    var h = Math.max(screen.width, screen.height);
    if (h >= 852) return 59;   // Dynamic Island phones (14 Pro and later, 15, 16, 17)
    if (h >= 844) return 47;   // 12 / 13 / 14
    if (h >= 812) return 44;   // X / XS / 11 Pro / mini
    return 20;                 // home-button phones
  }
  function fix() {
    var root = document.documentElement;
    var portrait = window.innerHeight > window.innerWidth;
    var reported = probe.offsetHeight;
    // the page fills the whole screen = it is under the status bar
    var underBar = window.innerHeight >= Math.max(screen.width, screen.height) - 2 || window.innerHeight >= screen.height - 2;
    if (reported > 0 || !portrait || !underBar) root.style.removeProperty('--safe-top');
    else root.style.setProperty('--safe-top', guess() + 'px');
  }
  fix();
  window.addEventListener('resize', fix);
  window.addEventListener('orientationchange', function () { setTimeout(fix, 300); });
  window.addEventListener('pageshow', fix);
})();
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  });
}
