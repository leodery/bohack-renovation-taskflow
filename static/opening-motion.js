const dialog = document.querySelector('#collaboration-story');
const scene = document.querySelector('#story-scene');
let opener;

document.addEventListener('click', event => {
  const button = event.target.closest('[data-open-story]');
  if (button) {
    opener = button;
    const frame = document.createElement('iframe');
    frame.title = '家装变更协作开场动画';
    frame.src = '/static/collaboration-scene.html';
    frame.addEventListener('load', () => {
      frame.contentDocument?.addEventListener('keydown', event => {
        if (event.key === 'Escape' && dialog.open) dialog.close();
      });
    }, {once: true});
    scene.replaceChildren(frame);
    dialog.showModal();
  }
  if (event.target.closest('[data-close-story]')) dialog.close();
});

dialog.addEventListener('close', () => {
  scene.replaceChildren();
  if (opener?.isConnected) opener.focus();
});
