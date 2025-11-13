// script.js — robust, page-safe version
document.addEventListener('DOMContentLoaded', () => {

  /* --------------------------------------------------------------------------
     Helper - safe element getter
  ---------------------------------------------------------------------------*/
  const $ = id => document.getElementById(id);

  /* --------------------------------------------------------------------------
     Smooth scroll for hero buttons (if present)
  ---------------------------------------------------------------------------*/
  const getStarted = $('getStarted');
  const learnMore = $('learnMore');

  if (getStarted) {
    getStarted.addEventListener('click', () => {
      const join = $('join');
      if (join) join.scrollIntoView({ behavior: 'smooth' });
    });
  }

  if (learnMore) {
    learnMore.addEventListener('click', () => {
      const about = $('about');
      if (about) about.scrollIntoView({ behavior: 'smooth' });
    });
  }

  /* --------------------------------------------------------------------------
     Join form (Formspree) — prevent redirect, show thank you
     - Uses the form's action attribute if present.
  ---------------------------------------------------------------------------*/
  const joinForm = $('joinForm');
  const thankyouMsg = $('thankyouMsg');

  if (joinForm) {
    joinForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (thankyouMsg) {
        thankyouMsg.style.display = 'block';
        thankyouMsg.textContent = 'Sending...';
      }

      const url = joinForm.getAttribute('action') || '';
      const formData = new FormData(joinForm);

      // If action is empty, simply show a local thank you and return
      if (!url) {
        if (thankyouMsg) thankyouMsg.textContent = '✅ Thank you — (local submit)';
        joinForm.reset();
        setTimeout(() => { if (thankyouMsg) thankyouMsg.style.display = 'none'; }, 3000);
        return;
      }

      try {
        const resp = await fetch(url, {
          method: 'POST',
          body: formData,
          headers: { 'Accept': 'application/json' }
        });

        if (resp.ok) {
          if (thankyouMsg) {
            thankyouMsg.textContent = '✅ Thank you for joining the journey!';
            thankyouMsg.style.color = '#ff7f50';
          }
          joinForm.reset();
          setTimeout(() => { if (thankyouMsg) thankyouMsg.style.display = 'none'; }, 4000);
        } else {
          if (thankyouMsg) {
            thankyouMsg.textContent = '❌ Submission failed. Try again later.';
            thankyouMsg.style.color = '#ff4d4d';
          }
        }
      } catch (err) {
        if (thankyouMsg) {
          thankyouMsg.textContent = '⚠️ Network error. Please try again.';
          thankyouMsg.style.color = '#ff4d4d';
        }
        console.error('Join form submit error:', err);
      }
    });
  }

  /* --------------------------------------------------------------------------
     Contact form — prevent redirect, show inline status (works same as join)
     - Looks for form with id "contactForm"
  ---------------------------------------------------------------------------*/
  const contactForm = $('contactForm');
  const statusMessage = $('statusMessage');

  if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (statusMessage) {
        statusMessage.textContent = 'Sending...';
        statusMessage.style.opacity = '1';
      }

      const url = contactForm.getAttribute('action') || contactForm.dataset.action || '';
      const formData = new FormData(contactForm);

      // If no action attribute, try Formspree default inlined by user; otherwise use a no-op
      if (!url) {
        // If you want to handle submissions locally, implement that here.
        if (statusMessage) {
          statusMessage.textContent = '✅ (Local) Message handled — form reset.';
          statusMessage.style.color = '#00ff7f';
        }
        contactForm.reset();
        setTimeout(() => { if (statusMessage) statusMessage.style.opacity = '0'; }, 3000);
        return;
      }

      try {
        const resp = await fetch(url, {
          method: 'POST',
          body: formData,
          headers: { 'Accept': 'application/json' }
        });

        if (resp.ok) {
          if (statusMessage) {
            statusMessage.textContent = '✅ Message sent successfully!';
            statusMessage.style.color = '#00ff7f';
          }
          contactForm.reset();
          setTimeout(() => { if (statusMessage) statusMessage.style.opacity = '0'; }, 3000);
        } else {
          if (statusMessage) {
            statusMessage.textContent = '❌ Failed to send. Try again later.';
            statusMessage.style.color = '#ff4d4d';
          }
        }
      } catch (err) {
        if (statusMessage) {
          statusMessage.textContent = '⚠️ Network error. Please try again.';
          statusMessage.style.color = '#ff4d4d';
        }
        console.error('Contact form submit error:', err);
      }
    });
  }

  /* --------------------------------------------------------------------------
     Intersection Observer for fade-in sections (safe)
  ---------------------------------------------------------------------------*/
  const fadeSections = document.querySelectorAll('.fade-section');
  if (fadeSections && fadeSections.length > 0 && 'IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) entry.target.classList.add('visible');
      });
    }, { threshold: 0.1 });

    fadeSections.forEach(section => observer.observe(section));
  } else {
    // If IntersectionObserver not available, just reveal sections
    fadeSections.forEach(s => s.classList.add('visible'));
  }

  /* --------------------------------------------------------------------------
     Hero particle canvas (safe: only if canvas exists and has 2d context)
  ---------------------------------------------------------------------------*/
  const canvas = $('heroCanvas');
  if (canvas) {
    const ctx = canvas.getContext && canvas.getContext('2d');
    if (ctx) {
      const setSize = () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
      };
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

      function animateParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(255,127,80,0.7)';
          ctx.fill();
          p.x += p.speedX;
          p.y += p.speedY;

          if (p.x < 0) p.x = canvas.width;
          if (p.x > canvas.width) p.x = 0;
          if (p.y < 0) p.y = canvas.height;
          if (p.y > canvas.height) p.y = 0;
        });
        requestAnimationFrame(animateParticles);
      }
      animateParticles();

      window.addEventListener('resize', () => {
        setSize();
        initParticles();
      });
    }
  }

  /* --------------------------------------------------------------------------
     Navbar scroll effect (safe)
  ---------------------------------------------------------------------------*/
  const navbar = $('navbar');
  if (navbar) {
    const onScroll = () => {
      if (window.scrollY > 50) navbar.classList.add('scrolled');
      else navbar.classList.remove('scrolled');
    };
    window.addEventListener('scroll', onScroll);
    onScroll();
  }

  /* --------------------------------------------------------------------------
     Mobile menu toggle / hamburger (safe)
     - Expects menuToggle and navLinks ids (if you named them differently, update)
  ---------------------------------------------------------------------------*/
  const menuToggle = $('menuToggle') || $('menu-toggle') || document.querySelector('.menu-icon');
  const navLinks = $('navLinks') || document.querySelector('#navLinks') || document.querySelector('nav');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('active');
      menuToggle.classList.toggle('open');

      // Animate hamburger spans if they exist
      const spans = menuToggle.querySelectorAll('span');
      if (spans && spans.length >= 3) {
        spans[0].classList.toggle('rotate1');
        spans[1].classList.toggle('hide');
        spans[2].classList.toggle('rotate2');
      }
    });
  }

  /* --------------------------------------------------------------------------
     Append small inline CSS for hamburger animation (only once)
  ---------------------------------------------------------------------------*/
  if (!document.getElementById('inline-hamburger-css')) {
    const style = document.createElement('style');
    style.id = 'inline-hamburger-css';
    style.textContent = `
      .menu-icon.open span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }
      .menu-icon.open span:nth-child(2) { opacity: 0; }
      .menu-icon.open span:nth-child(3) { transform: rotate(-45deg) translate(6px, -6px); }
      .rotate1 { transform: rotate(45deg) translate(5px, 5px); }
      .rotate2 { transform: rotate(-45deg) translate(6px, -6px); }
      .hide { opacity: 0; }
    `;
    document.head.appendChild(style);
  }

}); // DOMContentLoaded

window.addEventListener('load', () => {
  const rocket = document.querySelector('.rocket');
  rocket.style.animationPlayState = 'running';
});
