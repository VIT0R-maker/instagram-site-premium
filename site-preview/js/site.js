(() => {
  const root = document.documentElement;
  root.classList.add('js');

  const button = document.querySelector('[data-menu-toggle]');
  const nav = button && document.getElementById(button.getAttribute('aria-controls'));
  if (button && nav) {
    const setOpen = open => {
      nav.classList.toggle('is-open', open);
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Fechar menu' : 'Abrir menu');
    };
    button.addEventListener('click', () => setOpen(button.getAttribute('aria-expanded') !== 'true'));
    nav.addEventListener('click', event => {
      if (event.target.closest('a')) setOpen(false);
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && button.getAttribute('aria-expanded') === 'true') {
        setOpen(false);
        button.focus();
      }
    });
    window.matchMedia('(min-width: 900px)').addEventListener('change', event => {
      if (event.matches) setOpen(false);
    });
  }

  const dlg = document.getElementById('lightbox');
  const items = Array.from(document.querySelectorAll('[data-lightbox-index]'));
  if (dlg && items.length && typeof dlg.showModal === 'function') {
    const img = document.getElementById('lightbox-img');
    const cap = document.getElementById('lightbox-caption');
    const count = document.getElementById('lightbox-count');
    const n = items.length;
    let current = 0;
    let lastTrigger = null;

    const show = index => {
      current = (index + n) % n;
      const b = items[current];
      img.src = b.dataset.full;
      img.alt = b.dataset.alt || '';
      img.width = Number(b.dataset.w) || 720;
      img.height = Number(b.dataset.h) || 1280;
      cap.textContent = b.dataset.caption || '';
      count.textContent = (current + 1) + ' / ' + n;
    };

    items.forEach((b, i) => {
      b.addEventListener('click', () => {
        lastTrigger = b;
        show(i);
        dlg.showModal();
      });
    });

    dlg.querySelector('[data-lightbox-close]').addEventListener('click', () => dlg.close());
    dlg.querySelector('[data-lightbox-next]').addEventListener('click', () => show(current + 1));
    dlg.querySelector('[data-lightbox-prev]').addEventListener('click', () => show(current - 1));
    dlg.addEventListener('click', event => {
      if (event.target === dlg) dlg.close();
    });
    dlg.addEventListener('keydown', event => {
      if (event.key === 'ArrowRight') { event.preventDefault(); show(current + 1); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); show(current - 1); }
    });
    dlg.addEventListener('close', () => {
      if (lastTrigger) lastTrigger.focus();
    });
  }
})();
