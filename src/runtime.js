/* Trusted enhancement. Content/navigation remain available without JavaScript. */
(() => {
  const button = document.querySelector('[data-menu-toggle]');
  const nav = button && document.getElementById(button.getAttribute('aria-controls'));
  if (button && nav) {
    const setOpen = open => {
      nav.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    };
    button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', event => { if (event.target.closest('a')) setOpen(false); });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') { setOpen(false); button.focus(); }
    });
    document.documentElement.classList.add('js');
  }
})();
