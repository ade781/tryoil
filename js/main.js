(() => {
  'use strict';

  function setCurrentYear() {
    const yearEl = document.getElementById('year');
    if (yearEl) {
      yearEl.textContent = String(new Date().getFullYear());
    }
  }

  function initMobileNav() {
    const menuToggle = document.getElementById('menuToggle');
    const mobileNav = document.getElementById('mobileNav');
    if (!menuToggle || !mobileNav) return;

    const setOpen = (isOpen) => {
      mobileNav.hidden = !isOpen;
      if (isOpen) {
        mobileNav.classList.remove('hidden');
      }
      menuToggle.setAttribute('aria-expanded', String(isOpen));
    };

    menuToggle.addEventListener('click', () => {
      const isCurrentlyHidden =
        mobileNav.hidden || mobileNav.classList.contains('hidden');
      setOpen(isCurrentlyHidden);
    });

    mobileNav.addEventListener('click', (event) => {
      if (event.target.closest('a')) {
        setOpen(false);
      }
    });
  }

  function findFaqPanel(trigger) {
    if (
      trigger.nextElementSibling &&
      trigger.nextElementSibling.classList.contains('faq-panel')
    ) {
      return trigger.nextElementSibling;
    }

    const controlsId = trigger.getAttribute('aria-controls');
    if (controlsId) {
      const controlled = document.getElementById(controlsId);
      if (controlled && controlled.classList.contains('faq-panel')) {
        return controlled;
      }
    }

    const parentNext = trigger.parentElement?.nextElementSibling;
    if (parentNext && parentNext.classList.contains('faq-panel')) {
      return parentNext;
    }

    return trigger.parentElement?.querySelector('.faq-panel') || null;
  }

  function initFaqAccordion() {
    const triggers = document.querySelectorAll('.faq-trigger');
    triggers.forEach((trigger) => {
      const panel = findFaqPanel(trigger);
      if (!panel) return;

      trigger.addEventListener('click', () => {
        const isExpanded = trigger.getAttribute('aria-expanded') === 'true';
        const nextExpanded = !isExpanded;
        trigger.setAttribute('aria-expanded', String(nextExpanded));
        panel.hidden = !nextExpanded;
      });
    });
  }

  function fallbackCopyText(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } finally {
      document.body.removeChild(textarea);
    }
    return copied;
  }

  function initCopyUrl() {
    const copyBtn = document.getElementById('copyUrlBtn');
    const feedbackEl = document.getElementById('copyFeedback');
    if (!copyBtn || !feedbackEl) return;

    let feedbackTimer = null;

    const showFeedback = (message) => {
      feedbackEl.textContent = message;
      if (feedbackTimer) {
        clearTimeout(feedbackTimer);
      }
      feedbackTimer = setTimeout(() => {
        feedbackEl.textContent = '';
        feedbackTimer = null;
      }, 3000);
    };

    copyBtn.addEventListener('click', async () => {
      const url = window.location.href;
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else if (!fallbackCopyText(url)) {
          throw new Error('Copy failed');
        }
        showFeedback('URL copied to clipboard.');
      } catch {
        if (fallbackCopyText(url)) {
          showFeedback('URL copied to clipboard.');
        } else {
          showFeedback('Unable to copy URL.');
        }
      }
    });
  }

  function initQuoteForm() {
    const form = document.getElementById('quoteForm');
    const nameInput = document.getElementById('quoteName');
    const emailInput = document.getElementById('quoteEmail');
    const messageInput = document.getElementById('quoteMessage');
    const statusEl = document.getElementById('quoteStatus');

    if (!form || !nameInput || !emailInput || !messageInput || !statusEl) {
      return;
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    form.addEventListener('submit', (event) => {
      event.preventDefault();

      const name = nameInput.value.trim();
      const email = emailInput.value.trim();
      const message = messageInput.value.trim();

      if (!name) {
        statusEl.dataset.state = 'error';
        statusEl.textContent = 'Please enter your name.';
        nameInput.focus();
        return;
      }

      if (!email || !emailPattern.test(email)) {
        statusEl.dataset.state = 'error';
        statusEl.textContent = 'Please enter a valid email address.';
        emailInput.focus();
        return;
      }

      if (!message) {
        statusEl.dataset.state = 'error';
        statusEl.textContent = 'Please enter your message.';
        messageInput.focus();
        return;
      }

      statusEl.dataset.state = 'success';
      statusEl.textContent = 'Thank you! Your quote request has been received.';
      form.reset();
    });
  }

  function init() {
    setCurrentYear();
    initMobileNav();
    initFaqAccordion();
    initCopyUrl();
    initQuoteForm();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
