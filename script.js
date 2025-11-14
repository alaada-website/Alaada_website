// script.js — final unified, conflict-free version
(function () {
  'use strict';

  /* -------------------------
     Helper - safe element getter
  --------------------------*/
  const $ = id => document.getElementById(id);

  /* -------------------------
     Append hamburger + overlay CSS once
  --------------------------*/
  const ensureInlineCSS = () => {
    if (document.getElementById('inline-hamburger-css')) return;
    const style = document.createElement('style');
    style.id = 'inline-hamburger-css';
    style.textContent = `
      /* hamburger visuals & overlay visible state */
      .menu-icon { cursor: pointer; display: inline-flex; align-items: center; justify-content: center; color: inherit; }
      .menu-icon span { display: block; height: 2px; width: 18px; margin: 4px 0; background: currentColor; border-radius: 2px; transition: transform .24s ease, opacity .18s ease; }
      .menu-icon.open span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }
      .menu-icon.open span:nth-child(2) { opacity: 0; transform: translateX(-6px); }
      .menu-icon.open span:nth-child(3) { transform: rotate(-45deg) translate(6px, -6px); }
      .close-overlay { position: fixed; inset: 0; z-index: 1150; display: none; background: rgba(0,0,0,0.36); }
      body.menu-open .close-overlay { display: block; }
      /* utility for nav open state if CSS expects .open */
      #navLinks.open { left: 0 !important; }
    `;
    document.head.appendChild(style);
  };

  /* -------------------------
     Smooth scroll handlers
  --------------------------*/
  const initSmoothScroll = () => {
    const getStarted = $('getStarted');
    const learnMore = $('learnMore');

    if (getStarted) {
      getStarted.addEventListener('click', (e) => {
        e.preventDefault();
        const join = $('join');
        if (join) join.scrollIntoView({ behavior: 'smooth' });
      });
    }
    if (learnMore) {
      learnMore.addEventListener('click', (e) => {
        e.preventDefault();
        const about = $('about');
        if (about) about.scrollIntoView({ behavior: 'smooth' });
      });
    }
  };

  /* -------------------------
     Generic form submit handler
  --------------------------*/
  const handleFormSubmit = (form, statusEl, texts = {}) => {
    if (!form) return;
    const {
      sending = 'Sending...',
      success = '✅ Sent!',
      failed = '❌ Failed. Try again later.',
      network = '⚠️ Network error. Please try again.',
      local = '✅ (Local) handled'
    } = texts;

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (statusEl) { statusEl.style.display = 'block'; statusEl.textContent = sending; statusEl.style.opacity = '1'; }

      const url = form.getAttribute('action') || form.dataset.action || '';
      const formData = new FormData(form);

      if (!url) {
        if (statusEl) { statusEl.textContent = local; statusEl.style.color = '#00c853'; }
        form.reset();
        setTimeout(() => { if (statusEl) statusEl.style.opacity = '0'; }, 3000);
        return;
      }

      try {
        const resp = await fetch(url, { method: 'POST', body: formData, headers: { 'Accept': 'application/json' }});
        if (resp.ok) {
          if (statusEl) { statusEl.textContent = success; statusEl.style.color = '#00c853'; }
          form.reset();
          setTimeout(() => { if (statusEl) statusEl.style.opacity = '0'; }, 3000);
        } else {
          if (statusEl) { statusEl.textContent = failed; statusEl.style.color = '#ff4d4d'; }
        }
      } catch (err) {
        if (statusEl) { statusEl.textContent = network; statusEl.style.color = '#ff4d4d'; }
        console.error('Form submit error:', err);
      }
    });
  };

  const initForms = () => {
    const joinForm = $('joinForm');
    const thankyouMsg = $('thankyouMsg');
    if (joinForm) handleFormSubmit(joinForm, thankyouMsg, {
      sending: 'Sending...',
      success: '✅ Thank you for joining the journey!',
      local: '✅ Thank you — (local submit)'
    });

    const contactForm = $('contactForm');
    const statusMessage = $('statusMessage');
    if (contactForm) handleFormSubmit(contactForm, statusMessage, {
      sending: 'Sending...',
      success: '✅ Message sent successfully!',
      local: '✅ (Local) Message handled — form reset.'
    });
  };

  /* -------------------------
     Fade-in observer
  --------------------------*/
  const initFadeSections = () => {
    const sections = document.querySelectorAll('.fade-section');
    if (!sections || sections.length === 0) return;
    if ('IntersectionObserver' in window) {
      const obs = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) entry.target.classList.add('visible');
        });
      }, { threshold: 0.1 });
      sections.forEach(s => obs.observe(s));
    } else {
      sections.forEach(s => s.classList.add('visible'));
    }
  };

  /* -------------------------
     Hero canvas particles
  --------------------------*/
  const initHeroCanvas = () => {
    const canvas = $('heroCanvas');
    if (!canvas) return;
    const ctx = (canvas.getContext && canvas.getContext('2d')) || null;
    if (!ctx) return;

    const setSize = () => { canvas.width = window.innerWidth; canvas.height = window.innerHeight; };
    setSize();

    let particles = [];
    const particleCount = 100;

    const initParticles = () => {
      particles = [];
      for (let i = 0; i < particleCount; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: Math.random() * 2 + 1,
          speedX: (Math.random() - 0.5) * 0.5,
          speedY: (Math.random() - 0.5) * 0.5
        });
      }
    };
    initParticles();

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,127,80,0.7)';
        ctx.fill();
        p.x += p.speedX; p.y += p.speedY;
        if (p.x < 0) p.x = canvas.width;
        if (p.x > canvas.width) p.x = 0;
        if (p.y < 0) p.y = canvas.height;
        if (p.y > canvas.height) p.y = 0;
      });
      requestAnimationFrame(animate);
    };
    animate();

    window.addEventListener('resize', () => { setSize(); initParticles(); }, { passive: true });
  };

  /* -------------------------
     Navbar scroll effect
  --------------------------*/
  const initNavbarScroll = () => {
    const navbar = $('navbar');
    if (!navbar) return;
    const onScroll = () => {
      if (window.scrollY > 50) navbar.classList.add('scrolled');
      else navbar.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  };

  /* -------------------------
     Unified slide-in sidebar menu
  --------------------------*/
  const initSidebarMenu = () => {
    const menuToggle = $('menuToggle') || document.querySelector('.menu-icon');
    const navLinks = $('navLinks') || document.querySelector('#navLinks') || document.querySelector('nav');

    if (!menuToggle || !navLinks) return;

    ensureInlineCSS();

    // create overlay if not present
    let overlay = document.querySelector('.close-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'close-overlay';
      overlay.setAttribute('aria-hidden', 'true');
      document.body.appendChild(overlay);
    }

    const openMenu = () => {
      navLinks.classList.add('open');
      menuToggle.classList.add('open');
      document.body.classList.add('menu-open');
      document.documentElement.style.overflow = 'hidden';
      document.body.style.overflow = 'hidden';
      navLinks.setAttribute('aria-hidden', 'false');
      menuToggle.setAttribute('aria-expanded', 'true');
    };

    const closeMenu = () => {
      navLinks.classList.remove('open');
      menuToggle.classList.remove('open');
      document.body.classList.remove('menu-open');
      document.documentElement.style.overflow = '';
      document.body.style.overflow = '';
      navLinks.setAttribute('aria-hidden', 'true');
      menuToggle.setAttribute('aria-expanded', 'false');
    };

    // single toggle handler
    const onToggle = (e) => {
      e.stopPropagation();
      if (navLinks.classList.contains('open')) closeMenu();
      else openMenu();
    };
    menuToggle.addEventListener('click', onToggle);

    // overlay click closes
    overlay.addEventListener('click', closeMenu);

    // close on link click (delay slightly to allow navigation)
    try {
      const links = navLinks.querySelectorAll('a');
      links.forEach(a => a.addEventListener('click', () => setTimeout(closeMenu, 120)));
    } catch (err) {
      /* not a normal container — ignore */
    }

    // close on Escape
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Escape' || e.key === 'Esc') && navLinks.classList.contains('open')) closeMenu();
    });

    // close if window becomes wide (keep state sane)
    window.addEventListener('resize', () => {
      if (window.innerWidth > 900 && navLinks.classList.contains('open')) closeMenu();
    }, { passive: true });
  };

  /* -------------------------
     Rocket animation starter (on load)
  --------------------------*/
  const initRocket = () => {
    window.addEventListener('load', () => {
      try {
        const rocket = document.querySelector('.rocket');
        if (rocket) rocket.style.animationPlayState = 'running';
      } catch (err) { /* ignore */ }
    });
  };

  /* -------------------------
     Initialize everything once
  --------------------------*/
  document.addEventListener('DOMContentLoaded', () => {
    try {
      initSmoothScroll();
      initForms();
      initFadeSections();
      initHeroCanvas();
      initNavbarScroll();
      initSidebarMenu();
      initRocket();

      // ensure nav aria-hidden default
      const navLinks = $('navLinks') || document.querySelector('#navLinks') || document.querySelector('nav');
      if (navLinks) navLinks.setAttribute('aria-hidden', navLinks.classList.contains('open') ? 'false' : 'true');
    } catch (err) {
      console.error('Initialization error:', err);
    }
  });

})();
