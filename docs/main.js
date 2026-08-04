(() => {
  'use strict';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => [...c.querySelectorAll(s)];

  const header = $('.site-header');
  if (header) {
    const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 12);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
  }

  const toggle = $('.nav-toggle');
  const links = $('.nav-links');
  if (toggle && links) {
    const backdrop = document.createElement('div');
    backdrop.className = 'nav-backdrop';
    document.body.appendChild(backdrop);
    const setOpen = (open) => {
      toggle.setAttribute('aria-expanded', String(open));
      links.classList.toggle('open', open);
      backdrop.classList.toggle('show', open);
      document.body.classList.toggle('nav-open', open);
    };
    toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true'));
    backdrop.addEventListener('click', () => setOpen(false));
    links.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
    addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });
  }

  const reveals = $$('.reveal');
  if (reveals.length && 'IntersectionObserver' in window &&
      !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el) => io.observe(el));
    $$('.stagger').forEach((g) => $$(':scope > *', g).forEach((c, i) => c.style.setProperty('--i', i)));
  } else {
    reveals.forEach((el) => el.classList.add('in'));
  }

  const KEY = 'bhj_bag';
  const getCount = () => parseInt(localStorage.getItem(KEY) || '0', 10);
  const renderBag = () => $$('.bag-count').forEach((n) => (n.textContent = getCount()));
  renderBag();

  let toastEl;
  const toast = (msg) => {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'toast';
      toastEl.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 6 9 17l-5-5"/></svg><span></span>';
      document.body.appendChild(toastEl);
    }
    $('span', toastEl).textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  };

  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add]');
    if (!add) return;
    e.preventDefault();
    localStorage.setItem(KEY, String(getCount() + 1));
    renderBag();
    toast(`Added to bag — ${add.getAttribute('data-add') || 'item'}`);
  });

  const filterBar = $('.filters');
  if (filterBar) {
    const items = $$('.product-grid .product');
    filterBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter');
      if (!btn) return;
      $$('.filter', filterBar).forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      const cat = btn.dataset.filter;
      items.forEach((it) => {
        const show = cat === 'all' || it.dataset.cat === cat;
        it.style.display = show ? '' : 'none';
      });
    });
  }

  const form = $('.form');
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      toast('Thank you — we’ll be in touch shortly.');
      form.reset();
    });
  }

  $$('[data-year]').forEach((n) => (n.textContent = new Date().getFullYear()));

  // hero carousel — auto-advance, dots, swipe, hover-pause, reduced-motion safe
  const carousel = $('[data-carousel]');
  if (carousel) {
    const slides = $$('.hero-slide', carousel);
    const dotsWrap = $('.hero-dots', carousel);
    const reduceC = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let idx = 0, timer = null;
    const dots = slides.map((_, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('aria-label', 'Piece ' + (i + 1));
      b.setAttribute('aria-current', i === 0 ? 'true' : 'false');
      b.addEventListener('click', () => { go(i); restart(); });
      dotsWrap.appendChild(b);
      return b;
    });
    function go(n) {
      slides[idx].classList.remove('is-active');
      dots[idx].setAttribute('aria-current', 'false');
      idx = (n + slides.length) % slides.length;
      slides[idx].classList.add('is-active');
      dots[idx].setAttribute('aria-current', 'true');
    }
    function restart() { if (reduceC) return; clearInterval(timer); timer = setInterval(() => go(idx + 1), 4200); }
    restart();
    carousel.addEventListener('mouseenter', () => clearInterval(timer));
    carousel.addEventListener('mouseleave', restart);
    let x0 = null;
    carousel.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    carousel.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) { go(idx + (dx < 0 ? 1 : -1)); restart(); }
      x0 = null;
    }, { passive: true });
  }
})();
