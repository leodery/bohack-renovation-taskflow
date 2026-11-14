const play = document.querySelector('#play');
const stop = document.querySelector('#stop');
const status = document.querySelector('#scene-status');
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let swarm;

function finish() {
  swarm?.destroy();
  swarm = null;
  stop.hidden = true;
  play.disabled = false;
  play.hidden = reduced.matches;
  status.textContent = reduced.matches ? '已按减少动态效果设置显示完整流程。' : '';
}

play.onclick = async () => {
  if (reduced.matches || swarm) return;
  play.disabled = true;
  try {
    const {createSwarm} = await import('/static/vendor/swarm-rebuild/index.js');
    if (reduced.matches || !play.disabled) return;
    play.hidden = true;
    stop.hidden = false;
    swarm = createSwarm({
      trigger: 'manual', autoScroll: false, speed: 2.6,
      maxHeight: window.innerHeight, maxItems: 100, onComplete: finish,
    });
    swarm.start();
    document.querySelector('swarm-rebuild')?.style.setProperty('filter', 'grayscale(1)', 'important');
  } catch {
    finish();
    status.textContent = '动画暂时无法播放，可以阅读上方协作流程。';
  }
};
stop.onclick = finish;
reduced.addEventListener('change', finish);
window.addEventListener('pagehide', finish);
finish();
